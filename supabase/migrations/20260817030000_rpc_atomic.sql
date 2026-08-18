-- C.Verse — Atomic RPC + idempotency + badge triggers (squashed phase 4/6)
-- Semua aksi uang & stok lewat RPC single-transaction (security definer).
-- Setiap fungsi TULIS SATU KALI dalam versi FINAL (semua bug-fix patch
-- 16500000–16560000 sudah dilebur ke sini). XP = 1 C-Coin spend = 1 XP.

-- ══════════════════════════════════════════════════════════════════════════
-- Idempotency ledger: UNIQUE functional index (ON CONFLICT dipakai RPC wallet)
-- ══════════════════════════════════════════════════════════════════════════
create unique index uq_wtx_idempotency_key
  on public.wallet_transactions((metadata->>'idempotency_key'))
  where metadata->>'idempotency_key' is not null;

-- ══════════════════════════════════════════════════════════════════════════
-- wallet_debit (versi FINAL: guard self-only untuk pemanggil non-service via GUC role)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.wallet_debit(
  p_user uuid,
  p_amount integer,
  p_type text,
  p_ref_type text,
  p_ref_id text,
  p_idem text
) returns public.wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
begin
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') and p_user is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if p_idem is not null then
    select * into v_tx from wallet_transactions where metadata->>'idempotency_key' = p_idem;
    if found then return v_tx; end if; -- idempotent replay
  end if;

  select * into v_wallet from wallets where user_id = p_user for update;
  if not found then
    insert into wallets (user_id) values (p_user);
    select * into v_wallet from wallets where user_id = p_user for update;
  end if;
  if v_wallet.balance_ccoin < p_amount then raise exception 'INSUFFICIENT'; end if;

  update wallets set balance_ccoin = balance_ccoin - p_amount,
    total_spent_ccoin = total_spent_ccoin + p_amount
  where user_id = p_user
  returning * into v_wallet;

  -- spend 1 C-Coin = 1 XP (checkout/platform_buy); hold & payout bukan spend XP
  if p_type in ('checkout','platform_buy') then
    update users set total_xp = total_xp + p_amount,
      level = least(100, greatest(1, floor((total_xp + p_amount) / 10) + 1))
    where id = p_user;
  end if;

  insert into wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, metadata)
  values (gen_random_uuid()::text, p_user, p_type::wallet_tx_type, -p_amount, v_wallet.balance_ccoin, p_ref_type, p_ref_id,
          null, jsonb_build_object('idempotency_key', coalesce(p_idem, gen_random_uuid()::text)))
  returning * into v_tx;
  return v_tx;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- wallet_credit
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.wallet_credit(
  p_user uuid,
  p_amount integer,
  p_type text,
  p_ref_type text,
  p_ref_id text,
  p_idem text
) returns public.wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
begin
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_idem is not null then
    select * into v_tx from wallet_transactions where metadata->>'idempotency_key' = p_idem;
    if found then return v_tx; end if;
  end if;

  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into v_wallet from wallets where user_id = p_user for update;

  update wallets set balance_ccoin = balance_ccoin + p_amount,
    total_topup_ccoin = total_topup_ccoin + case when p_type = 'top_up' then p_amount else 0 end
  where user_id = p_user
  returning * into v_wallet;

  insert into wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, metadata)
  values (gen_random_uuid()::text, p_user, p_type::wallet_tx_type, p_amount, v_wallet.balance_ccoin, p_ref_type, p_ref_id,
          null, jsonb_build_object('idempotency_key', coalesce(p_idem, gen_random_uuid()::text)))
  returning * into v_tx;
  return v_tx;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Badges: event-driven (trigger, tanpa cron)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.award_badge_if_eligible(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_badge public.badges;
begin
  select * into v_badge from badges where code = p_code and is_active;
  if not found then return false; end if;
  if exists (select 1 from user_badges where user_id = p_user and badge_id = v_badge.id) then return false; end if;
  insert into user_badges (user_id, badge_id, xp_reward_snapshot) values (p_user, v_badge.id, v_badge.xp_reward);
  update users set total_xp = total_xp + v_badge.xp_reward,
    level = least(100, greatest(1, floor((total_xp + v_badge.xp_reward) / 10) + 1))
  where id = p_user;
  return true;
end $$;

create or replace function public.badge_on_ownership() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.award_badge_if_eligible(new.owner_id, 'first_drop');
  select count(distinct card_id) into n from ownership_history where owner_id = new.owner_id;
  if n >= 5 then perform public.award_badge_if_eligible(new.owner_id, 'collector_5'); end if;
  return new;
end $$;
create trigger trg_badge_ownership after insert on public.ownership_history
  for each row execute function public.badge_on_ownership();

create or replace function public.badge_on_bid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.award_badge_if_eligible(new.bidder_id, 'first_bid');
  if new.amount_ccoin > 100 then perform public.award_badge_if_eligible(new.bidder_id, 'whale'); end if;
  return new;
end $$;
create trigger trg_badge_bid after insert on public.bids
  for each row execute function public.badge_on_bid();

create or replace function public.badge_on_kyc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.award_badge_if_eligible(new.user_id, 'verified');
  end if;
  return new;
end $$;
create trigger trg_badge_kyc after update on public.kyc_records
  for each row execute function public.badge_on_kyc();

-- ══════════════════════════════════════════════════════════════════════════
-- checkout — versi FINAL (FCFS pasca-draw, gate SOLD_OUT sebelum LIVE)
-- ══════════════════════════════════════════════════════════════════════════
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

  -- Gate: lock drop row dulu; sold_out/habis dicek SEBELUM cek live
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
    and coalesce(status::text, '') <> 'defect'
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
    status = 'bound',
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

-- ══════════════════════════════════════════════════════════════════════════
-- Raffle: drop_entry + record_spend_conversion + draw_drop (versi FINAL)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.drop_entry(
  p_drop_id text,
  p_pool text                  -- 'regular' | 'premium' | 'both'
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

create or replace function public.record_spend_conversion(
  p_user uuid,
  p_amount integer,
  p_order_id text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  select balance_ccoin into v_balance from wallets where user_id = p_user;
  insert into wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, metadata)
  values (gen_random_uuid()::text, p_user, 'checkout'::wallet_tx_type, 0, v_balance, 'order', p_order_id,
          'raffle hold -> payment conversion', jsonb_build_object('conversion_of_hold', true, 'spend_ccoin', p_amount));
  update users set total_xp = total_xp + p_amount,
    level = least(100, greatest(1, floor((total_xp + p_amount) / 10) + 1))
  where id = p_user;
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
begin
  update drops set drawn_at = now()
  where id = p_drop_id and drawn_at is null
    and raffle_end_at is not null and raffle_end_at <= now()
  returning * into v_drop;
  if v_drop.id is null then return 0; end if; -- sudah drawn / belum waktunya

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

      insert into orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status,
                          delivery_option, escrow_status, source)
      values (gen_random_uuid()::text, v_entry.user_id, p_drop_id, v_card.id, array[v_card.id],
              v_price, v_price * 10000, 'settled'::order_status, 'vault'::delivery_option, 'released'::escrow_status, 'raffle')
      returning * into v_order;

      insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
      values (gen_random_uuid()::text, v_card.id, v_entry.user_id, 'primary', v_order.id);

      -- Konversi hold -> pembayaran (amount 0: dana sudah didebit saat entry; XP tercatat di sini)
      perform public.record_spend_conversion(v_entry.user_id, v_price, v_order.id);

      -- revenue share 70/30 ke creator
      if (floor(v_price * 0.3))::integer >= 1 then
        perform public.wallet_credit(v_drop.creator_id, (floor(v_price * 0.3))::integer, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
      end if;

      update drop_entries set status = 'won_premium' where id = v_entry.id;
      v_winners := v_winners + 1;
    end loop;
  end if;

  -- 2. REGULER: random entrants (regular + both yang kalah premium) -> won_regular
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

    insert into orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status,
                        delivery_option, escrow_status, source)
    values (gen_random_uuid()::text, v_entry.user_id, p_drop_id, v_card.id, array[v_card.id],
            v_price, v_price * 10000, 'settled'::order_status, 'vault'::delivery_option, 'released'::escrow_status, 'raffle')
    returning * into v_order;

    insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
    values (gen_random_uuid()::text, v_card.id, v_entry.user_id, 'primary', v_order.id);

    perform public.record_spend_conversion(v_entry.user_id, v_price, v_order.id);

    if (floor(v_price * 0.3))::integer >= 1 then
      perform public.wallet_credit(v_drop.creator_id, (floor(v_price * 0.3))::integer, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
    end if;

    -- pool 'both' yang menang reguler: refund selisih hold - price
    if v_entry.pool = 'both' and v_entry.hold_ccoin > v_price then
      perform public.wallet_credit(v_entry.user_id, v_entry.hold_ccoin - v_price, 'refund', 'drop_entry', v_entry.id,
              'refund-' || v_entry.id);
    end if;

    update drop_entries set status = 'won_regular' where id = v_entry.id;
    v_winners := v_winners + 1;
  end loop;

  -- 3. Sisanya -> lost + refund hold penuh
  update drop_entries e set status = 'lost'
  where e.drop_id = p_drop_id and e.status = 'held';
  for v_entry in select * from drop_entries where drop_id = p_drop_id and status = 'lost' loop
    perform public.wallet_credit(v_entry.user_id, v_entry.hold_ccoin, 'refund', 'drop_entry', v_entry.id,
            'refund-' || v_entry.id);
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

-- ══════════════════════════════════════════════════════════════════════════
-- Secondary: place_bid / cancel_bid / accept_bid / set_buyout / buyout_card
-- Fee split 7,5 / 7,5 / 85 (round half up; seller ambil sisa)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.place_bid(
  p_card_id text,
  p_amount integer
) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_active public.bids;
  v_new public.bids;
  v_has_active boolean := false;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;

  select * into v_active from bids where card_id = p_card_id and status = 'active' for update;
  v_has_active := found;
  if v_has_active and p_amount <= v_active.amount_ccoin then raise exception 'BID_TOO_LOW'; end if;

  perform public.wallet_debit(v_user, p_amount, 'escrow_hold', 'bid', p_card_id,
          'bid-' || v_user || '-' || p_card_id || '-' || gen_random_uuid()::text);

  if v_has_active then
    perform public.wallet_credit(v_active.bidder_id, v_active.amount_ccoin, 'escrow_release', 'bid', v_active.id,
            'release-' || v_active.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_active.id;
  end if;

  insert into bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status)
  values (gen_random_uuid()::text, p_card_id, v_user,
          coalesce((select display_name from users where id = v_user), 'Bidder'),
          p_amount, 'active')
  returning * into v_new;
  return v_new;
end $$;

create or replace function public.cancel_bid(p_bid_id text) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_bid public.bids;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_bid from bids where id = p_bid_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_bid.bidder_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if v_bid.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  perform public.wallet_credit(v_user, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
  update bids set status = 'cancelled', cancelled_at = now() where id = p_bid_id returning * into v_bid;
  return v_bid;
end $$;

create or replace function public.accept_bid(
  p_card_id text,
  p_destination public.shipment_to_dest default 'buyer_address'
) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_bid public.bids;
  v_other public.bids;
  v_seller_ccoin integer;
  v_royalty_ccoin integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;

  select * into v_bid from bids where card_id = p_card_id and status = 'active'
  order by amount_ccoin desc limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_BID'; end if;

  v_seller_ccoin := v_bid.amount_ccoin - round(v_bid.amount_ccoin * 0.075) - round(v_bid.amount_ccoin * 0.075);
  v_royalty_ccoin := round(v_bid.amount_ccoin * 0.075);

  -- hold buyer sudah didebit saat place_bid; seller & royalty dikredit sekarang
  perform public.wallet_credit(v_user, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
  end if;

  -- XP buyer: spend = amount
  update users set total_xp = total_xp + v_bid.amount_ccoin,
    level = least(100, greatest(1, floor((total_xp + v_bid.amount_ccoin) / 10) + 1))
  where id = v_bid.bidder_id;

  update bids set status = 'accepted', accepted_at = now() where id = v_bid.id;

  for v_other in select * from bids where card_id = p_card_id and status = 'active' and id <> v_bid.id for update loop
    perform public.wallet_credit(v_other.bidder_id, v_other.amount_ccoin, 'escrow_release', 'bid', v_other.id, 'release-' || v_other.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_other.id;
  end loop;

  update cards set owner_id = v_bid.bidder_id, buyout_price_ccoin = null, status = 'sold',
    location = (case when p_destination = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
  values (gen_random_uuid()::text, p_card_id, v_bid.bidder_id, 'secondary_bid', v_bid.id);

  return v_bid;
end $$;

create or replace function public.set_buyout(
  p_card_id text,
  p_price integer                -- null = cabut
) returns public.cards
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_active_count int;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if p_price is not null and p_price < 1 then raise exception 'INVALID_AMOUNT'; end if;

  if p_price is not null and v_card.buyout_price_ccoin is null then
    select count(*) into v_active_count from cards where owner_id = v_user and buyout_price_ccoin is not null;
    if v_active_count >= 20 then raise exception 'MAX_BUYOUT_ACTIVE'; end if;
  end if;

  update cards set buyout_price_ccoin = p_price,
    status = (case
      when p_price is null and status = 'listed_buyout'::card_status then 'sold'::card_status
      when p_price is not null and status in ('sold'::card_status, 'bound'::card_status) then 'listed_buyout'::card_status
      else status end)
  where id = p_card_id
  returning * into v_card;
  return v_card;
end $$;

create or replace function public.buyout_card(p_card_id text) returns public.cards
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_seller uuid;
  v_price integer;
  v_seller_ccoin integer;
  v_royalty_ccoin integer;
  v_bid public.bids;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found or v_card.buyout_price_ccoin is null then raise exception 'NOT_FOR_SALE'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;

  -- wash trading 14 hari (I13) & creator self-dealing 30 hari (I14)
  if exists (select 1 from ownership_history h
             where h.card_id = p_card_id and h.owner_id = v_user
             and h.transferred_at > now() - interval '14 days') then
    raise exception 'COOLING_PERIOD_14D';
  end if;
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.creator_id = v_user
             and coalesce(d.drop_start_at, d.drop_at, d.created_at) > now() - interval '30 days') then
    raise exception 'CREATOR_SELF_DEALING_30D';
  end if;

  v_price := v_card.buyout_price_ccoin;
  v_seller := v_card.owner_id;
  v_seller_ccoin := v_price - round(v_price * 0.075) - round(v_price * 0.075);
  v_royalty_ccoin := round(v_price * 0.075);

  -- Idem key unik per transaksi (bukan per kartu) — aman saat re-sale
  perform public.wallet_debit(v_user, v_price, 'platform_buy', 'card', p_card_id,
          'buyout-' || gen_random_uuid()::text);
  perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'card', p_card_id, 'settle-' || gen_random_uuid()::text);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'card', p_card_id, 'royalty-' || gen_random_uuid()::text);
  end if;

  -- release bid aktif
  for v_bid in select * from bids where card_id = p_card_id and status = 'active' for update loop
    perform public.wallet_credit(v_bid.bidder_id, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_bid.id;
  end loop;

  update cards set owner_id = v_user, buyout_price_ccoin = null, status = 'sold' where id = p_card_id
  returning * into v_card;

  insert into ownership_history (id, card_id, owner_id, acquired_via)
  values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout');

  return v_card;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Cron RPC: escrow auto-release (versi FINAL: shipping + delivered_at)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.escrow_auto_release() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update orders set escrow_status = 'released'::escrow_status, status = 'settled'::order_status
  where escrow_status = 'held'::escrow_status
    and delivery_option = 'shipping'::delivery_option
    and delivered_at is not null
    and delivered_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;