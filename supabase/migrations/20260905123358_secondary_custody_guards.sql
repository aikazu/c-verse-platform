-- Preserve physical custody while trading; enforce the existing 3 C-Coin settlement minimum.
create or replace function public.assert_active_actor() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from users where id=auth.uid() and flag_reason is null) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;
end $$;
revoke all on function public.assert_active_actor() from public,anon,authenticated;
grant execute on function public.assert_active_actor() to service_role;
-- All listing writes use set_buyout. A direct PATCH must not skip its guards.
revoke update on public.cards from authenticated,anon;
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
  perform public.assert_active_actor();
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount < 3 then raise exception 'SECONDARY_PRICE_TOO_SMALL'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id is null then raise exception 'CARD_NOT_TRADABLE'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;
  if exists (select 1 from shipments where card_id = p_card_id
    and status not in ('delivered','cancelled')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

  -- C-12 rebuy 24 jam juga lewat jalur bid (paritas buyout_card): prev owner
  -- tidak boleh kembali memegang kartu yang baru ia jual (audit 2026-08-29).
  if exists (select 1 from ownership_history h
             where h.card_id = p_card_id and h.owner_id = v_user
             and h.transferred_at > now() - interval '24 hours') then
    raise exception 'COOLING_PERIOD_24H';
  end if;
  -- C-13 creator self-dealing 30 hari (FINAL, paritas buyout_card 2026-08-29):
  -- kreator drop tidak boleh bid kartu drop-nya sendiri dalam 30 hari.
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.creator_id = v_user
             and coalesce(d.drop_start_at, d.created_at) > now() - interval '30 days') then
    raise exception 'CREATOR_SELF_DEALING_30D';
  end if;
  -- C-13 EXTENSION untuk seed card (Flow 10, keputusan 2026-08-20):
  -- kreator pemilik seed TIDAK boleh membeli kembali kartu seed miliknya dalam
  -- 30 hari sejak kartu berada di tangan kreator. Hanya memblok KREATOR seed.
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.is_seed and d.creator_id = v_user) then
    if exists (
      select 1 from ownership_history h
      join drops d on d.id = v_card.drop_id
      where h.card_id = p_card_id and h.owner_id = d.creator_id
        and h.transferred_at > now() - interval '30 days'
    ) or (
      not exists (select 1 from ownership_history h where h.card_id = p_card_id and h.owner_id = v_user)
      and (select created_at from cards where id = p_card_id) > now() - interval '30 days'
    ) then
      raise exception 'CREATOR_SELF_DEALING_30D';
    end if;
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

  -- Audit 2026-09-04 p7: bidder_name denormalized ikut aturan masking "Anonim"
  -- (paritas maskBidderNames di API) — user anonim/suspended menyimpan 'Anonim',
  -- bukan display_name asli. Nama asli tidak pernah menyentuh baris bid.
  insert into bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status)
  values (gen_random_uuid()::text, p_card_id, v_user,
          coalesce((select case when is_anonymous or flag_reason is not null then 'Anonim' else display_name end
                    from users where id = v_user), 'Bidder'),
          p_amount, 'active')
  returning * into v_new;
  return v_new;
end $$;

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
  perform public.assert_active_actor();
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
  if p_price is not null and p_price < 3 then raise exception 'SECONDARY_PRICE_TOO_SMALL'; end if;
  if p_price is not null then
  if exists (select 1 from shipments where card_id = p_card_id
    and status not in ('delivered','cancelled')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  end if;
  if p_price is not null and coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

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

create or replace function public.accept_bid(
  p_card_id text,
  p_destination public.shipment_to_dest default 'platform_vault',
  p_address text default null
) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_bid public.bids;
  v_other public.bids;
  v_is_seed boolean := false;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
begin
  perform public.assert_active_actor();
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if exists (select 1 from shipments where card_id = p_card_id
    and status not in ('delivered','cancelled')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  if not coalesce(v_is_seed, false) and v_card.location <> 'platform_vault' then
    raise exception 'CARD_NOT_IN_VAULT';
  end if;

  select * into v_bid from bids where card_id = p_card_id and status = 'active'
  order by amount_ccoin desc limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_BID'; end if;

  -- Guard MIN_SECONDARY_PRICE_CCOIN (packages/shared/src/index.ts) — split CEIL
  -- butuh seller >= 1 (price 1/2 -> seller <= 0); tolak sebelum wallet writes.
  if v_bid.amount_ccoin < 3 then raise exception 'SECONDARY_PRICE_TOO_SMALL'; end if;

  -- ── PHASE-1 LOCK (seed belum vault-in + verified) ──────────────────────
  if v_is_seed and (v_card.location <> 'platform_vault'::card_location
                    or v_card.verify_status <> 'verified'::verify_status) then
    -- Every purchase settles to vault; legacy destination arguments are ignored.
    update bids set status = 'accepted', accepted_at = now(),
      destination = 'platform_vault', shipping_address = null
    where id = v_bid.id;

    for v_other in select * from bids where card_id = p_card_id and status = 'active' and id <> v_bid.id for update loop
      perform public.wallet_credit(v_other.bidder_id, v_other.amount_ccoin, 'escrow_release', 'bid', v_other.id, 'release-' || v_other.id);
      update bids set status = 'outbid', outbid_at = now() where id = v_other.id;
    end loop;

    update cards set status = 'bid_pending'::card_status, buyout_price_ccoin = null
    where id = p_card_id;

    return v_bid;
  end if;

  -- ── SETTLE LANGSUNG (seed vaulted / non-seed) ──────────────────────────
  -- Lane D (2026-08-31): platform/royalty CEIL — round-to-nearest lama
  -- menguapkan pendapatan di harga kecil (price 6 -> 0/0/6). Seller remainder.
  v_platform_ccoin := ceil(v_bid.amount_ccoin * 0.075);
  v_royalty_ccoin := ceil(v_bid.amount_ccoin * 0.075);
  v_seller_ccoin := v_bid.amount_ccoin - v_platform_ccoin - v_royalty_ccoin;

  perform public.wallet_credit_gems(v_user, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit_gems((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_bid', 'bid', v_bid.id, v_bid.amount_ccoin,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- XP buyer: spend = amount
  update users set total_xp = total_xp + v_bid.amount_ccoin,
    cumulative_spend_ccoin = cumulative_spend_ccoin + v_bid.amount_ccoin,
    level = least(100, greatest(1, floor((total_xp + v_bid.amount_ccoin) / 10) + 1))
  where id = v_bid.bidder_id;

  update bids set status = 'accepted', accepted_at = now() where id = v_bid.id;

  for v_other in select * from bids where card_id = p_card_id and status = 'active' and id <> v_bid.id for update loop
    perform public.wallet_credit(v_other.bidder_id, v_other.amount_ccoin, 'escrow_release', 'bid', v_other.id, 'release-' || v_other.id);
    update bids set status = 'outbid', outbid_at = now() where id = v_other.id;
  end loop;

  update cards set owner_id = v_bid.bidder_id, buyout_price_ccoin = null, status = 'sold',
    location = 'platform_vault'::card_location
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
  values (gen_random_uuid()::text, p_card_id, v_bid.bidder_id, 'secondary_bid', v_bid.id);

  return v_bid;
end $$;

create or replace function public.buyout_card(
  p_card_id text,
  p_destination public.shipment_to_dest default 'platform_vault',
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
  v_is_seed boolean := false;
  v_bid public.bids;
  v_debit_tx public.wallet_transactions;
  v_order_ref text;
begin
  perform public.assert_active_actor();
  select * into v_card from cards where id = p_card_id for update;
  if not found or v_card.buyout_price_ccoin is null then raise exception 'NOT_FOR_SALE'; end if;
  if v_card.owner_id = v_user then raise exception 'OWN_CARD'; end if;
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

  -- wash trading blok rebuy 24 jam (C-12 FINAL 2026-08-15) & creator self-dealing 30 hari (I14)
  if exists (select 1 from ownership_history h
             where h.card_id = p_card_id and h.owner_id = v_user
             and h.transferred_at > now() - interval '24 hours') then
    raise exception 'COOLING_PERIOD_24H';
  end if;
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.creator_id = v_user
             and coalesce(d.drop_start_at, d.created_at) > now() - interval '30 days') then
    raise exception 'CREATOR_SELF_DEALING_30D';
  end if;
  -- C-13 EXTENSION untuk seed card (Flow 10, keputusan 2026-08-20):
  -- kreator pemilik seed TIDAK boleh membeli kembali kartu seed miliknya dalam
  -- 30 hari sejak kartu berada di tangan kreator. Hanya memblok KREATOR seed.
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.is_seed and d.creator_id = v_user) then
    if exists (
      select 1 from ownership_history h
      join drops d on d.id = v_card.drop_id
      where h.card_id = p_card_id and h.owner_id = d.creator_id
        and h.transferred_at > now() - interval '30 days'
    ) or (
      not exists (select 1 from ownership_history h where h.card_id = p_card_id and h.owner_id = v_user)
      and (select created_at from cards where id = p_card_id) > now() - interval '30 days'
    ) then
      raise exception 'CREATOR_SELF_DEALING_30D';
    end if;
  end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if exists (select 1 from shipments where card_id = p_card_id
    and status not in ('delivered','cancelled')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  if not coalesce(v_is_seed, false) and v_card.location <> 'platform_vault' then
    raise exception 'CARD_NOT_IN_VAULT';
  end if;

  v_price := v_card.buyout_price_ccoin;
  v_seller := v_card.owner_id;

  -- Guard MIN_SECONDARY_PRICE_CCOIN (paritas accept_bid) — tolak sebelum
  -- wallet writes; di bawah 3 C seller share <= 0 pada split CEIL.
  if v_price < 3 then raise exception 'SECONDARY_PRICE_TOO_SMALL'; end if;

  -- ── PHASE-1 LOCK (seed belum vault-in + verified) ──────────────────────
  if v_is_seed and (v_card.location <> 'platform_vault'::card_location
                    or v_card.verify_status <> 'verified'::verify_status) then
    -- Every purchase settles to vault; legacy destination arguments are ignored.
    -- Invarian founder 2026-08-23: PHASE-1 buyout seed = escrow hold (bukan
    -- platform_buy), supaya TIDAK grant XP via trigger. Saldo buyer tetap
    -- turun; XP granted sekali di PHASE-2 release_seed_sale.
    v_debit_tx := public.wallet_debit(v_user, v_price, 'escrow_hold', 'card', p_card_id,
            'buyout-seed-' || gen_random_uuid()::text);
    v_order_ref := gen_random_uuid()::text;
    insert into orders (id, user_id, drop_id, card_id, total_ccoin, total_idr, status,
                        delivery_option, escrow_status, shipping_address, source)
    values (v_order_ref, v_user, v_card.drop_id, p_card_id, v_price, v_price * 10000,
            'paid', 'vault'::public.delivery_option,
            'held', null, 'secondary_buyout');

    -- release bid aktif (PHASE-1: tidak ada pemenang bid — buyout menang)
    for v_bid in select * from bids where card_id = p_card_id and status = 'active' for update loop
      perform public.wallet_credit(v_bid.bidder_id, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
      update bids set status = 'outbid', outbid_at = now() where id = v_bid.id;
    end loop;

    update cards set status = 'bid_pending'::card_status, buyout_price_ccoin = null
    where id = p_card_id
    returning * into v_card;

    return v_card;
  end if;

  -- ── SETTLE LANGSUNG (seed vaulted / non-seed) ──────────────────────────
  -- Lane D (2026-08-31): split CEIL (lihat accept_bid) — seller remainder.
  v_platform_ccoin := ceil(v_price * 0.075);
  v_royalty_ccoin := ceil(v_price * 0.075);
  v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

  -- Ref revenue = id tx debit (unik per transaksi; kartu bisa terjual berulang)
  v_debit_tx := public.wallet_debit(v_user, v_price, 'platform_buy', 'card', p_card_id,
          'buyout-' || gen_random_uuid()::text);
  perform public.wallet_credit_gems(v_seller, v_seller_ccoin, 'settlement', 'card', p_card_id, 'settle-' || gen_random_uuid()::text);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit_gems((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
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

  update cards set owner_id = v_user, buyout_price_ccoin = null, status = 'sold',
    location = 'platform_vault'::card_location
  where id = p_card_id
  returning * into v_card;

  insert into ownership_history (id, card_id, owner_id, acquired_via)
  values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout');

  return v_card;
end $$;
