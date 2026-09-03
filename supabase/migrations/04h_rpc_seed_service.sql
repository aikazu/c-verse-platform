-- 04h: RPC seed sale service (release_seed_sale, cancel_seed_sale) (part of consolidated RPC set; apply in lexical order).
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
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: release_seed_sale requires service_role';
  end if;

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

    -- Guard MIN_SECONDARY_PRICE_CCOIN (defense-in-depth; seed price = drop price).
    if v_price < 3 then raise exception 'SECONDARY_PRICE_TOO_SMALL'; end if;

    -- Lane D (2026-08-31): split CEIL (lihat accept_bid) — seller remainder.
    v_platform_ccoin := ceil(v_price * 0.075);
    v_royalty_ccoin := ceil(v_price * 0.075);
    v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

    perform public.wallet_credit_gems(v_seller, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
    if v_royalty_ccoin >= 1 then
      perform public.wallet_credit_gems((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
              'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
      v_royalty_credited := v_royalty_ccoin;
    end if;
    perform public.record_platform_revenue('secondary_bid', 'bid', v_bid.id, v_price,
            v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

    -- XP buyer: spend = amount (PHASE-2 release — invariant founder 2026-08-23).
    update users set total_xp = total_xp + v_price,
      cumulative_spend_ccoin = cumulative_spend_ccoin + v_price,
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

  -- Guard MIN_SECONDARY_PRICE_CCOIN (paritas Path A; seed price = drop price).
  if v_price < 3 then raise exception 'SECONDARY_PRICE_TOO_SMALL'; end if;

  -- Lane D (2026-08-31): split CEIL (lihat accept_bid) — seller remainder.
  v_platform_ccoin := ceil(v_price * 0.075);
  v_royalty_ccoin := ceil(v_price * 0.075);
  v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

  perform public.wallet_credit_gems(v_seller, v_seller_ccoin, 'settlement', 'order', v_order.id, 'settle-' || v_order.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit_gems((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_buyout', 'order', v_order.id, v_price,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- XP buyer: PHASE-2 release (invariant founder 2026-08-23).
  update users set total_xp = total_xp + v_price,
    cumulative_spend_ccoin = cumulative_spend_ccoin + v_price,
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

create or replace function public.cancel_seed_sale(p_card_id text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards;
  v_is_seed boolean;
  v_bid public.bids;
  v_order public.orders;
  v_buyer uuid;
  v_refund_amount integer;
  v_path text;
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: cancel_seed_sale requires service_role';
  end if;

  -- Idempotent: kalau sudah pernah refund (idempotency_key tercatat),
  -- return ringkasan tanpa double-credit.
  if exists (
    select 1 from wallet_transactions
    where metadata->>'idempotency_key' = 'seed-abort-' || p_card_id
  ) then
    select c.user_id, c.amount_ccoin into v_buyer, v_refund_amount
      from wallet_transactions c
      where c.metadata->>'idempotency_key' = 'seed-abort-' || p_card_id
      limit 1;
    return json_build_object(
      'cardId', p_card_id,
      'refundedCcoin', v_refund_amount,
      'buyerId', v_buyer,
      'path', coalesce(v_path, 'unknown'),
      'alreadyAborted', true
    );
  end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  if v_card.status::text <> 'bid_pending' then
    raise exception 'NO_PENDING_SALE';
  end if;

  -- ── Path A: accepted bid ────────────────────────────────────────────────
  select * into v_bid from bids where card_id = p_card_id and status = 'accepted'
  order by accepted_at desc nulls last limit 1;
  if found then
    v_buyer := v_bid.bidder_id;
    v_refund_amount := v_bid.amount_ccoin;
    v_path := 'bid';

    perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'bid', v_bid.id,
            'seed-abort-' || p_card_id);

    update bids set status = 'cancelled', cancelled_at = now() where id = v_bid.id;

    update cards set status = 'inventory'::card_status where id = p_card_id;

    return json_build_object(
      'cardId', p_card_id,
      'refundedCcoin', v_refund_amount,
      'buyerId', v_buyer,
      'path', v_path
    );
  end if;

  -- ── Path B: order pending ─────────────────────────────────────────────
  select * into v_order from orders
  where card_id = p_card_id and status = 'paid'::order_status
    and escrow_status = 'held'::escrow_status and source = 'secondary_buyout'
  order by created_at desc limit 1;
  if not found then
    raise exception 'NO_PENDING_SALE';
  end if;

  v_buyer := v_order.user_id;
  v_refund_amount := v_order.total_ccoin;
  v_path := 'buyout';

  perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'order', v_order.id,
          'seed-abort-' || p_card_id);

  update orders set status = 'refunded'::order_status where id = v_order.id;
  update cards set status = 'inventory'::card_status where id = p_card_id;

  return json_build_object(
    'cardId', p_card_id,
    'refundedCcoin', v_refund_amount,
    'buyerId', v_buyer,
    'path', v_path
  );
end $$;
