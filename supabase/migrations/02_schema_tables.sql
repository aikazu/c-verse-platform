-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 02_schema_tables: tabel badges → platform_revenue, treasury
-- system user, trigger updated_at + tie-break timestamps.
-- Lanjutan 01_schema.
-- notifications.read_at dan payouts_status_check ditulis FINAL inline
-- (fold dari alter add column/constraint di 01 yang lama).
-- ══════════════════════════════════════════════════════════════════════════

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

-- KYC menyimpan metadata workflow dan object key Cloudflare R2 privat, bukan
-- URL publik. DOB + KTP + selfie wajib, NPWP opsional. Semua nullable agar
-- resubmission parsial tetap dapat diproses.
create table public.kyc_records (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  full_name text not null,
  nik text not null check (char_length(nik)=16),
  address text not null,
  dob date,
  ktp_object_key text,
  npwp_object_key text,
  selfie_object_key text,
  status kyc_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kyc_ktp_object_key_owner_check
    check (ktp_object_key is null or ktp_object_key like user_id::text || '/ktp-%'),
  constraint kyc_npwp_object_key_owner_check
    check (npwp_object_key is null or npwp_object_key like user_id::text || '/npwp-%'),
  constraint kyc_selfie_object_key_owner_check
    check (selfie_object_key is null or selfie_object_key like user_id::text || '/selfie-%'),
  unique(user_id)
);

comment on column public.kyc_records.ktp_object_key is 'Private Cloudflare R2 object key; never a public URL.';
comment on column public.kyc_records.npwp_object_key is 'Private Cloudflare R2 object key; never a public URL.';
comment on column public.kyc_records.selfie_object_key is 'Private Cloudflare R2 object key; never a public URL.';

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
  -- Check fee non-negatif FINAL (fold 06_seller_to_vault): seller-to-vault
  -- gratis (fee 0, tanpa debit wallet), vault_shipout berbayar (fee >= 1,
  -- dibayar via RPC vault_shipout). Kolom tetap nullable untuk baris legacy
  -- yang belum mencatat fee.
  fee_ccoin integer check (fee_ccoin is null or fee_ccoin >= 0),
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
  -- attempts: worker drain email (lib/emailQueue.ts) cap 3 percobaan -> 'failed'
  -- (transient transport error di-retry tick berikutnya; permanen gagal setelah 3x).
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  -- P0-3 (audit 2026-08-24): inbox kolom read_at (nullable, diisi user saat
  -- klik notifikasi; ditulis FINAL inline). Index unread-count di 18_indexes.sql.
  read_at timestamptz
);

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
  -- payouts.status: 'processing' (batch run) + 'refunded' (admin refund) —
  -- ditulis FINAL inline (fold dari alter add constraint di 01 yang lama).
  -- Webhook IRIS sudah menulis 'disbursed'/'failed'.
  constraint payouts_status_check
    check (status in ('pending','processing','disbursed','failed','refunded')),
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
  -- 'shipment': vault_shipout ship fee (founder 2026-08-28, full fee to treasury).
  source text not null check (source in ('primary','secondary_buyout','secondary_bid','shipment')),
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
-- Lihat helper function di 01_schema (set_users_xp_reached_at / set_cards_owner_since).
-- ══════════════════════════════════════════════════════════════════════════
create trigger trg_users_xp_reached_at
  before insert or update on public.users
  for each row execute function public.set_users_xp_reached_at();

create trigger trg_cards_owner_since
  before insert or update on public.cards
  for each row execute function public.set_cards_owner_since();
