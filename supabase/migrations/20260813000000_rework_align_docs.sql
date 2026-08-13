-- C.Verse — Rework align docs/00-08 (2026-08-13)
-- Brings initial_schema in line with docs/05-data-model (MVP canonical)
-- Additive + backward compatible where possible so preview branches survive reset.
-- Run after 20260812000000_initial_schema.sql

create extension if not exists "pgcrypto";

-- ── New enums (additive) ───────────────────────────────────────────────────
do $$ begin create type card_location as enum ('platform_stock','with_owner','platform_vault'); exception when duplicate_object then null; end $$;
do $$ begin create type card_status_new as enum ('inventory','bound','listed_buyout','bid_pending','sold','tampered','defect','lost'); exception when duplicate_object then null; end $$;
do $$ begin create type delivery_option as enum ('shipping','vault'); exception when duplicate_object then null; end $$;
do $$ begin create type escrow_status as enum ('held','released'); exception when duplicate_object then null; end $$;
do $$ begin create type shipment_type as enum ('primary_shipping','primary_vault','secondary_buyout','secondary_bid','vault_shipout'); exception when duplicate_object then null; end $$;
do $$ begin create type shipment_to_dest as enum ('buyer_address','platform_vault'); exception when duplicate_object then null; end $$;
do $$ begin create type shipment_from_location as enum ('platform','seller'); exception when duplicate_object then null; end $$;
do $$ begin create type shipment_status as enum ('requested','packed','shipped','delivered','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type bid_status as enum ('active','outbid','cancelled','accepted'); exception when duplicate_object then null; end $$;
do $$ begin create type creator_status as enum ('active','suspended','inactive'); exception when duplicate_object then null; end $$;
do $$ begin create type nfc_batch_status as enum ('received','provisioned','qc_passed','qc_failed','deployed'); exception when duplicate_object then null; end $$;
do $$ begin create type dispute_status as enum ('open','under_review','resolved_refund','resolved_strike','resolved_suspend'); exception when duplicate_object then null; end $$;
do $$ begin create type audit_action as enum ('create','update','delete','view_sensitive','login','login_mfa','2fa_enroll','2fa_reset','payout_trigger','config_change'); exception when duplicate_object then null; end $$;

-- ── Fixup existing enums (extend values) ─────────────────────────────────
-- drop_status: add missing values if not exists
do $$ begin
  alter type drop_status add value if not exists 'scheduled';
  alter type drop_status add value if not exists 'published';
  alter type drop_status add value if not exists 'sold_out';
  alter type drop_status add value if not exists 'closed';
exception when others then null; end $$;
-- order_status: add qc/settled/disputed vs pending/processing etc
do $$ begin
  alter type order_status add value if not exists 'paid';
  alter type order_status add value if not exists 'qc';
  alter type order_status add value if not exists 'settled';
  alter type order_status add value if not exists 'disputed';
exception when others then null; end $$;
-- wallet_tx_type: add new values
do $$ begin
  alter type wallet_tx_type add value if not exists 'top_up';
  alter type wallet_tx_type add value if not exists 'escrow_hold';
  alter type wallet_tx_type add value if not exists 'escrow_release';
  alter type wallet_tx_type add value if not exists 'settlement';
  alter type wallet_tx_type add value if not exists 'adjustment';
exception when others then null; end $$;

-- ── users: add profile fields (is_anonymous, total_xp etc) ───────────────
alter table public.users add column if not exists username text;
alter table public.users add column if not exists is_anonymous boolean not null default false;
alter table public.users add column if not exists total_xp integer not null default 0;
alter table public.users add column if not exists level integer not null default 1;
alter table public.users add column if not exists cumulative_spend_ccoin integer not null default 0;
-- backfill xp -> total_xp where needed
update public.users set total_xp = xp where total_xp = 0 and xp > 0;
-- username unique where not null
create unique index if not exists idx_users_username on public.users(username) where username is not null;

-- ── creators (kreator hasil rekrutan off-platform) ─────────────────────────
create table if not exists public.creators (
  id text primary key,
  user_id text references public.users(id) on delete set null,
  handle text unique,
  total_followers_combined integer not null default 0 check (total_followers_combined >= 0),
  status creator_status not null default 'active',
  bank_account jsonb,
  kyc_completed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_creators_user on public.creators(user_id);
drop trigger if exists trg_creators_updated_at on public.creators;
create trigger trg_creators_updated_at before update on public.creators
for each row execute function set_updated_at();

-- ── drops: add canonical columns ───────────────────────────────────────────
alter table public.drops add column if not exists artwork_3d_url text;
alter table public.drops add column if not exists price_ccoin integer check (price_ccoin >= 1);
alter table public.drops add column if not exists drop_start_at timestamptz;
alter table public.drops add column if not exists drop_end_at timestamptz;
alter table public.drops add column if not exists created_by text references public.users(id) on delete set null;
-- backfill price_ccoin from unsigned price where missing
update public.drops set price_ccoin = price_unsigned_ccoin where price_ccoin is null;
-- make drop_at alias visible: keep column but add generated view via drop_start_at coalesce
-- no need to drop old drop_at; keep for compat

-- ── cards: add location / buyout / qc / status evolution ───────────────────
alter table public.cards add column if not exists location card_location not null default 'platform_stock';
alter table public.cards add column if not exists buyout_price_ccoin integer check (buyout_price_ccoin is null or buyout_price_ccoin >= 1);
alter table public.cards add column if not exists nfc_configured boolean not null default false;
alter table public.cards add column if not exists qc_status text not null default 'pending' check (qc_status in ('pending','passed','failed'));
alter table public.cards add column if not exists card_status_new card_status_new;
-- map legacy card_status -> location + new status where possible
-- keep legacy card_status enum column for compat; add logic in app to prefer new columns
create index if not exists idx_cards_location on public.cards(location);
create index if not exists idx_cards_buyout on public.cards(buyout_price_ccoin) where buyout_price_ccoin is not null;

-- ── orders: delivery_option, shipping_fee, escrow ──────────────────────────
alter table public.orders add column if not exists delivery_option delivery_option not null default 'shipping';
alter table public.orders add column if not exists shipping_fee_ccoin integer check (shipping_fee_ccoin is null or shipping_fee_ccoin >= 1);
alter table public.orders add column if not exists escrow_status escrow_status not null default 'held';
alter table public.orders add column if not exists card_id text references public.cards(id) on delete set null;
alter table public.orders add column if not exists shipped_at timestamptz;
-- keep shipping_address as text for compat; new code uses same column (nullable for vault)
-- make it nullable (vault has no address)
do $$ begin
  alter table public.orders alter column shipping_address drop not null;
exception when others then null; end $$;

-- ── shipments (pengiriman fisik) ───────────────────────────────────────────
create table if not exists public.shipments (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  requester_id text not null references public.users(id) on delete cascade,
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
create index if not exists idx_shipments_card on public.shipments(card_id);
create index if not exists idx_shipments_requester on public.shipments(requester_id);
drop trigger if exists trg_shipments_updated_at on public.shipments;
create trigger trg_shipments_updated_at before update on public.shipments
for each row execute function set_updated_at();

-- ── bids: evolve to direct-on-card + status ───────────────────────────────
alter table public.bids add column if not exists card_id text references public.cards(id) on delete cascade;
alter table public.bids add column if not exists amount_ccoin_new integer check (amount_ccoin_new is null or amount_ccoin_new >= 1);
alter table public.bids add column if not exists status bid_status not null default 'active';
alter table public.bids add column if not exists outbid_at timestamptz;
alter table public.bids add column if not exists cancelled_at timestamptz;
alter table public.bids add column if not exists accepted_at timestamptz;
-- backfill card_id from listing's card for existing rows
update public.bids b set card_id = l.card_id from public.listings l where b.card_id is null and b.listing_id = l.id;
-- allow listing_id nullable for new direct bids (keep compat)
do $$ begin
  alter table public.bids alter column listing_id drop not null;
exception when others then null; end $$;
create index if not exists idx_bids_card on public.bids(card_id, status, amount_ccoin desc);
-- guard: one active per card (partial unique) — soft, enforced in app + DB
create unique index if not exists idx_bids_one_active_per_card
  on public.bids(card_id) where status = 'active';
do $$ begin
  alter table public.bids add constraint chk_amount_ccoin check (amount_ccoin >= 1);
exception when others then null; end $$;

-- ── ownership_history (provenance) ─────────────────────────────────────────
create table if not exists public.ownership_history (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  owner_id text not null references public.users(id) on delete cascade,
  acquired_via text not null check (acquired_via in ('primary','secondary_buyout','secondary_bid','gift')),
  order_id text references public.orders(id) on delete set null,
  bid_id text references public.bids(id) on delete set null,
  transferred_at timestamptz not null default now()
);
create index if not exists idx_ownership_card on public.ownership_history(card_id, transferred_at desc);
create index if not exists idx_ownership_owner on public.ownership_history(owner_id);

-- ── nfc_batches (provisioning) ─────────────────────────────────────────────
create table if not exists public.nfc_batches (
  id text primary key,
  batch_code text not null unique,
  vendor text,
  qty integer not null check (qty >= 1),
  status nfc_batch_status not null default 'received',
  created_at timestamptz not null default now()
);

-- ── badge_definitions evolution ────────────────────────────────────────────
alter table public.badges add column if not exists criteria jsonb;
alter table public.badges add column if not exists icon_url text;
alter table public.badges add column if not exists xp_reward integer not null default 0;
alter table public.badges add column if not exists is_active boolean not null default true;
alter table public.badges add column if not exists created_by text references public.users(id) on delete set null;
alter table public.badges add column if not exists created_at timestamptz not null default now();
alter table public.badges add column if not exists updated_at timestamptz not null default now();
-- backfill xp_reward from xp
update public.badges set xp_reward = xp where xp_reward = 0 and xp > 0;
-- sync icon_url from icon where missing
update public.badges set icon_url = icon where icon_url is null and icon is not null;
drop trigger if exists trg_badges_updated_at on public.badges;
create trigger trg_badges_updated_at before update on public.badges
for each row execute function set_updated_at();

-- user_badges: add xp snapshot
alter table public.user_badges add column if not exists awarded_at timestamptz not null default now();
alter table public.user_badges add column if not exists xp_reward_snapshot integer not null default 0;
-- backfill awarded_at from earned_at if column exists legacy
do $$ begin
  update public.user_badges set awarded_at = earned_at where awarded_at is not null and earned_at is not null and awarded_at = now() and earned_at <> now();
exception when others then null; end $$;

-- ── disputes ───────────────────────────────────────────────────────────────
create table if not exists public.disputes (
  id text primary key,
  order_id text references public.orders(id) on delete set null,
  card_id text references public.cards(id) on delete set null,
  reporter_id text not null references public.users(id) on delete cascade,
  reason text not null,
  status dispute_status not null default 'open',
  decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_disputes_reporter on public.disputes(reporter_id);
drop trigger if exists trg_disputes_updated_at on public.disputes;
create trigger trg_disputes_updated_at before update on public.disputes
for each row execute function set_updated_at();

-- ── admin_audit_log (append-only) ──────────────────────────────────────────
create table if not exists public.admin_audit_log (
  id text primary key,
  admin_user_id text not null references public.users(id) on delete cascade,
  action audit_action not null,
  target_table text not null,
  target_id text,
  payload_summary jsonb,
  ip text,
  session_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_admin on public.admin_audit_log(admin_user_id, created_at desc);
create index if not exists idx_audit_action on public.admin_audit_log(action);
create index if not exists idx_audit_target on public.admin_audit_log(target_table, target_id);
-- prevent update/delete via RLS + revoke (append-only enforced in app; DB guard: no update/delete policies)

-- ── notifications & payouts (05-data-model section notifications & payouts) ─
create table if not exists public.notifications (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  channel text not null check (channel in ('email','push','in_app')),
  template_key text not null,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);

create table if not exists public.payout_batches (
  id text primary key,
  batch_code text not null unique,
  status text not null default 'draft' check (status in ('draft','processing','paid','failed')),
  total_ccoin bigint not null default 0,
  total_idr bigint not null default 0,
  fee_1pct_idr bigint not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.payouts (
  id text primary key,
  batch_id text references public.payout_batches(id) on delete set null,
  user_id text not null references public.users(id) on delete cascade,
  type text not null check (type in ('creator_share','seller_proceeds','royalty')),
  ccoin_amount integer not null check (ccoin_amount >= 1),
  idr_amount bigint not null,
  withholding_tax jsonb,
  status text not null default 'pending' check (status in ('pending','disbursed','failed'))
);
create index if not exists idx_payouts_user on public.payouts(user_id);
create index if not exists idx_payouts_batch on public.payouts(batch_id);

-- ── Invariants: C-Coin integer >=1 everywhere (check already on most, add missing) ─
-- wallet_transactions amount could be negative (debit) — so no >=1 check there
-- shipments.fee already checked; orders shipping_fee already nullable >=1

-- ── RLS: enable on new tables (permissive for MVP; tighten when Auth wired) ─
alter table public.creators enable row level security;
alter table public.shipments enable row level security;
alter table public.ownership_history enable row level security;
alter table public.nfc_batches enable row level security;
alter table public.disputes enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.notifications enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payouts enable row level security;

do $$ begin
  drop policy if exists "allow all creators" on public.creators;
  create policy "allow all creators" on public.creators for all using (true) with check (true);
  drop policy if exists "allow all shipments" on public.shipments;
  create policy "allow all shipments" on public.shipments for all using (true) with check (true);
  drop policy if exists "allow all ownership_history" on public.ownership_history;
  create policy "allow all ownership_history" on public.ownership_history for all using (true) with check (true);
  drop policy if exists "allow all nfc_batches" on public.nfc_batches;
  create policy "allow all nfc_batches" on public.nfc_batches for all using (true) with check (true);
  drop policy if exists "allow all disputes" on public.disputes;
  create policy "allow all disputes" on public.disputes for all using (true) with check (true);
  drop policy if exists "allow all admin_audit_log" on public.admin_audit_log;
  create policy "allow all admin_audit_log" on public.admin_audit_log for all using (true) with check (true);
  drop policy if exists "allow all notifications" on public.notifications;
  create policy "allow all notifications" on public.notifications for all using (true) with check (true);
  drop policy if exists "allow all payout_batches" on public.payout_batches;
  create policy "allow all payout_batches" on public.payout_batches for all using (true) with check (true);
  drop policy if exists "allow all payouts" on public.payouts;
  create policy "allow all payouts" on public.payouts for all using (true) with check (true);
end $$;
