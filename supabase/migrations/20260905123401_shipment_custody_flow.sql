-- Complete the return-to-vault journey without changing settlement, QC or order history.
create or replace function public.vault_shipout(
  p_card_id text,
  p_address text
) returns public.shipments
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_is_seed boolean := false;
  v_shipment public.shipments;
  v_shipment_id text := gen_random_uuid()::text;
  -- pin: SHIPMENT_FEE_CCOIN (packages/shared/src/index.ts) — wajib sama nilai
  v_fee_ccoin constant integer := 2;
begin
  perform public.assert_active_actor();
  if p_address is null or length(trim(p_address)) < 10 then raise exception 'ADDRESS_REQUIRED'; end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
  if v_card.location <> 'platform_vault'::card_location then raise exception 'CARD_NOT_IN_VAULT'; end if;

  -- kartu tidak boleh dalam seed PHASE-1 pending (escrow hold / bid_pending)
  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if coalesce(v_is_seed, false) and v_card.status = 'bid_pending'::card_status then
    raise exception 'SEED_SALE_IN_PROGRESS';
  end if;

  -- anti double-ship: cek eksplisit sebelum insert; terminal (delivered/
  -- cancelled) dikecualikan agar kartu bisa di-ship ulang (paritas index).
  if exists (
    select 1 from shipments
    where card_id = p_card_id
      and status not in ('delivered'::shipment_status, 'cancelled'::shipment_status)
  ) then
    raise exception 'SHIPMENT_ACTIVE';
  end if;

  -- 1) debit ship fee (idem unik per attempt; replay diblok guard SHIPMENT_ACTIVE;
  --    bukan spend XP — type 'vault_shipout' di luar daftar XP wallet_debit)
  perform public.wallet_debit(v_user, v_fee_ccoin, 'vault_shipout', 'card', p_card_id,
          'shipout-' || v_user || '-' || p_card_id || '-' || v_shipment_id);

  -- 2) ledger: ship fee = pendapatan platform penuh -> treasury + platform_revenue
  perform public.record_platform_revenue('shipment', 'shipment', v_shipment_id, v_fee_ccoin,
          v_fee_ccoin, 0, 0);

  -- 3) shipment queue admin (fulfil via admin_fulfill_shipment)
  insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, fee_ccoin, status)
  values (v_shipment_id, p_card_id, v_user, 'vault_shipout', 'platform', 'buyer_address',
          jsonb_build_object('street', p_address), v_fee_ccoin, 'requested')
  returning * into v_shipment;

  -- 4) parity jalur ship-out lama: kartu keluar QC → layak kirim (display admin)
  -- A shipment request is not a QC check. Remove stale buyout advertising.
  update cards set buyout_price_ccoin = null,
    status = case when status='listed_buyout' then 'sold'::card_status else status end
  where id = p_card_id;

  return v_shipment;
end $$;

create or replace function public.admin_fulfill_shipment(p_id text, p_status text, p_tracking text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare
  v_shipment public.shipments;
  v_card public.cards;
  v_allowed text[];
begin
  if not public.is_service_role() then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_shipment from shipments where id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Card first is the same lock order as trading and ship-out.
  select * into v_card from cards where id=v_shipment.card_id for update;
  select * into v_shipment from shipments where id=p_id for update;
  v_allowed := case v_shipment.status
    when 'requested' then array['packed','shipped','cancelled']
    when 'packed' then array['shipped','cancelled']
    when 'shipped' then array['delivered'] else array[]::text[] end;
  if p_status is null or not (p_status=any(v_allowed)) then raise exception 'INVALID_TRANSITION'; end if;
  if v_card.owner_id is distinct from v_shipment.requester_id then raise exception 'FORBIDDEN'; end if;
  update shipments set status=p_status::shipment_status,
    tracking_number=coalesce(nullif(btrim(p_tracking),''), tracking_number)
    where id=p_id returning * into v_shipment;
  if p_status='delivered' then
    update cards set location=case when v_shipment.to_dest='platform_vault'
      then 'platform_vault'::card_location else 'with_owner'::card_location end
    where id=v_card.id;
  end if;
  -- Orders are already settled. Tracking belongs to this shipment only.
  return v_shipment;
end $$;

create or replace function public.seller_to_vault(p_card_id text, p_address text, p_tracking text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_shipment public.shipments;
begin
  perform public.assert_active_actor();
  if p_address is null or length(btrim(p_address))<10 or length(p_address)>500 then raise exception 'ADDRESS_REQUIRED'; end if;
  select * into v_card from cards where id=p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
  if v_card.location<>'with_owner' then raise exception 'INVALID_TRANSITION'; end if;
  if v_card.status in ('tampered','defect','lost') then raise exception 'CARD_NOT_TRADABLE'; end if;
  -- Pending seed sales need this route to satisfy the physical vault-in gate.
  if v_card.status='bid_pending' and not exists (select 1 from drops where id=v_card.drop_id and is_seed)
    then raise exception 'SALE_IN_PROGRESS'; end if;
  if exists (select 1 from shipments where card_id = p_card_id
    and status not in ('delivered','cancelled')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  update cards set buyout_price_ccoin=null,
    status=case when status='listed_buyout' then 'sold'::card_status else status end where id=p_card_id;
  insert into shipments (id,card_id,requester_id,type,from_location,to_dest,address,fee_ccoin,status,tracking_number)
    values (gen_random_uuid()::text,p_card_id,v_user,'secondary_seller_to_vault','with_owner','platform_vault',
      jsonb_build_object('street',p_address),0,'requested',nullif(btrim(p_tracking),'')) returning * into v_shipment;
  return v_shipment;
end $$;
revoke all on function public.seller_to_vault(text,text,text) from public,anon,authenticated;
grant execute on function public.seller_to_vault(text,text,text) to authenticated,service_role;

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
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: release_seed_sale requires service_role';
  end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  if exists (select 1 from shipments where card_id = p_card_id
    and status not in ('delivered','cancelled')) then raise exception 'SHIPMENT_ACTIVE'; end if;
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
  select * into v_bid from bids b where card_id = p_card_id and status = 'accepted'
    and not exists (select 1 from ownership_history h where h.bid_id=b.id)
  order by accepted_at desc nulls last limit 1;
  if found then
    v_seller := v_card.owner_id;
    v_price := v_bid.amount_ccoin;
    v_buyer := v_bid.bidder_id;


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
      location = 'platform_vault'::card_location
    where id = p_card_id;

    insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
    values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_bid', v_bid.id);

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

  update orders set status = 'settled'::order_status, escrow_status = 'released'::escrow_status,
    delivery_option = 'vault', shipping_address = null
  where id = v_order.id;

  update cards set owner_id = v_buyer, buyout_price_ccoin = null, status = 'sold',
    location = 'platform_vault'::card_location
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
  values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_buyout', v_order.id);

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

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  if v_card.status::text <> 'bid_pending' then
    -- Retry the last abort only after locking and checking for a NEW pending sale.
    select t.user_id,t.amount_ccoin into v_buyer,v_refund_amount
    from wallet_transactions t where t.type='seed_abort' and (
      t.metadata->>'idempotency_key'='seed-abort-' || p_card_id
      or exists (select 1 from bids b where b.id=t.ref_id and b.card_id=p_card_id and t.ref_type='bid')
      or exists (select 1 from orders o where o.id=t.ref_id and o.card_id=p_card_id and t.ref_type='order'))
    order by t.created_at desc limit 1;
    if found then
      return json_build_object('cardId',p_card_id,'refundedCcoin',v_refund_amount,
        'buyerId',v_buyer,'path','previous','alreadyAborted',true);
    end if;
    raise exception 'NO_PENDING_SALE';
  end if;

  -- ── Path A: accepted bid ────────────────────────────────────────────────
  select * into v_bid from bids b where card_id = p_card_id and status = 'accepted'
    and not exists (select 1 from ownership_history h where h.bid_id=b.id)
  order by accepted_at desc nulls last limit 1;
  if found then
    v_buyer := v_bid.bidder_id;
    v_refund_amount := v_bid.amount_ccoin;
    v_path := 'bid';

    perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'bid', v_bid.id,
            'seed-abort-bid-' || v_bid.id);

    update bids set status = 'cancelled', cancelled_at = now() where id = v_bid.id;

    update cards set status = 'bound'::card_status, buyout_price_ccoin = null where id = p_card_id;

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
          'seed-abort-order-' || v_order.id);

  update orders set status = 'refunded'::order_status, escrow_status = 'released'::escrow_status where id = v_order.id;
  update cards set status = 'bound'::card_status, buyout_price_ccoin = null where id = p_card_id;

  return json_build_object(
    'cardId', p_card_id,
    'refundedCcoin', v_refund_amount,
    'buyerId', v_buyer,
    'path', v_path
  );
end $$;
