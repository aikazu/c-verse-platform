-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — SECURITY FIX (audit 2026-08-23)
-- Release/seed grant leak: an `authenticated` caller reached the body of
-- release_seed_sale (stopped only by SEED_VAULT_IN_REQUIRED, not by a
-- permission error). Bypassed admin route + admin_audit_log on vaulted
-- verified seed cards. Intent (migration 20260821020000_seed_two_phase.sql
-- L551-557 + docs/07_constraints.md C-17 + docs/03_flows.md Flow 10) =
-- release = service_role ONLY.
--
-- Root cause (most likely):
--   • `create or replace function ... release_seed_sale(text) returns void`
--     in 20260821020000 (L318) and 20260823020000 (L198) — same signature —
--     is idempotent on the FUNCTION but the GRANT chain (L551-557 di
--     20260821020000, L355-360 di 20260823020000) dapat ter-reset jika
--     migration apply di-cloud dengan mode partial / Supabase auto-revoke
--     post-replace (perubahan search_path = public atau reload schema).
--   • Tanpa `grant execute ... to service_role` aktif, function default ke
--     PUBLIC EXECUTE (PostgreSQL default), yang menjadikan `anon` &
--     `authenticated` (member PUBLIC) bisa EXECUTE — persis symptom yang
--     terlihat di seed_card_test T-SEED-2.
--
-- FIX (3 lapis, defense-in-depth):
--   1. EXPLICIT REVOKE/GRANT idempotent (re-issue untuk me-reset ke state
--      intent — service_role only). Mencakup release_seed_sale + sibling
--      service-only RPCs (admin_fulfill_shipment, payout_refund,
--      payout_batch_run) untuk hardening paritas.
--   2. IN-BODY GUARD: `if not public.is_service_role() then raise exception
--      'PERMISSION_DENIED'`. Pola guard sudah ada di trigger RLS (helper
--      is_service_role dari 20260817020000_rls_policies.sql L36-40) — di
--      pakai sebagai pagar kedua kalau EXECUTE grant bocor lagi.
--   3. release_seed_sale, admin_fulfill_shipment, payout_refund, dan
--      payout_batch_run masing-masing tambah guard — admin_fulfill_shipment
--      dan payout_refund belum punya guard, jadi ditambahkan di sini.
--
-- TIDAK mengubah: signature, body logic, audit log, settlement math,
-- record_platform_revenue, ownership_history, shipment. create or replace
-- semua idempotent (search_path = public, security definer).
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 1. release_seed_sale — re-issue grant + in-body PERMISSION_DENIED guard.
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
  -- SECURITY GUARD (audit 2026-08-23): service_role ONLY — panggil via admin
  -- API (rpcReleaseSeedSale di apps/api/src/lib/db.ts L133-135) di belakang
  -- requireAdmin + admin_audit_log. Pagar kedua seandainya EXECUTE grant
  -- bocor lagi ke authenticated/anon (defense-in-depth).
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

  -- XP buyer: PHASE-2 release (konsisten dengan invariant founder 2026-08-23).
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
-- 2. admin_fulfill_shipment — TIDAK punya in-body guard. Paritas audit.
--    Body byte-identik dengan 20260823010000 kecuali tambahan guard di awal.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_fulfill_shipment(
  p_id text,
  p_status text,
  p_tracking text default null
) returns public.shipments
language plpgsql security definer set search_path = public as $$
declare
  v_shipment public.shipments;
  v_allowed text[];
begin
  -- SECURITY GUARD (audit 2026-08-23): service_role ONLY.
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: admin_fulfill_shipment requires service_role';
  end if;

  if p_id is null or p_id = '' then
    raise exception 'INVALID_ARG';
  end if;
  if p_status is null or p_status not in ('requested','packed','shipped','delivered','cancelled') then
    raise exception 'INVALID_ARG: status % tidak dikenal', p_status;
  end if;

  -- Lock shipment row. Hilang → 404 di route (NOT_FOUND).
  select * into v_shipment from shipments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Mirror SHIPMENT_TRANSITIONS dari apps/api/src/routes/shipments.ts:
  --   requested: packed/shipped/cancelled
  --   packed:    shipped/cancelled
  --   shipped:   delivered
  --   delivered/cancelled: terminal
  v_allowed := case v_shipment.status
    when 'requested' then array['packed','shipped','cancelled']
    when 'packed'    then array['shipped','cancelled']
    when 'shipped'   then array['delivered']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'INVALID_TRANSITION: % -> %', v_shipment.status, p_status;
  end if;

  -- 1) Update shipment row (status selalu, tracking_number hanya jika diberi).
  update shipments
    set status = p_status,
        tracking_number = coalesce(p_tracking, tracking_number)
    where id = v_shipment.id
    returning * into v_shipment;

  -- 2) Side effects bercabang sesuai status.
  if p_status = 'shipped' then
    -- Order terkait (delivery_option='shipping' & status='paid') → shipped.
    update orders
      set status = 'shipped'::order_status,
          shipped_at = now()
      where card_id = v_shipment.card_id
        and delivery_option = 'shipping'::delivery_option
        and status = 'paid'::order_status;
  elsif p_status = 'delivered' then
    -- Kartu pindah ke with_owner (sama dengan route lama).
    update cards set location = 'with_owner' where id = v_shipment.card_id;
    -- Order terkait (delivery_option='shipping' & status='shipped') → delivered.
    update orders
      set status = 'delivered'::order_status,
          delivered_at = now()
      where card_id = v_shipment.card_id
        and delivery_option = 'shipping'::delivery_option
        and status = 'shipped'::order_status;
  end if;

  -- 3) Propagate tracking ke SEMUA baris orders terkait card (sesuai route).
  -- Route tidak memfilter status/delivery_option di sini — hanya card_id.
  if p_tracking is not null then
    update orders set tracking_number = p_tracking where card_id = v_shipment.card_id;
  end if;

  return v_shipment;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. payout_refund — TIDAK punya in-body guard. Paritas audit.
--    Body byte-identik dengan 20260823000000 kecuali tambahan guard di awal.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.payout_refund(p_payout_id text) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v_payout public.payouts;
begin
  -- SECURITY GUARD (audit 2026-08-23): service_role ONLY.
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: payout_refund requires service_role';
  end if;

  if p_payout_id is null or p_payout_id = '' then
    raise exception 'INVALID_ARG';
  end if;

  select * into v_payout from payouts where id = p_payout_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_payout.status in ('disbursed','refunded') then
    raise exception 'INVALID_STATE: payout status % tidak bisa di-refund', v_payout.status;
  end if;

  -- Return locked funds to creator wallet. wallet_credit is idempotent by
  -- p_idem — replay (admin retries, cron double-call) is safe.
  perform public.wallet_credit(
    v_payout.user_id,
    v_payout.ccoin_amount,
    'payout_refund',
    'payout',
    v_payout.id,
    'payout-refund-' || v_payout.id
  );

  update payouts set status = 'refunded' where id = v_payout.id returning * into v_payout;
  return v_payout;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. payout_batch_run — TIDAK punya in-body guard. Paritas audit.
--    Body byte-identik dengan 20260817040000 kecuali tambahan guard di awal.
--    Dipanggil cron Worker (Selasa 06:00 WIB) via service_role; tidak ada
--    path user yang menyentuh — tapi pagar kedua untuk hardening.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.payout_batch_run(p_min_ccoin integer default 10) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_batch_id text;
  v_count integer;
begin
  -- SECURITY GUARD (audit 2026-08-23): service_role ONLY (cron).
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: payout_batch_run requires service_role';
  end if;

  select count(*) into v_count
  from payouts p
  join users u on u.id = p.user_id
  join kyc_records k on k.user_id = p.user_id and k.status = 'approved'
  left join wallets w on w.user_id = p.user_id
  where p.status = 'pending'
    and p.batch_id is null
    and p.ccoin_amount >= p_min_ccoin
    and coalesce(w.hold_payout_until, now()) <= now();
  if v_count = 0 then
    return null;
  end if;

  insert into payout_batches (id, batch_code, status, total_ccoin, total_idr, fee_1pct_idr)
  values (
    gen_random_uuid()::text,
    'PB-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    'processing',
    0,
    0,
    0
  )
  returning id into v_batch_id;

  -- net_idr = (ccoin - ceil(ccoin x 0.01)) x 10.000 (100 C -> 99 C -> Rp 990.000)
  update payouts p
  set batch_id = v_batch_id,
      idr_amount = (p.ccoin_amount - ceil(p.ccoin_amount * 0.01)) * 10000
  where p.status = 'pending'
    and p.batch_id is null
    and p.ccoin_amount >= p_min_ccoin
    and p.user_id in (select user_id from kyc_records where status = 'approved')
    and not exists (
      select 1 from wallets w
      where w.user_id = p.user_id and w.hold_payout_until > now()
    );

  update payout_batches b
  set total_ccoin = s.gross_ccoin,
      total_idr = s.net_idr,
      fee_idr = s.fee_idr
  from (
    select
      coalesce(sum(ccoin_amount), 0) as gross_ccoin,
      coalesce(sum(idr_amount), 0) as net_idr,
      coalesce(sum(ceil(ccoin_amount * 0.01)) * 10000, 0) as fee_idr
    from payouts where batch_id = v_batch_id
  ) s
  where b.id = v_batch_id;

  return v_batch_id;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. GRANTS — explicit REVOKE/GRANT idempotent (re-issue untuk hardening).
--    release_seed_sale, admin_fulfill_shipment, payout_refund, payout_batch_run
--    semuanya service_role ONLY. revoke from public menutup default EXECUTE
--    yang granted ke PUBLIC (juga mencakup anon & authenticated sebagai
--    member PUBLIC) — anti-regresi jika migration di-apply ulang.
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.release_seed_sale(text) from public;
revoke execute on function public.release_seed_sale(text) from anon;
revoke execute on function public.release_seed_sale(text) from authenticated;
grant execute on function public.release_seed_sale(text) to service_role;

revoke execute on function public.admin_fulfill_shipment(text, text, text) from public;
revoke execute on function public.admin_fulfill_shipment(text, text, text) from anon;
revoke execute on function public.admin_fulfill_shipment(text, text, text) from authenticated;
grant execute on function public.admin_fulfill_shipment(text, text, text) to service_role;

revoke execute on function public.payout_refund(text) from public;
revoke execute on function public.payout_refund(text) from anon;
revoke execute on function public.payout_refund(text) from authenticated;
grant execute on function public.payout_refund(text) to service_role;

revoke execute on function public.payout_batch_run(integer) from public;
revoke execute on function public.payout_batch_run(integer) from anon;
revoke execute on function public.payout_batch_run(integer) from authenticated;
grant execute on function public.payout_batch_run(integer) to service_role;