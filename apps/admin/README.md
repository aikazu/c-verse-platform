# C.Verse Admin — `apps/admin`

Admin adalah React/Vite SPA terpisah yang disajikan statik dari VPS dan tidak
dideploy ke Pages. Browser hanya menerima Supabase publishable/anon key;
`service-role` tetap menjadi secret Worker dan tidak boleh berada di bundle,
VPS, atau file environment admin.

## Arsitektur produksi

```text
Internet
  -> Cloudflare Access (allowlist founder)
  -> Cloudflare Tunnel
  -> cloudflared
  -> Nginx 127.0.0.1:8080
  -> apps/admin/dist
```

- URL: `https://admin.c-verse.co`.
- Cloudflare Access adalah gerbang pertama. Aplikasi disembunyikan dari App
  Launcher, cookie Access memakai `HttpOnly` dan binding cookie, serta sesi
  aplikasi dibatasi 6 jam.
- Login aplikasi memakai Supabase email OTP, lalu MFA TOTP wajib sampai sesi
  mencapai `aal2`.
- Read mengikuti RLS. Semua mutasi privileged lewat API role-gated
  `https://api.c-verse.co`; API menegakkan role admin + `aal2` dan menulis
  `admin_audit_log`.
- Nginx hanya listen di loopback. Port publik VPS hanya SSH key-only; HTTP/HTTPS
  tidak dibuka langsung.

## Menjalankan lokal

Salin `.env.example` menjadi `.env.local`, lalu isi hanya nilai publik:

```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
VITE_API_URL=http://localhost:8787
VITE_TURNSTILE_SITE_KEY=0x...

pnpm --filter @c-verse/admin dev   # 127.0.0.1:3000
pnpm --filter @c-verse/admin build # apps/admin/dist
```

## Deploy ke VPS

Build dilakukan lokal dengan `VITE_*` production, lalu isi `dist/` dikirim ke
direktori release versioned di `/var/www/cverse-admin/releases/`. Symlink
`/var/www/cverse-admin/current` diarahkan ke release baru setelah upload lolos
checksum. Nginx menyajikan `current` di `127.0.0.1:8080`; tunnel
`cverse-admin` meneruskan `admin.c-verse.co` ke origin tersebut.

VPS tidak memerlukan Node.js atau secret aplikasi. Rollback dilakukan dengan
mengembalikan symlink `current` ke release sebelumnya lalu menjalankan
`nginx -t` dan reload Nginx.
