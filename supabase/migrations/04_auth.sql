-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 02_auth: Supabase Auth → public.users mirror + username
-- generation + canonical email dedup. Setiap objek ditulis satu kali.
--
-- Sumber (FINAL, tanpa patch intermediate):
--   - 20260817010000_auth.sql — seluruh konten
--
-- Catatan konsolidasi:
--   - idx_users_username (UNIQUE WHERE username IS NOT NULL) disatukan di sini
--     dari foundation.sql — username uniqueness adalah auth concern.
--   - users_canonical_email_uidx tetap di sini (auth concern: dedup akun).
-- ══════════════════════════════════════════════════════════════════════════

-- Username uniqueness (partial unique — username nullable untuk akun praseed)
create unique index if not exists idx_users_username
  on public.users(username) where username is not null;

-- ══════════════════════════════════════════════════════════════════════════
-- generate_default_username: prefix-email + 4 digit acak, anti-duplikat.
-- Fallback ke hex uuid bila >1000 percobaan.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.generate_default_username(p_email text, p_id uuid)
returns text
language plpgsql
as $$
declare
  base text;
  candidate text;
  attempt int := 0;
begin
  base := lower(regexp_replace(split_part(p_email, '@', 1), '[^a-z0-9_]', '', 'g'));
  base := left(base, 16);
  if base = '' then
    base := 'user';
  end if;
  loop
    candidate := base || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from public.users where username = candidate);
    attempt := attempt + 1;
    if attempt >= 1000 then
      candidate := base || right(replace(p_id::text, '-', ''), 8);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- handle_new_auth_user: trigger AFTER INSERT on auth.users.
-- Versi FINAL: username manusiawi + username_is_auto=true. Menimpa dengan
-- coalesce agar nilai seed yang sudah di-set user tidak ditimpa trigger.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, username, username_is_auto, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    public.generate_default_username(new.email, new.id),
    true,
    'user'
  )
  on conflict (id) do update set
    username = coalesce(public.users.username, excluded.username),
    username_is_auto = coalesce(public.users.username_is_auto, excluded.username_is_auto);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ══════════════════════════════════════════════════════════════════════════
-- canonical_email: dedup akun berdasarkan email kanonik. IMMUTABLE agar bisa
-- jadi basis unique index. Untuk gmail/googlemail: buang titik di local-part,
-- potong "+tag", dan normalisasi suffix googlemail.com -> gmail.com.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.canonical_email(p_email text)
returns text
language sql
immutable
parallel safe
as $$
  select
    case
      when lower(split_part(p_email, '@', 2)) in ('gmail.com', 'googlemail.com') then
        lower(replace(split_part(split_part(p_email, '+', 1), '@', 1), '.', '') || '@gmail.com')
      else
        lower(p_email)
    end
$$;

-- Dua akun dengan email kanonik sama tertolak (uniqueness berbasis fungsi).
create unique index if not exists users_canonical_email_uidx
  on public.users (public.canonical_email(email))
  where email is not null;
