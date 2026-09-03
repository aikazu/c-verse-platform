-- 04i: fungsi + trigger notifikasi (bids, cards, payouts, shipments, kyc) (part of consolidated RPC set; apply in lexical order).
create or replace function public.fn_notify_bid_change() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_creator text;
begin
  -- Arahkan bidder lama (status transisi dari 'active' ke 'outbid') bahwa
  -- bid mereka sudah disalip. In-app SAJA — high frequency, bukan email.
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'outbid' then
    perform public.notify_user(
      old.bidder_id,
      'bid_outbid',
      jsonb_build_object('cardId', new.card_id, 'newBid', new.amount_ccoin, 'yourBid', old.amount_ccoin),
      false
    );
  end if;

  -- Bila bid baru di-accept owner: notif ✉ ke bidder + notif ke pemilik kartu
  -- bahwa kartu terjual (cards.owner_id diupdate dengan trigger terpisah).
  -- Uang pindah antar-user, irreversible -> masuk queue email.
  if tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform public.notify_user(
      new.bidder_id,
      'bid_accepted',
      jsonb_build_object('cardId', new.card_id, 'amount', new.amount_ccoin),
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bids_notify on public.bids;
create trigger trg_bids_notify
  after update on public.bids
  for each row execute function public.fn_notify_bid_change();

create or replace function public.fn_notify_bid_insert() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.cards where id = new.card_id;
  -- Info bid masuk = in-app saja (bisa sering; bukan perpindahan uang).
  if v_owner is not null and v_owner <> new.bidder_id then
    perform public.notify_user(
      v_owner,
      'bid_received',
      jsonb_build_object('cardId', new.card_id, 'bidderName', new.bidder_name, 'amount', new.amount_ccoin),
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bids_notify_insert on public.bids;
create trigger trg_bids_notify_insert
  after insert on public.bids
  for each row when (new.status = 'active')
  execute function public.fn_notify_bid_insert();

create or replace function public.fn_notify_card_owner_change() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_amount integer;
  v_title text;
begin
  if tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id
     and old.owner_id is not null and new.owner_id is not null then
    v_amount := new.buyout_price_ccoin;
    select d.title into v_title from public.drops d where d.id = new.drop_id;

    -- Kartu terjual = uang masuk ke seller -> email ✉.
    perform public.notify_user(
      old.owner_id,
      'card_bought',
      jsonb_build_object('cardId', new.id, 'amount', v_amount, 'dropTitle', v_title),
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cards_owner_change on public.cards;
create trigger trg_cards_owner_change
  after update on public.cards
  for each row execute function public.fn_notify_card_owner_change();

create or replace function public.fn_notify_payout_status() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    -- FIX 2026-09-02 (ditemukan test queue email): status terminal payout
    -- adalah 'disbursed' (constraint payouts_status_check TIDAK punya 'paid') —
    -- branch 'paid' lama tidak pernah aktif.
    if new.status = 'disbursed' then
      -- Dana payout benar-benar berpindah -> email ✉.
      perform public.notify_user(
        new.user_id,
        'payout_disbursed',
        jsonb_build_object('payoutId', new.id, 'amount', new.ccoin_amount),
        true
      );
    elsif new.status = 'failed' or new.status = 'refunded' then
      perform public.notify_user(
        new.user_id,
        'payout_failed',
        jsonb_build_object('payoutId', new.id, 'amount', new.ccoin_amount, 'status', new.status),
        true
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payouts_status on public.payouts;
create trigger trg_payouts_status
  after update on public.payouts
  for each row execute function public.fn_notify_payout_status();

create or replace function public.fn_notify_shipment_status() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_buyer uuid;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    select owner_id into v_buyer from public.cards where id = new.card_id;
    if v_buyer is null then
      return new;
    end if;
    if new.status = 'shipped' then
      -- C.Card fisik dalam perjalanan (resi) -> email ✉.
      perform public.notify_user(
        v_buyer,
        'shipment_shipped',
        jsonb_build_object('cardId', new.card_id, 'trackingNumber', new.tracking_number),
        true
      );
    elsif new.status = 'delivered' then
      perform public.notify_user(
        v_buyer,
        'shipment_delivered',
        jsonb_build_object('cardId', new.card_id),
        true
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shipments_status on public.shipments;
create trigger trg_shipments_status
  after update on public.shipments
  for each row execute function public.fn_notify_shipment_status();

create or replace function public.fn_notify_kyc_status() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'approved' then
      perform public.notify_user(new.user_id, 'kyc_approved', jsonb_build_object('status', new.status), true);
    elsif new.status = 'rejected' then
      perform public.notify_user(new.user_id, 'kyc_rejected', jsonb_build_object('status', new.status), true);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kyc_notify on public.kyc_records;
create trigger trg_kyc_notify
  after update on public.kyc_records
  for each row execute function public.fn_notify_kyc_status();
