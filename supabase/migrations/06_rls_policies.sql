-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 03b_rls_policies — part 2 of the 03_rls split (2026-09-03,
-- original 03_rls.sql 367 LoC > 300 budget). Content below moved
-- byte-for-byte from 03_rls.sql in original relative order:
-- storage.objects kyc-files policies, payouts, disputes, notifications,
-- creator_page_views, drop_entries, admin_audit_log immutable guard,
-- unlist_card_if_non_tradable trigger. No dependency on helpers in
-- 03_rls.sql; 03_ < 03b < 04_ keeps this applied right after 03_rls.sql.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- KYC files — storage.objects (bucket 'kyc-files', diprovision via
-- config.toml — private). SATU-SATUNYA policy storage.objects di repo:
-- tanpa ini upload dari browser (Kyc.tsx uploadKycFile) selalu ditolak RLS
-- "new row violates row-level security policy" (RLS storage.objects aktif
-- by default, terbukti empiris 2026-08-29; bucket public pun tetap kena RLS
-- untuk insert). Scope minimal: INSERT saja, hanya ke folder per-user
-- `<uid>/...`. Review admin membaca object via service-role (bypass RLS)
-- untuk menandatangani URL — lihat apps/api/src/lib/store.ts (KycRecord
-- comment).
-- ══════════════════════════════════════════════════════════════════════════
create policy kyc_files_owner_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- supabase-js upload() selalu mengirim header x-upsert (Kyc.tsx: upsert true) —
-- storage mengeksekusi INSERT .. ON CONFLICT DO UPDATE, dan Postgres menuntut
-- policy UPDATE untuk path itu meski tidak ada konflik (tanpa ini upload tetap
-- "new row violates row-level security policy"; terbukti empiris 2026-08-29).
create policy kyc_files_owner_update on storage.objects for update to authenticated
  using (
    bucket_id = 'kyc-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'kyc-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statement upsert storage berakhir dengan RETURNING * — Postgres menuntut
-- policy SELECT agar baris baru boleh dikembalikan (tanpa ini x-upsert upload
-- tetap RLS AccessDenied meski policy INSERT/UPDATE ada; dibuktikan via
-- bisect psql 2026-08-29).
create policy kyc_files_owner_select on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ══════════════════════════════════════════════════════════════════════════
-- payouts
-- ══════════════════════════════════════════════════════════════════════════
create policy payouts_select_own on public.payouts for select
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- disputes
-- ══════════════════════════════════════════════════════════════════════════
create policy disputes_select_own on public.disputes for select
  using (reporter_id = auth.uid());
create policy disputes_insert_own on public.disputes for insert
  with check (reporter_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- notifications
-- ══════════════════════════════════════════════════════════════════════════
create policy notifications_select_own on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- creator_page_views: writes ONLY via the SECURITY DEFINER RPC
-- record_creator_page_view (granted to anon+authenticated; runs as table
-- owner, unaffected by RLS). The insert-open policy was removed
-- (audit 2026-08-29): `with check (true)` let any anon key insert rows for
-- ANY creator_id, bypassing the RPC's suspended/unknown/no-creator guards.
-- ══════════════════════════════════════════════════════════════════════════

-- Owner-only read (audit 2026-08-29, docs 09 §3.5): creator may SELECT the
-- page views of its own creator page (dashboard). Non-owners get default
-- deny; no UPDATE/DELETE policy exists for non-admin roles at all.
create policy creator_page_views_select_own on public.creator_page_views for select
  using (
    exists (
      select 1 from public.creators cr
      where cr.id = creator_page_views.creator_id and cr.user_id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════════════════
-- drop_entries: seleksi milik sendiri
-- ══════════════════════════════════════════════════════════════════════════
create policy drop_entries_select_own on public.drop_entries for select
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- admin_audit_log: append-only absolut (tidak ada policy read/write non-service)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.audit_log_immutable_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;
create trigger trg_audit_immutable before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_immutable_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- AUTO-UNLIST non-tradable cards (keputusan 2026-08-23, src 23020000).
-- Trigger AFTER UPDATE OF status: kartu yang jadi 'tampered'/'defect'/'lost'
-- auto-clear buyout_price_ccoin (NULL). Listings dibuat lewat
-- buyout_price_ccoin NOT NULL → jadi auto-unlist. Daftar non-tradable
-- disinkronkan dengan check gate CARD_NOT_TRADABLE di accept_bid/buyout_card/
-- place_bid/set_buyout (audit 2026-08-23).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.unlist_card_if_non_tradable() returns trigger
language plpgsql as $$
begin
  if new.status::text in ('tampered','defect','lost')
     and new.buyout_price_ccoin is not null then
    new.buyout_price_ccoin := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_unlist_non_tradable on public.cards;
create trigger trg_unlist_non_tradable
  before update of status on public.cards
  for each row execute function public.unlist_card_if_non_tradable();
