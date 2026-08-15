-- ── fix checkout gate order (docs/13 §2.3 acceptance): 50 concurrent checkout
-- ke drop sisa 1 unit harus 49x SOLD_OUT, bukan DROP_NOT_LIVE. Sebelumnya gate
-- SELECT memfilter status='live' — begitu pemenang terakhir mengubah status ke
-- 'sold_out', panggilan yang kalah serialisasi row lock jatuh ke DROP_NOT_LIVE.
-- Perbaikan: lock row drop dulu, naikkan SOLD_OUT sebelum cek live.

create or replace function public.checkout(
  p_drop_id text,
  p_pool text,                 -- 'regular' | 'premium'
  p_delivery public.delivery_option default 'vault',
  p_address text default null,
  p_shipping_fee integer default null
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_drop public.drops;
  v_card public.cards;
  v_price integer;
  v_total integer;
  v_order public.orders;
  v_creator_share integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Gate: lock drop row dulu; sold_out/habis dicek SEBELUM cek live (docs/13 §2.3)
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

  -- Limit 1 kartu/user/drop
  if exists (select 1 from orders o where o.user_id = v_user and o.drop_id = p_drop_id and o.status <> 'refunded'::order_status)
     or exists (select 1 from drop_entries e where e.drop_id = p_drop_id and e.user_id = v_user and e.status like 'won%') then
    raise exception 'LIMIT_1_PER_DROP';
  end if;

  if p_pool not in ('regular','premium') then raise exception 'INVALID_POOL'; end if;
  if p_delivery = 'shipping' and (p_address is null or length(trim(p_address)) < 10) then raise exception 'ADDRESS_REQUIRED'; end if;
  if p_delivery = 'shipping' and (p_shipping_fee is null or p_shipping_fee < 1) then raise exception 'SHIPPING_FEE_REQUIRED'; end if;

  -- Pilih kartu random dari pool (premium = signed)
  select * into v_card from cards
  where drop_id = p_drop_id and owner_id is null
    and coalesce(card_status_new::text, '') <> 'defect'
    and variant = (case when p_pool = 'premium' then 'signed'::card_variant else 'unsigned'::card_variant end)
  order by random() limit 1
  for update skip locked;
  if not found then raise exception 'SOLD_OUT'; end if;

  v_price := case when v_card.variant = 'signed'::card_variant
             then coalesce(v_drop.price_signed_ccoin, v_drop.price_ccoin, v_drop.price_unsigned_ccoin)
             else coalesce(v_drop.price_ccoin, v_drop.price_unsigned_ccoin) end;
  v_total := v_price + coalesce(case when p_delivery = 'shipping' then p_shipping_fee end, 0);

  perform public.wallet_debit(v_user, v_total, 'checkout', 'drop', p_drop_id,
          'checkout-' || v_user || '-' || p_drop_id);

  update cards set owner_id = v_user,
    card_status_new = 'bound',
    location = (case when p_delivery = 'vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = v_card.id;

  update drops set sold_count = sold_count + 1,
    status = (case when sold_count + 1 >= total_units then 'sold_out'::drop_status else status end)
  where id = p_drop_id;

  insert into orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status,
                      delivery_option, shipping_fee_ccoin, escrow_status, shipping_address, source)
  values (gen_random_uuid()::text, v_user, p_drop_id, v_card.id, array[v_card.id], v_total, v_total * 10000,
          (case when p_delivery = 'vault' then 'settled'::order_status else 'paid'::order_status end),
          p_delivery, p_shipping_fee,
          (case when p_delivery = 'vault' then 'released'::escrow_status else 'held'::escrow_status end),
          p_address, 'fcfs')
  returning * into v_order;

  insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
  values (gen_random_uuid()::text, v_card.id, v_user, 'primary', v_order.id);

  -- Revenue share platform-produced 70/30 -> creator
  v_creator_share := floor(v_price * 0.3);
  if v_creator_share >= 1 and v_drop.creator_id is distinct from v_user then
    perform public.wallet_credit(v_drop.creator_id, v_creator_share, 'royalty', 'order', v_order.id,
            'royalty-' || v_order.id);
  end if;

  return v_order;
end $$;
