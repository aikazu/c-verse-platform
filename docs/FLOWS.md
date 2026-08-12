# C.Verse — 9 Flow MVP End-to-End (Single File)

> **Sumber**: `40_operations/05_mvp_flow.md` (717 baris) diringkas. Angka lock → [NUMBERS.md](NUMBERS.md). Arsitektur → [ARCHITECTURE.md](ARCHITECTURE.md). Data shape → [DATA.md](DATA.md).

---

## Flow 1 — Primary Sale Drop (Siapa Cepat Dia Dapat)

```
Kreator submit (artwork, narasi, totalUnits, harga C-Coin, dropAt ≥ H+14)
  → Review 1–2 hari → Rejected/Approved
  → Produksi 5–7d sample + 10–14d full
  → NFC provisioning + QC (Flow 2)
  → Listing publish H-7 + countdown (notif H-3/H-1/H-1jam)
  → Drop LIVE: checkout race, max 2 kartu/user, counter Realtime
  → Payment: potong saldo C-Coin (medium tunggal; KEPUTUSAN 2026-08-11)
    saldo kurang → tolak + arahkan top-up (Flow 9)
  → Sold out atau timer habis → fulfillment (Flow 2 & 3)
```

- **Signed**: `ceil(total/10)` (1 per 10). 15 → 1 signed + 14 unsigned.
- **Harga (lock)**: unsigned **30 C** (Rp 300k), signed **50 C** (Rp 500k) — bulat agar tanpa pembulatan.
- **Stok atomik**: decrement di Postgres (Workers), counter broadcast via Supabase Realtime (<50 concurrent cukup; 10k perlu assess).
- **Masuk kode**: `POST /api/orders/checkout` (limit 2, cek saldo C-Coin, allocate cards, `WalletTx type=checkout`).

---

## Flow 2 — Fulfillment (NFC Provisioning → QC → Packing → 3PL)

```
Produksi selesai
  → Provisioning 1× per tag: assign UUID↔UID, AppMasterKey, NDEF URL + SDM (UID+ctr+CMAC+Tamper)
  → Embed stiker belakang kartu (cover acrylic)
  → QC: tap test + defect fisik (target <2%)
  → Packing: dus premium + QR printed (short_id, fallback iOS)
  → Handover 3PL (Biteship/RajaOngkir, max 3 hari)
  → Tracking → delivery confirm (manual/auto)
```

- Provisioning **1× read-only** (SUN/SDM, N5), bukan write per kartu.
- COGS unsigned **Rp 104k** / signed **Rp 120k**; 3PL **Rp 15k terpisah**; tanpa payment fee per sale sejak C-Coin.
- Chip **Rp 5–7k**, lead time ~2 minggu, buffer 20%.

---

## Flow 3 — Payment & Settlement Primary

```
Checkout (Flow 1): potong C-Coin buyer (WalletTx checkout)
  → Hold escrow C-Coin  [BLOCKED — butuh lawyer, JANGAN lock desain]
  → Auto-release setelah delivery confirm
  → Split revenue share (C-Coin):
      platform-produced 70/30 · kreator-produced 30/70
  → Payout batch Selasa: C-Coin → IDR (kurs Rp10k/C, via disbursement)
  → Withholding: PPh 23 atas nilai IDR + bukti potong; PPN 11% atas penjualan
```

- Payment data tidak disimpan (tokenization Midtrans saat top-up, PCI-DSS via gateway).
- Debit atomik (row-lock), webhook top-up idempoten, recon harian via Cron.

---

## Flow 4 — NFC Tap & Verifikasi (Chrome Android 89+ ONLY)

```
Tap HP → Web NFC baca NDEF SUN (?uid=…&ctr=…&c=…)
  → GET Workers → lookup kartu by short_id/uid
  → Derive CMAC (AppKey diversified by UID + ctr, AES-128 via Web Crypto, key di KMS)
  → Compare + ctr > last_ctr (anti-replay)
  → Parse TagTamper
  → Return sertifikat + badge:
      ✅ "Kartu terverifikasi"  (match & utuh)
      ⚠️ "Tamper detected"      (once-opened)
      + 3D viewer (three.js) + ownership popup
```

- Web NFC **Chrome Android 89+ ONLY** (iOS/Firefox/desktop ❌ — research 2026-08-03).
- PII tidak di tag (hanya UID/ctr/CMAC).

---

## Flow 5 — Fallback QR/Serial (iOS & non-Chrome)

```
Scan QR di dus (short_id) ATAU input short_id manual
  → Lookup by short_id (DB match, TANPA CMAC)
  → 3D viewer + ownership popup, badge = ❓ "Registered" (weaker)
```

- Public verify tanpa login boleh (detail penuh butuh login — UU PDP minimization).
- 3D viewer tetap jalan (WebGL universal di iOS).

---

## Flow 6 — Ownership Transfer

> Koreksi gap G3: **tidak ada NFC re-write**. SUN/SDM read-only. Transfer = record di DB.

```
(A) Activation (primary buyer): Barang datang → "Activate" → tap (Flow 4) → bind current_owner_id → "Owned" di profil
(B) Secondary: settlement (Flow 7) + delivery confirm → generate one-time token → DB update current_owner_id + OwnershipHistory → owner baru tap (Flow 4) konfirmasi
```

- 1 kartu = 1 active owner. Bind tanpa settlement valid → tolak + fraud signal (edge E2).

---

## Flow 7 — Secondary Auction P2P

```
Listing (WAJIB verify Flow 4 dulu, 1 kartu=1 listing, max 20 active/user, 1–14 hari)
  → Pilih Fixed (buy-now) ATAU English (+ reserve hidden)
  → Live → bid Realtime (increment ≥5% atau Rp25k, mana lebih tinggi), harga/bid dalam C-Coin
  → Anti-sniping: bid di 5m terakhir → +5m (max 3×)
  → Timer habis → tertinggi menang (≥ reserve)
  → Settlement: hold C-Coin escrow [BLOCKED] → seller ship ≤5 hari → confirm/7d auto-release
  → Split: 7,5% platform + 7,5% royalti LIFETIME + 85% owner → payout C→IDR (fee 1%) → ownership (Flow 6)
```

- Mediasi `×` — midtrans dialek.
- **Contoh lock**: primary Rp300k → resale Rp1jt → platform Rp75k + royalti Rp75k + seller Rp850k.
- KYC: listing/bid > Rp1jt KYC dasar; transaksi > Rp5jt KYC+tracking+deposit 5% (hold deposit via C-Coin masih **[DRAFT] G11**, jangan dianggap ada).

---

## Flow 9 — Top-Up & Payout C-Coin (Closed-Loop, Opsi A 2026-08-11)

C-Coin = **medium tunggal** semua transaksi (TIDAK ADA IDR langsung). Rate **Rp10k/C**. **Opsi A**: saldo buyer **closed-loop TANPA withdraw** (belanja-only); hasil seller/kreator **auto-disburse IDR fee 1%** (pengganti “withdraw fee”). Seller boleh tahan hasil sebagai C-Coin.

```
Top-up: pilih jumlah C-Coin (≥1, cap [DRAFT])
  → T&C "saldo tidak dapat diuangkan"
  → Pay Midtrans Snap (Xendit backup)
  → Webhook → Workers (idempoten, retry via Queues)
  → WalletTx type=topup + update balance_ccoin → notifikasi

Payout: escrow release (Flow 3/7) → hitung porsi C-Coin
  → Seller secondary: default disburse IDR ATAU tahan C-Coin (tanpa fee)
  → WalletTx settlement (+ payout kalau IDR) → fee 1% × nominal IDR → disburse ke rekening KYC via Midtrans/Xendit → notifikasi
  (kreator: siklus Selasa; seller secondary: otomatis saat settlement, SLA [DRAFT])
```

- Satu `payment_id` tidak boleh double-process; ledger immutable (`balance_after`), Cron recon harian.
- **JANGAN terima top-up real sebelum lawyer clear** (status e-money/payment — [BLOCKED], agenda di `02_legal_compliance.md` 2.2).

---

## Flow 8 — Pendukung

**Onboarding kreator** — off-platform (personal + agency), kurasi manual, threshold **10k followers**, contract (IP kreator, lisensi non-eksklusif, royalti resale). Di kode: `POST /api/drops` (creator/admin), `PATCH /drops/:id/status` (admin review).

**KYC** — >Rp1jt KYC dasar, >Rp5jt KYC+tracking+deposit 5% (manual Y1, Verihubs/Privy Y2+). Retention 5 tahun. `POST /api/kyc`, `POST /kyc/:id/approve` (admin), gate di listings/bids >100 C.

**Anti-fraud** — rate limit 5 bid/listing/jam, CAPTCHA bid pertama, shill detection (rule-based + manual Y1, ML Y2+), strike 3×=suspend 30d, tamper/tag-conflict = fraud signal.

**Notifikasi** — email abstraction layer (Resend default, custom SMTP) + FCM push: H-7/H-3/H-1/H-1jam, payment, shipping, outbid, auction ending, payout, top-up. Marketing butuh consent (UU PDP).

---

## Health / Probe

- `GET /health` → `{"ok":true}` · `GET /api/drops` (live drops) — simple probe untuk `hermes verify`.
- `hermes verify` expects vite di `:5173` + api `:8787`; dev via `node scripts-dev.mjs` (spawn `api`+`web` paralel).

## Kata Kunci untuk Cari di Kode

`ensureSeed` · `store.ts` · `WalletTx` · `balance_ccoin` · `nfc_short_id` · `verifyStatus` · `F007/F008` · `Anti-sniping` · `Opsi A`
