# Supabase adapter — how the DB layer works (C.Verse Platform)

Status: **in-memory is default**, Supabase auto-enables when env is present (branch-aware).

## Architecture

```
apps/api/src/lib/
  store.ts    — in-memory Maps + ensureSeed()  (always works, no config)
  supabase.ts — getSupabase() / isSupabaseEnabled()  (null if env missing)
```

- **No env → in-memory** (demo, `hermes verify`, offline dev). `getSupabase()` returns `null`, callers fall back to `store.ts`.
- **Env present → Supabase** (production / preview branch). `getSupabase()` returns a real client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server) or `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (web).
- Env is read lazily and cached; `_resetSupabaseCache()` invalidates it (useful for tests).

## Why this split

Supabase Branching injects per-branch URL/keys automatically. If we hard-required Supabase, every
local run would need Docker + `supabase start`. The lazy `null` fallback keeps `pnpm dev` working
everywhere while still being “auto-integrate” on the platform — just connect the repo in Dashboard
and push; no code change.

## Migrating call sites

When you’re ready to move a route from in-memory to DB, pattern:

```ts
import { getSupabase } from "../lib/supabase.js";
import { store, ensureSeed } from "../lib/store.js";

const sb = getSupabase();
if (sb) {
  const { data, error } = await sb.from("drops").select("*").eq("status","live");
  if (error) throw error;
  return c.json({ drops: data });
}
// fallback
ensureSeed();
return c.json({ drops: [...store.drops.values()].filter(d=>d.status==="live")] });
```

Top candidates to migrate first: `drops`, `cards`, `orders` (highest churn). Wallet ledger should stay append-only — wrap in a Postgres transaction / RPC when you move it.

## Env vars

See `.env.example` at repo root. Copy to `.env.local` (Node) and `apps/api/.dev.vars` (Wrangler).

```ini
# local (npx supabase start → npx supabase status gives these)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJ...
```

On Supabase Cloud, these are injected via Project Settings → API and Branch secrets — never commit them.
