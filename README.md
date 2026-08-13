# C.Verse Platform — C.Card MVP

Monorepo: `apps/web` (Cloudflare Pages) + `apps/api` (Cloudflare Workers / Hono) + `apps/admin` (VPS + Cloudflare Access, terpisah — TIDAK di Pages) + `packages/shared` (Zod + constants canonical).

Dokumen perencanaan canonical: `docs/` (`00-README` → `08-deployment`) — **single source of truth** untuk AI agent / developer baru (self-contained, tidak perlu baca `00_Dream_Project/` lagi).

## Stack (per `docs/06-tech-decisions.md`)

- Frontend publik: React 19 + Vite + React Router + TanStack Query + three.js (3D viewer) → **Cloudflare Pages**
- Backend: Hono 4 + Zod → **Cloudflare Workers** (lokal via `@hono/node-server`)
- Admin: React 19 + Vite → **VPS + Cloudflare Tunnel + Access** (Zero Trust), 2FA TOTP wajib (`aal2`), audit log append-only
- DB/Auth/Realtime: Supabase Postgres (SG) + Storage (R2 parity lokal: `artwork` 10 MiB, `card-assets` 20 MiB, `kyc` private 5 MiB)
- Shared: `packages/shared` — constants (rate, fee, threshold) + Zod schemas (canonical — jangan hard-code di app)

## Prasyarat

- Node 20+ (`node -v`), `pnpm@9.12.3` (`npm i -g pnpm@9.12.3`)
- Env: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (untuk `apps/web` + `apps/admin`) dan `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (untuk Supabase ops, tidak pernah di-bundle publik)

## Menjalankan Lokal

```bash
pnpm install

# Semua (api :8787 + web :5173) — admin terpisah :3000 jika dijalankan
pnpm dev
# Atau per app:
pnpm --filter @c-verse/api dev:node   # Hono node :8787
pnpm --filter @c-verse/web dev        # Vite :5173 (proxy /api → :8787)
pnpm --filter @c-verse/admin dev      # Vite :3000 (admin — Cloudflare Access di prod)

# Build & typecheck
pnpm run typecheck
pnpm run build         # → apps/web/dist + apps/admin/dist (api = tsc --noEmit)
```

## Akun Demo

- Kolektor: `demo@cverse.id` / `demo123` (wallet 120 C-Coin, order + card demo, vault card)
- Admin: `admin@cverse.id` / `admin123`
- Tombol *Demo Login* 1-klik di `/login`

## Halaman & Route (per `docs/02-pages.md`)

- Publik: `/`, `/drops`, `/drops/:id`, `/drops/:id/checkout` (shipping vs vault), `/marketplace` (buyout), `/browse` (bid langsung), `/cards/:cardId` (info + ownership history), `/cards/:cardId/3d` (simple 3D + Verified Card badge), `/leaderboard`, `/c/:username` (kreator public), `/u/:username` (kolektor public — hidden jika `privacy anonymous`), `/verify` (QR/UID input → redirect ke card pages)
- User (login): `/home`, `/orders`, `/orders/:id` (timeline hanya untuk shipping; vault tanpa tracking), `/wallet` (top-up area user + ledger; payout fee 1%), `/me` (= `/collection`), `/me/manage` (sell: set/cabut buyout, bid accept, ship-from-vault), `/me/kyc`, `/me/privacy`, `/notifications`
- Kreator: `/creator` (traffic + pendapatan only; primary 70/30 platform-produced — creator-produced defer)
- Admin: **app terpisah** `admin.c-verse.co` (Tunnel + Access) — `/` (ADM-01..06), `/creators` (ADM-01), `/drops` (ADM-02), `/orders` (ADM-03), `/nfc` (ADM-04), `/payouts` (ADM-05), `/disputes` (ADM-06), `/badges` (ADM-07: criteria + ikon + XP reward), `/audit` (ADM-08 append-only), 2FA (ADM-09: aal2 guard)

## Flow MVP (9 flow, per `docs/03-flows.md`)

1. **Primary drop** — 1 kartu/user/drop, atomik, escrow `held` → `released` (vault langsung settled; shipping via DELIVERED + H+7)
2. **Fulfillment** — `paid → qc → shipped → delivered → settled` (shipping) vs `paid → qc → settled` (vault)
3. **Payment & Settlement** — `wallet_transactions` append-only + C-Coin integer ≥1 (ceiling dari IDR) + fee secondary 15% (7.5 platform + 7.5 royalti lifetime)
4. **NFC Tap → halaman 3D** — SUN URL `c-verse.co/cards/:id/3d?uid=..&ctr=..&c=CMAC`; iOS background reading tanpa Web NFC (validasi Sprint 0, gap C-03)
5. **Fallback QR** — scan QR di dus → `/cards/:id` status `Registered` (tanpa CMAC, lebih lemah)
6. **Ownership transfer** — DB record (`current_owner_id` + `ownership_history`); `location` enum (`platform_stock` / `with_owner` / `platform_vault`)
7. **Secondary Marketplace + Browse** — Marketplace = buyout price; Browse = bid langsung (1 active tertinggi; outbid/cancel release; owner accept only; tanpa expire; history 90 hari, accepted selamanya)
8. **Ship-from-vault** — kartu `platform_vault` bisa dikirim kapan saja (ongkir C-Coin integer ≥1)
9. **Gamifikasi** — Level `floor(total_xp/10)`; `spend 1 C = 1 XP` (+ badge XP reward); top-up **tidak** menambah XP

## Deploy (per `docs/08-deployment.md`)

- Supabase: `npx supabase db reset` → `migrations/*.sql` + `seed.sql`; buckets `artwork`/`card-assets`/`kyc`
- Web: Cloudflare Pages (`apps/web/dist`); domain `c-verse.co` (primary) + `c-verse.id` redirect — **LOCK sebelum provisioning NFC** (NDEF URL)
- API: `wrangler deploy` (`apps/api`); cron (`escrow 5m`, `payout Selasa 06:00 WIB`, `badge 03:00 WIB`)
- Admin: VPS + `cloudflared tunnel` → `admin.c-verse.co` + Access policy *Allow founders*; build `apps/admin` serve statik di belakang tunnel

## Angka Kunci (per docs `00-README` §4)

1 C-Coin = Rp 10.000 · threshold kreator 100rb+ followers *combined* · primary 70/30 (platform-produced) · secondary 15% (7.5/7.5/85) · payout fee 1% · produk 63×88mm holo + acrylic hardcase
