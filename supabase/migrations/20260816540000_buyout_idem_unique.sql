-- ── Fix buyout_card: idempotency key per kartu replay saat re-sale ──────────
-- Bug: key 'buyout-<user>-<card>' / 'settle-<card>' / 'royalty-<card>' stabil
-- seumur kartu. Setelah kartu dijual ulang (melewati cooling period 14 hari),
-- pembelian berikutnya dari pemilik lama yang sama menganggap semua
-- debit/kredit sebagai replay idempotent: kartu berpindah tangan tanpa uang
-- bergerak. Idempotensi buyout sebenarnya sudah dijamin state (row lock
-- kartu + buyout_price di-null + guard NOT_FOR_SALE/OWN_CARD/cooling), jadi
-- key dibuat unik per transaksi.

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

  update cards set owner_id = v_user, buyout_price_ccoin = null, card_status_new = 'sold' where id = p_card_id
  returning * into v_card;

  insert into ownership_history (id, card_id, owner_id, acquired_via)
  values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout');

  return v_card;
end $$;
