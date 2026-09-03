-- 08: RPC ledger platform_revenue + gamifikasi badge (part of consolidated RPC set; apply in lexical order).
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
