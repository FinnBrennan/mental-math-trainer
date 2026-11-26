-- user_weaknesses: output table written by the Python algorithm pipeline.
-- One row per rank per user (ranks 1-4). Upserted after each session.

create table public.user_weaknesses (
  user_id        uuid    not null references public.profiles(id) on delete cascade,
  rank           int     not null check (rank between 1 and 4),
  op             text    not null check (op in ('add', 'sub', 'mul', 'div')),
  band_a_min     int     not null,
  band_a_max     int     not null,
  band_b_min     int     not null,
  band_b_max     int     not null,
  avg_latency_ms float   not null,
  sample_count   int     not null check (sample_count > 0),
  computed_at    timestamptz not null default now(),
  primary key (user_id, rank),
  constraint band_a_valid check (band_a_min <= band_a_max),
  constraint band_b_valid check (band_b_min <= band_b_max)
);

create index user_weaknesses_user_idx on public.user_weaknesses (user_id);

-- RLS: users can only read their own weaknesses.
-- Write access is via service role only (Python pipeline).
alter table public.user_weaknesses enable row level security;

create policy "read own weaknesses" on public.user_weaknesses
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_weaknesses from anon, authenticated;
grant select on public.user_weaknesses to authenticated;
