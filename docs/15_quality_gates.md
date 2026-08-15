# 15 — Quality Gates: Testing, Lint, CI, DoD

> Status: [DRAFT — SPEC SIAP EKSEKUSI]
> Created: 2026-08-15
> Basis audit: folder Platform memiliki **0 file test**, `pnpm lint`
> = no-op, `.github/workflows` di-disabled. DoD `01_scope.md`
> mensyaratkan coverage >70% — tidak ada mekanisme mengukurnya.
> Estimasi: 2-3 hari setup awal, lalu disiplin per-PR.
> Berlaku sepanjang sprint (bukan sprint terpisah).

## 1. Prinsip

1. **Uang & stok tidak boleh regress** — test menarget area berisiko
   (wallet math, checkout race, bid release, fee split, RLS), bukan
   mengejar angka coverage di UI.
2. AI menulis code = AI menulis test di PR yang sama. DoD tanpa test
   = PR ditolak.
3. Tools sesuai preferensi founder: **Biome** (lint + format, satu
   alat) + **Vitest** (unit/integration). Tidak tambah tool lain.

## 2. Setup Teknis (sekali)

```
root:
  vitest.workspace.ts        # packages/shared, apps/api
  biome.json                 # lint rules recommended + format
apps/api:    vitest config (environment: edge-runtime optional —
             fallback node untuk unit lib; integration pakai koneksi
             supabase lokal)
packages/shared: vitest config murni
.github/workflows/ci.yml     # re-enable: PR + main
.github/workflows/deploy.yml # sesuai 08_deployment.md
package.json scripts:
  "test": "vitest run"
  "test:watch": "vitest"
  "lint": "biome check ."
  "format": "biome format --write ."
```

CI job (PR): `pnpm install -> typecheck -> lint (0 warning) ->
test -> build`. Deploy job hanya `main` (lihat `08_deployment.md`).

## 3. Matriks Test Wajib

### 3,1 Unit — `packages/shared` (prioritas tertinggi, murni fungsi)
| Target | Kasus |
|---|---|
| `idrToCCoin` | ceiling benar (Rp 15.000 → 2 C), input negatif → NaN/guard |
| `ccoinToIdr` | 30 C → 300.000 |
| `calcSignedCount` | 15 → 2 (ceil(15/10)), 10 → 1, 100 → 10 |
| `calcLevel` | xp 0 → level 1; 9 → 1; 10 → 2; 999 → 100 (clamp) |
| `isCcoinInteger` | 1.5 → false; 0 → false; 1 → true |
| fee split | 100 C sale → 7,5 / 7,5 / 85 (integer rounding!) |

### 3,2 Unit — `apps/api/src/lib`
| Target | Kasus |
|---|---|
| `cmac.ts` (spec 12) | RFC 4493 vectors + NXP AN12196 sample + 1-byte-flip invalid |
| `auth.ts` middleware | JWT expired/tampered/aud salah → 401 |
| `payments/midtrans.ts` (spec 14) | signature builder, status map, idempotency replay |

### 3,3 Integration — RPC Postgres (supabase lokal `npx supabase start`)
| Target | Kasus |
|---|---|
| `drop_entry()` | window tertutup/drawn → ENTRY_CLOSED; entry kedua user sama → ENTRY_EXISTS; saldo kurang → INSUFFICIENT |
| `draw_drop()` | 2x concurrent → idempotent (1 alokasi); 50 entry di 10 unit → 1 won_premium + 9 won_regular; ledger seimbang (SUM release+pembayaran = SUM hold); pool "both" won_regular → release selisih |
| `checkout()` | race 50-concurrent 1 unit → 1 sukses (fase FCFS, post-draw); limit 1/drop/user; saldo kurang → INSUFFICIENT |
| `wallet_debit/credit` | concurrency hingga 0 tanpa negatif; idempotency ON CONFLICT |
| `place_bid()` | outbid release otomatis; cancel release; accept transfer + fee split + ownership_history |
| RLS T1-T10 | script `supabase/tests/rls_test.sql` dari spec 11 |

### 3,4 Smoke manual (checklist per rilis — bukan automation)
1. Register Google OTP + captcha → masuk.
2. Top-up sandbox 30 C → saldo naik.
3. Raffle entry (pilih pool, hold) → draw manual → winner order
   vault + loser hold balik → FCFS sisa unit terbeli.
4. Pasang buyout → beli dari akun kedua → split 7,5/7,5/85.
5. Bid → outbid → C-Coin balik.
6. Tap NFC sample (Android Chrome) → Verified Card.
7. QR dus → Registered.
8. Ship-from-vault → ongkir tercatat.
9. Admin login 2FA → buat drop → provisioning 1 tag.
10. `/investor` menampilkan GMV sesuai transaksi di atas.

## 4. Coverage & Lint Targets

| Area | Target |
|---|---|
| `packages/shared` | ≥ 90% lines (murni fungsi, murah) |
| `apps/api/src/lib` (cmac, auth, payments) | ≥ 80% |
| `apps/api/src/routes` | happy path + error utama per route (angka bebas, review manual) |
| Web/admin UI | tanpa unit test Y1 (smoke manual cukup) |
| Biome lint | 0 error 0 warning di CI (hard gate) |

## 5. Definition of Done per PR (checklist reviewer)

- [ ] Typecheck 4 workspace lulus.
- [ ] Biome 0 warning.
- [ ] Test baru untuk logic yang diubah (merah → hijau).
- [ ] Tidak ada angka C-Coin/fee hardcode (pakai shared).
- [ ] Migration (jika ada) idempotent + backward compatible
      (add nullable dulu, drop nanti).
- [ ] RLS: tabel baru/berubah punya policy (bukan allow-all).
- [ ] Tidak ada secret di kode/diff.
- [ ] Checklist `07_constraints.md` §6 (keputusan FINAL) tidak dilanggar.

## 6. Jangan Dilakukan

- Jangan mengejar coverage 100% di UI (mubazir).
- Jangan skip test dengan `it.skip`/`describe.skip` tanpa issue ID.
- Jangan matikan lint rule karena "mengganggu" — fix atau dokumentasikan
  exception per-baris.
- Jangan commit snapshot test yang auto-update massal (`-u` hanya saat
  perubahan disengaja).

## 7. Acceptance Criteria

- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` semua
      hijau di CI pada PR pertama setelah spec ini diterapkan.
- [ ] Matriks 3,1-3,3 terpenuhi minimal 90% item.
- [ ] CI block merge saat lint warning / test merah.
- [ ] Smoke checklist 3,4 dijalankan + dicatat sebelum tiap deploy
      ke preview environment.

## 8. Sumber

- Global founder preference: TDD red-green-refactor; formatter+lint+
  test wajib sebelum commit.
- `dev-strategy/01_scope.md` DoD (coverage >70%, review 2 reviewer).
- `dev-strategy/08_deployment.md` CI/CD pipeline.
- Audit Platform 2026-08-15: 0 test file, lint no-op, workflows
  disabled.
