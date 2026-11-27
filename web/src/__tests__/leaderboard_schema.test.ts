import { readFileSync } from 'fs'
import { resolve } from 'path'

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20261127000004_leaderboard.sql'),
  'utf-8'
)

describe('leaderboard migration: get_leaderboard function', () => {
  it('creates the function', () => {
    expect(SQL).toContain('create function public.get_leaderboard(p_period text')
  })

  it('returns the expected columns', () => {
    expect(SQL).toContain('rank bigint')
    expect(SQL).toContain('username text')
    expect(SQL).toContain('avatar_url text')
    expect(SQL).toContain('best_score int')
    expect(SQL).toContain('games_played bigint')
  })

  it('is security definer with empty search_path', () => {
    const fnBlock = SQL.slice(SQL.indexOf('create function public.get_leaderboard'))
    expect(fnBlock).toContain('security definer')
    expect(fnBlock).toContain("set search_path = ''")
  })

  it('filters to ranked sessions only', () => {
    expect(SQL).toContain("mode = 'ranked'")
  })

  it('filters to public profiles only', () => {
    expect(SQL).toContain('is_public = true')
  })

  it('supports daily period filter', () => {
    expect(SQL).toContain("p_period != 'daily'")
    expect(SQL).toContain('current_date')
  })

  it('grants execute to anon and authenticated', () => {
    expect(SQL).toContain('grant execute on function public.get_leaderboard')
    expect(SQL).toContain('to anon, authenticated')
  })

  it('revokes from public', () => {
    expect(SQL).toContain('revoke all on function public.get_leaderboard')
    expect(SQL).toContain('from public')
  })
})

describe('leaderboard migration: profile is_public grant', () => {
  it('revokes old grant without is_public', () => {
    expect(SQL).toContain('revoke update (username, display_name, timezone, avatar_url) on public.profiles from authenticated')
  })

  it('grants update including is_public', () => {
    expect(SQL).toContain('grant update (username, display_name, timezone, avatar_url, is_public) on public.profiles to authenticated')
  })
})

describe('leaderboard migration: well-formedness', () => {
  it('is not empty', () => {
    expect(SQL.trim().length).toBeGreaterThan(0)
  })

  it('has no unbalanced parentheses', () => {
    const open = (SQL.match(/\(/g) ?? []).length
    const close = (SQL.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })
})
