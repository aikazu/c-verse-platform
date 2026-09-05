-- Tiered badge engine. Catalog rows declare only a whitelisted metric type and
-- threshold; this migration never evaluates arbitrary JSON/SQL from a badge row.
create or replace function public.badge_progress(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_creator_cards integer := 0;
begin
  select coalesce(max(card_count), 0) into v_creator_cards
  from (
    select count(distinct oh.card_id)::integer as card_count
    from ownership_history oh
    join cards c on c.id = oh.card_id
    join drops d on d.id = c.drop_id
    where oh.owner_id = p_user
    group by d.creator_id
  ) creator_counts;

  return jsonb_build_object(
    'collect_count', (select count(distinct card_id)::integer from ownership_history where owner_id = p_user),
    'creator_cards', v_creator_cards,
    'creator_count', (select count(distinct d.creator_id)::integer from ownership_history oh join cards c on c.id = oh.card_id join drops d on d.id = c.drop_id where oh.owner_id = p_user),
    'drop_count', (select count(distinct c.drop_id)::integer from ownership_history oh join cards c on c.id = oh.card_id where oh.owner_id = p_user),
    'signed_count', (select count(distinct oh.card_id)::integer from ownership_history oh join cards c on c.id = oh.card_id where oh.owner_id = p_user and c.variant = 'signed'),
    'primary_count', (select count(distinct card_id)::integer from ownership_history where owner_id = p_user and acquired_via = 'primary'),
    'secondary_count', (select count(distinct card_id)::integer from ownership_history where owner_id = p_user and acquired_via in ('secondary_buyout', 'secondary_bid')),
    'support_creators', (select count(distinct ref_id)::integer from wallet_transactions where user_id = p_user and type = 'support' and amount_ccoin < 0 and ref_type = 'user' and ref_id is not null),
    'first_bid', (select count(*)::integer from bids where bidder_id = p_user),
    'single_bid_gt', (select coalesce(max(amount_ccoin), 0)::integer from bids where bidder_id = p_user),
    'kyc_verified', case when exists (select 1 from kyc_records where user_id = p_user and status = 'approved') then 1 else 0 end
  );
end $$;

create or replace function public.badge_criteria_matches(p_criteria jsonb, p_progress jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_type text; v_min_text text; v_min integer; v_value integer;
begin
  if jsonb_typeof(p_criteria) is distinct from 'object' then return false; end if;
  v_type := p_criteria->>'type';
  v_min_text := p_criteria->>'min';
  if v_type is null
     or v_type not in ('collect_count', 'creator_cards', 'creator_count', 'drop_count', 'signed_count', 'primary_count', 'secondary_count', 'support_creators', 'first_bid', 'single_bid_gt', 'kyc_verified')
     or jsonb_typeof(p_criteria->'min') is distinct from 'number'
     or v_min_text is null or v_min_text !~ '^[1-9][0-9]{0,8}$' then return false; end if;
  v_min := v_min_text::integer;
  v_value := coalesce((p_progress->>v_type)::integer, 0);
  if v_type = 'single_bid_gt' then return v_value > v_min; end if;
  return v_value >= v_min;
end $$;

create or replace function public.badge_user_is_eligible(p_user uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.users
    where id = p_user and flag_reason is null
      and id <> '00000000-0000-4000-8000-0000000000c0'::uuid
  )
$$;

create or replace function public.award_badge_if_eligible(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_badge public.badges;
  v_xp integer;
  v_progress jsonb;
begin
  -- Every caller acquires this row first. It serializes award + XP mutation
  -- for a user while preserving existing wallet and settlement locks.
  perform 1 from users where id = p_user for no key update;
  if not found or not public.badge_user_is_eligible(p_user) then return false; end if;
  select * into v_badge from badges where code = p_code and is_active;
  v_progress := public.badge_progress(p_user);
  if not found or not public.badge_criteria_matches(v_badge.criteria, v_progress) then return false; end if;
  insert into user_badges (user_id, badge_id, xp_reward_snapshot)
  values (p_user, v_badge.id, v_badge.xp_reward)
  on conflict (user_id, badge_id) do nothing
  returning xp_reward_snapshot into v_xp;
  if not found then return false; end if;
  update users set total_xp = total_xp + v_xp,
    level = least(100, greatest(1, floor((total_xp + v_xp) / 10) + 1))
  where id = p_user;
  return true;
end $$;

create or replace function public.evaluate_badges_for_user(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_progress jsonb;
  v_awarded integer := 0;
  v_xp integer := 0;
begin
  perform 1 from users where id = p_user for no key update;
  if not found or not public.badge_user_is_eligible(p_user) then return 0; end if;
  v_progress := public.badge_progress(p_user);
  with eligible as (
    select b.id, b.xp_reward
    from badges b
    where b.is_active
      and not exists (select 1 from user_badges ub where ub.user_id = p_user and ub.badge_id = b.id)
      and public.badge_criteria_matches(b.criteria, v_progress)
  ), inserted as (
    insert into user_badges (user_id, badge_id, xp_reward_snapshot)
    select p_user, id, xp_reward from eligible
    on conflict (user_id, badge_id) do nothing
    returning xp_reward_snapshot
  ) select count(*)::integer, coalesce(sum(xp_reward_snapshot), 0)::integer into v_awarded, v_xp from inserted;
  if v_awarded > 0 then
    update users set total_xp = total_xp + v_xp,
      level = least(100, greatest(1, floor((total_xp + v_xp) / 10) + 1))
    where id = p_user;
  end if;
  return v_awarded;
end $$;

create or replace function public.backfill_badges() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_awarded integer := 0;
begin
  for v_user in select id from users order by id loop
    v_awarded := v_awarded + public.evaluate_badges_for_user(v_user.id);
  end loop;
  return v_awarded;
end $$;

create or replace function public.badge_on_ownership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_badges_for_user(new.owner_id);
  return new;
end $$;

create or replace function public.badge_on_bid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_badges_for_user(new.bidder_id);
  return new;
end $$;

create or replace function public.badge_on_kyc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.evaluate_badges_for_user(new.user_id);
  end if;
  return new;
end $$;

create or replace function public.badge_on_support() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'support' and new.amount_ccoin < 0 and new.ref_type = 'user' and new.ref_id is not null then
    perform public.evaluate_badges_for_user(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_badge_support on public.wallet_transactions;
create trigger trg_badge_support
  after insert on public.wallet_transactions
  for each row execute function public.badge_on_support();

create index if not exists idx_ownership_history_user_source_card
  on public.ownership_history(owner_id, acquired_via, card_id);
create index if not exists idx_wallet_transactions_support_user_recipient
  on public.wallet_transactions(user_id, ref_id)
  where type = 'support' and amount_ccoin < 0 and ref_type = 'user';

revoke execute on function public.badge_progress(uuid) from public;
revoke execute on function public.badge_progress(uuid) from anon;
revoke execute on function public.badge_progress(uuid) from authenticated;
grant execute on function public.badge_progress(uuid) to service_role;
revoke execute on function public.badge_criteria_matches(jsonb, jsonb) from public;
revoke execute on function public.badge_criteria_matches(jsonb, jsonb) from anon;
revoke execute on function public.badge_criteria_matches(jsonb, jsonb) from authenticated;
grant execute on function public.badge_criteria_matches(jsonb, jsonb) to service_role;
revoke execute on function public.badge_user_is_eligible(uuid) from public;
revoke execute on function public.badge_user_is_eligible(uuid) from anon;
revoke execute on function public.badge_user_is_eligible(uuid) from authenticated;
grant execute on function public.badge_user_is_eligible(uuid) to service_role;
revoke execute on function public.award_badge_if_eligible(uuid, text) from public;
revoke execute on function public.award_badge_if_eligible(uuid, text) from anon;
revoke execute on function public.award_badge_if_eligible(uuid, text) from authenticated;
grant execute on function public.award_badge_if_eligible(uuid, text) to service_role;
revoke execute on function public.evaluate_badges_for_user(uuid) from public;
revoke execute on function public.evaluate_badges_for_user(uuid) from anon;
revoke execute on function public.evaluate_badges_for_user(uuid) from authenticated;
grant execute on function public.evaluate_badges_for_user(uuid) to service_role;
revoke execute on function public.backfill_badges() from public;
revoke execute on function public.backfill_badges() from anon;
revoke execute on function public.backfill_badges() from authenticated;
grant execute on function public.backfill_badges() to service_role;
revoke execute on function public.badge_on_ownership() from public;
revoke execute on function public.badge_on_ownership() from anon;
revoke execute on function public.badge_on_ownership() from authenticated;
revoke execute on function public.badge_on_bid() from public;
revoke execute on function public.badge_on_bid() from anon;
revoke execute on function public.badge_on_bid() from authenticated;
revoke execute on function public.badge_on_kyc() from public;
revoke execute on function public.badge_on_kyc() from anon;
revoke execute on function public.badge_on_kyc() from authenticated;
revoke execute on function public.badge_on_support() from public;
revoke execute on function public.badge_on_support() from anon;
revoke execute on function public.badge_on_support() from authenticated;

select public.backfill_badges();
