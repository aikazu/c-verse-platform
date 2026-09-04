-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 06_rls_policies: policy lanjutan dan guard trigger.
-- Bergantung pada helper dan RLS dasar di 05_rls.sql.
-- ══════════════════════════════════════════════════════════════════════════

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

create trigger trg_unlist_non_tradable
  before update of status on public.cards
  for each row execute function public.unlist_card_if_non_tradable();
