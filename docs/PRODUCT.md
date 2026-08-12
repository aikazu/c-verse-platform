# C.Verse — Product (Ringkas dari 00_foundation + 20_product + 30_business)

## Satu Paragraf

**C.Verse** (Creator Verse) — **C.Card** adalah MVP-nya — adalah platform yang mempertemukan **kreator Indonesia** dengan **kolektor/fans** untuk merilis **kartu kolaborasi edisi terbatas** (acrylic hardcase 63×88 mm ala graded Pokemon card + dus custom premium). Tiap kartu = **1 NFC terverifikasi** (teknologi NFC dengan proteksi anti-tamper) di belakang kartu ter-cover acrylic = **1 sertifikat digital immutable**. Primary **siapa cepat dia dapat** (fixed, time-boxed), secondary **lelang P2P bid-offer bebas**, gamifikasi **level/badge/leaderboard** mengikat ekosistem.

> MVP = kartu. Platform = **limited-edition physical collectibles** (Y1 kartu, Y2 fashion/tiket event, Y3+ art/vinyl/figure). Lihat `90_research/multi-tier-strategy.md` di arsip untuk tier expansion.

## Pilar (5)

1. **Physical-first** — bisa dipegang, dipajang, NFC cuma menambah.
2. **Verifiable scarcity** — verifikasi keaslian + sertifikat on-platform, tidak bisa di-clone.
3. **Anti-tamper** — deteksi tamper irreversibel, sekali dibuka status berubah permanen.
4. **Fair primary, free secondary** — fair launch; pasar bebas di secondary.
5. **Gamified ownership** — level 1–50, badge (First Drop, Whale, Curator…), leaderboard.

## Batasan MVP

- Bukan Web3 wallet/crypto-primary (crypto internal signature saja).
- Bukan marketplace preloved umum; bukan sosmed baru.
- Scope MVP: 27 fitur Must/Should (blok 1–2, RICE+MoSCoW di arsip). AR = Y2+ (F209), bukan 3D viewer MVP.

## Personas

| Persona | Siapa | Motivasi utama |
|---------|-------|----------------|
| **Aurel** (kreator indie) | follower 10k–100k | Pengen drop pertama sukses + settlement jelas |
| **Bara** (kreator established) | 500k+ | Revenue share + lifetime royalty |
| **Nara** (kolektor pemula) | fans kreator | FOMO, mudah checkout, badge First Drop |
| **Dharma** (kolektor serius) | flipper/investor | Data harga, rarity, apresiasi nilai |
| **Brand Celcius** (B2B) | studio/brand | Co-promote + dashboard real-time |
| **Reseller/Flipper** | wildcard | Likuiditas — dibatasi limit + anti-bot |

## Journey — Titik Kritis

**Kreator (Aurel)**: apply → kurasi 5–7 hari → upload artwork → preview mockup → set unit/harga/drop date (min H+14) → produksi 10–14 hari → NFC embed + QC (<2% defect) → listing H-7 + countdown → drop live → sold-out notif → escrow release → payout Selasa.

**Kolektor pemula (Nara)**: discover di IG kreator → upcoming drops → reminder → drop live tap **Beli Sekarang** → **potong saldo C-Coin** (kurang → top-up Flow 9 → balik, stok masih ada) → "pembeli #5/15" → sertifikat di profil → 3PL tracking → tap NFC → sertifikat + 3D viewer → share story → badge + level naik → opsional secondary listing (default auto-disburse IDR, opsional tahan C-Coin).

**Kolektor serius (Dharma)**: riset (harga primer, bid history, rarity) → checkout (mungkin 2 unit, limit) → hold & track (`Your collection value +X%`) → jual dengan **anti-sniping +5m** (max 3×).

**Brand**: pitch → demo 100 unit → agreement (IP, revenue share, lisensi non-eksklusif) → upload artwork → co-promote → dashboard real-time → repeat drop + royalti ongoing.

> Detail journey lengkap (5 journey + pain→solusi) ada di arsip `20_product/02_user_journey.md`.

## Form Factor (Lock)

- Kartu **63×88 mm**, premium 350–400 gsm, **holo default**, acrylic hardcase tebal ~3 mm.
- **Signed variant 1 per 10** (`signed_count = ceil(total/10)`). Drop 15 → 1 signed + 14 unsigned.
- **Harga asumsi A019**: unsigned **30 C-Coin** (Rp 300k), signed **50 C-Coin** (Rp 500k).
- COGS average acrylic+print+NFC panduan kasar **Rp 50–80k**; **Total COGS per kartu unsigned Rp 104k** (signed Rp 120k + Rp 16k insert) sudah termasuk dus, QC, shipping, payment fee — 3PL **Rp 15k terpisah** sebagai variable cost.

## Revenue Model (Lock — 2026-08-11)

- **Primary**: platform-produced **70/30** (platform/kreator), kreator-produced **30/70**.
- **Secondary fee 15% = 7,5% platform + 7,5% royalty kreator (LIFETIME, non-expiring) + 85% owner**.
- Contoh: primary Rp 300k → kreator Rp 90k (30%); resale Rp 1jt → platform Rp 75k + kreator Rp 75k + seller Rp 850k.
- Lifetime royalty contoh eskalasi 5× sale (300k→600k→900k→1,2jt→1,5jt) = **Rp 405k** (termasuk primary). Lihat NUMBERS.md.

## GTM MVP (Lock)

- **Off-platform**: 30–50 kreator via personal relationship + 1–2 agency partner; self-serve Y2+.
- **Manual approval**, threshold **10k followers**.
- Bootstrap Y1: modal **Rp 50–100 jt** dari Hezky (sole funder), equity sementara 60/20/20 (Hezky/Iqbal/Elpid).

## Nilai yang Harus Terasa di UI

- **Premium signal**: dark + gold, hardcase, dus — bukan “merch”.
- **Scarcity signal**: counter sisa unit Realtime + Unit #X/Y di sertifikat.
- **Trust signal**: verify badge (`✅ Terverifikasi` / `⚠️ Tamper` / `❓ Registered (QR)`).
