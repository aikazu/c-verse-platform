-- User baru (OTP/OAuth) langsung dapat username default 'user_<14hex>' sehingga URL
-- profil /u/<handle> selalu tersedia — tidak pernah jatuh ke /u/<uuid>.
-- User tetap bisa mengganti username via PATCH /api/profile.
-- Handle = 8 hex pertama + 6 hex terakhir dari uuid (tahan tabrakan utk uuid acak).

-- 1) Backfill user existing tanpa username
update public.users
set username = 'user_' || substr(replace(id::text, '-', ''), 1, 8) || right(replace(id::text, '-', ''), 6)
where username is null;

-- 2) Signup baru: generate username default di trigger handle_new_auth_user
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, username, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8) || right(replace(new.id::text, '-', ''), 6),
    'user'
  )
  on conflict (id) do update set
    username = coalesce(public.users.username, excluded.username);
  return new;
end;
$$;
