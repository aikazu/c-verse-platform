# C.Verse Platform

This repository contains the active C.Card MVP. Follow the global Codex
instructions for communication, scope, Git, verification, and collaboration;
this file records only repository-specific facts and non-negotiable boundaries.

## Orientation

- Monorepo: React 19/Vite public SPA (`apps/web`), Hono API Worker
  (`apps/api`), React admin SPA (`apps/admin`), and shared schemas/constants
  (`packages/shared`). Node >=20 and `pnpm@12` are required for workspace
  dependencies and scripts. The standalone Supabase CLI uses `npx` below.
- Start with `docs/00_readme.md` and the smallest referenced documents needed
  for the task. `docs/` is the implementation planning source; code wins when
  it conflicts with a document.
- `docs/` is a byte-identical, two-way mirror of
  `C:\Users\iqbal\Documents\C-Verse\00_Dream_Project\dev-strategy/`.
  It contains 18 files: `00_readme.md` through `16_foundation_cleanup.md` plus
  `ui-glossary.md`. `AGENTS.md` is not mirrored. Check both copies before a
  docs change; run `pnpm sync:docs`, then `pnpm sync:docs:check`; commit matching
  changes in both repositories. The sync script never commits.

## Architecture and security boundaries

- Keep the database fat and API thin. Money and stock mutations are Postgres
  `SECURITY DEFINER` RPCs, invoked only through `apps/api/src/lib/db.ts` so
  each mutation remains one transaction. Routes authenticate, validate, invoke
  an RPC, and map errors; reads use selector modules.
- Preserve module facades: imports from outside an API module go only through
  that module's one-line `index.ts`. `lib/` never imports `modules/`. Check
  changes with `pnpm --filter @c-verse/api lint:boundaries`.
- Browsers receive only Supabase anon credentials. Service-role credentials and
  API secrets stay server-side. RLS is enforcement, not a UI convention; never
  log or return raw Supabase/Postgres errors.
- Public/Admin Workers access the private API through Service Bindings. Access
  and WARP are perimeter controls only: privileged routes must still enforce a
  valid session, `admin` role, and suspension server-side. Admin remains
  passwordless email OTP; do not add mandatory app MFA/TOTP or weaken factors.
- Keep confirmed domain rules intact: C-Coin values are integer >=1, price and
  rate constants come from `@c-verse/shared`, spend/destructive actions use the
  in-app confirmation modal, and all settlement/revenue/stock work stays in the
  established RPC flow. See `docs/03_flows.md`, `05_data_model.md`, and
  `07_constraints.md` for the full contract.
- Do not reintroduce password login, in-memory stores, auction timers,
  decimal C-Coin, or client-side privileged mutations. NFC verification stays
  server-side CMAC with forward-only counters; KYC data stays in the private
  R2 bucket.

## Local development and data

- Install with `pnpm install`. Main dev: `pnpm dev`; Admin only:
  `pnpm --filter @c-verse/admin dev`; API Node mode:
  `pnpm --filter @c-verse/api dev:node`.
- Copy the relevant `.env.example`; `.env*` and `.dev.vars` stay ignored.
  The web/admin bundle may contain anon keys only. The API fails fast without
  `SUPABASE_URL`; do not add an in-memory fallback.
- Start the integration bench with `npx supabase start`; reuse a healthy local
  stack. Use `npx supabase db reset --local` only when deliberately restoring
  local fixtures, not as routine setup for unrelated UI/docs work. Never aim
  seeds, uploads, or test mutations at production.
- Keep migration and seed SQL files at most 500 physical lines, as required
  for the consolidated baseline. Follow `supabase/README.md` for migration
  order, fixture assets, and integration-test commands.

## Verification

For code changes, run the repository gates before committing, in this order:

1. `pnpm run format`
2. `pnpm run lint:fix`
3. `pnpm run typecheck`
4. `pnpm test`
5. `pnpm run lint`
6. `pnpm run build`

Also run API boundary checks for API-module changes, `pnpm test:e2e` for
affected journeys when the local Supabase stack is available, and the relevant
`supabase/tests/` integration checks after SQL/RPC work. A migration for data
that must survive is forward-only; do not edit an applied baseline without an
explicit disposable-reset decision.

For docs-only changes, check references, current facts, and mirror consistency;
do not start services or reset data solely to validate documentation.
