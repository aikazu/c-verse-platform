-- Honor pool choice, release failed holds, and allocate only eligible inventory.
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
  perform public.assert_active_actor();

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
    and status = 'inventory'::card_status
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
  perform public.assert_active_actor();
  if p_pool not in ('regular','premium','both') then raise exception 'INVALID_POOL'; end if;

  select * into v_drop from drops
  where id = p_drop_id and status = 'live' and drop_start_at <= now()
    and (drop_end_at is null or drop_end_at > now())
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

create or replace function public.draw_drop(p_drop_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_drop public.drops;
  v_entry record;
  v_card public.cards;
  v_price integer;
  v_order public.orders;
  v_premium_slots int;
  v_winners int := 0;
  v_royalty integer;
begin
  update drops set drawn_at = now()
  where id = p_drop_id and drawn_at is null
    and raffle_end_at is not null and raffle_end_at <= now()
  returning * into v_drop;
  if v_drop.id is null then return 0; end if;

  -- 1. PREMIUM: random entrants (premium + both) -> won_premium (kartu signed, vault default)
  select count(*) into v_premium_slots from cards
  where drop_id = p_drop_id and owner_id is null and status = 'inventory' and variant = 'signed'::card_variant;
  if v_premium_slots > 0 then
    for v_entry in
      select e.* from drop_entries e
      where e.drop_id = p_drop_id and e.status = 'held' and e.pool in ('premium','both')
      order by random() limit v_premium_slots
      for update skip locked
    loop
      select * into v_card from cards
      where drop_id = p_drop_id and owner_id is null and status = 'inventory' and variant = 'signed'::card_variant
      order by random() limit 1 for update skip locked;
      if not found then exit; end if;

      v_price := coalesce(v_drop.price_signed_ccoin, v_drop.price_ccoin, v_drop.price_unsigned_ccoin);
      update cards set owner_id = v_entry.user_id, status = 'bound', location = 'platform_vault'::card_location
      where id = v_card.id;
      update drops set sold_count = sold_count + 1,
        status = (case when sold_count + 1 >= total_units then 'sold_out'::drop_status else status end)
      where id = p_drop_id;

      insert into orders (id, user_id, drop_id, card_id, total_ccoin, total_idr, status,
                          delivery_option, escrow_status, source)
      values (gen_random_uuid()::text, v_entry.user_id, p_drop_id, v_card.id,
              v_price, v_price * 10000, 'settled'::order_status, 'vault'::delivery_option, 'released'::escrow_status, 'raffle')
      returning * into v_order;

      insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
      values (gen_random_uuid()::text, v_card.id, v_entry.user_id, 'primary', v_order.id);

      perform public.record_spend_conversion(v_entry.user_id, v_price, v_order.id);

      v_royalty := (floor(v_price * 0.3))::integer;
      if v_royalty >= 1 then
        perform public.wallet_credit_gems(v_drop.creator_id, v_royalty, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
      end if;
      perform public.record_platform_revenue('primary', 'order', v_order.id, v_price, v_price - v_royalty, v_royalty, 0);

      update drop_entries set status = 'won_premium' where id = v_entry.id;
      perform public.notify_user(
        v_entry.user_id,
        'drop_won',
        jsonb_build_object('dropId', p_drop_id, 'dropTitle', v_drop.title, 'variant', 'signed', 'amount', v_price),
        true
      );
      v_winners := v_winners + 1;
    end loop;
  end if;

  -- 2. REGULAR: equal draw among regular and both; premium-only never changes pool.
  loop
    select * into v_card from cards
    where drop_id = p_drop_id and owner_id is null and status = 'inventory' and variant = 'unsigned'::card_variant
    order by random() limit 1 for update skip locked;
    exit when not found;

    select * into v_entry from drop_entries e
    where e.drop_id = p_drop_id and e.status = 'held' and e.pool in ('regular','both')
    order by random()
    limit 1 for update skip locked;
    exit when not found;

    v_price := coalesce(v_drop.price_ccoin, v_drop.price_unsigned_ccoin);
    update cards set owner_id = v_entry.user_id, status = 'bound', location = 'platform_vault'::card_location
    where id = v_card.id;
    update drops set sold_count = sold_count + 1,
      status = (case when sold_count + 1 >= total_units then 'sold_out'::drop_status else status end)
      where id = p_drop_id;

    insert into orders (id, user_id, drop_id, card_id, total_ccoin, total_idr, status,
                        delivery_option, escrow_status, source)
    values (gen_random_uuid()::text, v_entry.user_id, p_drop_id, v_card.id,
            v_price, v_price * 10000, 'settled'::order_status, 'vault'::delivery_option, 'released'::escrow_status, 'raffle')
      returning * into v_order;

    insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
    values (gen_random_uuid()::text, v_card.id, v_entry.user_id, 'primary', v_order.id);

    perform public.record_spend_conversion(v_entry.user_id, v_price, v_order.id);

    v_royalty := (floor(v_price * 0.3))::integer;
    if v_royalty >= 1 then
      perform public.wallet_credit_gems(v_drop.creator_id, v_royalty, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
    end if;
    perform public.record_platform_revenue('primary', 'order', v_order.id, v_price, v_price - v_royalty, v_royalty, 0);

    -- Pemenang reguler yang hold-nya lebih besar dari harga (pool premium yang
    -- jatuh ke reguler, atau both) -> refund selisih (FIX 2026-08-16).
    if v_entry.hold_ccoin > v_price then
      perform public.wallet_credit(v_entry.user_id, v_entry.hold_ccoin - v_price, 'refund', 'drop_entry', v_entry.id,
              'refund-' || v_entry.id);
    end if;

    update drop_entries set status = 'won_regular' where id = v_entry.id;
    perform public.notify_user(
      v_entry.user_id,
      'drop_won',
      jsonb_build_object('dropId', p_drop_id, 'dropTitle', v_drop.title, 'variant', 'unsigned', 'amount', v_price),
      true
    );
    v_winners := v_winners + 1;
  end loop;

  -- 3. Sisanya -> lost + refund hold penuh. Notif pecundang raffle = in-app
  -- SAJA (bisa ratusan per draw — email massal 12:00 WIB = anti-pattern).
  update drop_entries e set status = 'lost'
  where e.drop_id = p_drop_id and e.status = 'held';
  for v_entry in select * from drop_entries where drop_id = p_drop_id and status = 'lost' loop
    perform public.wallet_credit(v_entry.user_id, v_entry.hold_ccoin, 'refund', 'drop_entry', v_entry.id,
            'refund-' || v_entry.id);
    perform public.notify_user(
      v_entry.user_id,
      'drop_lost',
      jsonb_build_object('dropId', p_drop_id, 'dropTitle', v_drop.title, 'refund', v_entry.hold_ccoin),
      false
    );
    update drop_entries set status = 'refunded' where id = v_entry.id;
  end loop;

  return v_winners;
end $$;
