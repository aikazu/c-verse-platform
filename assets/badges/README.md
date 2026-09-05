# C.Verse badge assets

43 achievements: eight families with five tiers plus three one-time specials. Created with the built-in imagegen tool on 2026-09-05.

- Master artwork: `source/*.png` (eight metallic cosmic emblems).
- Runtime artwork: R2 `badges/v1/*.webp` pada `https://assets.c-verse.co`
  (immutable, `Cache-Control` satu tahun), 320x320. Bundle `public/badges/`
  di web/admin sudah dihapus 2026-09-06; `badges.icon_url` menyimpan URL R2
  absolut via migrasi `20260905200101_badge_icon_r2.sql`.
- The final masters have a black matte. Render them with `mix-blend-mode: screen` on an isolated dark surface; they do not have an alpha channel. Checkerboard draft outputs are not part of this asset pack.
- One family image is reused by Bronze (I), Silver (II), Gold (III), Astral (IV), and Nova (V). The reusable BadgeEmblem component adds the tier border, accents and glow; keep the artwork unobstructed.
- Achievement tiers are independent of the account's Galactic Rank Ladder. Each badge awards XP once. Earned XP uses the stored snapshot, including older rewards.
- Database catalog: `supabase/migrations/20260905071602_badge_catalog.sql`. Rules and balance are documented in `docs/05_data_model.md`.

## Catalog

| Code | Achievement | Tier | XP | Criterion |
|---|---|---|---:|---|
| first_drop | First Light | Bronze | 5 | Pernah memiliki 1 C.Card unik sepanjang waktu. |
| collector_5 | Collector | Silver | 10 | Pernah memiliki 5 C.Card unik sepanjang waktu. |
| collector_tier_3 | Card Keeper | Gold | 20 | Pernah memiliki 15 C.Card unik sepanjang waktu. |
| collector_tier_4 | Grand Collector | Astral | 40 | Pernah memiliki 30 C.Card unik sepanjang waktu. |
| collector_tier_5 | Collection Nova | Nova | 80 | Pernah memiliki 75 C.Card unik sepanjang waktu. |
| devotee_tier_1 | First Connection | Bronze | 5 | Pernah memiliki 1 C.Card unik dari satu kreator yang sama. |
| devotee_tier_2 | True Fan | Silver | 10 | Pernah memiliki 3 C.Card unik dari satu kreator yang sama. |
| curator | Curator | Gold | 25 | Pernah memiliki 10 C.Card unik dari satu kreator yang sama. |
| devotee_tier_4 | Inner Circle | Astral | 50 | Pernah memiliki 25 C.Card unik dari satu kreator yang sama. |
| devotee_tier_5 | Eternal Devotee | Nova | 100 | Pernah memiliki 50 C.Card unik dari satu kreator yang sama. |
| explorer_tier_1 | New Horizons | Bronze | 5 | Pernah mengoleksi C.Card dari 2 kreator berbeda. |
| explorer_tier_2 | Talent Scout | Silver | 15 | Pernah mengoleksi C.Card dari 4 kreator berbeda. |
| explorer_tier_3 | Star Seeker | Gold | 30 | Pernah mengoleksi C.Card dari 8 kreator berbeda. |
| explorer_tier_4 | Constellation | Astral | 50 | Pernah mengoleksi C.Card dari 12 kreator berbeda. |
| explorer_tier_5 | Universe Explorer | Nova | 90 | Pernah mengoleksi C.Card dari 20 kreator berbeda. |
| archivist_tier_1 | Chapter One | Bronze | 5 | Pernah mengoleksi C.Card dari 2 Drop berbeda. |
| archivist_tier_2 | Story Keeper | Silver | 10 | Pernah mengoleksi C.Card dari 5 Drop berbeda. |
| archivist_tier_3 | Drop Archivist | Gold | 25 | Pernah mengoleksi C.Card dari 10 Drop berbeda. |
| archivist_tier_4 | Chronicle Master | Astral | 45 | Pernah mengoleksi C.Card dari 20 Drop berbeda. |
| archivist_tier_5 | Living Archive | Nova | 85 | Pernah mengoleksi C.Card dari 40 Drop berbeda. |
| autograph_tier_1 | First Signature | Bronze | 10 | Pernah memiliki 1 C.Card signed unik. |
| autograph_tier_2 | Ink Seeker | Silver | 20 | Pernah memiliki 3 C.Card signed unik. |
| autograph_tier_3 | Signature Curator | Gold | 35 | Pernah memiliki 7 C.Card signed unik. |
| autograph_tier_4 | Autograph Elite | Astral | 60 | Pernah memiliki 15 C.Card signed unik. |
| autograph_tier_5 | Signature Nova | Nova | 100 | Pernah memiliki 30 C.Card signed unik. |
| pioneer_tier_1 | Launch Crew | Bronze | 5 | Selesaikan pembelian 1 C.Card primer unik melalui FCFS atau raffle yang dimenangi. |
| pioneer_tier_2 | Drop Regular | Silver | 10 | Selesaikan pembelian 3 C.Card primer unik melalui FCFS atau raffle yang dimenangi. |
| pioneer_tier_3 | First Edition | Gold | 20 | Selesaikan pembelian 10 C.Card primer unik melalui FCFS atau raffle yang dimenangi. |
| pioneer_tier_4 | Launch Vanguard | Astral | 40 | Selesaikan pembelian 25 C.Card primer unik melalui FCFS atau raffle yang dimenangi. |
| pioneer_tier_5 | Genesis Pioneer | Nova | 80 | Selesaikan pembelian 50 C.Card primer unik melalui FCFS atau raffle yang dimenangi. |
| trader_tier_1 | New Orbit | Bronze | 5 | Selesaikan pembelian 1 C.Card sekunder unik melalui buyout atau bid yang diterima. |
| trader_tier_2 | Market Voyager | Silver | 10 | Selesaikan pembelian 3 C.Card sekunder unik melalui buyout atau bid yang diterima. |
| trader_tier_3 | Orbit Navigator | Gold | 20 | Selesaikan pembelian 10 C.Card sekunder unik melalui buyout atau bid yang diterima. |
| trader_tier_4 | Trade Pathfinder | Astral | 40 | Selesaikan pembelian 25 C.Card sekunder unik melalui buyout atau bid yang diterima. |
| trader_tier_5 | Market Nova | Nova | 80 | Selesaikan pembelian 50 C.Card sekunder unik melalui buyout atau bid yang diterima. |
| patron_tier_1 | First Spark | Bronze | 3 | Kirim Dukungan yang berhasil kepada 1 kreator berbeda. |
| patron_tier_2 | Kindred Spirit | Silver | 8 | Kirim Dukungan yang berhasil kepada 3 kreator berbeda. |
| patron_tier_3 | Creator Ally | Gold | 15 | Kirim Dukungan yang berhasil kepada 5 kreator berbeda. |
| patron_tier_4 | Starlight Patron | Astral | 30 | Kirim Dukungan yang berhasil kepada 10 kreator berbeda. |
| patron_tier_5 | Supernova Patron | Nova | 60 | Kirim Dukungan yang berhasil kepada 20 kreator berbeda. |
| first_bid | First Signal | Bronze | 3 | Pasang satu bid valid. Hanya diberikan sekali, meski bid kemudian dibatalkan atau dikalahkan. |
| whale | Big Signal | Gold | 15 | Pasang satu bid valid di atas 100 C-Coin. Hadiah satu kali; pembatalan tidak memberi XP tambahan. |
| verified | Verified Identity | Silver | 10 | KYC disetujui. Verifikasi tetap opsional untuk koleksi dan diperlukan untuk payout C-Gems. |

## Generation prompts

Base direction: one production UI achievement badge for the C.Verse space arcade collectible platform; sculpted gunmetal titanium and brushed platinum, thick bevels, restrained cyan inlays, front-facing orthographic composition, readable at 64px, controlled studio lighting, no text, letters, numbers, watermark, scenery, pedestal or enclosing shield. Reusable base with tier decorations added by the interface.

| Asset | Subject |
|---|---|
| collector | Three fanned collectible cards, center card engraved with a four-point orbital star. |
| devotee | Four-point star cradled by swept metallic wings, a faceted cyan heart at its center. |
| explorer | Compass rose inside intersecting orbital rings with three satellite stars. |
| archivist | Open metallic star-map archive book with stacked folios beneath. |
| autograph | Fountain-pen nib across a metallic collectible card with an engraved swoosh. |
| pioneer | Compact retro-futuristic rocket, beveled fins, cyan cockpit and metallic exhaust. |
| trader | Curved orbital arrows exchanging places around a faceted ringed planet. |
| patron | Cupped metallic hands supporting a faceted four-point cyan star. |

Final edit prompt (applied separately to each base):

> Edit this exact badge asset. Preserve the metallic emblem exactly: shape, details, metallic platinum finish, cyan gems, framing and position. The checkerboard behind it is an unwanted baked-in background, remove the checkerboard entirely including in gaps. Replace ALL background space with perfectly uniform pure black RGB #000000. Do NOT draw any checkerboard. This black matte is needed for screen-blend composition in a dark UI. No scenery, no shadow on background, no external glow. Output one square image, emblem on solid pure black.
