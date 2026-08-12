# Supabase GitHub Branching — Setup Guide (C.Verse Platform)

This repo is **branching-ready**: once connected, every GitHub PR gets its own Supabase preview
database, migrations auto-apply, and merge to `main` can auto-deploy to production.

## One-time setup (Dashboard)

1. Supabase Dashboard → **Project Settings → Integrations → GitHub Integration**
   → **Authorize GitHub** → pick this repo.
2. **Working directory**: `.` (because `supabase/` lives at repo root — `C:/Users/iqbal/Documents/C-Verse/Platform/supabase/`).
3. Options:
   - ✅ **Automatic branching** — new GitHub branch → Supabase branch (preview DB).
   - ✅ **Supabase changes only** (recommended) — only create preview when `supabase/**` changes.
   - ✅ **Deploy to production** — push/merge to `main` auto-runs migrations + functions (enable after first stable prod).
   - Optional: enable **Supabase Preview** status check as **required** in GitHub branch protection (Settings → Branches → Require status checks → `Supabase Preview`).

No code change needed — the integration reads directly from this repo.

## Local development

```bash
# Supabase local stack (needs Docker)
npx supabase start   # API :54321, DB :54322, Studio :54323, Inbucket :54324
npx supabase status  # shows anon/service_role keys → copy to .env.local
npx supabase db reset --linked   # re-run migrations + supabase/seed.sql
npx supabase stop
```

Copy `.env.example` → `.env.local` and fill `VITE_SUPABASE_URL` / `SUPABASE_*`.

## Migrations

```bash
# Create a new migration (after changing DB via Studio or SQL)
npx supabase db diff -f add_collectible_tier
# Commit
git add supabase/migrations && git commit -m "db: add collectible tier"
```

Migrations in `supabase/migrations/` are **auto-applied** on:
- preview branch creation (PR open),
- production deploy (merge to `main`, if enabled).

## Seed

`supabase/seed.sql` is **preview-only** by design — it seeds preview branches for local/CI testing but is **never merged to production** (per Supabase branching docs). It mirrors the in-memory seed in `apps/api/src/lib/store.ts`, so behavior is identical whether DB is connected or not.

## What stays in-memory vs what moves to DB

- **Now**: API uses `apps/api/src/lib/store.ts` in-memory `Map`s with `ensureSeed()`. Works with zero config — perfect for offline dev and `hermes verify`.
- **After connect**: swap the store for Supabase client (`@supabase/supabase-js`, already in `apps/api` deps as `supabase` — see `docs/supabase-adapter.md`). The in-memory path remains as fallback when env vars are missing, so demo still works without Docker.

## Supabase config choices (this repo)

- `supabase/config.toml` → `project_id = "c-verse-platform"`, `site_url = http://127.0.0.1:5173`, Storage buckets `artwork` (public, 10 MiB) + `card-assets` (public, 20 MiB), RLS permissive (`allow all` for MVP, tighten after Auth wiring).
- Do **not** edit `project_id` locally after branching is enabled — it must match the Dashboard project.
