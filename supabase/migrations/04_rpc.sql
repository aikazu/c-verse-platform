-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 04_rpc: Semua SECURITY DEFINER RPC (FINAL versions) +
-- EXECUTE grants per role. Setiap RPC ditulis SATU KALI di versi finalnya;
-- patch intermediate (21020000/23010000/23020000/23030000/23040000/23050000)
-- sudah dilebur di sini.
--
-- Pemetaan sumber → final:
--   - wallet_debit:             20260817030000_rpc_atomic.sql           (tidak pernah di-patch)
--   - wallet_credit:            20260817060000_revenue_flow_hardening.sql (top-up cap)
--   - award_badge_if_eligible:  20260817030000_rpc_atomic.sql
--   - record_spend_conversion:  20260817030000_rpc_atomic.sql
--   - checkout:                 20260817060000_revenue_flow_hardening.sql (platform_revenue; vault-only settle 2026-08-28)
--   - drop_entry:               20260817030000_rpc_atomic.sql
--   - draw_drop:                20260817060000_revenue_flow_hardening.sql (platform_revenue + refund fallback)
--   - draw_pending_drops:       20260817030000_rpc_atomic.sql
--   (escrow_auto_release DIHAPUS 2026-08-28 — semua pembelian settle langsung
--    ke vault, tidak ada lagi escrow order shipping; cron call dihapus di Lane API)
--   - vault_shipout:            BARU 2026-08-28 (founder: ship fee dibayar saat
--    ship-out pasca-vault; ledger via treasury + platform_revenue ref_type 'shipment')
--   - place_bid:                20260821020000_seed_two_phase.sql (SALE_IN_PROGRESS + CARD_NOT_TRADABLE + BID_LIMIT)
--   - cancel_bid:               20260817030000_rpc_atomic.sql
--   - accept_bid:               20260821020000_seed_two_phase.sql (two-phase LOCK + settlement)
--   - set_buyout:               20260821020000_seed_two_phase.sql (SALE_IN_PROGRESS + CARD_NOT_TRADABLE + MAX_BUYOUT)
--   - buyout_card:              20260823020000_seed_xp_unify.sql (escrow_hold PHASE-1 + manual XP di release)
--   - payout_request:           20260817060000_revenue_flow_hardening.sql
--   - payout_batch_run:         20260823030000_release_seed_grant_lock.sql (+ PERMISSION_DENIED guard)
--   - record_platform_revenue:  20260817060000_revenue_flow_hardening.sql
--   - activate_scheduled_drops: 20260817060000_revenue_flow_hardening.sql
--   - release_seed_sale:        20260823030000_release_seed_grant_lock.sql (+ guard + Path B manual XP)
--   - cancel_seed_sale:         20260823050000_seed_sale_abort.sql (+ guard + idempotent)
--   - admin_fulfill_shipment:   20260823040000_admin_fulfill_tracking_trim.sql (+ guard + trim tracking)
--   - payout_refund:            20260823030000_release_seed_grant_lock.sql (+ guard)
--
-- Defense-in-depth: 4 service-only RPC (release_seed_sale, admin_fulfill_shipment,
-- payout_refund, payout_batch_run) + cancel_seed_sale SEMUA punya in-body
-- is_service_role() guard — pagar kedua jika EXECUTE grant bocor ke anon/authenticated.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- wallet_debit: idempotent by p_idem + XP trigger for checkout/platform_buy.
-- Guard: caller role in (authenticated, anon) → p_user must = auth.uid().
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

  -- spend 1 C-Coin = 1 XP (checkout/platform_buy); hold & payout bukan spend XP.
  -- cumulative_spend_ccoin mirrors spend-derived XP only (badge rewards excluded);
  -- top-up never reaches here. Used by gamification leaderboards/leveling.
  if p_type in ('checkout','platform_buy') then
    update users set total_xp = total_xp + p_amount,
      cumulative_spend_ccoin = cumulative_spend_ccoin + p_amount,
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
-- wallet_credit: idempotent by p_idem + cap top-up 500 C-Coin non-KYC.
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
-- award_badge_if_eligible: idempotent insert user_badges + XP grant.
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

-- Badge triggers (event-driven, idempotent)
create or replace function public.badge_on_ownership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
  v_creator_id uuid;
begin
  perform public.award_badge_if_eligible(new.owner_id, 'first_drop');
  select count(distinct card_id) into n from ownership_history where owner_id = new.owner_id;
  if n >= 5 then perform public.award_badge_if_eligible(new.owner_id, 'collector_5'); end if;
  -- Curator badge: owner holds >= 10 distinct cards from the SAME creator (drops.creator_id).
  -- Resolve once from new.card_id via cards→drops; NOT NULL constraints on both FK columns
  -- make v_creator_id non-null in practice, but guard defensively.
  select d.creator_id into v_creator_id
    from public.cards c
    join public.drops d on d.id = c.drop_id
    where c.id = new.card_id;
  if v_creator_id is not null then
    select count(distinct oh.card_id) into n
      from public.ownership_history oh
      join public.cards c on c.id = oh.card_id
      join public.drops d on d.id = c.drop_id
      where oh.owner_id = new.owner_id and d.creator_id = v_creator_id;
    if n >= 10 then perform public.award_badge_if_eligible(new.owner_id, 'curator'); end if;
  end if;
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
-- record_spend_conversion: 0-amount tx untuk raffle winner XP record
-- (hold → settled konversi).
-- ══════════════════════════════════════════════════════════════════════════
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
    cumulative_spend_ccoin = cumulative_spend_ccoin + p_amount,
    level = least(100, greatest(1, floor((total_xp + p_amount) / 10) + 1))
  where id = p_user;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- record_platform_revenue: insert ledger + kredit treasury (idempotent per ref).
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
    case
      -- shipment fee = pendapatan platform penuh (vault_shipout, 2026-08-28)
      when p_source = 'shipment'
        then jsonb_build_object('platform_pct', 1.0, 'royalty_pct', 0, 'seller_pct', 0, 'rate_idr', 10000)
      when p_source = 'primary'
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
-- checkout: FCFS primary sale — settle LANGSUNG ke vault (founder 2026-08-28):
-- tanpa alamat/ongkir di titik beli (pool regular/premium TETAP). Kartu ->
-- platform_vault, order settled + escrow released. Revenue 70/30 tetap
-- tercatat di titik beli. Shipping = flow terpisah pasca-vault via
-- vault_shipout. Lock + sold_out + limit 1/user/drop atomik.
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.checkout(text, text, public.delivery_option, text, integer);
drop function if exists public.checkout(text);
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

  perform public.wallet_debit(v_user, v_price, 'checkout', 'drop', p_drop_id,
          'checkout-' || v_user || '-' || p_drop_id);

  update cards set owner_id = v_user,
    status = 'bound',
    location = 'platform_vault'::card_location
  where id = v_card.id;

  update drops set sold_count = sold_count + 1,
    status = (case when sold_count + 1 >= total_units then 'sold_out'::drop_status else status end)
  where id = p_drop_id;

  insert into orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status,
                      delivery_option, shipping_fee_ccoin, escrow_status, shipping_address, source)
  values (gen_random_uuid()::text, v_user, p_drop_id, v_card.id, array[v_card.id], v_price, v_price * 10000,
          'settled'::order_status, 'vault'::delivery_option, null,
          'released'::escrow_status, null, 'fcfs')
  returning * into v_order;

  insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
  values (gen_random_uuid()::text, v_card.id, v_user, 'primary', v_order.id);

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
-- vault_shipout: owner minta ship-out kartu dari platform vault dan BAYAR
-- ship fee di titik ini (founder 2026-08-28). Atomic dalam satu transaksi:
-- wallet_debit fee + record_platform_revenue (ref_type 'shipment', fee penuh
-- ke treasury) + insert shipments 'vault_shipout' requested (queue admin).
-- Anti double-ship: raise manual SHIPMENT_ACTIVE (bukan raw unique violation),
-- paritas dengan partial unique index uq_shipments_active_per_card.
-- Catatan: p_type 'vault_shipout' WAJIB terdaftar di enum wallet_tx_type
-- (01_schema.sql — domain Lane Schema).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.vault_shipout(
  p_card_id text,
  p_address text,
  p_fee_ccoin integer
) returns public.shipments
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_is_seed boolean := false;
  v_shipment public.shipments;
  v_shipment_id text := gen_random_uuid()::text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_fee_ccoin is null or p_fee_ccoin < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_address is null or length(trim(p_address)) < 10 then raise exception 'ADDRESS_REQUIRED'; end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  if v_card.owner_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if v_card.location <> 'platform_vault'::card_location then raise exception 'CARD_NOT_IN_VAULT'; end if;

  -- kartu tidak boleh dalam seed PHASE-1 pending (escrow hold / bid_pending)
  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if coalesce(v_is_seed, false) and v_card.status = 'bid_pending'::card_status then
    raise exception 'SEED_SALE_IN_PROGRESS';
  end if;

  -- anti double-ship: cek eksplisit sebelum insert; terminal (delivered/
  -- cancelled) dikecualikan agar kartu bisa di-ship ulang (paritas index).
  if exists (
    select 1 from shipments
    where card_id = p_card_id
      and status not in ('delivered'::shipment_status, 'cancelled'::shipment_status)
  ) then
    raise exception 'SHIPMENT_ACTIVE';
  end if;

  -- 1) debit ship fee (idem unik per attempt; replay diblok guard SHIPMENT_ACTIVE;
  --    bukan spend XP — type 'vault_shipout' di luar daftar XP wallet_debit)
  perform public.wallet_debit(v_user, p_fee_ccoin, 'vault_shipout', 'card', p_card_id,
          'shipout-' || v_user || '-' || p_card_id || '-' || v_shipment_id);

  -- 2) ledger: ship fee = pendapatan platform penuh -> treasury + platform_revenue
  perform public.record_platform_revenue('shipment', 'shipment', v_shipment_id, p_fee_ccoin,
          p_fee_ccoin, 0, 0);

  -- 3) shipment queue admin (fulfil via admin_fulfill_shipment)
  insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, fee_ccoin, status)
  values (v_shipment_id, p_card_id, v_user, 'vault_shipout', 'platform', 'buyer_address',
          jsonb_build_object('street', p_address), p_fee_ccoin, 'requested')
  returning * into v_shipment;

  -- 4) parity jalur ship-out lama: kartu keluar QC → layak kirim (display admin)
  update cards set qc_status = 'passed' where id = p_card_id;

  return v_shipment;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- drop_entry: raffle entry — escrow hold (bukan spend, no XP).
-- ══════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════
-- draw_drop: raffle draw + revenue tercatat + refund selisih hold premium→regular.
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

      v_royalty := (floor(v_price * 0.3))::integer;
      if v_royalty >= 1 then
        perform public.wallet_credit(v_drop.creator_id, v_royalty, 'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
      end if;
      perform public.record_platform_revenue('primary', 'order', v_order.id, v_price, v_price - v_royalty, v_royalty, 0);

      update drop_entries set status = 'won_premium' where id = v_entry.id;
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
-- draw_pending_drops: cron (setiap 5 menit).
-- ══════════════════════════════════════════════════════════════════════════
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
-- escrow_auto_release DIHAPUS (founder 2026-08-28): semua pembelian settle
-- langsung ke vault — tidak ada lagi order shipping ber-escrow 'held' baru,
-- jadi cron H+7 tidak punya pekerjaan. (Sebelumnya: 20260817030000.)
drop function if exists public.escrow_auto_release();
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- place_bid: SALE_IN_PROGRESS guard (seed PHASE-1) + CARD_NOT_TRADABLE +
-- maks 3 bid aktif per user. Refund active bid saat outbid.
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
-- cancel_bid: bidder cancel own active bid (escrow release).
-- ══════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════
-- accept_bid: TWO-PHASE seed sale (PHASE-1 LOCK untuk seed yang belum
-- vault-in/verified; settle langsung untuk seed vaulted/non-seed).
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.accept_bid(text, public.shipment_to_dest, text);
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
  v_is_seed boolean := false;
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
  if v_card.status::text = 'bid_pending' then
    raise exception 'SALE_IN_PROGRESS';
  end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;

  select * into v_bid from bids where card_id = p_card_id and status = 'active'
  order by amount_ccoin desc limit 1 for update;
  if not found then raise exception 'NO_ACTIVE_BID'; end if;

  -- ── PHASE-1 LOCK (seed belum vault-in + verified) ──────────────────────
  if v_is_seed and (v_card.location <> 'platform_vault'::card_location
                    or v_card.verify_status <> 'verified'::verify_status) then
    -- alamat hanya relevan untuk seed PHASE-1 (disimpan di bid untuk
    -- release_seed_sale); settle non-seed tidak butuh alamat (2026-08-28).
    if p_destination = 'buyer_address' and (p_address is null or length(trim(p_address)) < 10) then
      raise exception 'ADDRESS_REQUIRED';
    end if;
    update bids set status = 'accepted', accepted_at = now(),
      destination = p_destination, shipping_address = p_address
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

-- ══════════════════════════════════════════════════════════════════════════
-- set_buyout: listing/unlisting + MAX 20 aktif (paritas check + RLS guard).
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

-- ══════════════════════════════════════════════════════════════════════════
-- buyout_card: TWO-PHASE seed sale (PHASE-1 LOCK escrow_hold untuk seed
-- yang belum vault-in/verified; settle langsung untuk seed vaulted/non-seed).
-- COOLING_PERIOD_24H + CREATOR_SELF_DEALING_30D + C-13 EXTENSION (seed card).
-- ══════════════════════════════════════════════════════════════════════════
drop function if exists public.buyout_card(text, public.shipment_to_dest, text);
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
  v_is_seed boolean := false;
  v_bid public.bids;
  v_debit_tx public.wallet_transactions;
  v_order_ref text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
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
             and coalesce(d.drop_start_at, d.drop_at, d.created_at) > now() - interval '30 days') then
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

  v_price := v_card.buyout_price_ccoin;
  v_seller := v_card.owner_id;

  -- ── PHASE-1 LOCK (seed belum vault-in + verified) ──────────────────────
  if v_is_seed and (v_card.location <> 'platform_vault'::card_location
                    or v_card.verify_status <> 'verified'::verify_status) then
    -- alamat hanya relevan untuk seed PHASE-1 (disimpan di order untuk
    -- release_seed_sale); settle non-seed tidak butuh alamat (2026-08-28).
    if p_destination = 'buyer_address' and (p_address is null or length(trim(p_address)) < 10) then
      raise exception 'ADDRESS_REQUIRED';
    end if;
    -- Invarian founder 2026-08-23: PHASE-1 buyout seed = escrow hold (bukan
    -- platform_buy), supaya TIDAK grant XP via trigger. Saldo buyer tetap
    -- turun; XP granted sekali di PHASE-2 release_seed_sale.
    v_debit_tx := public.wallet_debit(v_user, v_price, 'escrow_hold', 'card', p_card_id,
            'buyout-seed-' || gen_random_uuid()::text);
    v_order_ref := gen_random_uuid()::text;
    insert into orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status,
                        delivery_option, escrow_status, shipping_address, source)
    values (v_order_ref, v_user, v_card.drop_id, p_card_id, array[p_card_id], v_price, v_price * 10000,
            'paid', (case when p_destination = 'platform_vault' then 'vault'::public.delivery_option else 'shipping'::public.delivery_option end),
            'held', p_address, 'secondary_buyout');

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
    location = 'platform_vault'::card_location
  where id = p_card_id
  returning * into v_card;

  insert into ownership_history (id, card_id, owner_id, acquired_via)
  values (gen_random_uuid()::text, p_card_id, v_user, 'secondary_buyout');

  return v_card;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- payout_request: creator minta disbursement (KYC + min 10 + hold check).
-- ══════════════════════════════════════════════════════════════════════════
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
-- payout_batch_run: cron Workers (Selasa 06:00 WIB). service_role ONLY +
-- in-body PERMISSION_DENIED guard (defense-in-depth, audit 2026-08-23).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.payout_batch_run(p_min_ccoin integer default 10) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_batch_id text;
  v_count integer;
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: payout_batch_run requires service_role';
  end if;

  select count(*) into v_count
  from payouts p
  join users u on u.id = p.user_id
  join kyc_records k on k.user_id = p.user_id and k.status = 'approved'
  left join wallets w on w.user_id = p.user_id
  where p.status = 'pending'
    and p.batch_id is null
    and p.ccoin_amount >= p_min_ccoin
    and coalesce(w.hold_payout_until, now()) <= now();
  if v_count = 0 then
    return null;
  end if;

  insert into payout_batches (id, batch_code, status, total_ccoin, total_idr, fee_1pct_idr)
  values (
    gen_random_uuid()::text,
    'PB-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    'processing',
    0,
    0,
    0
  )
  returning id into v_batch_id;

  -- net_idr = (ccoin - ceil(ccoin x 0.01)) x 10.000 (100 C -> 99 C -> Rp 990.000)
  update payouts p
  set batch_id = v_batch_id,
      idr_amount = (p.ccoin_amount - ceil(p.ccoin_amount * 0.01)) * 10000
  where p.status = 'pending'
    and p.batch_id is null
    and p.ccoin_amount >= p_min_ccoin
    and p.user_id in (select user_id from kyc_records where status = 'approved')
    and not exists (
      select 1 from wallets w
      where w.user_id = p.user_id and w.hold_payout_until > now()
    );

  update payout_batches b
  set total_ccoin = s.gross_ccoin,
      total_idr = s.net_idr,
      fee_1pct_idr = s.fee_idr
  from (
    select
      coalesce(sum(ccoin_amount), 0) as gross_ccoin,
      coalesce(sum(idr_amount), 0) as net_idr,
      coalesce(sum(ceil(ccoin_amount * 0.01)) * 10000, 0) as fee_idr
    from payouts where batch_id = v_batch_id
  ) s
  where b.id = v_batch_id;

  return v_batch_id;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- activate_scheduled_drops: cron 5 menit (scheduled->live, live->closed).
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
-- release_seed_sale: PHASE-2 SETTLEMENT seed (service_role ONLY +
-- in-body PERMISSION_DENIED guard). Path A = accepted-bid, Path B =
-- order pending. XP buyer granted TEPAT SEKALI di release (founder 2026-08-23).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.release_seed_sale(p_card_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards;
  v_is_seed boolean;
  v_bid public.bids;
  v_order public.orders;
  v_seller uuid;
  v_price integer;
  v_seller_ccoin integer;
  v_platform_ccoin integer;
  v_royalty_ccoin integer;
  v_royalty_credited integer := 0;
  v_buyer uuid;
  v_dest public.shipment_to_dest;
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: release_seed_sale requires service_role';
  end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  if v_card.status::text <> 'bid_pending' then
    raise exception 'NO_PENDING_SALE';
  end if;

  -- GATE PHASE-2: fisik wajib di vault + NFC verified (verified HANYA via
  -- tap crypto nfc.ts — admin tidak bisa memalsukan).
  if v_card.location <> 'platform_vault'::card_location
     or v_card.verify_status <> 'verified'::verify_status then
    raise exception 'SEED_VAULT_IN_REQUIRED';
  end if;

  -- ── Path A: accepted bid (owner accept -> PHASE-1) ─────────────────────
  select * into v_bid from bids where card_id = p_card_id and status = 'accepted'
  order by accepted_at desc nulls last limit 1;
  if found then
    v_seller := v_card.owner_id;
    v_price := v_bid.amount_ccoin;
    v_buyer := v_bid.bidder_id;
    v_dest := coalesce(v_bid.destination, 'buyer_address'::public.shipment_to_dest);

    v_platform_ccoin := round(v_price * 0.075);
    v_royalty_ccoin := round(v_price * 0.075);
    v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

    perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'bid', v_bid.id, 'settle-' || v_bid.id);
    if v_royalty_ccoin >= 1 then
      perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
              'royalty', 'bid', v_bid.id, 'royalty-' || v_bid.id);
      v_royalty_credited := v_royalty_ccoin;
    end if;
    perform public.record_platform_revenue('secondary_bid', 'bid', v_bid.id, v_price,
            v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

    -- XP buyer: spend = amount (PHASE-2 release — invariant founder 2026-08-23).
    update users set total_xp = total_xp + v_price,
      cumulative_spend_ccoin = cumulative_spend_ccoin + v_price,
      level = least(100, greatest(1, floor((total_xp + v_price) / 10) + 1))
    where id = v_buyer;

    update cards set owner_id = v_buyer, buyout_price_ccoin = null, status = 'sold',
      location = (case when v_dest = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
    where id = p_card_id;

    insert into ownership_history (id, card_id, owner_id, acquired_via, bid_id)
    values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_bid', v_bid.id);

    if v_dest = 'buyer_address' then
      insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
      values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_bid', 'platform', 'buyer_address',
              jsonb_build_object('street', coalesce(v_bid.shipping_address, '')),
              'requested');
    end if;

    return;
  end if;

  -- ── Path B: order pending (buyout PHASE-1 — escrow 'held') ─────────────
  select * into v_order from orders
  where card_id = p_card_id and status = 'paid'::order_status
    and escrow_status = 'held'::escrow_status and source = 'secondary_buyout'
  order by created_at desc limit 1;
  if not found then
    raise exception 'NO_PENDING_SALE';
  end if;

  v_seller := v_card.owner_id;
  v_price := v_order.total_ccoin;
  v_buyer := v_order.user_id;
  v_dest := (case when v_order.delivery_option = 'vault' then 'platform_vault'::public.shipment_to_dest else 'buyer_address'::public.shipment_to_dest end);

  v_platform_ccoin := round(v_price * 0.075);
  v_royalty_ccoin := round(v_price * 0.075);
  v_seller_ccoin := v_price - v_platform_ccoin - v_royalty_ccoin;

  perform public.wallet_credit(v_seller, v_seller_ccoin, 'settlement', 'order', v_order.id, 'settle-' || v_order.id);
  if v_royalty_ccoin >= 1 then
    perform public.wallet_credit((select creator_id from drops where id = v_card.drop_id), v_royalty_ccoin,
            'royalty', 'order', v_order.id, 'royalty-' || v_order.id);
    v_royalty_credited := v_royalty_ccoin;
  end if;
  perform public.record_platform_revenue('secondary_buyout', 'order', v_order.id, v_price,
          v_platform_ccoin, v_royalty_credited, v_seller_ccoin);

  -- XP buyer: PHASE-2 release (invariant founder 2026-08-23).
  update users set total_xp = total_xp + v_price,
    cumulative_spend_ccoin = cumulative_spend_ccoin + v_price,
    level = least(100, greatest(1, floor((total_xp + v_price) / 10) + 1))
  where id = v_buyer;

  update orders set status = 'settled'::order_status, escrow_status = 'released'::escrow_status
  where id = v_order.id;

  update cards set owner_id = v_buyer, buyout_price_ccoin = null, status = 'sold',
    location = (case when v_dest = 'platform_vault' then 'platform_vault'::card_location else 'with_owner'::card_location end)
  where id = p_card_id;

  insert into ownership_history (id, card_id, owner_id, acquired_via, order_id)
  values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_buyout', v_order.id);

  if v_dest = 'buyer_address' then
    insert into shipments (id, card_id, requester_id, type, from_location, to_dest, address, status)
    values (gen_random_uuid()::text, p_card_id, v_buyer, 'secondary_buyout', 'platform', 'buyer_address',
            jsonb_build_object('street', coalesce(v_order.shipping_address, '')),
            'requested');
  end if;

  return;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- cancel_seed_sale: ADMIN ABORT stuck seed PHASE-1 (service_role ONLY).
-- Path A refund accepted-bid winner; Path B refund order buyer. Idempotent
-- via 'seed-abort-'||card_id idem key. Tidak touch treasury/platform_revenue
-- (PHASE-1 menulis TIDAK ada revenue leg).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.cancel_seed_sale(p_card_id text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards;
  v_is_seed boolean;
  v_bid public.bids;
  v_order public.orders;
  v_buyer uuid;
  v_refund_amount integer;
  v_path text;
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: cancel_seed_sale requires service_role';
  end if;

  -- Idempotent: kalau sudah pernah refund (idempotency_key tercatat),
  -- return ringkasan tanpa double-credit.
  if exists (
    select 1 from wallet_transactions
    where metadata->>'idempotency_key' = 'seed-abort-' || p_card_id
  ) then
    select c.user_id, c.amount_ccoin into v_buyer, v_refund_amount
      from wallet_transactions c
      where c.metadata->>'idempotency_key' = 'seed-abort-' || p_card_id
      limit 1;
    return json_build_object(
      'cardId', p_card_id,
      'refundedCcoin', v_refund_amount,
      'buyerId', v_buyer,
      'path', coalesce(v_path, 'unknown'),
      'alreadyAborted', true
    );
  end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  if v_card.status::text <> 'bid_pending' then
    raise exception 'NO_PENDING_SALE';
  end if;

  -- ── Path A: accepted bid ────────────────────────────────────────────────
  select * into v_bid from bids where card_id = p_card_id and status = 'accepted'
  order by accepted_at desc nulls last limit 1;
  if found then
    v_buyer := v_bid.bidder_id;
    v_refund_amount := v_bid.amount_ccoin;
    v_path := 'bid';

    perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'bid', v_bid.id,
            'seed-abort-' || p_card_id);

    update bids set status = 'cancelled', cancelled_at = now() where id = v_bid.id;

    update cards set status = 'inventory'::card_status where id = p_card_id;

    return json_build_object(
      'cardId', p_card_id,
      'refundedCcoin', v_refund_amount,
      'buyerId', v_buyer,
      'path', v_path
    );
  end if;

  -- ── Path B: order pending ─────────────────────────────────────────────
  select * into v_order from orders
  where card_id = p_card_id and status = 'paid'::order_status
    and escrow_status = 'held'::escrow_status and source = 'secondary_buyout'
  order by created_at desc limit 1;
  if not found then
    raise exception 'NO_PENDING_SALE';
  end if;

  v_buyer := v_order.user_id;
  v_refund_amount := v_order.total_ccoin;
  v_path := 'buyout';

  perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'order', v_order.id,
          'seed-abort-' || p_card_id);

  update orders set status = 'refunded'::order_status where id = v_order.id;
  update cards set status = 'inventory'::card_status where id = p_card_id;

  return json_build_object(
    'cardId', p_card_id,
    'refundedCcoin', v_refund_amount,
    'buyerId', v_buyer,
    'path', v_path
  );
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_fulfill_shipment: atomic shipment + order + card update.
-- service_role ONLY + in-body PERMISSION_DENIED guard + trim tracking
-- (audit 2026-08-23).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_fulfill_shipment(
  p_id text,
  p_status text,
  p_tracking text default null
) returns public.shipments
language plpgsql security definer set search_path = public as $$
declare
  v_shipment public.shipments;
  v_tracking text := nullif(btrim(coalesce(p_tracking, '')), '');
  v_allowed text[];
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: admin_fulfill_shipment requires service_role';
  end if;

  if p_id is null or p_id = '' then
    raise exception 'INVALID_ARG';
  end if;
  if p_status is null or p_status not in ('requested','packed','shipped','delivered','cancelled') then
    raise exception 'INVALID_ARG: status % tidak dikenal', p_status;
  end if;

  select * into v_shipment from shipments where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Mirror SHIPMENT_TRANSITIONS dari apps/api/src/routes/shipments.ts:
  --   requested: packed/shipped/cancelled
  --   packed:    shipped/cancelled
  --   shipped:   delivered
  --   delivered/cancelled: terminal
  v_allowed := case v_shipment.status
    when 'requested' then array['packed','shipped','cancelled']
    when 'packed'    then array['shipped','cancelled']
    when 'shipped'   then array['delivered']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'INVALID_TRANSITION: % -> %', v_shipment.status, p_status;
  end if;

  -- 1) Update shipment row (status selalu, tracking_number hanya jika non-empty).
  update shipments
    set status = p_status,
        tracking_number = coalesce(v_tracking, tracking_number)
    where id = v_shipment.id
    returning * into v_shipment;

  -- 2) Side effects bercabang sesuai status.
  if p_status = 'shipped' then
    update orders
      set status = 'shipped'::order_status,
          shipped_at = now()
      where card_id = v_shipment.card_id
        and delivery_option = 'shipping'::delivery_option
        and status = 'paid'::order_status;
  elsif p_status = 'delivered' then
    update cards set location = 'with_owner' where id = v_shipment.card_id;
    update orders
      set status = 'delivered'::order_status,
          delivered_at = now()
      where card_id = v_shipment.card_id
        and delivery_option = 'shipping'::delivery_option
        and status = 'shipped'::order_status;
  end if;

  -- 3) Propagate tracking ke SEMUA baris orders terkait card.
  if v_tracking is not null then
    update orders set tracking_number = v_tracking where card_id = v_shipment.card_id;
  end if;

  return v_shipment;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- payout_refund: admin return locked funds to creator (service_role ONLY).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.payout_refund(p_payout_id text) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v_payout public.payouts;
begin
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: payout_refund requires service_role';
  end if;

  if p_payout_id is null or p_payout_id = '' then
    raise exception 'INVALID_ARG';
  end if;

  select * into v_payout from payouts where id = p_payout_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_payout.status in ('disbursed','refunded') then
    raise exception 'INVALID_STATE: payout status % tidak bisa di-refund', v_payout.status;
  end if;

  perform public.wallet_credit(
    v_payout.user_id,
    v_payout.ccoin_amount,
    'payout_refund',
    'payout',
    v_payout.id,
    'payout-refund-' || v_payout.id
  );

  update payouts set status = 'refunded' where id = v_payout.id returning * into v_payout;
  return v_payout;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- get_leaderboard: read-only leaderboard by type (xp / cards / badges /
-- creator). Order: score DESC, reached_at ASC, username ASC NULLS LAST,
-- user_id ASC (absolute determinism). Pure read — SECURITY DEFINER untuk
-- konsistensi filter `is_anonymous = false AND flag_reason IS NULL`. Search_path
-- pinned; STABLE; validasi type + clamp limit (5..50).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.get_leaderboard(
  p_type text,
  p_creator_id uuid default null,
  p_limit integer default 20
) returns table(
  rank bigint,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  total_xp integer,
  score bigint,
  reached_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit integer := greatest(5, least(coalesce(p_limit, 20), 50));
begin
  if p_type not in ('xp','cards','badges','creator') then
    raise exception 'INVALID_LEADERBOARD_TYPE: %, expected xp|cards|badges|creator', p_type;
  end if;
  if p_type = 'creator' and p_creator_id is null then
    raise exception 'creator_id is required for creator leaderboard';
  end if;

  if p_type = 'xp' then
    return query
      select
        row_number() over (order by u.total_xp desc, u.xp_reached_at asc, u.username asc nulls last, u.id asc)::bigint as rank,
        u.id, u.display_name, u.username, u.avatar_url, u.total_xp,
        u.total_xp::bigint as score,
        u.xp_reached_at as reached_at
      from public.users u
      where u.is_anonymous = false and u.flag_reason is null
      order by u.total_xp desc, u.xp_reached_at asc, u.username asc nulls last, u.id asc
      limit v_limit;

  elsif p_type = 'cards' then
    return query
      with agg as (
        select c.owner_id as user_id,
               count(*)::bigint as score,
               max(c.owner_since) as reached_at
        from public.cards c
        where c.owner_id is not null
        group by c.owner_id
      )
      select
        row_number() over (order by a.score desc, a.reached_at asc, u.username asc nulls last, u.id asc)::bigint as rank,
        u.id, u.display_name, u.username, u.avatar_url, u.total_xp,
        a.score,
        a.reached_at
      from agg a
      join public.users u on u.id = a.user_id
      where u.is_anonymous = false and u.flag_reason is null
      order by a.score desc, a.reached_at asc, u.username asc nulls last, u.id asc
      limit v_limit;

  elsif p_type = 'badges' then
    return query
      with agg as (
        select ub.user_id,
               count(*)::bigint as score,
               max(ub.earned_at) as reached_at
        from public.user_badges ub
        group by ub.user_id
      )
      select
        row_number() over (order by a.score desc, a.reached_at asc, u.username asc nulls last, u.id asc)::bigint as rank,
        u.id, u.display_name, u.username, u.avatar_url, u.total_xp,
        a.score,
        a.reached_at
      from agg a
      join public.users u on u.id = a.user_id
      where u.is_anonymous = false and u.flag_reason is null
      order by a.score desc, a.reached_at asc, u.username asc nulls last, u.id asc
      limit v_limit;

  else -- p_type = 'creator'
    return query
      with agg as (
        select c.owner_id as user_id,
               count(*)::bigint as score,
               max(c.owner_since) as reached_at
        from public.cards c
        join public.drops d on d.id = c.drop_id
        where c.owner_id is not null and d.creator_id = p_creator_id
        group by c.owner_id
      )
      select
        row_number() over (order by a.score desc, a.reached_at asc, u.username asc nulls last, u.id asc)::bigint as rank,
        u.id, u.display_name, u.username, u.avatar_url, u.total_xp,
        a.score,
        a.reached_at
      from agg a
      join public.users u on u.id = a.user_id
      where u.is_anonymous = false and u.flag_reason is null
      order by a.score desc, a.reached_at asc, u.username asc nulls last, u.id asc
      limit v_limit;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- EXECUTE grants (least-privilege). service-only RPC di-revoke dari public/
-- anon/authenticated; user-facing RPC ke authenticated.
-- Pola: revoke from public (cover anon + authenticated via PUBLIC member),
-- grant to target role. In-body is_service_role() guard tetap pagar kedua.
-- ══════════════════════════════════════════════════════════════════════════

-- Wallet operations
revoke execute on function public.wallet_debit(uuid, integer, text, text, text, text) from public;
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to authenticated;

revoke execute on function public.wallet_credit(uuid, integer, text, text, text, text) from public;
grant execute on function public.wallet_credit(uuid, integer, text, text, text, text) to service_role;

-- Checkout / bid / marketplace — user-facing
revoke execute on function public.checkout(text, text) from public;
grant execute on function public.checkout(text, text) to authenticated;

revoke execute on function public.vault_shipout(text, text, integer) from public;
grant execute on function public.vault_shipout(text, text, integer) to authenticated;

revoke execute on function public.drop_entry(text, text) from public;
grant execute on function public.drop_entry(text, text) to authenticated;

revoke execute on function public.place_bid(text, integer) from public;
grant execute on function public.place_bid(text, integer) to authenticated;

revoke execute on function public.cancel_bid(text) from public;
grant execute on function public.cancel_bid(text) to authenticated;

revoke execute on function public.accept_bid(text, public.shipment_to_dest, text) from public;
grant execute on function public.accept_bid(text, public.shipment_to_dest, text) to authenticated;

revoke execute on function public.set_buyout(text, integer) from public;
grant execute on function public.set_buyout(text, integer) to authenticated;

revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from public;
grant execute on function public.buyout_card(text, public.shipment_to_dest, text) to authenticated;

-- Badges + XP — internal/service
revoke execute on function public.award_badge_if_eligible(uuid, text) from public;
grant execute on function public.award_badge_if_eligible(uuid, text) to service_role;

revoke execute on function public.record_spend_conversion(uuid, integer, text) from public;
grant execute on function public.record_spend_conversion(uuid, integer, text) to service_role;

-- Cron — service_role only
revoke execute on function public.draw_drop(text) from public;
grant execute on function public.draw_drop(text) to service_role;

revoke execute on function public.draw_pending_drops() from public;
grant execute on function public.draw_pending_drops() to service_role;

revoke execute on function public.activate_scheduled_drops() from public;
grant execute on function public.activate_scheduled_drops() to service_role;

revoke execute on function public.payout_batch_run(integer) from public;
revoke execute on function public.payout_batch_run(integer) from anon;
revoke execute on function public.payout_batch_run(integer) from authenticated;
grant execute on function public.payout_batch_run(integer) to service_role;

-- Payout + seed admin — service_role only + revoke from public/anon/authenticated
revoke execute on function public.payout_request(integer) from public;
grant execute on function public.payout_request(integer) to authenticated;

revoke execute on function public.payout_refund(text) from public;
revoke execute on function public.payout_refund(text) from anon;
revoke execute on function public.payout_refund(text) from authenticated;
grant execute on function public.payout_refund(text) to service_role;

revoke execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) from public;
grant execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) to service_role;

revoke execute on function public.release_seed_sale(text) from public;
revoke execute on function public.release_seed_sale(text) from anon;
revoke execute on function public.release_seed_sale(text) from authenticated;
grant execute on function public.release_seed_sale(text) to service_role;

revoke execute on function public.cancel_seed_sale(text) from public;
revoke execute on function public.cancel_seed_sale(text) from anon;
revoke execute on function public.cancel_seed_sale(text) from authenticated;
grant execute on function public.cancel_seed_sale(text) to service_role;

revoke execute on function public.admin_fulfill_shipment(text, text, text) from public;
revoke execute on function public.admin_fulfill_shipment(text, text, text) from anon;
revoke execute on function public.admin_fulfill_shipment(text, text, text) from authenticated;
grant execute on function public.admin_fulfill_shipment(text, text, text) to service_role;

-- Leaderboard: read-only publik (anon + authenticated) + service_role
revoke execute on function public.get_leaderboard(text, uuid, integer) from public;
grant execute on function public.get_leaderboard(text, uuid, integer) to anon;
grant execute on function public.get_leaderboard(text, uuid, integer) to authenticated;
grant execute on function public.get_leaderboard(text, uuid, integer) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- Notification triggers (P0-3 audit 2026-08-24). Event-driven INSERT ke
-- `notifications` untuk event-event penting tanpa menunggu perubahan manual
-- dari RPC. Status='sent' langsung dari trigger; worker push/email filter
-- `where status='sent' and channel<>'in_app'` (konsistensi).
--
-- Pemberitahuan yang dicakup:
--   - bids     : outbid + accepted + received (INSERT)
--   - cards    : ownership transfer
--   - payouts  : status transitions
--   - shipments: shipped + delivered
--
-- Idempotent: semua trigger dibuat drop-if-exists dulu agar migration bisa
-- diulang tanpa error saat development. Tables sudah ada di 01_schema.
-- ══════════════════════════════════════════════════════════════════════════

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
