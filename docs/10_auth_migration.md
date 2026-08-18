# 10 — Auth Migration: Supabase Auth + Turnstile

> Status: [IMPLEMENTED 2026-08-16]
> Created: 2026-08-15; updated: 2026-08-18
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
- `public.users.id` → `references auth.users(id)` (UUID), drop kolom password.
- Admin app tetap: service-role + Cloudflare Access + TOTP `aal2` (sudah ada).

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
4. Hapus "Demo Login 1-klik" untuk build prod (keep via env flag
   `VITE_ENABLE_DEMO_LOGIN` untuk demo founder).

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
1. Struktur auth di-squash ke fase migration `20260817010000_auth.sql`
   (bagian dari rantai 6 fase; `20260817000000_foundation.sql` sudah
   mendefinisikan `users.id` uuid, tanpa `password_hash` dan tanpa tabel `sessions`):
   - `users.id` → `uuid not null references auth.users(id) on delete cascade`.
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
