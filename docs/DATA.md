# C.Verse — Data (Schema + Ledger + Branching)

## In-Memory Today (MVP)

`apps/api/src/lib/store.ts` — **kanonik yang jalan sekarang**. Semua route (`drops`, `wallet`, `orders`, `nfc`, `listings`, `bids`, `profile`, `gamification`, `creators`, `kyc`) pakai `ensureSeed()` + `Map`s. Seed ephemeral (restart → reset).

```ts
Store { users, drops, cards, wallets, walletTx[], orders, listings, bids[], badges, userBadges, kyc, sessions }
```

Lihat [FLOWS.md](FLOWS.md) untuk flow yang pakai tiap entity.

## SQL Mirroring (Supabase)

`supabase/migrations/20260812000000_initial_schema.sql` = **mirror 1:1** store.ts. Jalankan via `npx supabase db reset` atau auto via branching. `supabase/seed.sql` mirror `ensureSeed()` persis (`ON CONFLICT DO NOTHING`).

### Ringkas Skema

| Tabel | PK | Kunci asing / unik | Catatan |
|-------|----|--------------------|---------|
| `users` | `id` text | `email` unique, `role` enum collector/creator/admin, `xp` | `password_hash` MVP; ganti Supabase Auth di produksi |
| `wallets` | `user_id` → users | 1:1, `balance_ccoin ≥0` | Total topup/spent terpisah |
| `drops` | `id` text | `creator_id`→users, `status` enum, `signed+unsigned=total`, `sold≤total` | Index status/creator/drop_at |
| `cards` | `id` text | `drop_id`→drops, `drop_id+unit_number` unique, `nfc_uid`/`nfc_short_id` unique | `verify_status` enum |
| `wallet_transactions` | `id` text | `user_id`→users, `(ref_type,ref_id)` | **Immutable ledger** — `created_at` desc index |
| `orders` | `id` text | `user_id`→users, `drop_id`→drops, `card_ids text[]` | `total_ccoin`, `total_idr`, `tracking_number` |
| `listings` | `id` text | `card_id`→cards, `seller_id`→users, `current_bidder_id`→users | `type` fixed/auction, `reserve_ccoin`, `ends_at` |
| `bids` | `id` text | `listing_id`→listings, `bidder_id`→users | Index `(listing, amount desc)` |
| `badges` | `id` text | `code` unique | Static catalog |
| `user_badges` | `(user_id,badge_id)` | →users, →badges | Earn log |
| `kyc_records` | `id` text | `user_id` unique →users, `nik char(16)` | `status` pending/approved/rejected |
| `sessions` | `token` text | `user_id`→users | MVP token store; ganti JWT di produksi |

Enums: `user_role`, `drop_status` (draft/review/approved/production/scheduled/live/ended/cancelled), `order_status`, `listing_status`, `listing_type`, `wallet_tx_type` (topup/checkout/refund/payout/royalty/fee/hold/release), `verify_status`, `kyc_status`, `card_variant/status`. RLS: **permissive** (`allow all`) untuk MVP, tighten setelah Auth wiring. Trigger `set_updated_at()` di `users/wallets/drops/cards/orders/listings/kyc_records`.

### Ledger C-Coin (Aturan)

- Satu `payment_id` **idempoten** — tidak boleh double credit.
- Semua mutasi saldo = `wallet_transactions` dengan `balance_after_ccoin`; **tidak ada update/delete**, hanya append.
- Top-up: `type=topup` setelah webhook Midtrans sukses. Checkout/listing settlement: `type=checkout` (buyer debit) + `type=royalty`/`payout` (kreator/seller credit). Payout IDR: fee 1% dicatat terpisah.
- Recon harian via Cron (SOP 6.1 arsip).

## Supabase Branching (Auto-Integrate)

> Repo sudah branching-ready. Lihat [supabase-branching.md](supabase-branching.md) untuk langkah Dashboard.

- **`supabase/` di repo root** → Working directory = `.` saat connect di Integrations.
- `supabase/migrations/` auto-apply di: (a) PR preview branch creation, (b) merge `main` → production (jika `Deploy to production` aktif).
- `supabase/seed.sql` **preview-only** (tidak merge ke prod) — untuk `supabase db reset --linked` dan preview seed.
- Storage: `config.toml` buckets `artwork` (10 MiB, png/jpg/webp, public) + `card-assets` (20 MiB, + obj, public). R2 tetap jadi zero-egress; Supabase storage parity untuk local dev.
- Auth: `site_url = http://127.0.0.1:5173`, `additional_redirect_urls` localhost, `project_id = "c-verse-platform"` (jangan ganti setelah branching aktif).

### Local Supabase (Docker)

```bash
npx supabase start # :54321 API, :54322 DB (17), :54323 Studio
npx supabase status # anon/service_role keys → copy ke .env.local
npx supabase db reset # re-run migrations + seed
npx supabase stop
```

`.env.example` (repo root) punya `VITE_SUPABASE_URL/ANON_KEY`, `SUPABASE_URL/ANON/SERVICE_ROLE`, `DATABASE_URL` (pooler + direct).

## Adapter (In-Memory ↔ Postgres)

- **`apps/api/src/lib/supabase.ts`** — `getSupabase(): SupabaseClient | null` (lazy, cache). Env inject per-branch via Secrets. `null` → fallback ke `store.ts`. Tetap hijau tanpa Docker.
- **`apps/web/src/lib/supabase.ts`** — `supabase` client via `VITE_SUPABASE_*`; `isSupabaseEnabled` flag.

Migrasi per-route — pola di [supabase-adapter.md](supabase-adapter.md):

```ts
const sb = getSupabase();
if (sb) { const {data,error} = await sb.from("drops").select("*").eq("status","live"); … }
ensureSeed(); return c.json({ drops: [...store.drops.values()].filter(…) });
```

Prioritas migrasi: `drops` → `cards` → `orders` → `wallet_transactions` (transaksi/ledger pakai RPC).

## Validasi SQL

File di `supabase/migrations/` harus lint-clean (`npx supabase db lint`) dan naik sebagai **required check** (`Supabase Preview`) sebelum merge — lihat `.github/workflows/supabase-branch-check.yml`.
