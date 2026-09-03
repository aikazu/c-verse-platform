-- 13: RPC payouts + admin shipment (send_support, payout_request, payout_batch_run, payout_refund, admin_fulfill_shipment) (part of consolidated RPC set; apply in lexical order).
create or replace function public.send_support(
  p_creator uuid,
  p_amount integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_debit_tx public.wallet_transactions;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_creator = v_user then raise exception 'SELF_SUPPORT'; end if;
  if not exists (select 1 from users where id = p_creator and role = 'creator' and flag_reason is null) then
    raise exception 'CREATOR_NOT_FOUND';
  end if;
  -- Lane D (2026-08-31): creators.status wajib 'active' — baris users bisa
  -- lolos (role creator, flag null) sementara page kreator sudah di-suspend.
  if not exists (select 1 from creators where user_id = p_creator and status = 'active') then
    raise exception 'CREATOR_NOT_ACTIVE';
  end if;

  v_debit_tx := public.wallet_debit(v_user, p_amount, 'support', 'user', p_creator::text,
          'support-debit-' || gen_random_uuid()::text);
  -- Dual-token 2026-09-03: dukungan yang DITERIMA kreator = gems (lot 24h);
  -- sender debit + XP C-Coin tidak berubah.
  perform public.wallet_credit_gems(p_creator, p_amount, 'support', 'user', v_user::text,
          'support-credit-' || gen_random_uuid()::text);

  return jsonb_build_object(
    'transactionId', v_debit_tx.id,
    'balanceCcoin', v_debit_tx.balance_after_ccoin
  );
end $$;

create or replace function public.payout_request(p_amount integer) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.wallets;
  v_payout public.payouts;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_amount is null or p_amount < 10 then raise exception 'MIN_PAYOUT'; end if;
  if not exists (select 1 from kyc_records k where k.user_id = v_user and k.status = 'approved') then
    raise exception 'KYC_REQUIRED';
  end if;

  select * into v_wallet from wallets where user_id = v_user for update;
  if v_wallet.hold_payout_until is not null and v_wallet.hold_payout_until > now() then
    raise exception 'PAYOUT_HELD';
  end if;

  -- Dana dikunci (debit GEMS matured saja) sampai batch disbursed; gagal batch
  -- -> payout_refund kredit balik gems sebagai lot langsung matured.
  perform public.wallet_debit_gems(v_user, p_amount, 'payout', 'payout_request', null,
          'payout-req-' || v_user || '-' || gen_random_uuid()::text, true);

  -- idr_amount diisi payout_batch_run (net setelah fee 1%); 0 = placeholder.
  insert into payouts (id, user_id, type, ccoin_amount, idr_amount, status, requested_at)
  values (gen_random_uuid()::text, v_user, 'seller_proceeds', p_amount, 0, 'pending', now())
  returning * into v_payout;
  return v_payout;
end $$;

create or replace function public.payout_batch_run(p_min_ccoin integer default 10) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_batch_id text;
  v_count integer;
begin
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
      fee_1pct_idr = s.fee_idr
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

create or replace function public.payout_refund(p_payout_id text) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v_payout public.payouts;
begin
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

  -- Dual-token 2026-09-03: refund payout kredit balik GEMS sebagai lot yang
  -- LANGSUNG matured (p_matured=true) — dana bisa langsung di-payout ulang.
  perform public.wallet_credit_gems(
    v_payout.user_id,
    v_payout.ccoin_amount,
    'payout_refund',
    'payout',
    v_payout.id,
    'payout-refund-' || v_payout.id,
    true
  );

  update payouts set status = 'refunded' where id = v_payout.id returning * into v_payout;
  return v_payout;
end $$;

create or replace function public.admin_fulfill_shipment(
  p_id text,
  p_status text,
  p_tracking text default null
) returns public.shipments
language plpgsql security definer set search_path = public as $$
declare
  v_shipment public.shipments;
  v_tracking text := nullif(btrim(coalesce(p_tracking, '')), '');
  v_allowed text[];
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: admin_fulfill_shipment requires service_role';
  end if;

  if p_id is null or p_id = '' then
    raise exception 'INVALID_ARG';
  end if;
  if p_status is null or p_status not in ('requested','packed','shipped','delivered','cancelled') then
    raise exception 'INVALID_ARG: status % tidak dikenal', p_status;
  end if;

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

  -- 1) Update shipment row (status selalu, tracking_number hanya jika non-empty).
  update shipments
    set status = p_status::shipment_status,
        tracking_number = coalesce(v_tracking, tracking_number)
    where id = v_shipment.id
    returning * into v_shipment;

  -- 2) Side effects bercabang sesuai status.
  if p_status = 'shipped' then
    update orders
      set status = 'shipped'::order_status,
          shipped_at = now()
      where card_id = v_shipment.card_id
        and delivery_option = 'shipping'::delivery_option
        and status = 'paid'::order_status;
  elsif p_status = 'delivered' then
    update cards set location = 'with_owner' where id = v_shipment.card_id;
    update orders
      set status = 'delivered'::order_status,
          delivered_at = now()
      where card_id = v_shipment.card_id
        and delivery_option = 'shipping'::delivery_option
        and status = 'shipped'::order_status;
  end if;

  -- 3) Propagate tracking ke SEMUA baris orders terkait card.
  if v_tracking is not null then
    update orders set tracking_number = v_tracking where card_id = v_shipment.card_id;
  end if;

  return v_shipment;
end $$;
