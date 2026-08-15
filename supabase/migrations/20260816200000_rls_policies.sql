-- C.Verse — RLS policy matrix (docs/11_rls_policy.md)
-- Default deny: enable RLS semua tabel, hapus seluruh policy "allow all",
-- buat policy per-operation sesuai matriks. service-role bypass otomatis.

-- ── Enable RLS (idempotent) ─────────────────────────────────────────────────
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.drops enable row level security;
alter table public.cards enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.orders enable row level security;
alter table public.bids enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.kyc_records enable row level security;
alter table public.creators enable row level security;
alter table public.shipments enable row level security;
alter table public.ownership_history enable row level security;
alter table public.nfc_batches enable row level security;
alter table public.disputes enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.notifications enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payouts enable row level security;
alter table public.creator_page_views enable row level security;
alter table public.qc_defects enable row level security;
alter table public.cards force row level security;

-- ── Drop semua policy allow-all lama ────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ── Helper ──────────────────────────────────────────────────────────────────
create or replace function public.is_service_role() returns boolean
language sql stable as $$
  select coalesce(current_setting('role', true), '') in ('service_role', 'supabase_admin', 'postgres');
$$;

-- ── users ───────────────────────────────────────────────────────────────────
create policy users_select on public.users for select
  using (id = auth.uid() or not is_anonymous);
create policy users_update_own on public.users for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.users_fields_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.role is distinct from old.role or new.flag_reason is distinct from old.flag_reason
     or new.total_xp is distinct from old.total_xp or new.level is distinct from old.level then
    raise exception 'users.role/flag_reason/xp hanya boleh diubah service-role';
  end if;
  return new;
end $$;
drop trigger if exists trg_users_fields_guard on public.users;
create trigger trg_users_fields_guard before update on public.users
  for each row execute function public.users_fields_guard();

-- ── creators ────────────────────────────────────────────────────────────────
create policy creators_select on public.creators for select
  using (status = 'active' or user_id = auth.uid());

-- ── drops ───────────────────────────────────────────────────────────────────
-- draft/review/production tidak bocor ke anon/auth (seed legacy 'ended' tetap terlihat)
create policy drops_select_public on public.drops for select
  using (status in ('live','published','sold_out','closed','ended','scheduled'));

-- ── cards ───────────────────────────────────────────────────────────────────
-- Kartu belum terjual (inventory/available) tidak tampil; owner selalu bisa lihat miliknya.
create policy cards_select on public.cards for select
  using (
    owner_id = auth.uid()
    or coalesce(card_status_new::text, status::text) not in ('inventory','available')
  );
create policy cards_update_owner_buyout on public.cards for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.cards_buyout_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.owner_id is distinct from old.owner_id
     or new.status is distinct from old.status
     or new.nfc_uid is distinct from old.nfc_uid
     or new.nfc_short_id is distinct from old.nfc_short_id then
    raise exception 'cards: hanya buyout_price_ccoin yang boleh diubah owner';
  end if;
  return new;
end $$;
drop trigger if exists trg_cards_buyout_guard on public.cards;
create trigger trg_cards_buyout_guard before update on public.cards
  for each row execute function public.cards_buyout_guard();

-- ── wallets / ledger ────────────────────────────────────────────────────────
create policy wallets_select_own on public.wallets for select
  using (user_id = auth.uid());

create policy wtx_select_own on public.wallet_transactions for select
  using (user_id = auth.uid());

create or replace function public.wallet_tx_immutable_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'wallet_transactions is append-only';
end $$;
drop trigger if exists trg_wtx_immutable on public.wallet_transactions;
create trigger trg_wtx_immutable before update or delete on public.wallet_transactions
  for each row execute function public.wallet_tx_immutable_guard();

-- ── orders / shipments ──────────────────────────────────────────────────────
create policy orders_select_own on public.orders for select
  using (user_id = auth.uid());
create policy shipments_select_own on public.shipments for select
  using (requester_id = auth.uid());

-- ── bids ────────────────────────────────────────────────────────────────────
create policy bids_select on public.bids for select
  using (
    bidder_id = auth.uid()
    or status = 'accepted'
    or created_at > now() - interval '90 days'
  );
create policy bids_insert_own on public.bids for insert
  with check (bidder_id = auth.uid());

-- ── provenance ──────────────────────────────────────────────────────────────
create policy ownership_history_select_public on public.ownership_history for select
  using (true);

-- ── badges ──────────────────────────────────────────────────────────────────
create policy badges_select_active on public.badges for select
  using (is_active);
create policy user_badges_select_own on public.user_badges for select
  using (user_id = auth.uid());

-- ── kyc (tidak pernah anon) ─────────────────────────────────────────────────
create policy kyc_select_own on public.kyc_records for select
  using (user_id = auth.uid());
create policy kyc_insert_own on public.kyc_records for insert
  with check (user_id = auth.uid());

-- ── payouts ─────────────────────────────────────────────────────────────────
create policy payouts_select_own on public.payouts for select
  using (user_id = auth.uid());

-- ── disputes ────────────────────────────────────────────────────────────────
create policy disputes_select_own on public.disputes for select
  using (reporter_id = auth.uid());
create policy disputes_insert_own on public.disputes for insert
  with check (reporter_id = auth.uid());

-- ── notifications ───────────────────────────────────────────────────────────
create policy notifications_select_own on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── creator_page_views: insert-only anon (log kunjungan; tidak bisa dibaca) ─
create policy creator_page_views_insert on public.creator_page_views for insert
  with check (true);

-- ── admin_audit_log: append-only absolut (tidak ada policy read/write non-service) ──
create or replace function public.audit_log_immutable_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;
drop trigger if exists trg_audit_immutable on public.admin_audit_log;
create trigger trg_audit_immutable before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_immutable_guard();
