-- Username default yang manusiawi: <prefix-email> + 4 digit acak, anti-duplikat.
-- Kolom username_is_auto menandai username hasil generate (belum diganti user) —
-- web memakainya untuk memunculkan popup "pilih username" setelah signup.

alter table public.users add column if not exists username_is_auto boolean not null default false;

-- Kandidat username: prefix email (dibersihkan, max 16 char) + 4 digit acak.
-- Anti-duplikat: loop ulang sampai tidak bentrok; fallback ke hex uuid jika >1000 coba.
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

-- Trigger signup: generate username default + tandai sebagai auto.
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

-- Backfill: username default lama (pola user_<hex>) → format baru, tetap auto.
update public.users
set username = public.generate_default_username(email, id),
    username_is_auto = true
where username ~ '^user_[0-9a-f]+$';