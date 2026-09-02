# UI Glossary — C.Verse Web (Space Arcade)

**Purpose:** Single source of truth for page titles, channel labels, and user-facing terms.
Every `PageHero` prop, nav label, and empty-state string must use these values — no synonyms.

## Page titles & channels

| Route | `channel` | `channelLabel` | `title` (h1) | Nav / UserMenu label |
|---|---|---|---|---|
| `/` | — | — | — (Landing, no hero) | — |
| `/home` | `00` | `BERANDA` | **Beranda** | Beranda |
| `/drops` | `01` | `DROPS` | **Drops** | Drops |
| `/drops/:id` | `01` | `DROPS` | `{drop.title}` (data-driven) | — |
| `/marketplace` | `02` | `MARKET` | **Marketplace** | Marketplace |
| `/browse` | `03` | `JELAJAHI` | **Jelajahi** | Jelajahi |
| `/leaderboard` | `04` | `PERINGKAT` | **Peringkat** | Peringkat |
| `/u/:username` | `05` | `PROFIL` | `{displayName}` | — |
| `/c/:username` | `06A` | `KREATOR` | `{displayName}` | — |
| `/creator` | `06B` | `KREATOR` | **Dasbor Kreator** | Dasbor Kreator |
| `/creator/drops/:id` | `06C` | `KREATOR` | `{drop.title}` | — |
| `/creator/payouts` | `06D` | `KREATOR` | **Riwayat Penarikan** | Penarikan & Royalti |
| `/cards/:id` | `07` | `C.CARD` | `{drop.title} · #N` | — |
| `/cards/:id/3d` | `07B` | `C.CARD` | `{drop.title} · #N` | — |
| `/wallet` | `08` | `DOMPET` | **Dompet** | Dompet |
| `/collection` | `09` | `KOLEKSI` | **Koleksi** | Koleksi |
| `/me/manage` | `10A` | `KELOLA` | **Kelola C.Card** | Kelola C.Card |
| `/me/manage/verify-shipment` | `10B` | `KELOLA` | **Kirim ke Vault** | Kirim ke Vault |
| `/me/kyc` | `11` | `KYC` | **Verifikasi Identitas** | Verifikasi |
| `/me/privacy` | `12` | `PRIVASI` | **Privasi** | Privasi |
| `/orders` | `13A` | `PESANAN` | **Pesanan** | Pesanan |
| `/orders/:id` | `13B` | `PESANAN` | **Detail Pesanan** | — |
| `/drops/:id/checkout` | `14` | `CHECKOUT` | **Checkout** | — |
| `/notifications` | `15` | `NOTIFIKASI` | **Notifikasi** | Notifikasi |

Rules:
- Channel numbers are unique per route (no `CH:06` ×4 or `CH:10` ×2).
- `extra` (rail-extra) is **not rendered** unless it carries live data (e.g. ticker). Static decoration strings like `PILOT DECK`, `TREASURY LINK`, `STEALTH PROTOCOL` are removed.
- Hero `sub` is only used when it adds context not in the title (e.g. handle `@karina` above a display name). Never repeat the title as sub/eyebrow.

## Vocabulary

| Concept | Canonical term | Notes |
|---|---|---|
| Home page | **Beranda** | Replaces `Cockpit` (theme jargon) and `Home` (English) in nav + h1 + aria. |
| Card variants | **Reguler** / **Signed** | Lowercase `signed` → `Signed`; `Premium (Signed)` / `Regular` removed. |
| Sale phases | **Raffle** / **Segera Diundi** / **Beli Langsung** / **Selesai** / **Akan Datang** | `FCFS` → `Beli Langsung`; `Draw Soon` / `Menunggu Draw` → `Segera Diundi`. |
| Storage | **Vault** (capital V, proper noun) | Never `vault`, `gudang vault`, `di vault` lowercase. |
| Withdrawal | **Penarikan** (user), **Penarikan & Royalti** (menu) | `Payout` only in code/API, not in UI. |
| Actor | **Kolektor** | Replaces `Pilot`, `Pemain`, `PILOT DOSSIER/CLEARANCE`, `PEMAIN` ticker. |
| Notifications | **Notifikasi** | Replaces `Inbox`, `SIGNAL`, `INBOX FEED`. |
| Order table | **Pesanan** | `<th>Order</th>` → `Pesanan`. |
| Currency | **C** (inline), **C-Coin** (balance label) | Consistent: `1 C = Rp…`, never mixed `C`/`C-Coin` in same card without reason. |
| Earnings balance | **C-Gems** | Saldo penghasilan (hasil jual, royalti, Dukungan diterima) — separate from C-Coin (saldo belanja); non-transferable. |
| Gem lock status | **Bisa dicair** / **Terkunci 24 jam** | Status lot C-Gems; Penarikan hanya untuk lot **Bisa dicair**. |

## Redundancy rule

No word may appear twice in the vertical stack `rail → h1 → next eyebrow/h2` within one viewport fold.
If `channelLabel` equals the title word, the next section's eyebrow must name the section's content (e.g. level, count), not the page name.
