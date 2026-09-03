-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 06_seller_to_vault: repair POST /api/shipments/seller-to-vault.
--
-- Route menulis type='secondary_seller_to_vault' + from_location='with_owner'
-- (apps/api/src/modules/shipments/routes.ts) tetapi kedua nilai tidak ada di
-- enum — setiap request gagal di Postgres (22P02) dan flow verifikasi seller
-- tidak pernah bisa sukses. Nilai sinkron dengan:
--   - shipmentTypeSchema di packages/shared/src/index.ts ('secondary_seller_to_vault')
--   - guard uq_shipments_active_per_card (01_schema): terminal = delivered/cancelled
--   - pelaksanaan admin_fulfill_shipment (04_rpc) — tidak berubah.
--
-- Enum ALTER ... ADD VALUE tidak bisa jalan di dalam transaction block, dan
-- `db push` menjalankan migrasi dalam transaksi — jadi tambah nilai lewat
-- DO block dengan commit terpisah tidak mungkin. Solusinya: recreate enum
-- via transaction-safe swap (create new type → alter column → drop old).
-- ══════════════════════════════════════════════════════════════════════════

-- 1) shipment_type + 'secondary_seller_to_vault' (seller kirim kartu with_owner
--    ke platform vault untuk verifikasi — P0-6 audit 2026-08-24).
alter type public.shipment_type rename to shipment_type_old;

create type public.shipment_type as enum (
  'primary_shipping',
  'primary_vault',
  'secondary_buyout',
  'secondary_bid',
  'vault_shipout',
  'secondary_seller_to_vault'
);

-- Default kolom bertipe enum lama tidak bisa di-cast otomatis (42804) —
-- drop dulu, swap tipe, set ulang.
alter table public.shipments alter column type drop default;

alter table public.shipments
  alter column type type public.shipment_type
  using type::text::public.shipment_type;

drop type public.shipment_type_old;

-- 2) shipment_from_location + 'with_owner' (sumber aktual kartu seller —
--    'seller' generik dipertahankan untuk kompatibilitas baris lama).
alter type public.shipment_from_location rename to shipment_from_location_old;

create type public.shipment_from_location as enum (
  'platform',
  'seller',
  'with_owner'
);

alter table public.shipments alter column from_location drop default;

alter table public.shipments
  alter column from_location type public.shipment_from_location
  using from_location::text::public.shipment_from_location;

alter table public.shipments alter column from_location set default 'platform'::public.shipment_from_location;

drop type public.shipment_from_location_old;

-- 3) Check fee non-negatif: seller-to-vault gratis (fee 0, tanpa debit wallet),
--    vault_shipout berbayar (fee >= 1, dibayar via RPC vault_shipout). Kolom
--    tetap nullable untuk baris legacy yang belum mencatat fee.
alter table public.shipments drop constraint if exists shipments_fee_ccoin_check;
alter table public.shipments add constraint shipments_fee_ccoin_check
  check (fee_ccoin is null or fee_ccoin >= 0);
