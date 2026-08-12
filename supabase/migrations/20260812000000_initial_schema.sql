-- C.Verse — Initial schema (maps 1:1 to apps/api/src/lib/store.ts + packages/shared)
-- Generated for Supabase branching (GitHub integration auto-applies migrations)
-- Safe to run on a fresh project; idempotent where practical

-- Extensions
create extension if not exists "pgcrypto";

-- Helpers
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- Enums
do $$ begin create type user_role as enum ('collector','creator','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type drop_status as enum ('draft','review','approved','production','scheduled','live','ended','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type order_status as enum ('pending','paid','processing','shipped','delivered','cancelled','refunded'); exception when duplicate_object then null; end $$;
do $$ begin create type listing_status as enum ('draft','listed','bidding','awaiting_settlement','settled','expired','cancelled','failed'); exception when duplicate_object then null; end $$;
do $$ begin create type listing_type as enum ('fixed','auction'); exception when duplicate_object then null; end $$;
do $$ begin create type wallet_tx_type as enum ('topup','checkout','refund','payout','royalty','fee','hold','release'); exception when duplicate_object then null; end $$;
do $$ begin create type verify_status as enum ('verified','tamper_detected','registered','unknown'); exception when duplicate_object then null; end $$;
do $$ begin create type kyc_status as enum ('pending','approved','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type card_variant as enum ('unsigned','signed'); exception when duplicate_object then null; end $$;
do $$ begin create type card_status as enum ('available','sold','listed','transferred'); exception when duplicate_object then null; end $$;

-- Users (mirrors auth.users via FK, but standalone for MVP; can be linked later)
create table if not exists public.users (
  id text primary key,
  email text not null unique,
  password_hash text not null, -- MVP only; replaced by Supabase Auth in production
  display_name text not null,
  role user_role not null default 'collector',
  avatar_url text,
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
for each row execute function set_updated_at();

-- Wallets (1:1 with users)
create table if not exists public.wallets (
  user_id text primary key references public.users(id) on delete cascade,
  balance_ccoin integer not null default 0 check (balance_ccoin >= 0),
  total_topup_ccoin integer not null default 0,
  total_spent_ccoin integer not null default 0,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_wallets_updated_at on public.wallets;
create trigger trg_wallets_updated_at before update on public.wallets
for each row execute function set_updated_at();

-- Drops (creator's collectible release)
create table if not exists public.drops (
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
  creator_id text not null references public.users(id) on delete restrict,
  creator_name text not null,
  sold_count integer not null default 0 check (sold_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_counts check (signed_count + unsigned_count = total_units),
  constraint chk_sold check (sold_count <= total_units)
);
create index if not exists idx_drops_status on public.drops(status);
create index if not exists idx_drops_creator on public.drops(creator_id);
create index if not exists idx_drops_drop_at on public.drops(drop_at);
drop trigger if exists trg_drops_updated_at on public.drops;
create trigger trg_drops_updated_at before update on public.drops
for each row execute function set_updated_at();

-- Cards (physical units; 1 card = 1 NFC tag)
create table if not exists public.cards (
  id text primary key,
  drop_id text not null references public.drops(id) on delete cascade,
  unit_number integer not null check (unit_number >= 1),
  variant card_variant not null,
  status card_status not null default 'available',
  owner_id text references public.users(id) on delete set null,
  nfc_uid text not null unique,
  nfc_short_id text not null unique,
  verify_status verify_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(drop_id, unit_number)
);
create index if not exists idx_cards_drop on public.cards(drop_id);
create index if not exists idx_cards_owner on public.cards(owner_id);
create index if not exists idx_cards_nfc_uid on public.cards(nfc_uid);
create index if not exists idx_cards_nfc_short on public.cards(nfc_short_id);
drop trigger if exists trg_cards_updated_at on public.cards;
create trigger trg_cards_updated_at before update on public.cards
for each row execute function set_updated_at();

-- Wallet transactions (immutable ledger; append-only)
create table if not exists public.wallet_transactions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  type wallet_tx_type not null,
  amount_ccoin integer not null, -- positive = credit, negative = debit
  balance_after_ccoin integer not null,
  ref_type text,
  ref_id text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wtx_user_created on public.wallet_transactions(user_id, created_at desc);
create index if not exists idx_wtx_ref on public.wallet_transactions(ref_type, ref_id);

-- Orders (primary sale checkout)
create table if not exists public.orders (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  drop_id text not null references public.drops(id) on delete restrict,
  card_ids text[] not null default '{}',
  total_ccoin integer not null check (total_ccoin >= 1),
  total_idr integer not null check (total_idr >= 0),
  status order_status not null default 'paid',
  shipping_address text not null,
  tracking_number text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_user on public.orders(user_id, created_at desc);
create index if not exists idx_orders_drop on public.orders(drop_id);
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders
for each row execute function set_updated_at();

-- Listings (secondary market)
create table if not exists public.listings (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  seller_id text not null references public.users(id) on delete cascade,
  type listing_type not null default 'fixed',
  price_ccoin integer not null check (price_ccoin >= 1),
  reserve_ccoin integer check (reserve_ccoin is null or reserve_ccoin >= 0),
  current_bid_ccoin integer check (current_bid_ccoin is null or current_bid_ccoin >= 1),
  current_bidder_id text references public.users(id) on delete set null,
  status listing_status not null default 'listed',
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_listings_status on public.listings(status);
create index if not exists idx_listings_card on public.listings(card_id);
create index if not exists idx_listings_seller on public.listings(seller_id);
create index if not exists idx_listings_type on public.listings(type);
create index if not exists idx_listings_ends_at on public.listings(ends_at);
drop trigger if exists trg_listings_updated_at on public.listings;
create trigger trg_listings_updated_at before update on public.listings
for each row execute function set_updated_at();

-- Bids (auction bids; history preserved even after settlement)
create table if not exists public.bids (
  id text primary key,
  listing_id text not null references public.listings(id) on delete cascade,
  bidder_id text not null references public.users(id) on delete cascade,
  bidder_name text not null,
  amount_ccoin integer not null check (amount_ccoin >= 1),
  created_at timestamptz not null default now()
);
create index if not exists idx_bids_listing on public.bids(listing_id, amount_ccoin desc);
create index if not exists idx_bids_bidder on public.bids(bidder_id);

-- Badges (static catalog)
create table if not exists public.badges (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null,
  icon text not null,
  xp integer not null default 0
);

-- User badges (earned)
create table if not exists public.user_badges (
  user_id text not null references public.users(id) on delete cascade,
  badge_id text not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);
create index if not exists idx_user_badges_user on public.user_badges(user_id);

-- KYC records
create table if not exists public.kyc_records (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  full_name text not null,
  nik text not null check (char_length(nik)=16),
  address text not null,
  status kyc_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id) -- one KYC per user (upsert on resubmit if rejected)
);
create index if not exists idx_kyc_status on public.kyc_records(status);
drop trigger if exists trg_kyc_updated_at on public.kyc_records;
create trigger trg_kyc_updated_at before update on public.kyc_records
for each row execute function set_updated_at();

-- Sessions (MVP token store; replaced by Supabase Auth JWT in production)
create table if not exists public.sessions (
  token text primary key,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_sessions_user on public.sessions(user_id);

-- RLS (permissive for MVP; tighten when Supabase Auth is wired)
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.drops enable row level security;
alter table public.cards enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.orders enable row level security;
alter table public.listings enable row level security;
alter table public.bids enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.kyc_records enable row level security;
alter table public.sessions enable row level security;

-- Drop & recreate permissive policies (idempotent via DO)
do $$ begin
  -- users
  drop policy if exists "allow all users" on public.users;
  create policy "allow all users" on public.users for all using (true) with check (true);
  -- wallets
  drop policy if exists "allow all wallets" on public.wallets;
  create policy "allow all wallets" on public.wallets for all using (true) with check (true);
  -- drops
  drop policy if exists "allow all drops" on public.drops;
  create policy "allow all drops" on public.drops for all using (true) with check (true);
  -- cards
  drop policy if exists "allow all cards" on public.cards;
  create policy "allow all cards" on public.cards for all using (true) with check (true);
  -- wallet_transactions
  drop policy if exists "allow all wtx" on public.wallet_transactions;
  create policy "allow all wtx" on public.wallet_transactions for all using (true) with check (true);
  -- orders
  drop policy if exists "allow all orders" on public.orders;
  create policy "allow all orders" on public.orders for all using (true) with check (true);
  -- listings
  drop policy if exists "allow all listings" on public.listings;
  create policy "allow all listings" on public.listings for all using (true) with check (true);
  -- bids
  drop policy if exists "allow all bids" on public.bids;
  create policy "allow all bids" on public.bids for all using (true) with check (true);
  -- badges
  drop policy if exists "allow all badges" on public.badges;
  create policy "allow all badges" on public.badges for all using (true) with check (true);
  -- user_badges
  drop policy if exists "allow all user_badges" on public.user_badges;
  create policy "allow all user_badges" on public.user_badges for all using (true) with check (true);
  -- kyc
  drop policy if exists "allow all kyc" on public.kyc_records;
  create policy "allow all kyc" on public.kyc_records for all using (true) with check (true);
  -- sessions
  drop policy if exists "allow all sessions" on public.sessions;
  create policy "allow all sessions" on public.sessions for all using (true) with check (true);
end $$;
