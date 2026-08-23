-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — Founder decision 2026-08-23: UNIFY SEED BUYER XP AT RELEASE
-- (menggantikan PHASE-1 grant buyout via trigger wallet_debit)
--
-- LATAR BELAKANG (audit):
--   Sebelum fix ini ada INKONSISTENSI XP buyer pada Creator Seed
--   C.Card two-phase (migration 20260821020000_seed_two_phase):
--     * BUYOUT PHASE-1: debit buyer via wallet_debit dengan
--       p_type='platform_buy' -> trigger wallet_debit di
--       20260817030000_rpc_atomic.sql L51-55 OTOMATIS grant XP
--       (1 C-Coin spend = 1 XP). XP tercatat INSTAN saat
--       PHASE-1 LOCK (bisa HARIAN sebelum release).
--     * ACCEPT_BID PHASE-1: TIDAK ADA debit buyer (bid sudah
--       di-escrow dari place_bid dengan type='escrow_hold' yang
--       TIDAK grant XP per komentar 'hold & payout bukan spend
--       XP' di 20260817030000_rpc_atomic.sql L50). XP buyer
--       di-grant MANUAL di release_seed_sale Path A
--       (~L373-376) saat admin release -> terjadi SETELAH
--       vault-in + NFC verified (bisa HARIAN setelah PHASE-1).
--
--   INVARIANT BARU (keputusan founder 2026-08-23): buyer XP
--   granted TEPAT SEKALI, pada PHASE-2 RELEASE, untuk KEDUA
--   path (buyout DAN accept_bid). XP merefleksikan 'uang benar-
--   benar keluar dari escrow ke settled' (bukan saat escrow
--   terbentuk). Konsisten dengan aturan hold/payout bukan spend
--   (20260817030000_rpc_atomic.sql L50).
--
-- PERUBAHAN:
--   A. buyout_card PHASE-1: wallet_debit p_type 'platform_buy' ->
--      'escrow_hold' — supaya TIDAK grant XP via trigger.
--      Saldo buyer MASIH turun (escrow 'held' di orders), tapi
--      tidak dikategorikan 'spend' sampai release.
--   B. release_seed_sale Path A (accepted-bid): manual XP grant
--      SUDAH ADA (L373-376 di 20260821020000_seed_two_phase.sql)
--      — DIPERTAHANKAN byte-for-byte (sudah benar).
--   C. release_seed_sale Path B (order pending buyout PHASE-1):
--      TAMBAH manual XP grant untuk buyer (sebelumnya gratis
--      karena PHASE-1 trigger). Catatan TIDAK double-count di
--      Path B di-blok TEPAT dengan mekanisme trigger sekarang
--      yang sudah kita matikan via Perubahan A.
--   D. Trigger AFTER UPDATE OF status ON cards: kartu yang
--      jadi non-tradable (tampered/defect/lost) -> auto-unlist
--      (buyout_price_ccoin = NULL). Mencegah listing stays
--      live setelah status berubah.
--
-- TIDAK mengubah: settlement 85/7,5/7,5, record_platform_revenue,
-- royalty, ownership_history, shipment (byte-for-byte utuh).
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 1. buyout_card — PHASE-1 LOCK: ganti debit type 'platform_buy' ->
--    'escrow_hold' supaya TIDAK grant XP via trigger wallet_debit
--    (sesuai invariant baru: XP granted sekali di PHASE-2 release).
--    Saldo buyer TETAP turun, order TETAP 'paid'/'held' (settlement
--    identik dengan versi sebelumnya).
-- ══════════════════════════════════════════════════════════════════════════
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
  -- C-13 EXTENSION untuk seed card (Flow 10, keputusan 2026-08-20)
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
    -- BUKAN 'platform_buy' (invarian founder 2026-08-23): PHASE-1 buyout seed
    -- = escrow hold, TIDAK grant XP. Saldo buyer tetap turun (orders.escrow_status='held'),
    -- wallet_transactions.type='escrow_hold' (sesuai semantics place_bid).
    v_debit_tx := public.wallet_debit(v_user, v_price, 'escrow_hold', 'card', p_card_id,
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

  -- ── SETTLE LANGSUNG (seed vaulted / non-seed) — body utuh (20260821020000) ─
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
-- 2. release_seed_sale — Path B: TAMBAH manual XP grant buyer (sebelumnya
--    gratis via trigger PHASE-1, sekarang dimatikan di Perubahan A).
--    Path A manual XP grant TETAP (sudah benar sejak 20260821020000).
--    Settlement 85/7,5/7,5, royalty, record_platform_revenue, ownership,
--    shipment: byte-for-byte utuh.
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

    -- XP buyer: spend = amount (PHASE-2 release — konsisten dengan invariant
    -- founder 2026-08-23: XP granted sekali di release untuk kedua path).
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

  -- XP buyer: PHASE-2 release (sebelumnya gratis via trigger PHASE-1
  -- wallet_debit 'platform_buy' di buyout_card; sekarang dimatikan via
  -- Perubahan A di file ini — tanpa grant manual di sini buyer TIDAK
  -- dapat XP, melanggar invariant founder 2026-08-23).
  update users set total_xp = total_xp + v_price,
    level = least(100, greatest(1, floor((total_xp + v_price) / 10) + 1))
  where id = v_buyer;

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
-- 3. AUTO-UNLIST non-tradable cards (Task B, keputusan 2026-08-23).
--    Ketika card.status -> 'tampered'/'defect'/'lost', trigger AFTER UPDATE
--    OF status akan clear buyout_price_ccoin (NULL). Listings dibuat lewat
--    kartu buyout_price_ccoin NOT NULL — jadi auto-unlist. Active bid
--    TIDAK disentuh (accept_bid sudah gate CARD_NOT_TRADABLE).
--    Daftar non-tradable disinkronkan dengan check gate CARD_NOT_TRADABLE
--    di accept_bid/buyout_card/place_bid/set_buyout (audit 2026-08-23).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.unlist_card_if_non_tradable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('tampered','defect','lost')
     and new.buyout_price_ccoin is not null then
    new.buyout_price_ccoin := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_unlist_non_tradable on public.cards;
create trigger trg_unlist_non_tradable
  before update of status on public.cards
  for each row execute function public.unlist_card_if_non_tradable();

-- Grants re-eksplisit karena create or replace mengganti definisi
-- (least-privilege, pola 20260821020000_seed_two_phase.sql L547-557).
revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from public;
revoke execute on function public.release_seed_sale(text) from public;
grant execute on function public.buyout_card(text, public.shipment_to_dest, text) to authenticated;
grant execute on function public.release_seed_sale(text) to service_role;
