-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 01_schema: All DDL (extensions, enums, tables, base indexes,
-- updated_at triggers, table-level grants). Setiap objek ditulis satu kali.
--
-- Sumber (semua FINAL, tanpa patch intermediate):
--   - 20260817000000_foundation.sql         — DDL lengkap
--   - 20260817040000_grants_payout.sql      — table-level grants
--   - 20260817060000_revenue_flow_hardening.sql — platform_revenue + treasury + grants
--   - 20260821000000_seed_card.sql          — drops.is_seed column
--   - 20260821020000_seed_two_phase.sql     — bids.destination/shipping_address, orders.source check
--   - 20260823000000_payout_refund.sql      — payouts.status check (add 'processing','refunded')
--   - 20260824000000_shipment_active_unique.sql — partial unique index shipments active per card
--
-- Perubahan dari versi asli (konsolidasi saja — tidak ada logic change):
--   - ALTER TABLE add column/constraint setelah CREATE TABLE (idempotent)
--   - Sequence + grants dikumpulkan di akhir file
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════════════════
-- Enums (nilai FINAL — bersih, tanpa legacy)
-- ══════════════════════════════════════════════════════════════════════════
create type public.user_role as enum ('user','creator','admin');
create type public.drop_status as enum ('draft','scheduled','published','live','sold_out','closed','cancelled');
create type public.order_status as enum ('paid','qc','shipped','delivered','settled','refunded','disputed');
create type public.wallet_tx_type as enum ('top_up','checkout','escrow_hold','escrow_release','settlement','payout','royalty','refund','adjustment','platform_buy','platform_revenue','seed_abort','payout_refund');
-- Founder 2026-08-28: ship-out fee dari platform vault (RPC vault_shipout,
-- 04_rpc). Statement-level, idempotent untuk re-run migrator.
alter type public.wallet_tx_type add value if not exists 'vault_shipout';
create type public.verify_status as enum ('verified','tamper_detected','registered','unknown');
create type public.kyc_status as enum ('pending','approved','rejected');
create type public.card_variant as enum ('unsigned','signed');
create type public.card_status as enum ('inventory','bound','listed_buyout','bid_pending','sold','tampered','defect','lost');
create type public.card_location as enum ('platform_stock','with_owner','platform_vault');
create type public.delivery_option as enum ('shipping','vault');
create type public.escrow_status as enum ('held','released');
create type public.shipment_type as enum ('primary_shipping','primary_vault','secondary_buyout','secondary_bid','vault_shipout');
create type public.shipment_to_dest as enum ('buyer_address','platform_vault');
create type public.shipment_from_location as enum ('platform','seller');
create type public.shipment_status as enum ('requested','packed','shipped','delivered','cancelled');
create type public.bid_status as enum ('active','outbid','cancelled','accepted');
create type public.creator_status as enum ('active','suspended','inactive');
create type public.nfc_batch_status as enum ('received','provisioned','qc_passed','qc_failed','deployed');
create type public.dispute_status as enum ('open','under_review','resolved_refund','resolved_strike','resolved_suspend');
create type public.audit_action as enum ('create','update','delete','view_sensitive','login','login_mfa','2fa_enroll','2fa_reset','payout_trigger','config_change');
create type public.defect_type as enum ('dus','acrylic','kartu','nfc');
create type public.defect_severity as enum ('minor','major','critical');
create type public.defect_resolution as enum ('redistribute','destroy','return_vendor');

-- ══════════════════════════════════════════════════════════════════════════
-- Helper trigger updated_at
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Helper trigger tie-break timestamps (leaderboard, keputusan 2026-08-27).
-- users.xp_reached_at: bumped HANYA saat total_xp berubah — display_name /
-- avatar / kolom lain tidak menyentuh tie-break. Klien tidak boleh tulis
-- langsung (users_fields_guard 03_rls menambahkan xp_reached_at ke daftar
-- kolom terlindungi bersama role/flag_reason/total_xp/level).
-- cards.owner_since: bumped HANYA saat owner_id berubah (INSERT atau UPDATE
-- owner swap). Cosmetic update (status / buyout_price / verify_status /
-- nfc_configured / location / qc_status / last_ctr / nfc_uid / nfc_short_id)
-- TIDAK bump owner_since — property itu inti dari fitur leaderboard.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.set_users_xp_reached_at() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.xp_reached_at := now();
    return new;
  end if;
  if old.total_xp is distinct from new.total_xp then
    new.xp_reached_at := now();
  end if;
  return new;
end $$;

create or replace function public.set_cards_owner_since() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.owner_since := now();
    return new;
  end if;
  if old.owner_id is distinct from new.owner_id then
    new.owner_since := now();
  end if;
  return new;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Tabel
-- ══════════════════════════════════════════════════════════════════════════
create table public.users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  role user_role not null default 'user',
  avatar_url text,
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  username text,
  is_anonymous boolean not null default false,
  total_xp integer not null default 0,
  level integer not null default 1,
  -- users.xp_reached_at: tie-break timestamp for leaderboard XP rank
  -- (Flow leaderboard, keputusan 2026-08-27). Bumped hanya oleh trigger saat
  -- total_xp berubah — klien tidak boleh tulis langsung (guard trigger 03_rls).
  xp_reached_at timestamptz not null default now(),
  cumulative_spend_ccoin integer not null default 0,
  flag_reason text,
  consent_analytics_detail boolean not null default false,
  consent_data_market boolean not null default false,
  username_is_auto boolean not null default false
);

create table public.wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  balance_ccoin integer not null default 0 check (balance_ccoin >= 0),
  total_topup_ccoin integer not null default 0,
  total_spent_ccoin integer not null default 0,
  updated_at timestamptz not null default now(),
  hold_payout_until timestamptz
);

create table public.drops (
  id text primary key,
  title text not null check (char_length(title) between 3 and 120),
  series text not null check (char_length(series) between 3 and 120),
  narrative text not null,
  artwork_url text not null default '',
  total_units integer not null check (total_units between 1 and 1000),
  signed_count integer not null check (signed_count >= 0),
  unsigned_count integer not null check (unsigned_count >= 0),
  price_unsigned_ccoin integer not null check (price_unsigned_ccoin >= 1),
  price_signed_ccoin integer not null check (price_signed_ccoin >= 1),
  status drop_status not null default 'draft',
  drop_at timestamptz,
  creator_id uuid not null references public.users(id) on delete restrict,
  creator_name text not null,
  sold_count integer not null default 0 check (sold_count <= total_units),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  artwork_3d_url text,
  price_ccoin integer check (price_ccoin >= 1),
  drop_start_at timestamptz,
  drop_end_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  raffle_end_at timestamptz,
  drawn_at timestamptz,
  -- drops.is_seed: Creator Seed C.Card provenance (Flow 10, keputusan 2026-08-20).
  is_seed boolean not null default false,
  constraint chk_counts check (signed_count + unsigned_count = total_units)
);

create table public.cards (
  id text primary key,
  drop_id text not null references public.drops(id) on delete cascade,
  unit_number integer not null check (unit_number >= 1),
  variant card_variant not null,
  status card_status not null default 'inventory',
  owner_id uuid references public.users(id) on delete set null,
  -- cards.owner_since: tie-break timestamp for leaderboard cards/badges rank
  -- (Flow leaderboard, keputusan 2026-08-27). Bumped hanya oleh trigger saat
  -- owner_id berubah — cosmetic updates (status, buyout_price, dll) TIDAK bump.
  owner_since timestamptz not null default now(),
  nfc_uid text not null unique,
  nfc_short_id text not null unique,
  verify_status verify_status not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  location card_location not null default 'platform_stock',
  buyout_price_ccoin integer check (buyout_price_ccoin is null or buyout_price_ccoin >= 1),
  nfc_configured boolean not null default false,
  qc_status text not null default 'pending' check (qc_status in ('pending','passed','failed')),
  last_ctr integer not null default 0,
  unique (drop_id, unit_number)
);

create table public.wallet_transactions (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  type wallet_tx_type not null,
  amount_ccoin integer not null,
  balance_after_ccoin integer not null,
  ref_type text,
  ref_id text,
  note text,
  created_at timestamptz not null default now(),
  metadata jsonb
);

create table public.orders (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  drop_id text not null references public.drops(id) on delete restrict,
  card_ids text[] not null default '{}',
  total_ccoin integer not null check (total_ccoin >= 1),
  total_idr integer not null check (total_idr >= 0),
  status order_status not null default 'paid',
  shipping_address text,
  tracking_number text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  delivery_option delivery_option not null default 'vault',
  shipping_fee_ccoin integer check (shipping_fee_ccoin is null or shipping_fee_ccoin >= 1),
  escrow_status escrow_status not null default 'held',
  card_id text references public.cards(id) on delete set null,
  shipped_at timestamptz,
  source text not null default 'fcfs'
);

create table public.bids (
  id text primary key,
  bidder_id uuid not null references public.users(id) on delete cascade,
  bidder_name text not null,
  amount_ccoin integer not null check (amount_ccoin >= 1),
  created_at timestamptz not null default now(),
  card_id text references public.cards(id) on delete cascade,
  status bid_status not null default 'active',
  outbid_at timestamptz,
  cancelled_at timestamptz,
  accepted_at timestamptz,
  -- bids.destination / shipping_address: two-phase seed sale (2026-08-21).
  -- destination = pilihan tujuan buyer saat PHASE-1 accept; dipakai release_seed_sale.
  destination public.shipment_to_dest,
  shipping_address text,
  constraint chk_amount_ccoin check (amount_ccoin >= 1)
);

create table public.badges (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null,
  icon text not null,
  xp integer not null default 0,
  criteria jsonb,
  icon_url text,
  xp_reward integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_badges (
  user_id uuid not null references public.users(id) on delete cascade,
  badge_id text not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  awarded_at timestamptz not null default now(),
  xp_reward_snapshot integer not null default 0,
  primary key (user_id, badge_id)
);

create table public.kyc_records (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  full_name text not null,
  nik text not null check (char_length(nik)=16),
  address text not null,
  status kyc_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table public.creators (
  id text primary key,
  user_id uuid references public.users(id) on delete set null,
  handle text unique,
  total_followers_combined integer not null default 0 check (total_followers_combined >= 0),
  status creator_status not null default 'active',
  bank_account jsonb,
  kyc_completed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipments (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  type shipment_type not null,
  from_location shipment_from_location not null default 'platform',
  to_dest shipment_to_dest not null,
  address jsonb,
  fee_ccoin integer check (fee_ccoin is null or fee_ccoin >= 1),
  status shipment_status not null default 'requested',
  tracking_number text,
  platform_check jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ownership_history (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  acquired_via text not null check (acquired_via in ('primary','secondary_buyout','secondary_bid','gift')),
  order_id text references public.orders(id) on delete set null,
  bid_id text references public.bids(id) on delete set null,
  transferred_at timestamptz not null default now()
);

create table public.nfc_batches (
  id text primary key,
  batch_code text not null unique,
  vendor text,
  qty integer not null check (qty >= 1),
  status nfc_batch_status not null default 'received',
  created_at timestamptz not null default now()
);

create table public.disputes (
  id text primary key,
  order_id text references public.orders(id) on delete set null,
  card_id text references public.cards(id) on delete set null,
  reporter_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  status dispute_status not null default 'open',
  decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id text primary key,
  admin_user_id uuid not null references public.users(id) on delete cascade,
  action audit_action not null,
  target_table text not null,
  target_id text,
  payload_summary jsonb,
  ip text,
  session_id text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  channel text not null check (channel in ('email','push','in_app')),
  template_key text not null,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now()
);

-- P0-3 (audit 2026-08-24): inbox kolom read_at di notifications (nullable,
-- diisi user saat klik notifikasi). Index unread-count di 05_indexes.sql.
alter table public.notifications
  add column if not exists read_at timestamptz;

create table public.payout_batches (
  id text primary key,
  batch_code text not null unique,
  status text not null default 'draft' check (status in ('draft','processing','paid','failed')),
  total_ccoin bigint not null default 0,
  total_idr bigint not null default 0,
  fee_1pct_idr bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.payouts (
  id text primary key,
  batch_id text references public.payout_batches(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('creator_share','seller_proceeds','royalty')),
  ccoin_amount integer not null check (ccoin_amount >= 1),
  idr_amount bigint not null,
  withholding_tax jsonb,
  status text not null default 'pending',
  -- payouts.requested_at: waktu user request disbursement (founder 2026-08-23).
  requested_at timestamptz not null default now()
);

create table public.creator_page_views (
  id text primary key,
  creator_id text not null references public.creators(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  referrer text,
  city text,
  user_id uuid references public.users(id) on delete set null
);

create table public.qc_defects (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  defect_type defect_type not null,
  severity defect_severity not null default 'minor',
  notes text,
  resolution defect_resolution,
  redistribute_discount_pct integer check (redistribute_discount_pct is null or (redistribute_discount_pct between 10 and 30)),
  created_at timestamptz not null default now()
);

create table public.drop_entries (
  id text primary key default gen_random_uuid()::text,
  drop_id text not null references public.drops(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  pool text not null check (pool in ('regular','premium','both')),
  hold_ccoin integer not null check (hold_ccoin >= 1),
  status text not null default 'held' check (status in ('held','won_premium','won_regular','lost','refunded')),
  created_at timestamptz not null default now()
);

-- platform_revenue: ledger pendapatan platform per event settlement.
-- Snapshot fee rate per transaksi (docs/05 I6/I11).
create table public.platform_revenue (
  id text primary key default gen_random_uuid()::text,
  source text not null check (source in ('primary','secondary_buyout','secondary_bid')),
  ref_type text not null,
  ref_id text not null,
  gross_ccoin integer not null check (gross_ccoin >= 1),
  platform_ccoin integer not null default 0,
  royalty_ccoin integer not null default 0,
  seller_ccoin integer not null default 0,
  fee_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.platform_revenue is
  'Ledger pendapatan platform (per event settlement) — snapshot fee rate per transaksi (docs 05 I6/I11).';

-- ══════════════════════════════════════════════════════════════════════════
-- Constraint extensions (idempotent alter; sumber: 21xx/23xx migrations)
-- ══════════════════════════════════════════════════════════════════════════

-- orders.source: seed buyout PHASE-1 (20260821020000) menulis 'secondary_buyout'.
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('fcfs','raffle','secondary_buyout'));

-- payouts.status: tambah 'processing' (batch run) + 'refunded' (admin refund).
-- Webhook IRIS sudah menulis 'disbursed'/'failed'.
alter table public.payouts
  drop constraint if exists payouts_status_check;
alter table public.payouts
  add constraint payouts_status_check
    check (status in ('pending','processing','disbursed','failed','refunded'));

-- ══════════════════════════════════════════════════════════════════════════
-- Treasury user (system account, is_anonymous=true agar tidak muncul publik).
-- Fixed UUID yang dipakai semua ledger fees.
-- ══════════════════════════════════════════════════════════════════════════
insert into public.users (id, email, display_name, username, role, is_anonymous)
values ('00000000-0000-4000-8000-0000000000c0', 'treasury@c-verse.co', 'C.Verse Treasury', 'cverse_treasury', 'user', true)
on conflict (id) do nothing;
insert into public.wallets (user_id) values ('00000000-0000-4000-8000-0000000000c0')
on conflict (user_id) do nothing;

-- ══════════════════════════════════════════════════════════════════════════
-- Trigger updated_at (semua tabel berkepemilikan updated_at)
-- ══════════════════════════════════════════════════════════════════════════
create trigger trg_users_updated_at before update on public.users for each row execute function set_updated_at();
create trigger trg_wallets_updated_at before update on public.wallets for each row execute function set_updated_at();
create trigger trg_drops_updated_at before update on public.drops for each row execute function set_updated_at();
create trigger trg_cards_updated_at before update on public.cards for each row execute function set_updated_at();
create trigger trg_orders_updated_at before update on public.orders for each row execute function set_updated_at();
create trigger trg_badges_updated_at before update on public.badges for each row execute function set_updated_at();
create trigger trg_kyc_updated_at before update on public.kyc_records for each row execute function set_updated_at();
create trigger trg_creators_updated_at before update on public.creators for each row execute function set_updated_at();
create trigger trg_shipments_updated_at before update on public.shipments for each row execute function set_updated_at();
create trigger trg_disputes_updated_at before update on public.disputes for each row execute function set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- Trigger tie-break timestamps (leaderboard, keputusan 2026-08-27).
-- Lihat helper function di atas (set_users_xp_reached_at / set_cards_owner_since).
-- ══════════════════════════════════════════════════════════════════════════
create trigger trg_users_xp_reached_at
  before insert or update on public.users
  for each row execute function public.set_users_xp_reached_at();

create trigger trg_cards_owner_since
  before insert or update on public.cards
  for each row execute function public.set_cards_owner_since();

-- ══════════════════════════════════════════════════════════════════════════
-- Index basis (access-path + uniqueness) — sumber: foundation.sql
-- ══════════════════════════════════════════════════════════════════════════
create index if not exists idx_drops_status on public.drops(status);
create index if not exists idx_drops_creator on public.drops(creator_id);
create index if not exists idx_drops_drop_at on public.drops(drop_at);
create index if not exists idx_cards_drop on public.cards(drop_id);
create index if not exists idx_cards_owner on public.cards(owner_id);
create index if not exists idx_cards_nfc_uid on public.cards(nfc_uid);
create index if not exists idx_cards_nfc_short on public.cards(nfc_short_id);
create index if not exists idx_cards_location on public.cards(location);
create index if not exists idx_cards_buyout on public.cards(buyout_price_ccoin) where buyout_price_ccoin is not null;
create index if not exists idx_cards_unit on public.cards(drop_id, unit_number);
create index if not exists idx_wtx_user_created on public.wallet_transactions(user_id, created_at desc);
create index if not exists idx_wtx_ref on public.wallet_transactions(ref_type, ref_id);
create index if not exists idx_orders_user on public.orders(user_id, created_at desc);
create index if not exists idx_orders_drop on public.orders(drop_id);
create index if not exists idx_bids_bidder on public.bids(bidder_id);
create index if not exists idx_bids_card on public.bids(card_id, status, amount_ccoin desc);
create unique index if not exists idx_bids_one_active_per_card on public.bids(card_id) where status = 'active';
create index if not exists idx_kyc_status on public.kyc_records(status);
create index if not exists idx_creators_user on public.creators(user_id);
create index if not exists idx_shipments_card on public.shipments(card_id);
create index if not exists idx_shipments_requester on public.shipments(requester_id);
create index if not exists idx_ownership_card on public.ownership_history(card_id, transferred_at desc);
create index if not exists idx_ownership_owner_card on public.ownership_history(owner_id, card_id);
create index if not exists idx_disputes_reporter on public.disputes(reporter_id);
create index if not exists idx_audit_admin on public.admin_audit_log(admin_user_id, created_at desc);
create index if not exists idx_audit_action on public.admin_audit_log(action);
create index if not exists idx_audit_target on public.admin_audit_log(target_table, target_id);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_payouts_user on public.payouts(user_id);
create index if not exists idx_payouts_batch on public.payouts(batch_id);
create index if not exists idx_cpv_creator on public.creator_page_views(creator_id, viewed_at desc);
create index if not exists idx_cpv_viewed on public.creator_page_views(viewed_at desc);
create index if not exists idx_qc_card on public.qc_defects(card_id);
create unique index if not exists idx_drop_entries_unique on public.drop_entries(drop_id, user_id);
create index if not exists idx_drop_entries_drop on public.drop_entries(drop_id, status);

-- ══════════════════════════════════════════════════════════════════════════
-- Constraint indexes (unique/partial-unique untuk integritas data)
-- ══════════════════════════════════════════════════════════════════════════
-- Idempotency ledger untuk wallet_debit/credit (RPC atomic layer).
create unique index if not exists uq_wtx_idempotency_key
  on public.wallet_transactions((metadata->>'idempotency_key'))
  where metadata->>'idempotency_key' is not null;

-- platform_revenue idempotent per (ref_type, ref_id).
create unique index if not exists uq_platform_revenue_ref on public.platform_revenue(ref_type, ref_id);

-- M7 (audit 2026-08-24): vault-shipout duplicate-insert guard.
-- Final terminal statuses (delivered/cancelled) dikecualikan supaya kartu bisa
-- di-ship ulang setelah transaksi sebelumnya selesai.
create unique index if not exists uq_shipments_active_per_card
  on public.shipments (card_id)
  where status not in ('delivered', 'cancelled');

-- ══════════════════════════════════════════════════════════════════════════
-- GRANT tabel (least-privilege — row tetap difilter RLS)
-- ══════════════════════════════════════════════════════════════════════════
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- anon: read publik + insert page-view (rate-limit per-IP di API route M4).
grant select on public.users, public.creators, public.drops, public.cards, public.bids, public.ownership_history, public.badges to anon;
grant insert on public.creator_page_views to anon;

-- authenticated: read sesuai matriks RLS + write minimum (guard trigger).
grant select on
  public.users, public.creators, public.drops, public.cards, public.orders,
  public.wallets, public.wallet_transactions, public.bids, public.shipments,
  public.ownership_history, public.badges, public.user_badges, public.kyc_records,
  public.payouts, public.notifications, public.disputes
to authenticated;
grant insert on public.bids, public.kyc_records, public.disputes, public.creator_page_views to authenticated;
grant update on public.users, public.cards, public.notifications to authenticated;
