alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "avatars authenticated update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "avatars authenticated delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create function public.migrate_anon_user(p_anon_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from auth.users
    where id = p_anon_user_id and is_anonymous = true
  ) then
    return;
  end if;

  if p_anon_user_id = v_caller then
    return;
  end if;

  update public.sessions
  set user_id = v_caller
  where user_id = p_anon_user_id;

  update public.problems
  set user_id = v_caller
  where user_id = p_anon_user_id;

  delete from public.profiles where id = p_anon_user_id;
end;
$$;

grant execute on function public.migrate_anon_user(uuid) to authenticated;
revoke all on function public.migrate_anon_user(uuid) from public, anon;

revoke update (username, display_name, timezone) on public.profiles from authenticated;
grant update (username, display_name, timezone, avatar_url) on public.profiles to authenticated;
