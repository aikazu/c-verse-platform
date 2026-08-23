-- C.Verse — Atomic admin shipment fulfillment (refs audit finding: PATCH
-- /api/shipments/:id/status dulu menulis shipments + orders + cards secara
-- berurutan tanpa transaksi. Sekarang semua side-effects terjadi dalam satu
-- RPC SECURITY DEFINER. Mengikuti pola escrow_auto_release (cron side) dan
-- payout_refund (admin side). Dipanggil dari service_role (admin API route).

-- ══════════════════════════════════════════════════════════════════════════
-- 1. admin_fulfill_shipment(p_id, p_status, p_tracking)
--    Mekanikal move dari route langsung → RPC. Behavior IDENTIK dengan
--    PATCH lama:
--      - lock shipment row FOR UPDATE
--      - validasi transisi (mirror SHIPMENT_TRANSITIONS di route)
--      - update shipments (status + tracking_number jika ada)
--      - jika p_status='shipped' : set order terkait → 'shipped' (+ shipped_at)
--      - jika p_status='delivered' : set cards.location='with_owner'
--                                 + order terkait → 'delivered' (+ delivered_at)
--      - jika p_tracking diberikan : propagate ke order terkait (semua baris
--        orders yang terkait card_id — sesuai perilaku route saat ini)
--    orders.* difilter delivery_option='shipping' + status prereq
--    (paid saat shipped, shipped saat delivered) — sama dengan route.
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
-- 2. EXECUTE grants (least-privilege, paritas phase 5/7 + payout_refund).
--    Admin API route memanggil via service_role Supabase client.
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.admin_fulfill_shipment(text, text, text) from public;
grant execute on function public.admin_fulfill_shipment(text, text, text) to service_role;
