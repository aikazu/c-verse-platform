# 13 — Atomic Checkout RPC (store in-memory → Postgres)

> Status: [IMPLEMENTED 2026-08-16] — spec ini historis; kondisi akhir:
> semua uang & stok lewat RPC single-transaction di
> `supabase/migrations/*.sql` (18 file bernomor; RPC di 07–17), `store.ts` tinggal type + helper
> murni (bukan data), tidak ada fallback in-memory.
> Created: 2026-08-15; updated: 2026-08-18
> Basis audit awal: seluruh route API pakai `apps/api/src/lib/store.ts` (Map
> in-memory); checkout = read-check-write JS — aman hanya single-process,
> oversell di Workers multi-isolate.

## 1. Prinsip Migrasi

1. **Postgres = satu-satunya sumber kebenaran.** Dual-write dihapus;
   `store.ts` kini hanya type domain + helper `uid`/`nowIso`, tanpa
   data in-memory. API fail-fast tanpa `SUPABASE_URL`.
2. Semua **aksi uang & stok** lewat **RPC single transaction**
   (`security definer` function) — bukan read-modify-write di JS.
3. Urutan migrasi route: read-only dulu → wallet → checkout → bids →
   shipments (regresi kecil per gelombang).

## 2. RPC Checkout (inti)

> **Update 2026-08-28 (founder: purchase → vault only)**: parameter
> `p_delivery`/`p_address`/`p_shipping_fee` dihapus dari flow
> pembelian — checkout settle LANGSUNG ke vault (kartu
> `location='platform_vault'`, order `settled`, tanpa escrow
> DELIVERED+H+7). Signature di bawah = historis.

### 2,1 Signature
```sql
create or replace function public.checkout(
  p_drop_id       uuid,
  p_pool          text,                 -- 'regular' | 'premium' (FCFS sisa)
  p_delivery      delivery_option,      -- 'vault' | 'shipping'
  p_address       text,                 -- null jika vault
  p_shipping_fee  integer               -- >=1 jika shipping, null jika vault
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_drop   drops;
  v_card   cards;
  v_price  integer;
  v_order  orders;
begin
  -- 1. Gate user & drop (FCFS = HANYA setelah draw; sebelum itu
  --    pakai drop_entry, lihat 2,1b)
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_drop from drops
    where id = p_drop_id and status = 'live'
    and drawn_at is not null            -- fase FCFS saja (C-15)
    and drop_start_at <= now() and (drop_end_at is null or drop_end_at > now())
    for update;                          -- LOCK baris drop
  if not found then raise exception 'DROP_NOT_LIVE'; end if;
  if v_drop.remaining_units < 1 then raise exception 'SOLD_OUT'; end if;

  -- 2. Max 1 kartu/user/drop (backup selain partial index)
  if exists (select 1 from orders o
             where o.user_id = v_user and o.drop_id = p_drop_id
             and o.status not in ('refunded')) then
    raise exception 'LIMIT_1_PER_DROP';
  end if;

  -- 3. Pilih kartu random dari POOL yang dipilih (premium = signed)
  select * into v_card from cards
    where drop_id = p_drop_id and status = 'inventory'
    and is_signed = (p_pool = 'premium')
    order by random() limit 1
    for update skip locked;
  if not found then raise exception 'SOLD_OUT'; end if;

  -- 4. Debit saldo atomik (raise jika kurang)
  perform public.wallet_debit(v_user, v_card.price_ccoin,
          'checkout', 'order', null, 'checkout-' || v_user || '-' || p_drop_id);

  -- 5. Assign kartu + order
  update cards set current_owner_id = v_user, status = 'bound',
    location = case when p_delivery = 'vault' then 'platform_vault'
                    else 'with_owner' end
  where id = v_card.id;
  update drops set sold_count = sold_count + 1,
    status = case when sold_count + 1 >= total_units then 'sold_out' else status end
  where id = p_drop_id;

  insert into orders (user_id, drop_id, card_id, total_ccoin, total_idr,
    status, delivery_option, shipping_fee_ccoin, shipping_address, escrow_status)
  values (v_user, p_drop_id, v_card.id, v_card.price_ccoin,
    v_card.price_ccoin * 10000, 'paid', p_delivery, p_shipping_fee,
    p_address, 'held')
  returning * into v_order;

  insert into ownership_history (card_id, owner_id, acquired_via)
  values (v_card.id, v_user, 'primary');

  return v_order;
end $$;
```
Catatan: pool premium = kartu `is_signed` (harga `price_signed_ccoin`),
pool regular = unsigned (`price_ccoin`) — snapshot harga di
`cards.price_ccoin` saat provisioning tetap dipakai sebagai harga kartu.

### 2,1b RPC raffle: drop_entry + draw_drop (C-15 — Flow 1 fase 1-2)
```sql
create or replace function public.drop_entry(
  p_drop_id uuid, p_pool text)   -- 'regular' | 'premium' | 'both'
returns public.drop_entries language plpgsql security definer as $$
declare
  v_user uuid := auth.uid(); v_drop drops; v_hold int;
begin
  select * into v_drop from drops
    where id = p_drop_id and status = 'live'
    and drawn_at is null and raffle_end_at > now()  -- hanya window entry
    for update;
  if not found then raise exception 'ENTRY_CLOSED'; end if;
  -- hold: regular = harga unsigned, premium/both = harga signed (max)
  v_hold := case when p_pool = 'regular' then v_drop.price_ccoin
                 else v_drop.price_signed_ccoin end;
  perform public.wallet_debit(v_user, v_hold, 'escrow_hold',
          'drop', p_drop_id, 'entry-' || v_user || '-' || p_drop_id);
  -- CATATAN: hold entry pakai type 'escrow_hold' dan TIDAK menambah XP
  -- (bukan spend nyata) — XP hanya tercatat saat konversi hold jadi
  -- pembayaran di draw_drop (winner).
  insert into drop_entries (drop_id, user_id, pool, hold_ccoin, status)
  values (p_drop_id, v_user, p_pool, v_hold, 'held')
  returning *;                       -- UNIQUE(drop_id,user_id) -> ENTRY_EXISTS
end $$;

create or replace function public.draw_drop(p_drop_id uuid)
returns integer language plpgsql security definer as $$
-- SATU transaksi batch; idempotent via drops.drawn_at
declare v_n int;
begin
  update drops set drawn_at = now()
    where id = p_drop_id and drawn_at is null and raffle_end_at <= now()
    returning 1 into v_n;
  if v_n is null then return 0; end if;       -- sudah drawn / belum waktunya

  -- 1. PREMIUM: random entrants (premium + both) -> won_premium
  --    limit = signed_units tersisa; alokasi kartu is_signed +
  --    insert orders (source='raffle', default vault, PAID)
  --    + ownership_history + konversi hold jadi pembayaran
  -- 2. REGULER: random entrants (regular + both yang kalah)
  --    -> won_regular; pool 'both' -> wallet_credit selisih
  --    (hold - price_ccoin)
  -- 3. Sisanya -> lost + wallet_credit hold penuh (release)
  -- 4. Return jumlah winner (app kirim notif via queue)
  -- Implementasi: cursor/loop dengan SELECT ... ORDER BY random()
  --   FOR UPDATE; pola alokasi kartu sama dengan checkout 2,1.
  return v_winner_count;
end $$;
```
Race test raffle (wajib, tambahan 2,3):
- `draw_drop` dipanggil 2x concurrent → tepat 1 yang mengalokasikan
  (kedua return 0/idempotent), tidak ada order ganda.
- 50 entry di drop 10 unit (1 signed + 9 unsigned) → winner tepat
  1 `won_premium` + 9 `won_regular`; SUM release + pembayaran =
  SUM hold awal (ledger seimbang, tidak ada C-Coin hilang/teriilang).
- Entry di window tertutup / drop sudah drawn → `ENTRY_CLOSED`.

### 2,2 RPC wallet (dipakai checkout & top-up & payout)
```sql
wallet_debit(p_user uuid, p_amount int, p_type wallet_tx_type,
             p_ref_type text, p_ref_id text, p_idem text)
  -- UPDATE wallets SET balance_ccoin = balance_ccoin - p_amount
  --   WHERE user_id = p_user AND balance_ccoin >= p_amount
  --   -- 0 row → raise INSUFFICIENT
  -- INSERT wallet_transactions (..., metadata jsonb incl idempotency_key)
  --   ON CONFLICT do nothing + cek existing (idempotent)

wallet_credit(...)  -- mirip, untuk release/refund/royalty/settlement
```
- Unique index fungsional sudah ada (`metadata->>'idempotency_key'`) —
  pastikan `ON CONFLICT` memakainya, bukan hanya pengecekan JS.
- XP bertambah DI SINI (spend 1 C-Coin = 1 XP) dalam transaksi sama:
  `update users set total_xp = total_xp + p_amount ...`.

### 2,3 Race test (wajib)
- Node script spawn 50 concurrent `supabase.rpc('checkout', ...)` ke drop
  sisa 1 unit → **tepat 1 sukses**, 49 error `SOLD_OUT`, `sold_count` = total.
- 2 concurrent checkout user sama → kedua yang kedua `LIMIT_1_PER_DROP`.
- Concurrent debit hingga saldo 0 → tidak pernah balance negatif
  (constraint `balance_ccoin >= 0` + RPC row lock).

## 3. Gelombang Migrasi Route

| Gelombang | Route | Dari → Ke |
|---|---|---|
| 1 (read) | drops, marketplace, publicProfile, seo, creators stats (browse module dihapus 2026-08-31 — discovery drop via `/api/drops`) | store → `supabase.from().select()` (Supabase client langsung, raw SQL ok) |
| 2 | wallet (top-up/payout/ledger), gamification | store → RPC wallet_credit/debit + select |
| 3 | orders (checkout, orders list/detail), shipments | store → RPC checkout + select. PATCH /api/shipments/:id/status (admin fulfillment) atomic via RPC `admin_fulfill_shipment` di RPC `07`–`17` (sebelumnya `20260823010000_admin_fulfill_shipment.sql`) — bukan sequential writes ke shipments/orders/cards lagi. |
| 4 | bids (place/cancel/accept), cards buyout set/cabut | store → RPC `place_bid` (hold+outbid release atomic), `accept_bid` (transfer+split fee 7,5/7,5/85 + ownership_history) |
| 5 | kyc, disputes, admin reads | select via anon + RLS / role-gated API |
| 6 | `store.ts` disusutkan jadi type + helper murni (bukan data); seed SQL-only (`supabase/seed.sql` satu sumber seed) |

Per gelombang: jalankan typecheck + manual smoke flow + tambah vitest.

## 4. Realtime & Cron ikut pindah

- Realtime counter drop: subscribe `drops` changes (Supabase Realtime)
  — bukan polling JS.
- Cron Workers (raffle draw check, payout Selasa): panggil RPC
  `draw_drop()` untuk
  drops yang lewat `raffle_end_at` dan belum drawn, `payout_batch_run()`
  — logika di SQL function, cron hanya trigger.
  (`escrow_auto_release` DELIVERED+H+7 dihapus — founder
  2026-08-28: purchase → vault only, settlement langsung.)
- Badge TANPA cron: award via trigger Postgres dalam transaksi
  yang sama dengan event kualifikasi — instan + atomic
  (keputusan user 2026-08-15).

## 5. Jangan Dilakukan

- Jangan `select ... ` lalu `update` di JS untuk stok/saldo (race klasik).
- Jangan share satu Postgres connection lintas request tanpa pooler
  (pakai Supavisor pooler string, sesuai `06_tech_decisions.md`).
- Jangan migrasi semua route sekaligus dalam satu commit — per gelombang.
- Jangan biarkan `security definer` function tanpa `set search_path`
  (kebocoran privilege).

## 6. Acceptance Criteria

- [ ] Restart API = data tetap; dua instance API jalan paralel tanpa oversell.
- [ ] Race test 50-concurrent lulus (video/log terlampir di PR).
- [ ] `wallet_transactions` hanya bertambah via RPC; tidak ada row hasil
      tulis langsung JS.
- [x] `store.ts` disusutkan jadi type + helper murni, tanpa data in-memory.
- [ ] Checkout vault default (C-10) teruji: tanpa address → order
      `delivery_option='vault'`, kartu `location='platform_vault'`.

## 7. Sumber

- `dev-strategy/05_data_model.md` (invariant I1-I14, RLS, ledger).
- `dev-strategy/06_tech_decisions.md` D5 (checkout race: RPC + row lock),
  D6 (Realtime), stack Supavisor.
- Audit Platform 2026-08-15: `orders.ts` read-check-write; store in-memory
  dipakai semua route.
