-- Kunci akun berdasarkan CANONICAL EMAIL — mencegah:
--  1) OTP dan Google login dengan EMAIL SAMA alias dua akun berbeda.
--  2) Abuse alias "+" (user+01@gmail.com / user+02@gmail.com → inbox sama)
--     dipakai bikin banyak akun.
--
-- Ditegakkan lewat unique index di public.users (bukan auth.users, yang
-- pemiliknya supabase_auth_admin — berbeda role dengan migration).
-- Alurnya:
--   - GoTrue create auth.users baru → trigger on_auth_user_created →
--     fungsi handle_new_auth_user (security definer) insert public.users.
--   - Jika email kanonik baris itu sudah ada di public.users → unique
--     violation → seluruh auth.users insert ikut di-rollback → GoTrue
--     menolak → TIDAK ada akun duplikat.

-- Email kanonik: lowercase + untuk gmail/googlemail buang titik & "+tag",
-- dan normalisasi suffix googlemail.com → gmail.com (dua-duanya inbox sama).
-- Harus IMMUTABLE (deterministik) supaya bisa jadi basis unique index.
create or replace function public.canonical_email(p_email text)
returns text
language sql
immutable
parallel safe
as $$
  select
    case
      -- gmail / googlemail: local-part tanpa titik dan tanpa '+...',
      -- domain di-normalisasi jadi canonical 'gmail.com'
      when lower(split_part(p_email, '@', 2)) in ('gmail.com', 'googlemail.com') then
        lower(replace(split_part(split_part(p_email, '+', 1), '@', 1), '.', '') || '@gmail.com')
      else
        lower(p_email)
    end
$$;

-- Unique index di public.users: dua baris dengan email kanonik sama = terlarang.
create unique index if not exists users_canonical_email_uidx
  on public.users (public.canonical_email(email))
  where email is not null;