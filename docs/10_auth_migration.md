# 10 — Auth Migration: Supabase Auth + Turnstile

> Status: [IMPLEMENTED 2026-08-16]
> Created: 2026-08-15; updated: 2026-08-20
> Basis audit awal: `apps/api/src/routes/auth.ts` (password plaintext, token
> in-memory). Migration selesai: route auth.ts sudah clean (hanya `/me`),
> JWT verify via `jose` + JWKS, tidak ada password/in-memory session.
> Admin app MFA TOTP (aal2) via `TotpRequired.tsx`.
> Estimasi: 3-5 hari AI-assisted. Dependency: tidak ada (mulai duluan).
> Blok: `11_rls_policy.md`, `13_atomic_checkout_rpc.md` menunggu ini.

## 1. Masalah

Auth saat ini custom in-memory — tidak bisa dibawa ke produksi:

| Isu | Bukti | Risiko |
|---|---|---|
| Password plaintext | `auth.ts` register: `passwordHash: password`; login bandingkan string langsung | Kredensial bocor total |
| Token in-memory | `store.sessions` Map; restart server = semua logout | Tidak survive deploy |
| Tidak ada OAuth/OTP | tidak ada Google, tidak ada email OTP | Melanggar FINAL 2026-08-13: auth = Google OAuth + email OTP wajib |
| Tidak ada captcha | grep `turnstile` = 0 hasil | Melanggar FINAL: captcha anti-spam wajib |
| `users.id` bukan `auth.users.id` | seed `u_demo` dsb. | Tidak bisa pakai `auth.uid()` di RLS |

## 2. Target (FINAL — jangan deviate)

- Supabase Auth: **Google OAuth + email OTP (6 digit, magic link OFF)**.
- **Captcha Turnstile wajib** untuk register + email OTP request.
- API Hono verifikasi **Supabase JWT** (JWKS), ambil `sub` sebagai user id.
- `public.users.id` = UUID sama dengan `auth.users.id` (di-isi trigger `on_auth_user_created`, bukan FK constraint eksplisit); tidak ada kolom password.
- Admin app tetap: service-role + Cloudflare Access + TOTP `aal2` (sudah ada).
- **PASSWORDLESS (FINAL 2026-08-20)**: platform TANPA password sama
  sekali untuk SEMUA user (kolektor & kreator) — autentikasi hanya
  Google OAuth ATAU email OTP. Tidak ada register berbasis password
  di jalur manapun; OTP tetap wajib captcha Turnstile.
- **Akun kreator ADMIN-PROVISIONED (FINAL 2026-08-20)**: kreator
  TIDAK self-register. Admin app (service-role) create auth user
  (tanpa password, `email_confirm: true`) → set
  `profiles.role = 'creator'` → isi `creators.user_id` → kirim email
  akses via SumoPod SMTP. Ini menutup gap G1/G2 (`creators.user_id`
  nullable tanpa flow pengisian).

## 3. Langkah Eksekusi

### 3,1 Supabase Dashboard (config, bukan code)
1. Auth → Providers: enable **Google** (OAuth client ID/secret dari Google
   Cloud Console; redirect `https://c-verse.co/auth/callback` + localhost).
2. Auth → Email: enable **email provider**, OTP expiry 1 jam, magic link OFF.
3. Auth → Captcha: pilih **Turnstile**, isi site key + secret key
   (Cloudflare Dashboard → Turnstile → widget `cverse-login`).
4. Email SMTP: arahkan ke **SumoPod SMTP** (`smtp.sumopod.com:465`, SSL,
   username/password dari env) supaya OTP bukan dari sender default Supabase.

### 3,2 Web (`apps/web`)
1. Install `@supabase/supabase-js`. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
   (anon only — service-role DILARANG di web bundle).
2. `src/lib/supabase.ts`: `createClient(url, anonKey, { auth: { persistSession: true } })`.
3. Halaman `/login` rewrite:
   - Tombol "Lanjutkan dengan Google" → `supabase.auth.signInWithOAuth({ provider: 'google' })`.
   - Form email → `supabase.auth.signInWithOtp({ email, options: { captchaToken } })`
     → layar input 6 digit → `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
   - Widget Turnstile render dulu; token disertakan tiap request OTP.
4. "Demo Login 1-klik" DIHAPUS total dari web (tidak ada env flag
   tersisa) — login hanya Google OAuth + email OTP.

### 3,3 API (`apps/api`)
1. Middleware auth baru `src/lib/auth.ts` (paket `jose`, jalan di Workers):
   ```
   verifySupabaseJwt(token):
     - JWKS dari `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cache in-memory)
     - verify: iss = SUPABASE_URL, aud = 'authenticated'
     - return { sub }  // = users.id
   ```
2. `requireUser(c)`: ambil `Authorization: Bearer`, verify, load
   `users` row by id. 401 jika invalid.
3. Hapus: `makeToken`, `authHeaderToToken`, `store.sessions`, seluruh
   `/register` `/login` `/demo-login` `/logout` lama.
4. Ganti semua `getUserByToken(...)` di 15 route → `requireUser(c)`.

### 3,4 Database
1. Struktur auth disatukan di migration `02_auth.sql` (sebelumnya
   `20260817010000_auth.sql`). Sebelum konsolidasi (2026-08-24): bagian
   dari rantai 7 fase (6 fase inti `1/6`..`6/6` + hardening
   `20260817060000` phase 7/7); phase 1 `foundation`
   (timestamp `20260817000000`) sudah
   mendefinisikan `users.id` uuid, tanpa `password_hash` dan tanpa tabel `sessions`):
   - `users.id` = `uuid primary key` — di-isi trigger dari `auth.users.id`;
     TANPA FK constraint eksplisit `references auth.users(id)` (delete cascade
     tidak diterapkan di schema).
   - Username default manusiawi + flag `username_is_auto`: `generate_default_username()`
     (prefix-email + 4 digit acak, anti-duplikat).
   - Dedup akun per email kanonik: `canonical_email()` + unique index
     `users_canonical_email_uidx` (buang titik & `+tag` di gmail/googlemail).
   - Insert row `users` otomatis saat signup: **trigger** `on_auth_user_created`
     (`auth.users insert → insert public.users (id, email, display_name, username, ...)`).
2. Migrasi akun demo/seed: service-role `authAdmin.createUser({ email, password })`
   per akun seed → update `users.id` ke UUID baru. Seed `karina@creator.id`
   dan demo jadi akun nyata (password disimpan di `.env` lokal saja).

### 3,5 Rate limit auth (anti abuse OTP)
- Workers: max **5 OTP request / email / 10 menit** + max **20 / IP / jam**
  (pakai Cloudflare Rate Limiting binding, fallback KV counter).
- Salah OTP 5x → lock 15 menit (tabel `auth_retry_lock` atau claim di users).

### 3,6 Provisioning akun kreator (admin-provisioned, FINAL 2026-08-20)
- **STATUS: TERIMPLEMENTASI (2026-08-21)** — endpoint nyata
  `POST /api/admin/users/provision` (gate admin + MFA aal2, service-role,
  ter-audit) menggantikan rencana awal RPC `admin_provision_creator`:
  1. Cek duplikat email (409 "Email sudah terdaftar").
  2. `auth.admin.createUser({ email, email_confirm: true, user_metadata:
     { full_name, role: 'creator' } })` — TANPA password; trigger DB
     otomatis membuat baris `public.users` (role default 'user').
  3. Update `public.users` → `role='creator'`, `display_name`.
  4. Insert baris `creators` (handle unique; `status='active'`,
     `total_followers_combined` default 0). Handle bentrok → 409
     "Handle sudah dipakai" + rollback best-effort hapus auth user
     (tidak ada akun yatim).
  5. Kirim email akses via modul email ber-flag: `EMAIL_ENABLED` default
     **OFF di dev** (kirim dilewati, respons `emailSent:false`); saat
     `true`, kirim via SumoPod SMTP (configurable `SMTP_HOST`/`SMTP_PORT`/
     `SMTP_USER`/`SMTP_PASS`).
  6. Audit log `admin_audit_log` (action `create`, payload berisi
     `provision:true` + handle + status email).
  Admin app menampilkan form "Buat akun kreator" yang memanggil endpoint
  ini. Kreator login OTP email / Google OAuth — email harus sama dengan
  yang di-set admin. Pencatatan `admin_audit_log` wajib (aksi
  account-provisioning).

### 3,6,1 Prod email checklist (2026-08-23)
- Set `EMAIL_ENABLED=true` + `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
  `SMTP_PASS` di API env (sama dengan dev). Modul `apps/api/src/lib/email.ts`
  memuat `nodemailer` via dynamic import — runtime **Node only**.
- Di Cloudflare Workers (prod) `nodemailer` tidak tersedia → email
  akan error eksplisit. Opsi MVP: pindahkan dispatch ke deployment
  Node (worker cron/queue) atau pakai email HTTP API eksternal
  post-MVP. Sampai itu jalan, kreator yang di-provision admin
  cukup menerima info akses dari UI admin ("akun sudah dibuat —
  login via OTP/Google dengan email berikut") tanpa email keluar.
- Tidak ada fallback silent; flag OFF atau transport gagal = audit
  log tetap merekam `emailSent:false`.

## 4. Jangan Dilakukan

- Jangan simpan JWT di localStorage (pakai persistSession supabase — httpOnly
  cookie via @supabase/ssr saat domain live).
- Jangan bypass Turnstile "sementara" di staging publik.
- Jangan buat endpoint register custom dengan password lagi.

## 5. Acceptance Criteria

- [ ] Login Google + email OTP 6 digit jalan end-to-end di web.
- [ ] OTP tanpa Turnstile token → ditolak Supabase (400).
- [ ] Semua route API 401 tanpa JWT valid; 403 JWT valid tapi user di-suspend.
- [ ] Restart API = session user tetap (JWT stateless).
- [ ] `public.users.id` 100% UUID = `auth.users.id`; kolom password hilang.
- [ ] Unit test (vitest): middleware JWKS — token expired/tampered → 401.

## 6. Sumber

- `dev-strategy/06_tech_decisions.md` D-so (Supabase Auth FINAL).
- Memory `mvp-product-rules-2026-08-13`: Google OAuth + email OTP + captcha Turnstile.
- `dev-strategy/08_deployment.md` §Supabase setup (Auth Google+OTP+captcha).
- Audit Platform 2026-08-15: `apps/api/src/routes/auth.ts` (plaintext,
  in-memory session).
- Keputusan akun kreator admin-provisioned + passwordless
  (2026-08-20, [VALIDATED]) — dasar section 3,6.
- Keputusan Creator Seed C.Card (2026-08-20, [VALIDATED]) — seed
  card 1-of-1 memerlukan akun kreator aktif (Flow 11 provision
  sebelum listing).
