-- 11: RPC bids (place_bid, cancel_bid) + set_buyout (part of consolidated RPC set; apply in lexical order).
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
  -- BID_CANCEL_COOLDOWN (BID_CANCEL_COOLDOWN_HOURS = 24): tolak sebelum wallet
  -- write apa pun. Boundary strict `>`: created_at tepat now()-24h sudah boleh.
  if v_bid.created_at > now() - interval '24 hours' then
    raise exception 'BID_CANCEL_COOLDOWN';
  end if;

  perform public.wallet_credit(v_user, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
  update bids set status = 'cancelled', cancelled_at = now() where id = p_bid_id returning * into v_bid;
  return v_bid;
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
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if p_price is not null and p_price < 1 then raise exception 'INVALID_AMOUNT'; end if;
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
