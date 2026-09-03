-- 10: RPC raffle draw (draw_drop, draw_pending_drops) (part of consolidated RPC set; apply in lexical order).
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
  where drop_id = p_drop_id and owner_id is null and variant = 'signed'::card_variant;
  if v_premium_slots > 0 then
    for v_entry in
      select e.* from drop_entries e
      where e.drop_id = p_drop_id and e.status = 'held' and e.pool in ('premium','both')
      order by random() limit v_premium_slots
      for update skip locked
    loop
      select * into v_card from cards
      where drop_id = p_drop_id and owner_id is null and variant = 'signed'::card_variant
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

  -- 2. REGULER: random entrants (regular + premium/both yang kalah premium) -> won_regular
  loop
    select * into v_card from cards
    where drop_id = p_drop_id and owner_id is null and variant = 'unsigned'::card_variant
    order by random() limit 1 for update skip locked;
    exit when not found;

    select * into v_entry from drop_entries e
    where e.drop_id = p_drop_id and e.status = 'held'
    order by (case when e.pool = 'regular' then 0 else 1 end), random()
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

create or replace function public.draw_pending_drops() returns integer
language plpgsql security definer set search_path = public as $$
declare n int := 0; d record;
begin
  for d in select id from drops where raffle_end_at is not null and drawn_at is null and raffle_end_at <= now() loop
    n := n + public.draw_drop(d.id);
  end loop;
  return n;
end $$;

drop function if exists public.escrow_auto_release();
