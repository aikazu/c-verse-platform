# C.Verse — Architecture (Full Edge)

> Sumber: `90_research/tech-stack-decision-full-edge.md` (2026-08-05, update 2026-08-11) + `.hermes/` fix. Untuk angka → [NUMBERS.md](NUMBERS.md).

## Keputusan Strategis

**Full edge, tanpa VPS**: React/Vite SPA di **Cloudflare Pages** + **Hono** di **Cloudflare Workers** + **Supabase** (Postgres + Auth + Realtime) + **Cloudflare R2** (storage). Cold start ~0 ms, PoP Jakarta/Singapore, free tier cukup Y1.

```
Browser / Mobile
    │
    ▼
┌──────────────────────────────┐  Cloudflare Pages (Vite SPA, unlimited, free)
│ React 19 + Vite + Router     │  TanStack Query (cache/retry/optimistic)
│ shadcn/Radix · three.js      │  SEO di-defer (traffic dari sosmed kreator)
└──────────────┬───────────────┘
               │ fetch /api/*
               ▼
┌──────────────────────────────┐  Cloudflare Workers (Hono, 100k req/day free)
│ Auth middleware (JWT via JWKS)│  Business logic · CMAC verify (Web Crypto)
│ Webhook handler (Midtrans)    │  CF Queues · Cron (open/close, recon, email)
└───┬──────┬──────┬──────┬──────┘
    │      │      │      │
    ▼      ▼      ▼      ▼
 Supabase Supabase  R2   Queues
 Postgres  Auth  (images Cron
 (SG)      (JWT)  +3D)  (bg jobs)
    │
    ▼
 Supabase Realtime (broadcast: bid + counter)
    · <50 concurrent/listing cukup (MVP)
    · Durable Objects tidak dipakai (overkill)
```

**Yang tidak dipakai di MVP**: Next.js/SSR, Better Auth/Lucia, BullMQ/Redis, VPS.

## Monorepo

```
Platform/
  apps/web/        → Vite SPA, deploy ke CF Pages (dist/)
  apps/api/        → Hono, src/index.ts = Worker entry (export default app)
                     src/server.ts = Node entry (serve, dipakai lokal & scripts-dev.mjs)
  packages/shared/ → Zod schemas, types, constants (dipakai web+api)
  supabase/        → migrations/ + seed.sql + config.toml
```

Tooling: **pnpm workspace**. Shared: `packages/shared/src/index.ts` di-import web+api → type safety tanpa codegen.

## Komponen

| Lapisan | Pilihan | Catatan |
|---------|---------|---------|
| Frontend | React 19 + Vite, React Router, Tailwind CSS 4, three.js (lazy), OrbitControls, UnrealBloomPass, GSAP | Code-split three.js; fallback 2D jika WebGL off |
| Backend | Hono + Zod (`@hono/zod-validator`), Drizzle ORM ready (PG via `postgres.js` / Supavisor) | Validasi shared via `packages/shared` |
| DB | Supabase Postgres **SG**, Supavisor pooler, Drizzle Kit migrasi | Branching: per-PR preview DB (lihat [DATA.md](DATA.md)) |
| Storage | Cloudflare R2 (S3-compat, zero egress) — 3D `.obj` + texture | Presigned URL / public bucket + CDN |
| Realtime | Supabase Realtime broadcast | Auction + counter |
| Jobs | CF Queues + Cron Triggers | BullMQ tidak ada (butuh long-running) |
| Payment | **Midtrans** (primary) + Xendit backup | **Hanya** top-up C-Coin + disbursement (checkout internal C-Coin, tanpa fee gateway) |
| Shipping | Biteship / RajaOngkir | Tracking → notifikasi |
| Email | **Resend** (default, abstraction layer, vendor-agnostic) | Custom SMTP bisa plug |
| NFC | NTAG 424 DNA TagTamper — SUN AES-128 CMAC via Web Crypto | `nodejs_compat` fallback jika perlu |

## Dev & Build (Hermes-aware)

```bash
pnpm install
pnpm dev              # node scripts-dev.mjs → tsx watch src/server.ts :8787 + vite :5173
pnpm --filter @c-verse/web dev   # vite :5173 (proxy /api → :8787)
pnpm --filter @c-verse/api dev:node # tsx watch src/server.ts :8787
pnpm -r build         # shared tsc --noEmit + api tsc + web vite build
pnpm -r typecheck
```

**Hermes verify** (`hermes verify --json`): bootstrap `pnpm install` → build `pnpm build + typecheck` → test `typecheck+build` → start `pnpm dev` (spawn keduanya) → probe **`GET /` @ :5173 → 200** (0.016s). Port di `.hermes/environment.json:5173` (bukan 8000).

**Pitfall yang sudah di-fix**:
- `src/index.ts` sempat `import.meta.url.endsWith` → crash di Workers Miniflare. Fix: pisah `index.ts` (pure export) vs `server.ts` (Node serve).
- Stale `vite`/`tsx` di port 8787/5173 bikin `EADDRINUSE` — `TASKKILL /PID … /F` sebelum restart.

## Deploy

- **Web** → Cloudflare Pages: output `apps/web/dist/`.
- **API** → Cloudflare Workers: `npx wrangler deploy` di `apps/api` (stok free tier cukup, upgrade Paid $5/bulan jika >100k req/hari).
- **Supabase Branching** → `[DATA.md](DATA.md)` + `docs/supabase-branching.md`: connect repo di Dashboard (Working directory `.`), PR → preview DB auto-migrate, merge `main` → deploy.

## Free Tier Headroom Y1

Supabase DB 500 MB (est 50–100), Auth 50k MAU, Realtime 200 concurrent; Workers 100k/hari, R2 10 GB, Queues 1M — margin 5–100× untuk 30–50 kreator, 1.5k unit, GMV Rp 320–640M.

## Open Items (Jangan Asumsi)

- CMAC pure Web Crypto vs `nodejs_compat` (Sprint 6–8).
- R2 public vs presigned.
- Supabase SG vs Jakarta region (cek saat setup).
- Domain/SSL sebelum pilot.
