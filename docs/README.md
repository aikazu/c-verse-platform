# C.Verse Platform — Docs

> **Tujuan**: workspace `Platform` bisa jalan **tanpa buka `00_Dream_Project`**. Semua angka, flow, arsitektur, dan data model yang perlu untuk ngoding MVP ada di folder `docs/` ini. `00_Dream_Project` tetap jadi arsip pondasi/brainstorm — bukan yang dibaca harian.

## Baca Berurutan

| # | Dok | Isi | Kapan dibaca |
|---|-----|-----|--------------|
| 1 | [PRODUCT.md](PRODUCT.md) | Visi, pilar, form factor, personas & journey, revenue model | Sebelum sentuh fitur apa pun |
| 2 | [FLOWS.md](FLOWS.md) | **9 Flow MVP end-to-end** — primary drop, fulfillment, settlement, NFC tap, QR fallback, ownership, auction P2P, onboarding/KYC/gamifikasi, C-Coin top-up/payout | Saat implement route/page tertentu, buka flow terkait |
| 3 | [ARCHITECTURE.md](ARCHITECTURE.md) | Full-edge stack, monorepo, deploy, Realtime/Queues, 3D viewer, env & secrets | Saat setup infra / debug build |
| 4 | [DATA.md](DATA.md) | Skema DB, ledger C-Coin, Supabase Branching (GitHub integration), adapter in-memory ↔ Postgres | Saat migrasi / tambah tabel / seed |
| 5 | [NUMBERS.md](NUMBERS.md) | **Single source angka lock** — rate C-Coin, AOV, COGS, fee, threshold, capacity | Sebelum hardcode angka apa pun |
| — | [supabase-branching.md](supabase-branching.md) | Langkah connect repo ke Supabase (Working directory `.`) | Sekali, saat enable branching |
| — | [supabase-adapter.md](supabase-adapter.md) | Pola migrasi `store.ts` → `supabase-js` per route | Saat pindah dari in-memory ke DB |

## Peta Cepat: Ide → Kode

```
00_Dream_Project (arsip pondasi)
        ↓ diringkas
Platform/docs/*  ← kamu di sini (compact, code-oriented)
        ↓ diimplementasi
apps/web  (React/Vite SPA → Cloudflare Pages)
apps/api  (Hono → Cloudflare Workers / Node tsx)
packages/shared (Zod schemas + constants)
supabase/migrations + seed.sql (branching auto-apply)
```

## Quick Start (tanpa Supabase)

```bash
pnpm install
pnpm dev              # node scripts-dev.mjs → :8787 API + :5173 web (proxy /api)
# demo: demo@cverse.id / demo123  → tombol "Demo Login" di /login
```

## Quick Start (dengan Supabase)

```bash
npx supabase start    # :54321 API, :54322 DB, :54323 Studio
# copy .env.example → .env.local  (isi VITE_SUPABASE_* / SUPABASE_*)
npx supabase db reset # re-run migrations + seed.sql
pnpm dev
```

## Konvensi

- Bahasa Indonesia untuk narasi, English untuk proper nouns (NFC, SKU, RLS, JWT, dsb).
- Angka lock ada di [NUMBERS.md](NUMBERS.md) — jangan hardcode di tempat lain.
- Status `[BLOCKED]` = butuh input lawyer (escrow & e-money) — jangan lock desain sampai clear.
- Flow di [FLOWS.md](FLOWS.md) mapping ke `F001–F036` di `20_product/03_features_mvp.md` (arsip).

## Jika Ragu

Buka [FLOWS.md](FLOWS.md) dulu (1 file = semua perilaku sistem), lalu [DATA.md](DATA.md) untuk bentuk datanya, terakhir [ARCHITECTURE.md](ARCHITECTURE.md) untuk cara jalaninnya.
