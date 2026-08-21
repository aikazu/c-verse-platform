-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — Creator Seed C.Card: TWO-PHASE SETTLEMENT
-- (FASE C, keputusan user 2026-08-21 — MENGgantikan gate-paksa FASE B)
-- Flow 10 (docs/03_flows.md): seed card 1-of-1 di-hadiahkan ke kreator
-- (kreator = owner), dijual di secondary NORMAL (bukan primary raffle).
--
-- ALUR BARU (two-phase):
--   PHASE-1 (LOCK): bid/checkout BOLEH dari mana saja (kartu di owner ATAU
--     di vault) selama TIDAK ada transaksi berjalan. Saat owner ACCEPT atau
--     buyer CHECKOUT buyout: deal terkunci — card.status = 'bid_pending',
--     bid lain di-release, uang buyer tetap escrow/hold, seller BELUM
--     dibayar, ownership BELUM pindah.
--   PHASE-2 (RELEASE): WAJIB kartu fisik kembali ke vault platform
--     (location='platform_vault' via admin vault-in) + verifikasi NFC
--     (verify_status='verified' — HANYA via tap crypto di nfc.ts, admin
--     tidak bisa memalsukan) -> BARU release/settlement: seller 85% +
--     royalti kreator 7,5% (via drops.creator_id) + platform 7,5% +
--     ownership pindah ke buyer + shipment. Admin memicu via fungsi
--     release_seed_sale(p_card_id) (service_role HANYA).
--   Selama 'bid_pending': place_bid & set_buyout DITOLAK -> SALE_IN_PROGRESS.
--
-- MIGRATION LAMA TIDAK DIUBAH (immutable: 20260817060000 & 20260821000000)
-- — semua perubahan = create-or-replace + alter add column if not exists
-- (idempoten, aman re-run).
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 0. Kolom bids baru (idempoten) — menyimpan pilihan buyer saat
--    PHASE-1 accept, dipakai release_seed_sale untuk settlement + shipment.
--    accepted_at SUDAH ada sejak foundation; destination/shipping_address
--    ditambah di sini (nullable — bid non-seed / path lama tidak terpengaruh).
-- ══════════════════════════════════════════════════════════════════════════
alter table public.bids add column if not exists destination public.shipment_to_dest;
alter table public.bids add column if not exists shipping_address text;

comment on column public.bids.destination is
  'Two-phase seed sale (2026-08-21): pilihan tujuan buyer yang disimpan saat PHASE-1 accept (bid -> accepted), dipakai release_seed_sale saat settlement (vault / kirim fisik).';
comment on column public.bids.shipping_address is
  'Two-phase seed sale (2026-08-21): alamat pengiriman yang disimpan saat PHASE-1 accept (kewajiban saat destination=buyer_address), dipakai shipment saat release.';

-- ══════════════════════════════════════════════════════════════════════════
-- 0b. orders.source: seed buyout PHASE-1 membuat order dengan
--    source='secondary_buyout' (escrow 'held') — perluas check constraint
--    (idempoten: drop constraint jika masih versi lama).
-- ══════════════════════════════════════════════════════════════════════════
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('fcfs','raffle','secondary_buyout'));

-- ══════════════════════════════════════════════════════════════════════════
-- 1. accept_bid — TWO-PHASE (create or replace dari 20260821000000).
--    Gate SEED_VAULT_IN_REQUIRED lama DIHAPUS.
--    - seed TIDAK vaulted (location<>platform_vault ATAU verify<>verified)
--      -> PHASE-1 LOCK: bid->accepted (+destination/shipping_address),
--      kartu 'bid_pending', bid lain di-release, TANPA uang/ownership.
--    - seed SUDAH vaulted / non-seed -> settle LANGSUNG (body lama utuh).
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.accept_bid(text, public.shipment_to_dest, text);
create or replace function public.accept_bid(
  p_card_id text,
  p_destination public.shipment_to_dest default 'buyer_address',
  p_address text default null
) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_bid public.bids;
  v_other public.bids;
  v_is_seed boolean := false;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;
  if p_destination = 'buyer_address' and (p_address is null or length(trim(p_address)) < 10) then
    raise exception 'ADDRESS_REQUIRED';
  end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;

  select * into v_bid from bids where card_id = p_card_id and status = 'active'
  order by amount_ccoin desc limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_BID'; end if;

  -- ── PHASE-1 LOCK (seed belum vault-in + verified) ──────────────────────
  if v_is_seed and (v_card.location <> 'platform_vault'::card_location
                    or v_card.verify_status <> 'verified'::verify_status) then
    update bids set status = 'accepted', accepted_at = now(),
      destination = p_destination, shipping_address = p_address
    where id = v_bid.id;

    for v_other in select * from bids where card_id = p_card_id and status = 'active' and id <> v_bid.id for update loop
      perform public.wallet_credit(v_other.bidder_id, v_other.amount_ccoin, 'escrow_release', 'bid', v_other.id, 'release-' || v_other.id);
      update bids set status = 'outbid', outbid_at = now() where id = v_other.id;
    end loop;

    update cards set status = 'bid_pending'::card_status, buyout_price_ccoin = null
    where id = p_card_id;

    return v_bid;
  end if;

  -- ── SETTLE LANGSUNG (seed vaulted / non-seed) — body 20260821000000 ────
  v_platform_ccoin := round(v_bid.amount_ccoin * 0.075);
  v_royalty_ccoin := round(v_bid.amount_ccoin * 0.075);
  v_seller_ccoin := v_bid.amount_ccoin - v_platform_ccoin - v_royalty_ccoin;

  perform public.wallet_credit(v_user, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_bid', 'bid', v_bid.id, v_bid.amount_ccoin,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- XP buyer: spend = amount
  update users set total_xp = total_xp + v_bid.amount_ccoin,
    level = least(100, greatest(1, floor((total_xp + v_bid.amount_ccoin) / 10) + 1))
  where id = v_bid.bidder_id;

  update bids set status = 'accepted', accepted_at = now() where id = v_bid.id;

  for v_other in select * from bids where card_id = p_card_id and status = 'active' and id <> v_bid.id for update loop
    perform public.wallet_credit(v_other.bidder_id, v_other.amount_ccoin, 'escrow_release', 'bid', v_other.id, 'release-' || v_other.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_other.id;
  end loop;

  update cards set owner_id = v_bid.bidder_id, buyout_price_ccoin = null, status = 'sold',
    location = (case when p_destination = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
  values (gen_random_uuid()::text, p_card_id, v_bid.bidder_id, 'secondary_bid', v_bid.id);

  if p_destination = 'buyer_address' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
    values (gen_random_uuid()::text, p_card_id, v_bid.bidder_id, 'secondary_bid',
            (case when v_is_seed then 'platform'::shipment_from_location else 'seller'::shipment_from_location end),
            'buyer_address',
            jsonb_build_object('street', p_address), 'requested');
  end if;

  return v_bid;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. buyout_card — TWO-PHASE (create or replace dari 20260821000000).
--    Gate SEED_VAULT_IN_REQUIRED lama DIHAPUS. COOLING_PERIOD_24H +
--    CREATOR_SELF_DEALING_30D (incl. extension C-13 seed) DIPERTAHANKAN
--    utuh di jalur entry.
--    - seed TIDAK vaulted -> PHASE-1 LOCK: debit buyer 'platform_buy' +
--      order 'paid'/'held' + kartu 'bid_pending', TANPA settle.
--    - seed SUDAH vaulted / non-seed -> settle LANGSUNG (body lama utuh).
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.buyout_card(text, public.shipment_to_dest, text);
create or replace function public.buyout_card(
  p_card_id text,
  p_destination public.shipment_to_dest default 'buyer_address',
  p_address text default null
) returns public.cards
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_seller uuid;
  v_price integer;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
  v_is_seed boolean := false;
  v_bid public.bids;
  v_debit_tx public.wallet_transactions;
  v_order_ref text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found or v_card.buyout_price_ccoin is null then raise exception 'NOT_FOR_SALE'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;
  if p_destination = 'buyer_address' and (p_address is null or length(trim(p_address)) < 10) then
    raise exception 'ADDRESS_REQUIRED';
  end if;

  -- wash trading blok rebuy 24 jam (C-12 FINAL 2026-08-15) & creator self-dealing 30 hari (I14)
  if exists (select 1 from ownership_history h
             where h.card_id = p_card_id and h.owner_id = v_user
             and h.transferred_at > now() - interval '24 hours') then
    raise exception 'COOLING_PERIOD_24H';
  end if;
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.creator_id = v_user
             and coalesce(d.drop_start_at, d.drop_at, d.created_at) > now() - interval '30 days') then
    raise exception 'CREATOR_SELF_DEALING_30D';
  end if;
  -- C-13 EXTENSION untuk seed card (Flow 10, keputusan 2026-08-20):
  -- seed drop BUKAN raffle -> drop_start_at/drop_at tidak bermakna dan
  -- coalesce(...) di guard di atas jatuh ke created_at (kapan seed drop
  -- dibuat oleh tim internal) — itu belum tentu merefleksikan ownership
  -- kreator. Sasarannya: kreator pemilik seed TIDAK boleh membeli kembali
  -- kartu seed miliknya dalam 30 hari sejak kartu berada di tangan kreator.
  -- Basis pragmatis & konsisten: ownership_history terakhir milik kreator
  -- (owners.id = drops.creator_id menandai serah hadiah [3] -> transfer
  -- 'gift' atau 'primary' ke kreator), fallback cards.created_at bila tidak
  -- ada record ownership kreator sama sekali. Hanya memblok KREATOR seed
  -- (drops.creator_id = v_user) — buyer normal tidak terpengaruh.
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.is_seed and d.creator_id = v_user) then
    if exists (
      select 1 from ownership_history h
      join drops d on d.id = v_card.drop_id
      where h.card_id = p_card_id and h.owner_id = d.creator_id
        and h.transferred_at > now() - interval '30 days'
    ) or (
      not exists (select 1 from ownership_history h where h.card_id = p_card_id and h.owner_id = v_user)
      and (select created_at from cards where id = p_card_id) > now() - interval '30 days'
    ) then
      raise exception 'CREATOR_SELF_DEALING_30D';
    end if;
  end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;

  v_price := v_card.buyout_price_ccoin;
  v_seller := v_card.owner_id;

  -- ── PHASE-1 LOCK (seed belum vault-in + verified) ──────────────────────
  if v_is_seed and (v_card.location <> 'platform_vault'::card_location
                    or v_card.verify_status <> 'verified'::verify_status) then
    v_debit_tx := public.wallet_debit(v_user, v_price, 'platform_buy', 'card', p_card_id,
            'buyout-seed-' || gen_random_uuid()::text);
    v_order_ref := gen_random_uuid()::text;
    insert into orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status,
                        delivery_option, escrow_status, shipping_address, source)
    values (v_order_ref, v_user, v_card.drop_id, p_card_id, array[p_card_id], v_price, v_price * 10000,
            'paid', (case when p_destination = 'platform_vault' then 'vault'::public.delivery_option else 'shipping'::public.delivery_option end),
            'held', p_address, 'secondary_buyout');

    -- release bid aktif (PHASE-1: tidak ada pemenang bid — buyout menang)
    for v_bid in select * from bids where card_id = p_card_id and status = 'active' for update loop
      perform public.wallet_credit(v_bid.bidder_id, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
      update bids set status = 'outbid', outbid_at = now() where id = v_bid.id;
    end loop;

    update cards set status = 'bid_pending'::card_status, buyout_price_ccoin = null
    where id = p_card_id
    returning * into v_card;

    return v_card;
  end if;

  -- ── SETTLE LANGSUNG (seed vaulted / non-seed) — body 20260821000000 ────
  v_platform_ccoin := round(v_price * 0.075);
  v_royalty_ccoin := round(v_price * 0.075);
  v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

  -- Ref revenue = id tx debit (unik per transaksi; kartu bisa terjual berulang)
  v_debit_tx := public.wallet_debit(v_user, v_price, 'platform_buy', 'card', p_card_id,
          'buyout-' || gen_random_uuid()::text);
  perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'card', p_card_id, 'settle-' || gen_random_uuid()::text);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'card', p_card_id, 'royalty-' || gen_random_uuid()::text);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_buyout', 'buyout', v_debit_tx.id, v_price,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- release bid aktif
  for v_bid in select * from bids where card_id = p_card_id and status = 'active' for update loop
    perform public.wallet_credit(v_bid.bidder_id, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_bid.id;
  end loop;

  update cards set owner_id = v_user, buyout_price_ccoin = null, status = 'sold',
    location = (case when p_destination = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id
  returning * into v_card;

  insert into ownership_history (id, card_id, owner_id, acquired_via)
  values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout');

  if p_destination = 'buyer_address' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
    values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout',
            (case when v_is_seed then 'platform'::shipment_from_location else 'seller'::shipment_from_location end),
            'buyer_address',
            jsonb_build_object('street', p_address), 'requested');
  end if;

  return v_card;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. release_seed_sale(p_card_id) — BARU. PHASE-2 SETTLEMENT seed.
--    Dipanggil HANYA oleh service_role (admin lewat API) — bukan aksi user.
--    Guard idempotent: status harus 'bid_pending' (transaksi seed sedang
--    berjalan) — setelah settle, status jadi 'sold', panggilan ulang ditolak
--    NO_PENDING_SALE. Gate: kartu fisik wajib platform_vault + NFC verified
--    (SEED_VAULT_IN_REQUIRED). Settle accepted-bid ATAU order pending:
--    seller 85% + royalti kreator 7,5% + platform 7,5% + ownership + shipment.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.release_seed_sale(p_card_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards;
  v_is_seed boolean;
  v_bid public.bids;
  v_order public.orders;
  v_seller uuid;
  v_price integer;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
  v_buyer uuid;
  v_dest public.shipment_to_dest;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  if v_card.status::text <> 'bid_pending' then
    raise exception 'NO_PENDING_SALE';
  end if;

  -- GATE PHASE-2: fisik wajib di vault + NFC verified (verified HANYA via
  -- tap crypto nfc.ts — admin tidak bisa memalsukan).
  if v_card.location <> 'platform_vault'::card_location
     or v_card.verify_status <> 'verified'::verify_status then
    raise exception 'SEED_VAULT_IN_REQUIRED';
  end if;

  -- ── Path A: accepted bid (owner accept -> PHASE-1) ─────────────────────
  select * into v_bid from bids where card_id = p_card_id and status = 'accepted'
  order by accepted_at desc nulls last limit 1;
  if found then
    v_seller := v_card.owner_id;
    v_price := v_bid.amount_ccoin;
    v_buyer := v_bid.bidder_id;
    v_dest := coalesce(v_bid.destination, 'buyer_address'::public.shipment_to_dest);

    v_platform_ccoin := round(v_price * 0.075);
    v_royalty_ccoin := round(v_price * 0.075);
    v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

    perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
    if v_royalty_ccoin >= 1 then
      perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
              'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
      v_royalty_credited := v_royalty_ccoin;
    end if;
    perform public.record_platform_revenue('secondary_bid', 'bid', v_bid.id, v_price,
            v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

    -- XP buyer: spend = amount
    update users set total_xp = total_xp + v_price,
      level = least(100, greatest(1, floor((total_xp + v_price) / 10) + 1))
    where id = v_buyer;

    update cards set owner_id = v_buyer, buyout_price_ccoin = null, status = 'sold',
      location = (case when v_dest = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
    where id = p_card_id;

    insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
    values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_bid', v_bid.id);

    if v_dest = 'buyer_address' then
      insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
      values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_bid', 'platform', 'buyer_address',
              jsonb_build_object('street', coalesce(v_bid.shipping_address, '')),
              'requested');
    end if;

    return;
  end if;

  -- ── Path B: order pending (buyout PHASE-1 — escrow 'held') ─────────────
  select * into v_order from orders
  where card_id = p_card_id and status = 'paid'::order_status
    and escrow_status = 'held'::escrow_status and source = 'secondary_buyout'
  order by created_at desc limit 1;
  if not found then
    raise exception 'NO_PENDING_SALE';
  end if;

  v_seller := v_card.owner_id;
  v_price := v_order.total_ccoin;
  v_buyer := v_order.user_id;
  v_dest := (case when v_order.delivery_option = 'vault' then 'platform_vault'::public.shipment_to_dest else 'buyer_address'::public.shipment_to_dest end);

  v_platform_ccoin := round(v_price * 0.075);
  v_royalty_ccoin := round(v_price * 0.075);
  v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

  perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'order', v_order.id, 'settle-' || v_order.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_buyout', 'order', v_order.id, v_price,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);
  -- XP buyer SUDAH diberikan saat PHASE-1 debit ('platform_buy') — konsisten
  -- dengan settle langsung buyout (wallet_debit menambah XP spend); TIDAK
  -- di-grant ulang di sini (hindari double-count).

  update orders set status = 'settled'::order_status, escrow_status = 'released'::escrow_status
  where id = v_order.id;

  update cards set owner_id = v_buyer, buyout_price_ccoin = null, status = 'sold',
    location = (case when v_dest = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
  values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_buyout', v_order.id);

  if v_dest = 'buyer_address' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
    values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_buyout', 'platform', 'buyer_address',
            jsonb_build_object('street', coalesce(v_order.shipping_address, '')),
            'requested');
  end if;

  return;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. place_bid — tambah guard SALE_IN_PROGRESS saat transaksi seed dua-fase
--    berjalan (card.status = 'bid_pending'). Logika lain UTUH.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.place_bid(
  p_card_id text,
  p_amount integer
) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_active public.bids;
  v_new public.bids;
  v_has_active boolean := false;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

  select * into v_active from bids where card_id = p_card_id and status = 'active' for update;
  v_has_active := found;
  if v_has_active and p_amount <= v_active.amount_ccoin then raise exception 'BID_TOO_LOW'; end if;

  perform public.wallet_debit(v_user, p_amount, 'escrow_hold', 'bid', p_card_id,
          'bid-' || v_user || '-' || p_card_id || '-' || gen_random_uuid()::text);

  -- Maks 3 bid aktif per user (dicek SETELAH lock wallet: serial per user).
  if (select count(*) from bids where bidder_id = v_user and status = 'active') >= 3 then
    raise exception 'BID_LIMIT';
  end if;

  if v_has_active then
    perform public.wallet_credit(v_active.bidder_id, v_active.amount_ccoin, 'escrow_release', 'bid', v_active.id,
            'release-' || v_active.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_active.id;
  end if;

  insert into bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status)
  values (gen_random_uuid()::text, p_card_id, v_user,
          coalesce((select display_name from users where id = v_user), 'Bidder'),
          p_amount, 'active')
  returning * into v_new;
  return v_new;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. set_buyout — tambah guard SALE_IN_PROGRESS saat transaksi seed dua-fase
--    berjalan (card.status = 'bid_pending'). Logika lain UTUH (MAX_BUYOUT +
--    status transitions).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.set_buyout(
  p_card_id text,
  p_price integer
) returns public.cards
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_active_count int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if p_price is not null and p_price < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_price is not null and coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

  if p_price is not null and v_card.buyout_price_ccoin is null then
    select count(*) into v_active_count from cards where owner_id = v_user and buyout_price_ccoin is not null;
    if v_active_count >= 20 then raise exception 'MAX_BUYOUT_ACTIVE'; end if;
  end if;

  update cards set buyout_price_ccoin = p_price,
    status = (case
      when p_price is null and status = 'listed_buyout'::card_status then 'sold'::card_status
      when p_price is not null and status in ('sold'::card_status, 'bound'::card_status) then 'listed_buyout'::card_status
      else status end)
  where id = p_card_id
  returning * into v_card;
  return v_card;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. EXECUTE grants (least-privilege, pola existing). Re-grant eksplisit
--    karena create or replace mengganti definisi:
--    - 4 fungsi user -> authenticated
--    - release_seed_sale -> service_role HANYA (admin via API; BUKAN aksi user)
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.accept_bid(text, public.shipment_to_dest, text) from public;
revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from public;
revoke execute on function public.place_bid(text, integer) from public;
revoke execute on function public.set_buyout(text, integer) from public;
revoke execute on function public.release_seed_sale(text) from public;

grant execute on function public.accept_bid(text, public.shipment_to_dest, text) to authenticated;
grant execute on function public.buyout_card(text, public.shipment_to_dest, text) to authenticated;
grant execute on function public.place_bid(text, integer) to authenticated;
grant execute on function public.set_buyout(text, integer) to authenticated;
grant execute on function public.release_seed_sale(text) to service_role;