-- C.Verse — RLS verification tests T1-T10 (docs/11 §4).
-- Jalankan setelah `supabase db reset`:
--   psql postgres://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/rls_test.sql
-- Setiap blok menampilkan PASS/FAIL via RAISE NOTICE; kegagalan hard-except ditandai.

begin;

-- Fixture: user A & B (auth.users trigger membuat public.users row otomatis)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', null, now(), now(), now()),
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', null, now(), now(), now())
on conflict (id) do nothing;

insert into public.users (id, email, display_name) values
  ('10000000-0000-4000-8000-00000000000a', 'a@test.local', 'User A'),
  ('10000000-0000-4000-8000-00000000000b', 'b@test.local', 'User B')
on conflict (id) do nothing;

insert into public.wallets (user_id, balance_ccoin) values
  ('10000000-0000-4000-8000-00000000000a', 100)
on conflict (user_id) do nothing;

insert into public.wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin)
values ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'top_up', 100, 100)
on conflict (id) do nothing;

-- T11: regression linter 0013 (rls_disabled_in_public) — SEMUA tabel schema
-- public wajib RLS enabled. platform_revenue pernah terlewat dari 03_rls.
-- Internal ledger tetap default-deny tanpa policy user (service_role bypass).
do $$
declare offenders text;
begin
  select string_agg(tablename, ', ' order by tablename) into offenders
  from pg_tables
  where schemaname = 'public' and rowsecurity = false;
  if offenders is null then
    raise notice 'T11 PASS';
  else
    raise notice 'T11 FAIL (tables without RLS: %)', offenders;
  end if;
end $$;

-- T1: anon select wallets -> ditolak (permission denied tanpa grant, atau 0 rows via default-deny)
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.wallets;
  if n = 0 then raise notice 'T1 PASS'; else raise notice 'T1 FAIL (% rows)', n; end if;
exception when insufficient_privilege then
  raise notice 'T1 PASS (privilege denied — tanpa grant anon)';
end $$;

-- T2: anon select kyc_records -> ditolak (permission denied atau 0 rows)
do $$
declare n int;
begin
  select count(*) into n from public.kyc_records;
  if n = 0 then raise notice 'T2 PASS'; else raise notice 'T2 FAIL (% rows)', n; end if;
exception when insufficient_privilege then
  raise notice 'T2 PASS (privilege denied — tanpa grant anon)';
end $$;

-- T3: anon select drops where status='draft' -> 0 rows (seed tidak punya draft; cek policy menyaring)
do $$
declare n int;
begin
  select count(*) into n from public.drops where status::text not in ('live','published','sold_out','closed','scheduled');
  if n = 0 then raise notice 'T3 PASS'; else raise notice 'T3 FAIL (% rows)', n; end if;
end $$;

-- T8: anon insert creator_page_views -> rejected (writes go ONLY through the
-- SECURITY DEFINER RPC record_creator_page_view; the insert-open policy was
-- removed — audit 2026-08-29, advisors rls_policy_always_true finding).
do $$
begin
  insert into public.creator_page_views (id, creator_id, viewed_at) values (gen_random_uuid()::text, 'cr-karina', now());
  raise notice 'T8 FAIL (anon insert went through)';
exception when others then
  raise notice 'T8 PASS (%)', sqlerrm;
end $$;

-- T9: anon select creator_page_views -> ditolak (permission denied atau 0 rows)
do $$
declare n int;
begin
  select count(*) into n from public.creator_page_views;
  if n = 0 then raise notice 'T9 PASS'; else raise notice 'T9 FAIL (% rows)', n; end if;
exception when insufficient_privilege then
  raise notice 'T9 PASS (privilege denied — tanpa grant anon)';
end $$;

reset role;

-- T4/T5/T6/T7 sebagai user A
set local role authenticated;
set local request.jwt.claims to '{"sub":"10000000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- T4: user A select wallet_transactions -> hanya row A
do $$
declare n int; bad int;
begin
  select count(*) into n from public.wallet_transactions;
  select count(*) into bad from public.wallet_transactions where user_id <> '10000000-0000-4000-8000-00000000000a'::uuid;
  if n >= 1 and bad = 0 then raise notice 'T4 PASS'; else raise notice 'T4 FAIL (n=% bad=%)', n, bad; end if;
end $$;

-- T5: user A update wallet_transactions -> ditolak (0 row via RLS default-deny, atau exception dari guard trigger)
do $$
declare n int;
begin
  update public.wallet_transactions set amount_ccoin = 999 where id = '90000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'T5 PASS (RLS default-deny: 0 rows updated)';
  else
    raise notice 'T5 FAIL (% rows updated)', n;
  end if;
exception
  when others then
    raise notice 'T5 PASS (guard trigger: %)', sqlerrm;
end $$;

-- T6: user A update cards milik B (buyout) -> 0 row affected
do $$
declare n int;
begin
  update public.cards set buyout_price_ccoin = 50
  where owner_id = '10000000-0000-4000-8000-00000000000b'::uuid;
  get diagnostics n = row_count;
  if n = 0 then raise notice 'T6 PASS'; else raise notice 'T6 FAIL (% rows)', n; end if;
end $$;

-- T7: user A ubah kolom non-buyout di kartu milik sendiri -> exception (guard kolom)
do $$
declare card_id text;
begin
  select c.id into card_id from public.cards c where c.owner_id = '10000000-0000-4000-8000-00000000000a'::uuid limit 1;
  if card_id is null then
    -- seed tidak menjamin user A punya kartu — gunakan kartu milik demo user
    select c.id into card_id from public.cards c where c.owner_id = '00000000-0000-4000-8000-000000000001'::uuid limit 1;
    set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
  end if;
  update public.cards set nfc_uid = 'FF' where id = card_id;
  raise notice 'T7 FAIL (update lolos)';
exception when others then
  raise notice 'T7 PASS (%)', sqlerrm;
end $$;

reset role;

-- T10: service-role insert user_badges -> OK
set local role service_role;
do $$
begin
  insert into public.user_badges (user_id, badge_id) values ('10000000-0000-4000-8000-00000000000a', 'b1')
  on conflict do nothing;
  raise notice 'T10 PASS';
exception when others then
  raise notice 'T10 FAIL (%)', sqlerrm;
end $$;

reset role;
commit;
