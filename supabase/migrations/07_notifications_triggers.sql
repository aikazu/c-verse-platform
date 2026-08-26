-- P0-3 (audit 2026-08-24) lanjutan: trigger SQL agar tabel `notifications`
-- terisi otomatis untuk event-event penting tanpa menunggu perubahan manual
-- dari RPC. Trigger hanya INSERT ke notifications untuk channel='in_app' —
-- field 'sent' di-update dari worker email/push (TODO follow-up). Untuk
-- MVP, set status='sent' langsung dari trigger; worker push/email bisa
-- filter `where status='sent' and channel<>'in_app'` (untuk konsistensi).
--
-- Pemberitahuan yang dicakup:
--   - bids     : outbid + accepted
--   - cards    : ownership transfer (buyout/bid accept seed normal release)
--   - payouts  : status transitions
--   - shipments: created/diliveried
--
-- Idempotent: semua trigger dibuat drop-if-exists dulu agar migration bisa
-- diulang tanpa error saat development.

-- ══════════════════════════════════════════════════════════════════════════
-- Helper: lookup drop via card_id
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_drop_id_for_card(p_card_id text) returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select drop_id from public.cards where id = p_card_id limit 1;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. bids: outbid (saat ada bid baru yang lebih tinggi), accepted (saat owner
--    accept bid aktif). Beri tahu bidder yang di-outbid, lalu owner dapat
--    notifikasi saat ada bid baru dan saat accepted.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_notify_bid_change() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_creator text;
begin
  -- Arahkan bidder lama (status transisi dari 'active' ke 'outbid') bahwa
  -- bid mereka sudah disalip.
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'outbid' then
    insert into public.notifications(id, user_id, channel, template_key, payload, status)
    values (
      'nfb-'|| new.id || '-outbid-' || extract(epoch from now())::int::text,
      old.bidder_id,
      'in_app',
      'bid_outbid',
      jsonb_build_object('cardId', new.card_id, 'newBid', new.amount_ccoin, 'yourBid', old.amount_ccoin),
      'sent'
    );
  end if;

  -- Bila bid baru di-accept owner: notif ke bidder + notif ke pemilik kartu
  -- bahwa kartu terjual (cards.owner_id diupdate dengan trigger terpisah).
  if tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.notifications(id, user_id, channel, template_key, payload, status)
    values (
      'nfb-' || new.id || '-accept-' || extract(epoch from now())::int::text,
      new.bidder_id,
      'in_app',
      'bid_accepted',
      jsonb_build_object('cardId', new.card_id, 'amount', new.amount_ccoin),
      'sent'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bids_notify on public.bids;
create trigger trg_bids_notify
  after update on public.bids
  for each row execute function public.fn_notify_bid_change();

-- INSERT trigger: beritahu owner kartu saat ada bid baru masuk (active).
-- Hanya untuk bid yang ditempatkan langsung, tidak untuk yang dibuat via RPC
-- place_bid dengan outbid cascade.
create or replace function public.fn_notify_bid_insert() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.cards where id = new.card_id;
  if v_owner is not null and v_owner <> new.bidder_id then
    insert into public.notifications(id, user_id, channel, template_key, payload, status)
    values (
      'nfb-' || new.id || '-new-' || extract(epoch from now())::int::text,
      v_owner,
      'in_app',
      'bid_received',
      jsonb_build_object('cardId', new.card_id, 'bidderName', new.bidder_name, 'amount', new.amount_ccoin),
      'sent'
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

-- ══════════════════════════════════════════════════════════════════════════
-- 2. cards: ownership transfer — saat owner_id berubah ke user baru, kirim
--    notif ke seller lama (cards.buyout_price_ccoin sebelumnya nilainya) +
--    notif ke buyer baru.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_notify_card_owner_change() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_amount integer;
begin
  if tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id
     and old.owner_id is not null and new.owner_id is not null then
    v_amount := new.buyout_price_ccoin;

    insert into public.notifications(id, user_id, channel, template_key, payload, status)
    values (
      'nfc-' || new.id || '-sold-' || extract(epoch from now())::int::text,
      old.owner_id,
      'in_app',
      'card_bought',
      jsonb_build_object('cardId', new.id, 'amount', v_amount),
      'sent'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cards_owner_change on public.cards;
create trigger trg_cards_owner_change
  after update on public.cards
  for each row execute function public.fn_notify_card_owner_change();

-- ══════════════════════════════════════════════════════════════════════════
-- 3. payouts: status transitions ke paid/failed/unhold kirim notif.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_notify_payout_status() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'paid' then
      insert into public.notifications(id, user_id, channel, template_key, payload, status)
      values (
        'nfp-' || new.id || '-paid-' || extract(epoch from now())::int::text,
        new.user_id,
        'in_app',
        'payout_disbursed',
        jsonb_build_object('payoutId', new.id, 'amount', new.ccoin_amount),
        'sent'
      );
    elsif new.status = 'failed' or new.status = 'refunded' then
      insert into public.notifications(id, user_id, channel, template_key, payload, status)
      values (
        'nfp-' || new.id || '-fail-' || extract(epoch from now())::int::text,
        new.user_id,
        'in_app',
        'payout_failed',
        jsonb_build_object('payoutId', new.id, 'amount', new.ccoin_amount, 'status', new.status),
        'sent'
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

-- ══════════════════════════════════════════════════════════════════════════
-- 4. shipments: status transitions (caller-penting: shipped, delivered).
-- ══════════════════════════════════════════════════════════════════════════
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
      insert into public.notifications(id, user_id, channel, template_key, payload, status)
      values (
        'nfs-' || new.id || '-ship-' || extract(epoch from now())::int::text,
        v_buyer,
        'in_app',
        'shipment_shipped',
        jsonb_build_object('cardId', new.card_id, 'trackingNumber', new.tracking_number),
        'sent'
      );
    elsif new.status = 'delivered' then
      insert into public.notifications(id, user_id, channel, template_key, payload, status)
      values (
        'nfs-' || new.id || '-deliv-' || extract(epoch from now())::int::text,
        v_buyer,
        'in_app',
        'shipment_delivered',
        jsonb_build_object('cardId', new.card_id),
        'sent'
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
