# C.Verse Platform — C.Card MVP

Monorepo: React/Vite SPA (Cloudflare Pages) + Hono API (Cloudflare Workers) + shared Zod schemas.
Lihat `../../00_Dream_Project/` untuk dokumen brainstorm (pondasi, MVP flow, tech stack decision).

## Stack
- Frontend: React 19 + Vite + React Router + TanStack Query + three.js (3D viewer)
- Backend: Hono 4 + Zod
- Shared: Zod schemas + constants (C-Coin rate, AOV, fee, dll)

## Prasyarat
- Node 20+ (`node -v`), pnpm (`npm i -g pnpm`)

## Menjalankan Lokal

```bash
# install
pnpm install

# dev: jalankan keduanya (api :8787, web :5173)
pnpm --filter @c-verse/api dev:node # Hono via @hono/node-server :8787
pnpm --filter @c-verse/web dev # Vite :5173 (proxy /api → :8787)
# atau buka 2 terminal, satu per app
```

## Akun Demo
- Kolektor: `demo@cverse.id` / `demo123` (wallet 120 C-Coin, ada order + listing demo)
- Admin: `admin@cverse.id` / `admin123`
- Tombol "Demo Login" 1-klik ada di /login

## Flow yang Diimplementasi (9 Flow MVP)
1. **Primary Drop** — siapa cepat dia dapat, potong C-Coin, limit 2/drop, stok atomik
2. **Fulfillment** — card allocation + trackingNumber
3. **Payment & Settlement** — wallet C-Coin ledger, revenue share 70/30 ke kreator
4. **NFC Tap & Verify** — `/api/nfc/verify-nfc` (tap di Android) + QR fallback
5. **QR Fallback** — `/api/nfc/verify/:shortId` (iOS / non-Chrome)
6. **Ownership Transfer** — via secondary settlement (fixed buy-now + auction accept)
7. **Secondary Auction P2P** — fixed & english auction, min 5% increment, anti-sniping +5m, fee 15%
8. **Onboarding, KYC, Notifikasi** — kreator onboarding via /creator, KYC gate >100 C
9. **Top-up & Payout C-Coin** — rate 1 C = Rp 10.000, Opsi A: buyer closed-loop, seller payout fee 1%

## Build
```bash
pnpm --filter @c-verse/web build # → apps/web/dist
```

## Deploy (full-edge)
- Web: Cloudflare Pages (output `apps/web/dist`)
- API: Cloudflare Workers (`wrangler deploy` di `apps/api`) — untuk MVP lokal cukup node-server
