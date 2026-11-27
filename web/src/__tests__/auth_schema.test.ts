import { readFileSync } from 'fs'
import { resolve } from 'path'

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20261127000003_auth_and_avatars.sql'),
  'utf-8'
)

function containsAll(sql: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(sql).toContain(fragment)
  }
}

describe('auth_and_avatars migration: profiles', () => {
  it('adds avatar_url column', () => {
    expect(SQL).toContain('alter table public.profiles add column if not exists avatar_url text')
  })

  it('grants update on avatar_url to authenticated', () => {
    expect(SQL).toContain('grant update (username, display_name, timezone, avatar_url) on public.profiles to authenticated')
  })
})

describe('auth_and_avatars migration: storage', () => {
  it('creates avatars bucket as public', () => {
    expect(SQL).toContain("insert into storage.buckets (id, name, public)")
    expect(SQL).toContain("values ('avatars', 'avatars', true)")
  })

  it('has public read policy on storage.objects', () => {
    expect(SQL).toContain('"avatars public read"')
    expect(SQL).toContain('on storage.objects for select')
    expect(SQL).toContain("using (bucket_id = 'avatars')")
  })

  it('has authenticated insert policy scoped to own folder', () => {
    expect(SQL).toContain('"avatars authenticated insert"')
    expect(SQL).toContain('on storage.objects for insert')
    expect(SQL).toContain("bucket_id = 'avatars'")
    expect(SQL).toContain('storage.foldername(name)')
  })

  it('has authenticated update and delete policies', () => {
    expect(SQL).toContain('"avatars authenticated update"')
    expect(SQL).toContain('"avatars authenticated delete"')
  })
})

describe('auth_and_avatars migration: migrate_anon_user', () => {
  it('creates the function', () => {
    expect(SQL).toContain('create function public.migrate_anon_user(p_anon_user_id uuid)')
  })

  it('is security definer with empty search_path', () => {
    const fnBlock = SQL.slice(SQL.indexOf('create function public.migrate_anon_user'))
    expect(fnBlock).toContain('security definer')
    expect(fnBlock).toContain("set search_path = ''")
  })

  it('rejects unauthenticated calls', () => {
    expect(SQL).toContain("raise exception 'not authenticated'")
  })

  it('verifies source is an anonymous user', () => {
    expect(SQL).toContain('is_anonymous = true')
  })

  it('prevents migrating from self', () => {
    expect(SQL).toContain('p_anon_user_id = v_caller')
  })

  it('reassigns sessions and problems to caller', () => {
    containsAll(SQL, [
      'update public.sessions',
      'set user_id = v_caller',
      'update public.problems',
    ])
  })

  it('deletes the anonymous profile', () => {
    expect(SQL).toContain('delete from public.profiles where id = p_anon_user_id')
  })

  it('is only executable by authenticated users', () => {
    expect(SQL).toContain('grant execute on function public.migrate_anon_user(uuid) to authenticated')
    expect(SQL).toContain('revoke all on function public.migrate_anon_user(uuid) from public, anon')
  })
})

describe('auth_and_avatars migration: well-formedness', () => {
  it('is not empty', () => {
    expect(SQL.trim().length).toBeGreaterThan(0)
  })

  it('has no unbalanced parentheses', () => {
    const open = (SQL.match(/\(/g) ?? []).length
    const close = (SQL.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })

  it('avatar_url column is added before the grant', () => {
    const colIdx = SQL.indexOf('add column if not exists avatar_url')
    const grantIdx = SQL.indexOf('grant update (username, display_name, timezone, avatar_url)')
    expect(colIdx).toBeLessThan(grantIdx)
  })
})
