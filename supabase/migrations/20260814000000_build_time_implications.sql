-- C.Verse — Build-time implications (docs 05 + 09) — 2026-08-14
-- Additive & idempotent: safe to re-run. Aligns DB with docs canonical.
create extension if not exists "pgcrypto";

-- ── Enums ──────────────────────────────────────────────────────────
do $$ begin create type defect_type as enum ('dus','acrylic','kartu','nfc'); exception when duplicate_object then null; end $$;
do $$ begin create type defect_severity as enum ('minor','major','critical'); exception when duplicate_object then null; end $$;
do $$ begin create type defect_resolution as enum ('redistribute','destroy','return_vendor'); exception when duplicate_object then null; end $$;

-- Extend wallet_tx_type with platform_buy if missing (admin seed buys)
do $$ begin alter type wallet_tx_type add value if not exists 'platform_buy'; exception when others then null; end $$;
do $$ begin alter type wallet_tx_type add value if not exists 'admin_seed'; exception when others then null; end $$;

-- ── profiles (public.users) — consent + flag_reason ───────────────
alter table public.users add column if not exists flag_reason text;
alter table public.users add column if not exists consent_analytics_detail boolean not null default false;
alter table public.users add column if not exists consent_data_market boolean not null default false;

-- ── wallets — hold_payout_until (fraud hold) ──────────────────────
alter table public.wallets add column if not exists hold_payout_until timestamptz;

-- ── creator_page_views (05 data model + 09 3.5 log from day 1) ─────
create table if not exists public.creator_page_views (
  id text primary key,
  creator_id text not null references public.creators(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  referrer text,
  city text,
  user_id text references public.users(id) on delete set null
);
create index if not exists idx_cpv_creator on public.creator_page_views(creator_id, viewed_at desc);
create index if not exists idx_cpv_viewed on public.creator_page_views(viewed_at desc);

-- ── qc_defects (05 data model) ────────────────────────────────────
create table if not exists public.qc_defects (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  defect_type defect_type not null,
  severity defect_severity not null default 'minor',
  notes text,
  resolution defect_resolution,
  redistribute_discount_pct integer check (redistribute_discount_pct is null or (redistribute_discount_pct between 10 and 30)),
  created_at timestamptz not null default now()
);
create index if not exists idx_qc_card on public.qc_defects(card_id);

-- ── wallet_transactions metadata idempotency helpers ───────────────
alter table public.wallet_transactions add column if not exists metadata jsonb;
create index if not exists idx_wtx_metadata_idem on public.wallet_transactions((metadata->>'idempotency_key')) where metadata ? 'idempotency_key';

-- ── Ensure cards indexes for numbering economy (09 3.2) ───────────
create index if not exists idx_cards_unit on public.cards(drop_id, unit_number);

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.creator_page_views enable row level security;
alter table public.qc_defects enable row level security;
do $$ begin
  drop policy if exists "allow all creator_page_views" on public.creator_page_views;
  create policy "allow all creator_page_views" on public.creator_page_views for all using (true) with check (true);
  drop policy if exists "allow all qc_defects" on public.qc_defects;
  create policy "allow all qc_defects" on public.qc_defects for all using (true) with check (true);
end $$;
