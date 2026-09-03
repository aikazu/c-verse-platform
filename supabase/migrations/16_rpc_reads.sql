-- 16: RPC read-only (get_leaderboard, creator page view/stats, investor stats) (part of consolidated RPC set; apply in lexical order).
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

create or replace function public.record_creator_page_view(
  p_username text,
  p_referrer_host text default null,
  p_city text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_user_id uuid;
  v_creator_id text;
begin
  if p_username is null or length(trim(p_username)) = 0 then
    return; -- silent no-op: nothing to attribute
  end if;

  select u.id into v_creator_user_id
  from public.users u
  where lower(u.username) = lower(trim(p_username))
    and u.is_anonymous = false
    and u.flag_reason is null
  order by u.created_at
  limit 1;
  if not found then return; end if;

  select cr.id into v_creator_id
  from public.creators cr
  where cr.user_id = v_creator_user_id
  order by cr.created_at
  limit 1;
  if not found then return; end if;

  insert into public.creator_page_views (id, creator_id, viewed_at, referrer, city, user_id)
  values (gen_random_uuid()::text, v_creator_id, now(), p_referrer_host, p_city, auth.uid());
end $$;

revoke execute on function public.record_creator_page_view(text, text, text) from public;
grant execute on function public.record_creator_page_view(text, text, text) to anon;
grant execute on function public.record_creator_page_view(text, text, text) to authenticated;
grant execute on function public.record_creator_page_view(text, text, text) to service_role;

create or replace function public.get_creator_page_stats(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_creator_id text;
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select cr.id into v_creator_id
  from public.creators cr
  where cr.user_id = v_user
  order by cr.created_at
  limit 1;
  if not found then raise exception 'FORBIDDEN'; end if;

  return jsonb_build_object(
    'days', v_days,
    'total', (
      select count(*)::bigint from public.creator_page_views v
      where v.creator_id = v_creator_id and v.viewed_at >= v_since
    ),
    'distinct_viewers', (
      select count(distinct v.user_id)::bigint from public.creator_page_views v
      where v.creator_id = v_creator_id and v.viewed_at >= v_since
    ),
    'daily', (
      select coalesce(
        jsonb_agg(jsonb_build_object('day', d.day, 'views', d.views, 'distinct_viewers', d.distinct_viewers) order by d.day),
        '[]'::jsonb)
      from (
        select (v.viewed_at at time zone 'Asia/Jakarta')::date as day,
               count(*)::bigint as views,
               count(distinct v.user_id)::bigint as distinct_viewers
        from public.creator_page_views v
        where v.creator_id = v_creator_id and v.viewed_at >= v_since
        group by 1
      ) d
    ),
    'top_referrers', (
      select coalesce(
        jsonb_agg(jsonb_build_object('referrer_host', r.referrer_host, 'views', r.views) order by r.views desc),
        '[]'::jsonb)
      from (
        select v.referrer as referrer_host, count(*)::bigint as views
        from public.creator_page_views v
        where v.creator_id = v_creator_id and v.viewed_at >= v_since
          and v.referrer is not null and length(trim(v.referrer)) > 0
        group by 1
        order by views desc
        limit 10
      ) r
    )
  );
end $$;

revoke execute on function public.get_creator_page_stats(integer) from public;
revoke execute on function public.get_creator_page_stats(integer) from anon;
grant execute on function public.get_creator_page_stats(integer) to authenticated;
grant execute on function public.get_creator_page_stats(integer) to service_role;

create or replace function public.get_investor_stats() returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  return jsonb_build_object(
    'users', (select count(*)::bigint from public.users),
    'gmvCcoin', (
      select coalesce(sum(abs(t.amount_ccoin)), 0)::bigint
      from public.wallet_transactions t
      where t.type in ('checkout', 'platform_buy')
         or (t.type = 'escrow_hold' and t.ref_type = 'card')
    ),
    'secondaryVolCcoin', (
      select coalesce(sum(p.gross_ccoin), 0)::bigint
      from public.platform_revenue p
      where p.source in ('secondary_buyout', 'secondary_bid')
    ),
    'txCount', (select count(*)::bigint from public.wallet_transactions)
  );
end $$;

revoke execute on function public.get_investor_stats() from public;
revoke execute on function public.get_investor_stats() from anon;
grant execute on function public.get_investor_stats() to authenticated;
grant execute on function public.get_investor_stats() to service_role;
