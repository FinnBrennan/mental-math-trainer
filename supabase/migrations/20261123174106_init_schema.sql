-- =========================================================
-- init_schema: profiles, sessions, problems, RLS, write path
-- =========================================================

-- ---------- profiles ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name  text,
  timezone      text not null default 'UTC',
  is_public     boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint public_needs_username check (not is_public or username is not null)
);

-- auto-create a profile for every new auth user (incl. anonymous guests)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- sessions ----------
create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  mode         text not null check (mode in ('ranked', 'practice')),
  ruleset      text,
  settings     jsonb not null,
  seed         bigint not null,
  duration_s   int not null check (duration_s between 10 and 600),
  score        int not null default 0 check (score >= 0),
  started_at   timestamptz not null default now(),
  app_version  text not null,
  client_meta  jsonb not null default '{}'::jsonb,
  constraint ranked_rules check (
    mode <> 'ranked' or (ruleset = 'default_v1' and duration_s = 120)
  )
);

create index sessions_user_mode_time_idx
  on public.sessions (user_id, mode, started_at desc);

-- ---------- problems ----------
create table public.problems (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  seq         int not null check (seq >= 0),
  op          text not null check (op in ('add', 'sub', 'mul', 'div')),
  a           int not null,
  b           int not null,
  answer      int not null,
  shown_ms    int not null check (shown_ms >= 0),
  solved_ms   int check (solved_ms is null or solved_ms >= shown_ms),
  latency_ms  int generated always as (solved_ms - shown_ms) stored,
  keystrokes  jsonb not null default '[]'::jsonb,
  unique (session_id, seq),
  constraint arithmetic_ok check (
       (op = 'add' and answer = a + b)
    or (op = 'sub' and answer = a - b)
    or (op = 'mul' and answer = a * b)
    or (op = 'div' and b <> 0 and a = answer * b)
  )
);

create index problems_user_idx on public.problems (user_id);

-- ---------- privileges: explicit, identical locally and in prod ----------
revoke all on public.profiles, public.sessions, public.problems from anon, authenticated;
grant select on public.profiles, public.sessions, public.problems to authenticated;
grant update (username, display_name, timezone) on public.profiles to authenticated;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.problems enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "read own sessions" on public.sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy "read own problems" on public.problems
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------- write path: the ONLY way rounds get saved ----------
create function public.submit_session(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_session   uuid;
  v_mode      text := payload->>'mode';
  v_duration  int  := (payload->>'duration_s')::int;
  v_bad       int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(payload->'problems') is distinct from 'array' then
    raise exception 'problems must be an array';
  end if;

  insert into public.sessions
    (user_id, mode, ruleset, settings, seed, duration_s, app_version, client_meta)
  values (
    v_user, v_mode, payload->>'ruleset', payload->'settings',
    (payload->>'seed')::bigint, v_duration, payload->>'app_version',
    coalesce(payload->'client_meta', '{}'::jsonb)
  )
  returning id into v_session;

  insert into public.problems
    (session_id, user_id, seq, op, a, b, answer, shown_ms, solved_ms, keystrokes)
  select v_session, v_user, p.seq, p.op, p.a, p.b, p.answer,
         p.shown_ms, p.solved_ms, coalesce(p.keystrokes, '[]'::jsonb)
  from jsonb_to_recordset(payload->'problems') as p(
    seq int, op text, a int, b int, answer int,
    shown_ms int, solved_ms int, keystrokes jsonb
  );

  -- every timing must sit inside the round
  select count(*) into v_bad from public.problems
  where session_id = v_session
    and (shown_ms > v_duration * 1000 or solved_ms > v_duration * 1000);
  if v_bad > 0 then
    raise exception 'problem timings outside round duration';
  end if;

  -- ranked rounds must use default Zetamac-style operand ranges
  if v_mode = 'ranked' then
    select count(*) into v_bad from public.problems
    where session_id = v_session and not (
         (op = 'add' and a between 2 and 100 and b between 2 and 100)
      or (op = 'sub' and b between 2 and 100 and answer between 2 and 100)
      or (op = 'mul' and a between 2 and 12  and b between 2 and 100)
      or (op = 'div' and b between 2 and 12  and answer between 2 and 100)
    );
    if v_bad > 0 then
      raise exception 'ranked round contains non-default problems';
    end if;
  end if;

  -- score is computed by the server, never trusted from the client
  update public.sessions
  set score = (select count(*) from public.problems
               where session_id = v_session and solved_ms is not null)
  where id = v_session;

  return v_session;
end;
$$;

-- ---------- public dashboard: aggregates only, opt-in profiles ----------
create function public.get_public_dashboard(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prof as (
    select id, display_name, timezone
    from public.profiles
    where username = lower(p_username) and is_public
  ),
  ranked as (
    select s.score, (s.started_at at time zone prof.timezone)::date as day
    from public.sessions s
    join prof on s.user_id = prof.id
    where s.mode = 'ranked'
  ),
  daily as (
    select day, count(*) as rounds, max(score) as best
    from ranked group by day
  )
  select case
    when not exists (select 1 from prof) then null
    else jsonb_build_object(
      'display_name', (select display_name from prof),
      'daily', coalesce(
        (select jsonb_agg(jsonb_build_object('day', day, 'rounds', rounds, 'best', best)
                          order by day) from daily),
        '[]'::jsonb)
    )
  end;
$$;

-- ---------- function permissions ----------
revoke all on function public.handle_new_user()            from public, anon, authenticated;
revoke all on function public.submit_session(jsonb)        from public, anon;
grant execute on function public.submit_session(jsonb)     to authenticated;
revoke all on function public.get_public_dashboard(text)   from public;
grant execute on function public.get_public_dashboard(text) to anon, authenticated;
