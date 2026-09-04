# C.Verse Admin — `apps/admin`

Admin adalah React/Vite SPA terpisah yang disajikan oleh Cloudflare Worker
`c-verse-admin`. Browser hanya menerima Supabase publishable/anon key;
`service-role` tetap menjadi secret Worker API dan tidak boleh berada di bundle
atau file environment admin.

## Arsitektur produksi

```text
Founder dengan WARP aktif
  -> Cloudflare Access (allowlist founder + device posture WARP)
  -> c-verse-admin (Worker + Static Assets)
  -> /api/* melalui Service Binding
  -> c-verse-api (Worker privat)
```

- URL: `https://admin.c-verse.co`.
- Cloudflare Access adalah gerbang pertama. Aplikasi disembunyikan dari App
  Launcher, cookie Access memakai `HttpOnly` dan binding cookie, serta sesi
  dibatasi 6 jam.
- Policy mewajibkan identitas founder dan device yang terhubung melalui WARP.
  Request dari internet tanpa posture WARP ditolak sebelum mencapai Worker.
- Login aplikasi memakai Supabase email OTP. MFA/TOTP aplikasi tidak diwajibkan.
  Keputusan ini tidak menonaktifkan MFA secara global atau menghapus faktor yang
  sudah terdaftar pada pengguna.
- Read mengikuti RLS. Semua mutasi privileged memakai route same-origin
  `/api/admin/*`; gateway meneruskannya ke `c-verse-api` melalui Service
  Binding. API menegakkan role admin dan status akun tidak disuspend, lalu menulis
  `admin_audit_log`.
- `c-verse-api` tidak mempunyai custom domain, `workers.dev`, atau preview URL.
  Gateway menghapus cookie dan assertion Access sebelum meneruskan request agar
  credential perimeter tidak bocor ke backend aplikasi.

## Menjalankan lokal

Salin `.env.example` menjadi `.env.local`, lalu isi hanya nilai publik:

```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
VITE_API_URL=http://localhost:8787
VITE_TURNSTILE_SITE_KEY=0x...

pnpm --filter @c-verse/admin dev       # 127.0.0.1:3000
pnpm --filter @c-verse/admin dev:edge  # build + gateway Worker lokal
```

`VITE_API_URL` hanya override untuk development lokal. Build yang dideploy
memakai `/api` same-origin.

## Deploy ke Cloudflare Workers

```bash
pnpm --filter @c-verse/admin cf-typegen
pnpm --filter @c-verse/admin run deploy
```

Konfigurasi ada di `wrangler.jsonc`: Static Assets, custom domain
`admin.c-verse.co`, binding `API` ke `c-verse-api`, observability, serta
`workers_dev=false` dan `preview_urls=false`. Deploy manual harus dilakukan
setelah quality gates monorepo hijau. Rollback memakai versi Worker sebelumnya
di Cloudflare; tidak ada lagi origin VPS atau Cloudflare Tunnel.
