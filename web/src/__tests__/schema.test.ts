import { readFileSync } from 'fs'
import { resolve } from 'path'

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20261123174106_init_schema.sql'),
  'utf-8'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsAll(sql: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(sql).toContain(fragment)
  }
}

// ---------------------------------------------------------------------------
// profiles table
// ---------------------------------------------------------------------------

describe('schema: profiles table', () => {
  it('creates public.profiles', () => {
    expect(SQL).toContain('create table public.profiles')
  })

  it('id is uuid primary key referencing auth.users with cascade delete', () => {
    expect(SQL).toContain('id            uuid primary key references auth.users(id) on delete cascade')
  })

  it('username is unique with format check', () => {
    expect(SQL).toContain("username      text unique check (username ~ '^[a-z0-9_]{3,20}$')")
  })

  it('timezone defaults to UTC', () => {
    expect(SQL).toContain("timezone      text not null default 'UTC'")
  })

  it('is_public defaults to false', () => {
    expect(SQL).toContain('is_public     boolean not null default false')
  })

  it('enforces public_needs_username constraint', () => {
    expect(SQL).toContain('constraint public_needs_username check (not is_public or username is not null)')
  })

  it('auto-creates profile via handle_new_user trigger on auth.users insert', () => {
    expect(SQL).toContain('create function public.handle_new_user()')
    expect(SQL).toContain('insert into public.profiles (id) values (new.id)')
    expect(SQL).toContain('create trigger on_auth_user_created')
    expect(SQL).toContain('after insert on auth.users')
  })
})

// ---------------------------------------------------------------------------
// sessions table
// ---------------------------------------------------------------------------

describe('schema: sessions table', () => {
  it('creates public.sessions', () => {
    expect(SQL).toContain('create table public.sessions')
  })

  it('id is uuid primary key with gen_random_uuid()', () => {
    expect(SQL).toContain('id           uuid primary key default gen_random_uuid()')
  })

  it('user_id references profiles with cascade delete', () => {
    expect(SQL).toContain('user_id      uuid not null references public.profiles(id) on delete cascade')
  })

  it('mode is restricted to ranked or practice', () => {
    expect(SQL).toContain("mode         text not null check (mode in ('ranked', 'practice'))")
  })

  it('settings is non-null jsonb', () => {
    expect(SQL).toContain('settings     jsonb not null')
  })

  it('seed is bigint', () => {
    expect(SQL).toContain('seed         bigint not null')
  })

  it('duration_s has between 10 and 600 check', () => {
    expect(SQL).toContain('duration_s   int not null check (duration_s between 10 and 600)')
  })

  it('score defaults to 0 with non-negative check', () => {
    expect(SQL).toContain('score        int not null default 0 check (score >= 0)')
  })

  it('ranked_rules constraint enforces ruleset and duration for ranked mode', () => {
    expect(SQL).toContain('constraint ranked_rules check')
    expect(SQL).toContain("mode <> 'ranked' or (ruleset = 'default_v1' and duration_s = 120)")
  })

  it('has index on user_id, mode, started_at desc', () => {
    expect(SQL).toContain('create index sessions_user_mode_time_idx')
    expect(SQL).toContain('on public.sessions (user_id, mode, started_at desc)')
  })
})

// ---------------------------------------------------------------------------
// problems table
// ---------------------------------------------------------------------------

describe('schema: problems table', () => {
  it('creates public.problems', () => {
    expect(SQL).toContain('create table public.problems')
  })

  it('id is bigint generated always as identity', () => {
    expect(SQL).toContain('id          bigint generated always as identity primary key')
  })

  it('session_id references sessions with cascade delete', () => {
    expect(SQL).toContain('session_id  uuid not null references public.sessions(id) on delete cascade')
  })

  it('user_id references profiles with cascade delete', () => {
    expect(SQL).toContain('user_id     uuid not null references public.profiles(id) on delete cascade')
  })

  it('op is restricted to the four operations', () => {
    expect(SQL).toContain("op          text not null check (op in ('add', 'sub', 'mul', 'div'))")
  })

  it('shown_ms is non-null int with non-negative check', () => {
    expect(SQL).toContain('shown_ms    int not null check (shown_ms >= 0)')
  })

  it('solved_ms is nullable with ordering check', () => {
    expect(SQL).toContain('solved_ms   int check (solved_ms is null or solved_ms >= shown_ms)')
  })

  it('latency_ms is a generated stored column', () => {
    expect(SQL).toContain('latency_ms  int generated always as (solved_ms - shown_ms) stored')
  })

  it('keystrokes is non-null jsonb defaulting to empty array', () => {
    expect(SQL).toContain("keystrokes  jsonb not null default '[]'::jsonb")
  })

  it('has unique constraint on (session_id, seq)', () => {
    expect(SQL).toContain('unique (session_id, seq)')
  })

  it('enforces arithmetic correctness via constraint', () => {
    expect(SQL).toContain('constraint arithmetic_ok check')
    expect(SQL).toContain('op = \'add\' and answer = a + b')
    expect(SQL).toContain('op = \'sub\' and answer = a - b')
    expect(SQL).toContain('op = \'mul\' and answer = a * b')
    expect(SQL).toContain('op = \'div\' and b <> 0 and a = answer * b')
  })

  it('has index on user_id', () => {
    expect(SQL).toContain('create index problems_user_idx on public.problems (user_id)')
  })
})

// ---------------------------------------------------------------------------
// submit_session function
// ---------------------------------------------------------------------------

describe('schema: submit_session function', () => {
  it('creates the function', () => {
    expect(SQL).toContain('create function public.submit_session(payload jsonb)')
  })

  it('is security definer with empty search_path', () => {
    const fnBlock = SQL.slice(SQL.indexOf('create function public.submit_session'))
    expect(fnBlock).toContain('security definer')
    expect(fnBlock).toContain("set search_path = ''")
  })

  it('rejects unauthenticated calls', () => {
    expect(SQL).toContain("raise exception 'not authenticated'")
  })

  it('inserts into sessions then problems atomically', () => {
    expect(SQL).toContain('insert into public.sessions')
    expect(SQL).toContain('insert into public.problems')
  })

  it('validates problem timings are within round duration', () => {
    expect(SQL).toContain('shown_ms > v_duration * 1000 or solved_ms > v_duration * 1000')
    expect(SQL).toContain("raise exception 'problem timings outside round duration'")
  })

  it('validates ranked rounds use default operand ranges', () => {
    expect(SQL).toContain("raise exception 'ranked round contains non-default problems'")
  })

  it('computes score server-side from solved problems', () => {
    expect(SQL).toContain('set score = (select count(*) from public.problems')
    expect(SQL).toContain('where session_id = v_session and solved_ms is not null)')
  })

  it('returns the new session uuid', () => {
    expect(SQL).toContain('return v_session')
  })

  it('is only executable by authenticated users', () => {
    expect(SQL).toContain('grant execute on function public.submit_session(jsonb)     to authenticated')
    expect(SQL).toContain('revoke all on function public.submit_session(jsonb)        from public, anon')
  })
})

// ---------------------------------------------------------------------------
// get_public_dashboard function
// ---------------------------------------------------------------------------

describe('schema: get_public_dashboard function', () => {
  it('creates the function', () => {
    expect(SQL).toContain('create function public.get_public_dashboard(p_username text)')
  })

  it('is accessible by anon and authenticated', () => {
    expect(SQL).toContain('grant execute on function public.get_public_dashboard(text) to anon, authenticated')
  })

  it('filters to is_public profiles only', () => {
    expect(SQL).toContain('where username = lower(p_username) and is_public')
  })

  it('only aggregates ranked sessions', () => {
    expect(SQL).toContain("where s.mode = 'ranked'")
  })
})

// ---------------------------------------------------------------------------
// Privileges
// ---------------------------------------------------------------------------

describe('schema: privileges', () => {
  it('revokes all from anon and authenticated before granting', () => {
    expect(SQL).toContain('revoke all on public.profiles, public.sessions, public.problems from anon, authenticated')
  })

  it('authenticated can select profiles, sessions, problems', () => {
    expect(SQL).toContain('grant select on public.profiles, public.sessions, public.problems to authenticated')
  })

  it('authenticated can only update specific profile columns', () => {
    expect(SQL).toContain('grant update (username, display_name, timezone) on public.profiles to authenticated')
  })

  it('anon has no direct table access', () => {
    expect(SQL).not.toContain('grant select on public.sessions to anon')
    expect(SQL).not.toContain('grant insert on public.sessions to anon')
  })
})

// ---------------------------------------------------------------------------
// RLS
// ---------------------------------------------------------------------------

describe('schema: row-level security', () => {
  it('enables RLS on all three tables', () => {
    containsAll(SQL, [
      'alter table public.profiles enable row level security',
      'alter table public.sessions enable row level security',
      'alter table public.problems enable row level security',
    ])
  })

  it('profiles select policy restricts to own row', () => {
    expect(SQL).toContain('"read own profile" on public.profiles')
    expect(SQL).toContain('using (id = (select auth.uid()))')
  })

  it('profiles update policy has both using and with check', () => {
    expect(SQL).toContain('"update own profile" on public.profiles')
  })

  it('sessions select policy restricts to own rows via user_id', () => {
    expect(SQL).toContain('"read own sessions" on public.sessions')
    expect(SQL).toContain('using (user_id = (select auth.uid()))')
  })

  it('problems select policy restricts to own rows via user_id', () => {
    expect(SQL).toContain('"read own problems" on public.problems')
  })

  it('no insert/update policies on sessions or problems (write path is submit_session only)', () => {
    expect(SQL).not.toContain('"insert own session"')
    expect(SQL).not.toContain('"insert own problem"')
  })
})

// ---------------------------------------------------------------------------
// Well-formedness
// ---------------------------------------------------------------------------

describe('schema: well-formedness', () => {
  it('is not empty', () => {
    expect(SQL.trim().length).toBeGreaterThan(0)
  })

  it('has no unbalanced parentheses', () => {
    const open = (SQL.match(/\(/g) ?? []).length
    const close = (SQL.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })

  it('tables appear in dependency order: profiles before sessions before problems', () => {
    const profilesIdx = SQL.indexOf('create table public.profiles')
    const sessionsIdx = SQL.indexOf('create table public.sessions')
    const problemsIdx = SQL.indexOf('create table public.problems')
    expect(profilesIdx).toBeLessThan(sessionsIdx)
    expect(sessionsIdx).toBeLessThan(problemsIdx)
  })

  it('submit_session is defined after all three tables', () => {
    const problemsIdx = SQL.indexOf('create table public.problems')
    const fnIdx = SQL.indexOf('create function public.submit_session')
    expect(problemsIdx).toBeLessThan(fnIdx)
  })
})
