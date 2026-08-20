-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — Creator Seed C.Card: vault-in gate (FASE B, keputusan 2026-08-20)
-- Flow 10 (docs/03_flows.md): seed card 1-of-1 di-hadiahkan ke kreator
-- (kreator = owner), dijual di secondary NORMAL (bukan primary raffle).
-- GATE WAJIB: sebelum settle penjualan seed card ke buyer, kartu fisik
-- harus SUDAH masuk vault platform (location = 'platform_vault')
-- DAN terverifikasi NFC (verify_status = 'verified' — hanya bisa dicapai
-- via CMAC valid di apps/api/src/routes/nfc.ts, tidak bisa dipalsukan).
--
-- Provenance seed = flag DI LEVEL DROP: drops.is_seed boolean.
-- Alasan (keputusan user 2026-08-20): routing royalti & gate paling bersih
-- berbasis drop; cards.drop_id NOT NULL + drops.creator_id NOT NULL sudah
-- ada, jadi seed drop dibuat dengan creator_id = kreator target -> royalti
-- 7,5% otomatis ke kreator via kode existing (TANPA kolom fallback).
-- Teknis: alter add column if not exists -> aman re-run / idempoten.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.drops add column if not exists is_seed boolean not null default false;

comment on column public.drops.is_seed is
  'Seed card provenance: true = drop dibuat untuk Creator Seed C.Card (Flow 10, keputusan 2026-08-20). Kartu dari seed drop = kartu 1-of-1 tentang kreator yang di-hadiahkan ke kreator (drops.creator_id = pemilik awal), dijual di secondary normal. Gate vault-in (SEED_VAULT_IN_REQUIRED) berlaku: sebelum settle, kartu fisik wajib di platform_vault + NFC verified. BUKAN primary raffle — drop_start_at/drop_at tidak bermakna untuk seed drop (tidak ada entry window/draw).';

-- ══════════════════════════════════════════════════════════════════════════
-- accept_bid — create or replace: superset dari 20260817060000 (baris 396-466)
-- + gate seed vault-in. Signature identik, seluruh logika lama dipertahankan:
-- split 7,5/7,5/85, royalti ke drops.creator_id, record_platform_revenue,
-- XP buyer, outbid release, ownership_history, shipment secondary_bid.
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
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  -- Gate vault-in seed card: kartu dari seed drop wajib fisik di vault + NFC verified sebelum settle
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.is_seed)
     and (v_card.location <> 'platform_vault'::card_location or v_card.verify_status <> 'verified'::verify_status) then
    raise exception 'SEED_VAULT_IN_REQUIRED';
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

  update cards set owner_id = v_bid.bidder_id, buyout_price_ccoin = null, status = 'sold',
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
-- buyout_card — create or replace: superset dari 20260817060000 (baris 509-588)
-- + gate seed vault-in + perluasan C-13 untuk seed card.
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
  if coalesce(v_card.status::text, '') in ('tampered','defect','lost') then
    raise exception 'CARD_NOT_TRADABLE';
  end if;
  -- Gate vault-in seed card: kartu dari seed drop wajib fisik di vault + NFC verified sebelum settle
  if exists (select 1 from drops d where d.id = v_card.drop_id and d.is_seed)
     and (v_card.location <> 'platform_vault'::card_location or v_card.verify_status <> 'verified'::verify_status) then
    raise exception 'SEED_VAULT_IN_REQUIRED';
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
  -- C-13 EXTENSION untuk seed card (Flow 10, keputusan 2026-08-20):
  -- seed drop BUKAN raffle -> drop_start_at/drop_at tidak bermakna dan
  -- coalesce(...) di guard di atas jatuh ke created_at (kapan seed drop
  -- dibuat oleh tim internal) — itu belum tentu merefleksikan ownership
  -- kreator. Sasarannya: kreator pemilik seed TIDAK boleh membeli kembali
  -- kartu seed miliknya dalam 30 hari sejak kartu berada di tangan kreator.
  -- Basis pragmatis & konsisten: ownership_history terakhir milik kreator
  -- (owners.id = drops.creator_id menandai serah hadiah [3] -> transfer
  -- 'gift' atau 'primary' ke kreator), fallback cards.created_at bila tidak
  -- ada record ownership kreator sama sekali. Hanya memblok KREATOR seed
  -- (drops.creator_id = v_user) — buyer normal tidak terpengaruh.
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

  update cards set owner_id = v_user, buyout_price_ccoin = null, status = 'sold',
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
-- EXECUTE grants (pola 20260817060000:643-653 — least-privilege; re-grant
-- eksplisit karena create or replace mengganti definisi).
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.accept_bid(text, public.shipment_to_dest, text) from public;
revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from public;

grant execute on function public.accept_bid(text, public.shipment_to_dest, text) to authenticated;
grant execute on function public.buyout_card(text, public.shipment_to_dest, text) to authenticated;