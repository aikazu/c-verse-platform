# C.Verse Admin — `apps/admin` (app terpisah, TIDAK di Pages publik)

Per `docs/06-tech-decisions.md` D1 + `docs/08-deployment.md` section 3.5: admin dashboard = **app terpisah** (bukan di edge), akses langsung ke Supabase via `service-role` (tidak pernah di-bundle publik). Tidak ada route admin di API publik.

## Arsitektur

- Stack: React 19 + Vite SPA (`apps/admin`) — dijalankan **lokal** (mesin founder) atau VPS kecil + **Cloudflare Tunnel + Access** (Zero Trust).
- URL prod: `admin.c-verse.co` (via `cloudflared tunnel` → `http://localhost:3000`, policy Access: *Allow founders* email list).
- Auth: Supabase Auth (Google OAuth + email OTP) + **MFA TOTP wajib** (Supabase MFA: `aal1` → challenge → `aal2`; UI privileged terkunci sampai `aal2`).
- Audit: `admin_audit_log` append-only (siapa, aksi, target, payload ringkas, IP/session, waktu; RLS: no public, retensi ≥1 tahun).

## Menjalankan lokal

```bash
# env (apps/admin/.env.local)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

pnpm --filter @c-verse/admin dev   # :3000
pnpm --filter @c-verse/admin build # → apps/admin/dist
```

## Cloudflare Tunnel + Access (VPS)

1. `cloudflared tunnel create cverse-admin` → route `admin.c-verse.co` → `http://localhost:3000`
2. Cloudflare Access policy: *Allow* founder emails di depan `admin.c-verse.co`
3. Env admin di VPS: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (HANYA di admin — tidak di `apps/web`), `ADMIN_ALLOWED_EMAILS`

## 2FA (ADM-09) & Audit (ADM-08)

- **2FA:** lihat `src/App.tsx` — enroll QR + `mfa.challenge()` + `mfa.verify()` → sesi `aal2`. Catatan D1: admin via `service-role` (bypass RLS), jadi penegakan `aal2` di **app (guard route/UI)** + Cloudflare Access di jaringan.
- **Audit log:** hook terpusat di admin app — semua mutasi lewat satu service function → `INSERT admin_audit_log` otomatis; view + filter di `/audit`.

## Deploy

Admin TIDAK di-`wrangler pages deploy`. Build serve statik di belakang tunnel. Jangan pernah expose service-role key ke `apps/web` bundle.
