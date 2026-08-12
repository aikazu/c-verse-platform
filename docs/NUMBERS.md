# C.Verse — Numbers (Single Source — Lock)

> **Sumber lock**: `00_foundation/05_assumptions.md` (A015–A021) + `90_research/*` keputusan user 2026-08-11. Semua angka diasumsikan, kecuali yang ditandai **KEPUTUSAN USER** (bukan hipotesis). Konsisten dengan `packages/shared`.

## C-Coin (KEPUTUSAN USER 2026-08-11 — revisi Opsi A)

| Parameter | Nilai |
|-----------|-------|
| Rate | **1 C-Coin = Rp 10.000** (top-up) |
| Medium | **Tunggal** semua transaksi (primary + secondary) — TIDAK ADA IDR langsung |
| Buyer saldo | **Closed-loop TANPA withdraw** (belanja-only) |
| Seller/kreator hasil | **Auto-disburse IDR**, kena **payout fee 1% fixed** dari nominal IDR |
| Seller opsi | Boleh tahan hasil sebagai C-Coin (tanpa fee) |
| Gateway | Midtrans (primary) + Xendit (backup) — **hanya** top-up & disbursement |
| Ledger | `wallet_transactions` immutable (`balance_after_ccoin`), top-up webhook idempoten |
| Status hukum | **[BLOCKED]** — butuh lawyer fintech sebelum terima top-up real (e-money/payment threshold) |

## Harga & Kartu

| Parameter | Nilai | Sumber |
|-----------|-------|--------|
| AOV unsigned | **Rp 300k = 30 C** | A019 |
| AOV signed | **Rp 500k = 50 C** | A019 |
| Signed per drop | **1 per 10** (`ceil(total/10)`) | keputusan |
| Contoh 15 | 1 signed + 14 unsigned | — |
| COGS kartu unsigned (total) | **Rp 104k** (signed Rp 120k = +Rp16k insert) — sudah dus/QC/shipping/payment fee | unit economics |
| COGS production average (acrylic+print+NFC) panduan kasar | Rp 50–80k | form-factor |
| 3PL | **Rp 15k terpisah** (variable cost) | — |
| NTAG 424 DNA TagTamper | Rp 5–7k/satuan (target 1k–10k vol; Y2+ 100k → Rp3,5–5k) | N2 |
| Dus premium + QR fallback | termasuk COGS total di atas | Flow 2 |

Harga harus **bulat C-Coin** agar tanpa pembulatan konversi (Rp300k→30 C, Rp500k→50 C).

## Revenue Share (Lock)

| Alur | Split |
|------|-------|
| Primary platform-produced | **70% platform / 30% kreator** |
| Primary kreator-produced | 30% platform / 70% kreator |
| Secondary (fee 15%) | **7,5% platform + 7,5% royalti LIFETIME kreator + 85% owner** |

Contoh: primary Rp300k → kreator Rp90k; resale Rp1jt → platform Rp75k + royalti Rp75k + seller Rp850k. Lifetime eskalasi 5× (300k→600k→900k→1,2jt→1,5jt) = **Rp 405k** inc primary.

## Wallet & Settlement

| Parameter | Nilai |
|-----------|-------|
| Payout siklus | **Selasa** (kreator); seller secondary — otomatis saat settlement (SLA [DRAFT]) |
| Withholding | PPh 23 atas nilai IDR + bukti potong; PPN 11% collection |
| Escrow C-Coin | **[BLOCKED]** — desain hold belum di-lock (gap G9) |
| Cap saldo buyer | **[DRAFT]** usulan Rp5–10M |
| Min payout | **[DRAFT]** |
| Rekening tujuan KYC | **[DRAFT]** |

## Lelang P2P

| Rule | Nilai |
|------|-------|
| Tipe MVP | Fixed + English + reserve (hidden) |
| Max listing/user | 20 active |
| Max 1 kartu 1 listing, durasi 1–14 hari | |
| Min increment | **5%** dari current bid **ATAU Rp25k** (mana lebih tinggi) |
| Anti-sniping | bid di **5m terakhir → +5m** (max 3×) |
| State | draft → listed/bidding → awaiting_settlement → settled (+ expired/cancelled/failed) |
| Deposit (>Rp5jt) | 5% via C-Coin hold — **[DRAFT] G11**, jangan anggap ada |
| KYC gate | listing/bid **>100 C (~Rp1jt) wajib KYC**; transaksi >Rp5jt KYC+tracking+deposit |
| Purchase limit | primary **2**/user/drop, secondary **10**/user |
| Bid retraction | 1 jam + 1 strike; 3 strike → suspend 30d |

## NFC / 3D

| Parameter | Nilai |
|-----------|-------|
| Chip MVP | **NXP NTAG 424 DNA TagTamper** (AES-128 SUN CMAC + tamper loop irreversibel, NDEF 256 B, Type 4, ~10 cm) |
| Embedding | stiker belakang kartu (cover acrylic), provisioning **1× read-only** |
| Web NFC | **Chrome Android 89+ ONLY**; iOS/Firefox/desktop ❌ → fallback QR `short_id` (printed di dus) |
| Badge | ✅ Kartu terverifikasi (CMAC) · ⚠️ Tamper detected · ❓ Registered (QR, weaker) |
| 3D viewer | **three.js + OrbitControls + UnrealBloomPass**, `card.obj` MVP (`.glb` Y2+), drag rotate, bloom, idle auto-rotate, lazy load, fallback 2D |

## Other Thresholds

| Parameter | Nilai |
|-----------|-------|
| Kreator min followers | **10k** (off-platform GTM) |
| Target kreator Y1 | 30–50 aktif; pipeline 50 setelah 3 bulan |
| Drop cadence | 10–15 kartu/kreator, 1–2 drop/minggu |
| QC defect target | <2% |
| Tim | 1–2 dev + AI-assisted |
| Brainstorm → build | asumsi 5 bln blok 1–2 (52–54 PW) — gap G7 timeline belum lock |

## Kapasitas Y1 (Free Tier Headroom)

GMV **Rp320–640M** (100–200 drop, 1k–2k unit, 50 kreator ×2–4 release×10 unit); sold-out 70% → -30%. Supabase DB 500 MB (50–100), Auth 50k MAU (1–5k), Realtime 200 (10–50), Workers 100k/hari (10–50k), R2 10 GB (1–2), margin 5–100×.
