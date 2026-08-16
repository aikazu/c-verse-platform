-- C.Verse — Revenue ledger + flow hardening (phase 7/7)
-- 1. Platform revenue TIDAK menguap: setiap settlement primary (70/30) dan
--    secondary (7,5/7,5/85) mencatat baris platform_revenue + kredit treasury.
-- 2. Raffle: pemenang reguler yang hold-nya lebih besar dari harga (pool premium
--    yang jatuh ke reguler, atau both) di-refund selisihnya.
-- 3. Bid: maks 3 bid aktif per user (docs 03 Flow 7, keputusan founder 2026-08-16).
-- 4. Top-up: cap 500 C-Coin untuk user non-KYC (KYC approved = tanpa cap).
-- 5. Secondary + primary shipping otomatis membuat row shipments (fulfillment).
-- 6. payout_request: creator minta disbursement (KYC + min 10 + hold check).

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Enum + tabel platform_revenue + user treasury
-- ══════════════════════════════════════════════════════════════════════════
alter type public.wallet_tx_type add value if not exists 'platform_revenue';

create table if not exists public.platform_revenue (
  id text primary key default gen_random_uuid()::text,
  source text not null check (source in ('primary','secondary_buyout','secondary_bid')),
  ref_type text not null,
  ref_id text not null,
  gross_ccoin integer not null check (gross_ccoin >= 1),
  platform_ccoin integer not null default 0,
  royalty_ccoin integer not null default 0,
  seller_ccoin integer not null default 0,
  fee_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.platform_revenue is
  'Ledger pendapatan platform (per event settlement) — snapshot fee rate per transaksi (docs 05 I6/I11).';
create unique index if not exists uq_platform_revenue_ref on public.platform_revenue(ref_type, ref_id);

alter table public.platform_revenue enable row level security;
grant all on public.platform_revenue to service_role;

-- Treasury platform: user sistem (fixed UUID, bukan akun login — users.id tidak
-- bereferensi auth.users). is_anonymous agar tidak muncul di permukaan publik.
insert into public.users (id, email, display_name, username, role, is_anonymous)
values ('00000000-0000-4000-8000-0000000000c0', 'treasury@c-verse.co', 'C.Verse Treasury', 'cverse_treasury', 'user', true)
on conflict (id) do nothing;
insert into public.wallets (user_id) values ('00000000-0000-4000-8000-0000000000c0')
on conflict (user_id) do nothing;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. record_platform_revenue: insert ledger + kredit treasury (idempotent per ref)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.record_platform_revenue(
  p_source text,
  p_ref_type text,
  p_ref_id text,
  p_gross integer,
  p_platform integer,
  p_royalty integer,
  p_seller integer
) returns void
language plpgsql security definer set search_path = public as $$
declare v_treasury constant uuid := '00000000-0000-4000-8000-0000000000c0';
begin
  insert into platform_revenue (source, ref_type, ref_id, gross_ccoin, platform_ccoin, royalty_ccoin, seller_ccoin, fee_snapshot)
  values (p_source, p_ref_type, p_ref_id, p_gross, p_platform, p_royalty, p_seller,
    case when p_source = 'primary'
      then jsonb_build_object('platform_pct', 0.7, 'royalty_pct', 0.3, 'rate_idr', 10000)
      else jsonb_build_object('platform_pct', 0.075, 'royalty_pct', 0.075, 'seller_pct', 0.85, 'rate_idr', 10000)
    end)
  on conflict (ref_type, ref_id) do nothing;
  if p_platform >= 1 then
    perform public.wallet_credit(v_treasury, p_platform, 'platform_revenue', p_ref_type, p_ref_id,
            'rev-' || p_ref_type || '-' || p_ref_id);
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. wallet_credit: cap top-up 500 C-Coin tanpa KYC (BALANCE_CAP_CCOIN shared)
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

  -- Cap saldo top-up (docs 07 C-08, keputusan founder 2026-08-16):
  -- non-KYC maks 500 C-Coin; KYC approved tanpa cap.
  if p_type = 'top_up'
     and v_wallet.balance_ccoin + p_amount > 500
     and not exists (select 1 from kyc_records k where k.user_id = p_user and k.status = 'approved') then
    raise exception 'TOPUP_CAP_EXCEEDED';
  end if;

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
-- 4. checkout: revenue 70/30 tercatat + shipment otomatis untuk shipping
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.checkout(
  p_drop_id text,
  p_pool text,
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
  if p_delivery = 'shipping' and (p_address is null or length(trim(p_address)) < 10) then raise exception 'ADDRESS_REQUIRED'; end if;
  if p_delivery = 'shipping' and (p_shipping_fee is null or p_shipping_fee < 1) then raise exception 'SHIPPING_FEE_REQUIRED'; end if;

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

  -- Fulfillment: order shipping lahir bersama shipment 'requested' (queue admin)
  if p_delivery = 'shipping' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, fee_ccoin, status)
    values (gen_random_uuid()::text, v_card.id, v_user, 'primary_shipping', 'platform', 'buyer_address',
            jsonb_build_object('street', p_address), p_shipping_fee, 'requested');
  end if;

  -- Revenue share platform-produced 70/30 -> creator + ledger platform
  v_creator_share := floor(v_price * 0.3);
  if v_creator_share >= 1 and v_drop.creator_id is distinct from v_user then
    perform public.wallet_credit(v_drop.creator_id, v_creator_share, 'royalty', 'order', v_order.id,
            'royalty-' || v_order.id);
    v_royalty_credited := v_creator_share;
  end if;
  perform public.record_platform_revenue('primary', 'order', v_order.id, v_price,
          v_price - v_royalty_credited, v_royalty_credited, 0);

  return v_order;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. draw_drop: refund selisih hold untuk SEMUA pool + revenue tercatat
-- ══════════════════════════════════════════════════════════════════════════
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
      update cards set owner_id = v_entry.user_id, card_status_new = 'bound', location = 'platform_vault'::card_location
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

      v_royalty := (floor(v_price * 0.3))::integer;
      if v_royalty >= 1 then
        perform public.wallet_credit(v_drop.creator_id, v_royalty, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
      end if;
      perform public.record_platform_revenue('primary', 'order', v_order.id, v_price, v_price - v_royalty, v_royalty, 0);

      update drop_entries set status = 'won_premium' where id = v_entry.id;
      v_winners := v_winners + 1;
    end loop;
  end if;

  -- 2. REGULER: random entrants (regular + premium/both yang kalah premium)
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
    update cards set owner_id = v_entry.user_id, card_status_new = 'bound', location = 'platform_vault'::card_location
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

    v_royalty := (floor(v_price * 0.3))::integer;
    if v_royalty >= 1 then
      perform public.wallet_credit(v_drop.creator_id, v_royalty, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
    end if;
    perform public.record_platform_revenue('primary', 'order', v_order.id, v_price, v_price - v_royalty, v_royalty, 0);

    -- Pemenang reguler yang hold-nya lebih besar dari harga (pool premium yang
    -- jatuh ke reguler, atau both) -> refund selisih (FIX 2026-08-16).
    if v_entry.hold_ccoin > v_price then
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

-- ══════════════════════════════════════════════════════════════════════════
-- 6. place_bid: gate status kartu tradable + maks 3 bid aktif per user
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
  if coalesce(v_card.card_status_new::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;

  select * into v_active from bids where card_id = p_card_id and status = 'active' for update;
  v_has_active := found;
  if v_has_active and p_amount <= v_active.amount_ccoin then raise exception 'BID_TOO_LOW'; end if;

  perform public.wallet_debit(v_user, p_amount, 'escrow_hold', 'bid', p_card_id,
          'bid-' || v_user || '-' || p_card_id || '-' || gen_random_uuid()::text);

  -- Maks 3 bid aktif per user (dicek SETELAH lock wallet: serial per user).
  if (select count(*) from bids where bidder_id = v_user and status = 'active') >= 3 then
    raise exception 'BID_LIMIT';
  end if;

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

-- ══════════════════════════════════════════════════════════════════════════
-- 7. accept_bid: signature + alamat, gate tradable, fee platform tercatat,
--    shipment secondary_bid otomatis saat dest = buyer_address
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.accept_bid(text, public.shipment_to_dest);
create or replace function public.accept_bid(
  p_card_id text,
  p_destination public.shipment_to_dest default 'buyer_address',
  p_address text default null
) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_bid public.bids;
  v_other public.bids;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if coalesce(v_card.card_status_new::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if p_destination = 'buyer_address' and (p_address is null or length(trim(p_address)) < 10) then
    raise exception 'ADDRESS_REQUIRED';
  end if;

  select * into v_bid from bids where card_id = p_card_id and status = 'active'
  order by amount_ccoin desc limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_BID'; end if;

  v_platform_ccoin := round(v_bid.amount_ccoin * 0.075);
  v_royalty_ccoin := round(v_bid.amount_ccoin * 0.075);
  v_seller_ccoin := v_bid.amount_ccoin - v_platform_ccoin - v_royalty_ccoin;

  perform public.wallet_credit(v_user, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_bid', 'bid', v_bid.id, v_bid.amount_ccoin,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- XP buyer: spend = amount
  update users set total_xp = total_xp + v_bid.amount_ccoin,
    level = least(100, greatest(1, floor((total_xp + v_bid.amount_ccoin) / 10) + 1))
  where id = v_bid.bidder_id;

  update bids set status = 'accepted', accepted_at = now() where id = v_bid.id;

  for v_other in select * from bids where card_id = p_card_id and status = 'active' and id <> v_bid.id for update loop
    perform public.wallet_credit(v_other.bidder_id, v_other.amount_ccoin, 'escrow_release', 'bid', v_other.id, 'release-' || v_other.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_other.id;
  end loop;

  update cards set owner_id = v_bid.bidder_id, buyout_price_ccoin = null, card_status_new = 'sold',
    location = (case when p_destination = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
  values (gen_random_uuid()::text, p_card_id, v_bid.bidder_id, 'secondary_bid', v_bid.id);

  if p_destination = 'buyer_address' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
    values (gen_random_uuid()::text, p_card_id, v_bid.bidder_id, 'secondary_bid', 'seller', 'buyer_address',
            jsonb_build_object('street', p_address), 'requested');
  end if;

  return v_bid;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 8. set_buyout: kartu tampered/defect/lost tidak boleh di-listing
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.set_buyout(
  p_card_id text,
  p_price integer
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
  if p_price is not null and coalesce(v_card.card_status_new::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;

  if p_price is not null and v_card.buyout_price_ccoin is null then
    select count(*) into v_active_count from cards where owner_id = v_user and buyout_price_ccoin is not null;
    if v_active_count >= 20 then raise exception 'MAX_BUYOUT_ACTIVE'; end if;
  end if;

  update cards set buyout_price_ccoin = p_price,
    card_status_new = (case
      when p_price is null and card_status_new = 'listed_buyout'::card_status_new then 'sold'::card_status_new
      when p_price is not null and card_status_new in ('sold'::card_status_new, 'bound'::card_status_new) then 'listed_buyout'::card_status_new
      else card_status_new end)
  where id = p_card_id
  returning * into v_card;
  return v_card;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 9. buyout_card: signature + alamat, fee platform tercatat, shipment
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.buyout_card(text);
create or replace function public.buyout_card(
  p_card_id text,
  p_destination public.shipment_to_dest default 'buyer_address',
  p_address text default null
) returns public.cards
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_seller uuid;
  v_price integer;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
  v_bid public.bids;
  v_debit_tx public.wallet_transactions;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found or v_card.buyout_price_ccoin is null then raise exception 'NOT_FOR_SALE'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;
  if coalesce(v_card.card_status_new::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if p_destination = 'buyer_address' and (p_address is null or length(trim(p_address)) < 10) then
    raise exception 'ADDRESS_REQUIRED';
  end if;

  -- wash trading blok rebuy 24 jam (C-12 FINAL 2026-08-15) & creator self-dealing 30 hari (I14)
  if exists (select 1 from ownership_history h
             where h.card_id = p_card_id and h.owner_id = v_user
             and h.transferred_at > now() - interval '24 hours') then
    raise exception 'COOLING_PERIOD_24H';
  end if;
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.creator_id = v_user
             and coalesce(d.drop_start_at, d.drop_at, d.created_at) > now() - interval '30 days') then
    raise exception 'CREATOR_SELF_DEALING_30D';
  end if;

  v_price := v_card.buyout_price_ccoin;
  v_seller := v_card.owner_id;
  v_platform_ccoin := round(v_price * 0.075);
  v_royalty_ccoin := round(v_price * 0.075);
  v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

  -- Ref revenue = id tx debit (unik per transaksi; kartu bisa terjual berulang)
  v_debit_tx := public.wallet_debit(v_user, v_price, 'platform_buy', 'card', p_card_id,
          'buyout-' || gen_random_uuid()::text);
  perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'card', p_card_id, 'settle-' || gen_random_uuid()::text);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'card', p_card_id, 'royalty-' || gen_random_uuid()::text);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_buyout', 'buyout', v_debit_tx.id, v_price,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- release bid aktif
  for v_bid in select * from bids where card_id = p_card_id and status = 'active' for update loop
    perform public.wallet_credit(v_bid.bidder_id, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_bid.id;
  end loop;

  update cards set owner_id = v_user, buyout_price_ccoin = null, card_status_new = 'sold',
    location = (case when p_destination = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id
  returning * into v_card;

  insert into ownership_history (id, card_id, owner_id, acquired_via)
  values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout');

  if p_destination = 'buyer_address' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
    values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout', 'seller', 'buyer_address',
            jsonb_build_object('street', p_address), 'requested');
  end if;

  return v_card;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 10. payout_request: self-service disbursement request (KYC + min 10 + hold)
-- ══════════════════════════════════════════════════════════════════════════
alter table public.payouts add column if not exists requested_at timestamptz not null default now();

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

  -- Dana dikunci (debit) sampai batch disbursed; gagal batch -> refund manual via adjustment.
  perform public.wallet_debit(v_user, p_amount, 'payout', 'payout_request', null,
          'payout-req-' || v_user || '-' || gen_random_uuid()::text);

  -- idr_amount diisi payout_batch_run (net setelah fee 1%); 0 = placeholder.
  insert into payouts (id, user_id, type, ccoin_amount, idr_amount, status, requested_at)
  values (gen_random_uuid()::text, v_user, 'seller_proceeds', p_amount, 0, 'pending', now())
  returning * into v_payout;
  return v_payout;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 11. activate_scheduled_drops: cron 5 menit (scheduled->live, live->closed)
-- ══════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════
-- 12. EXECUTE grants untuk signature baru (least-privilege, paritas phase 5)
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.accept_bid(text, public.shipment_to_dest, text) from public;
revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from public;
revoke execute on function public.payout_request(integer) from public;
revoke execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) from public;
revoke execute on function public.activate_scheduled_drops() from public;

grant execute on function public.accept_bid(text, public.shipment_to_dest, text) to authenticated;
grant execute on function public.buyout_card(text, public.shipment_to_dest, text) to authenticated;
grant execute on function public.payout_request(integer) to authenticated;
grant execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.activate_scheduled_drops() to service_role;
