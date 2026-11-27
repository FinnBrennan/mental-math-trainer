revoke update (username, display_name, timezone, avatar_url) on public.profiles from authenticated;
grant update (username, display_name, timezone, avatar_url, is_public) on public.profiles to authenticated;

create function public.get_leaderboard(p_period text default 'alltime', p_limit int default 10)
returns table(rank bigint, username text, avatar_url text, best_score int, games_played bigint)
language sql
security definer
set search_path = ''
as $$
  select
    row_number() over (order by max(s.score) desc) as rank,
    p.username,
    p.avatar_url,
    max(s.score)::int as best_score,
    count(*)::bigint as games_played
  from public.sessions s
  join public.profiles p on s.user_id = p.id
  where
    s.mode = 'ranked'
    and p.is_public = true
    and p.username is not null
    and (p_period != 'daily' or s.started_at::date = current_date)
  group by p.username, p.avatar_url
  order by best_score desc
  limit p_limit;
$$;

grant execute on function public.get_leaderboard(text, int) to anon, authenticated;
revoke all on function public.get_leaderboard(text, int) from public;
