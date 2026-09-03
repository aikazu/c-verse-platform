-- 09: RPC pembelian (checkout, vault_shipout, drop_entry) + activate_scheduled_drops (part of consolidated RPC set; apply in lexical order).
drop function if exists public.checkout(text, text, public.delivery_option, text, integer);
drop function if exists public.checkout(text);
create or replace function public.checkout(
  p_drop_id text,
  p_pool text default 'regular'
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_drop public.drops;
  v_card public.cards;
  v_price integer;
  v_order public.orders;
  v_creator_share integer;
  v_royalty_credited integer := 0;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_drop from drops where id = p_drop_id for update;
  if not found then raise exception 'DROP_NOT_LIVE'; end if;
  if v_drop.status = 'sold_out'::drop_status or v_drop.sold_count >= v_drop.total_units then
    raise exception 'SOLD_OUT';
  end if;
  if v_drop.status <> 'live'::drop_status
     or not (v_drop.drop_start_at <= now() and (v_drop.drop_end_at is null or v_drop.drop_end_at > now()))
     or not (v_drop.raffle_end_at is null or v_drop.drawn_at is not null) then
    raise exception 'DROP_NOT_LIVE';
  end if;

  if exists (select 1 from orders o where o.user_id = v_user and o.drop_id = p_drop_id and o.status <> 'refunded'::order_status)
     or exists (select 1 from drop_entries e where e.drop_id = p_drop_id and e.user_id = v_user and e.status like 'won%') then
    raise exception 'LIMIT_1_PER_DROP';
  end if;

  if p_pool not in ('regular','premium') then raise exception 'INVALID_POOL'; end if;

  select * into v_card from cards
  where drop_id = p_drop_id and owner_id is null
    and coalesce(status::text, '') <> 'defect'
    and variant = (case when p_pool = 'premium' then 'signed'::card_variant else 'unsigned'::card_variant end)
  order by random() limit 1
  for update skip locked;
  if not found then raise exception 'SOLD_OUT'; end if;

  v_price := case when v_card.variant = 'signed'::card_variant
             then coalesce(v_drop.price_signed_ccoin, v_drop.price_ccoin, v_drop.price_unsigned_ccoin)
             else coalesce(v_drop.price_ccoin, v_drop.price_unsigned_ccoin) end;

  perform public.wallet_debit(v_user, v_price, 'checkout', 'drop', p_drop_id,
          'checkout-' || v_user || '-' || p_drop_id);

  update cards set owner_id = v_user,
    status = 'bound',
    location = 'platform_vault'::card_location
  where id = v_card.id;

  update drops set sold_count = sold_count + 1,
    status = (case when sold_count + 1 >= total_units then 'sold_out'::drop_status else status end)
  where id = p_drop_id;

  insert into orders (id, user_id, drop_id, card_id, total_ccoin, total_idr, status,
                      delivery_option, shipping_fee_ccoin, escrow_status, shipping_address, source)
  values (gen_random_uuid()::text, v_user, p_drop_id, v_card.id, v_price, v_price * 10000,
          'settled'::order_status, 'vault'::delivery_option, null,
          'released'::escrow_status, null, 'fcfs')
  returning * into v_order;

  insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
  values (gen_random_uuid()::text, v_card.id, v_user, 'primary', v_order.id);

  -- Revenue share platform-produced 70/30 -> creator (GEMS, dual-token
  -- 2026-09-03: penghasilan settlement user = gems, lot 24h) + ledger platform
  v_creator_share := floor(v_price * 0.3);
  if v_creator_share >= 1 and v_drop.creator_id is distinct from v_user then
    perform public.wallet_credit_gems(v_drop.creator_id, v_creator_share, 'royalty', 'order', v_order.id,
            'royalty-' || v_order.id);
    v_royalty_credited := v_creator_share;
  end if;
  perform public.record_platform_revenue('primary', 'order', v_order.id, v_price,
          v_price - v_royalty_credited, v_royalty_credited, 0);

  return v_order;
end $$;

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
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_address is null or length(trim(p_address)) < 10 then raise exception 'ADDRESS_REQUIRED'; end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
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
  update cards set qc_status = 'passed' where id = p_card_id;

  return v_shipment;
end $$;

create or replace function public.drop_entry(
  p_drop_id text,
  p_pool text
) returns public.drop_entries
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_drop public.drops;
  v_hold integer;
  v_entry public.drop_entries;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_pool not in ('regular','premium','both') then raise exception 'INVALID_POOL'; end if;

  select * into v_drop from drops
  where id = p_drop_id and status = 'live'
    and raffle_end_at is not null and drawn_at is null and raffle_end_at > now()
  for update;
  if not found then raise exception 'ENTRY_CLOSED'; end if;

  if exists (select 1 from orders o where o.user_id = v_user and o.drop_id = p_drop_id and o.status <> 'refunded'::order_status)
     or exists (select 1 from drop_entries e where e.drop_id = p_drop_id and e.user_id = v_user) then
    raise exception 'ENTRY_EXISTS';
  end if;

  -- hold: regular = harga unsigned, premium/both = harga signed (max)
  v_hold := case when p_pool = 'regular'
             then coalesce(v_drop.price_ccoin, v_drop.price_unsigned_ccoin)
             else coalesce(v_drop.price_signed_ccoin, v_drop.price_ccoin, v_drop.price_unsigned_ccoin) end;

  -- TIDAK menambah XP: hold bukan spend nyata (konversi saat draw)
  perform public.wallet_debit(v_user, v_hold, 'escrow_hold', 'drop', p_drop_id,
          'entry-' || v_user || '-' || p_drop_id);

  insert into drop_entries (id, drop_id, user_id, pool, hold_ccoin, status)
  values (gen_random_uuid()::text, p_drop_id, v_user, p_pool, v_hold, 'held')
  returning * into v_entry;

  return v_entry;
exception when unique_violation then
  raise exception 'ENTRY_EXISTS';
end $$;

create or replace function public.activate_scheduled_drops() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update drops set status = 'live'::drop_status
  where status in ('scheduled','published') and drop_start_at is not null and drop_start_at <= now()
    and (drop_end_at is null or drop_end_at > now());
  get diagnostics n = row_count;
  update drops set status = 'closed'::drop_status
  where status = 'live' and drop_end_at is not null and drop_end_at <= now();
  return n;
end $$;
