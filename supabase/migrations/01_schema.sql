-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 01_schema: extensions, enums (FINAL), helper trigger functions,
-- core tables (users → bids). Setiap objek ditulis satu kali.
--
-- Sumber (semua FINAL, tanpa patch intermediate):
--   - 20260817000000_foundation.sql         — DDL lengkap
--   - 20260817040000_grants_payout.sql      — table-level grants
--   - 20260817060000_revenue_flow_hardening.sql — platform_revenue + treasury + grants
--   - 20260821000000_seed_card.sql          — drops.is_seed column
--   - 20260821020000_seed_two_phase.sql     — bids.destination/shipping_address, orders.source check
--   - 20260823000000_payout_refund.sql      — payouts.status check (add 'processing','refunded')
--   - 20260824000000_shipment_active_unique.sql — partial unique index shipments active per card
--   - 06_seller_to_vault.sql (di-fold)      — shipment_type/shipment_from_location
--     FINAL (incl. 'secondary_seller_to_vault', 'with_owner') + shipments.fee_ccoin
--     check >= 0 (seller-to-vault gratis)
--
-- Pecahan schema (urutan leksikal: 01_ < 01b_ < 01c_ < 02_):
--   - 01b_schema_tables.sql  — tabel badges → platform_revenue + treasury + triggers
--   - 01c_indexes_grants.sql — index + grants/revokes
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
-- A1 2026-08-31: fan dukungan C-Coin ke kreator (RPC send_support, 04_rpc).
alter type public.wallet_tx_type add value if not exists 'support';
-- Dual-token 2026-09-03: konversi Gems→C-Coin 1:1 (RPC convert_gems, 04_rpc).
alter type public.wallet_tx_type add value if not exists 'convert';
create type public.verify_status as enum ('verified','tamper_detected','registered','unknown');
create type public.kyc_status as enum ('pending','approved','rejected');
create type public.card_variant as enum ('unsigned','signed');
create type public.card_status as enum ('inventory','bound','listed_buyout','bid_pending','sold','tampered','defect','lost');
create type public.card_location as enum ('platform_stock','with_owner','platform_vault');
create type public.delivery_option as enum ('shipping','vault');
create type public.escrow_status as enum ('held','released');
-- shipment_type FINAL (fold 06_seller_to_vault): 'secondary_seller_to_vault' =
-- seller kirim kartu with_owner ke platform vault untuk verifikasi (P0-6 audit
-- 2026-08-24; sinkron shipmentTypeSchema di packages/shared/src/index.ts).
create type public.shipment_type as enum ('primary_shipping','primary_vault','secondary_buyout','secondary_bid','vault_shipout','secondary_seller_to_vault');
create type public.shipment_to_dest as enum ('buyer_address','platform_vault');
-- shipment_from_location FINAL (fold 06_seller_to_vault): 'with_owner' = sumber
-- aktual kartu seller; 'seller' generik dipertahankan untuk kompatibilitas
-- baris lama.
create type public.shipment_from_location as enum ('platform','seller','with_owner');
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
  -- C-Gems (dual-token, keputusan owner 2026-09-03): saldo penghasilan
  -- settlement (royalty drop, seller settlement, support diterima) — bisa
  -- dicairkan via payout, TIDAK bisa di-top-up. Integer murni (parity C-Coin).
  balance_gems integer not null default 0 check (balance_gems >= 0),
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

-- C-Gems (dual-token, keputusan owner 2026-09-03): lot pendapatan settlement
-- dengan kunci 24 jam PER-LOT. Payout hanya boleh debit lot matured (FIFO
-- oldest-first, gate di payout_request); konversi Gems→C-Coin boleh debit lot
-- segala usia (aman — C-Coin tidak bisa dicairkan). Lot refund payout dibuat
-- langsung matured (mature_at = now()).
create table public.gem_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  remaining integer not null check (remaining >= 0),
  ref_type text not null,
  ref_id text,
  created_at timestamptz not null default now(),
  mature_at timestamptz not null
);

-- Ledger C-Gems (append-only, mirror wallet_transactions): amount positif =
-- kredit, negatif = debit. Idempotency RPC via idem_key (unique).
create table public.gem_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null,
  balance_after_gems integer not null,
  ref_type text not null,
  ref_table text,
  ref_id text,
  idem_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.orders (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  drop_id text not null references public.drops(id) on delete restrict,
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
  source text not null default 'fcfs',
  -- orders.source: seed buyout PHASE-1 (20260821020000) menulis 'secondary_buyout'
  -- (ditulis FINAL inline — fold dari alter add constraint di 01 yang lama).
  constraint orders_source_check check (source in ('fcfs','raffle','secondary_buyout'))
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
