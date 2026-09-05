-- Collector curation is independent of transaction and NFC state.
create table public.collection_showcases (
  user_id uuid primary key references public.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 80),
  card_ids text[] not null default '{}' check (cardinality(card_ids) <= 3),
  updated_at timestamptz not null default now()
);
alter table public.collection_showcases enable row level security;
revoke all on public.collection_showcases from anon, authenticated;
grant all on public.collection_showcases to service_role;
grant select on public.collection_showcases to authenticated;
create policy showcase_owner_read on public.collection_showcases for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.users u where u.id = (select auth.uid()) and u.flag_reason is null
  ));

create function public.save_collection_showcase(p_title text, p_card_ids text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from users where id = v_user and flag_reason is null)
    then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if p_title is null or p_card_ids is null or char_length(trim(p_title)) > 80
    or cardinality(p_card_ids) > 3 or array_position(p_card_ids, null) is not null
    or cardinality(p_card_ids) <> (select count(distinct x) from unnest(p_card_ids) x)
    or (cardinality(p_card_ids) > 0 and trim(p_title) = '')
    then raise exception 'INVALID_SHOWCASE'; end if;
  -- Lock cards before the showcase row, matching the ownership cleanup trigger.
  perform id from cards where id = any(p_card_ids) and owner_id = v_user order by id for share;
  select count(*) into v_count from cards where id = any(p_card_ids) and owner_id = v_user;
  if v_count <> cardinality(p_card_ids) then raise exception 'NOT_OWNER'; end if;
  insert into collection_showcases(user_id, title, card_ids) values (v_user, trim(p_title), p_card_ids)
    on conflict (user_id) do update set title = excluded.title, card_ids = excluded.card_ids, updated_at = now();
end;
$$;
revoke all on function public.save_collection_showcase(text, text[]) from public, anon;
grant execute on function public.save_collection_showcase(text, text[]) to authenticated;

create function public.prune_collection_showcase()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update collection_showcases set card_ids = array_remove(card_ids, old.id), updated_at = now()
    where user_id = old.owner_id and old.id = any(card_ids);
  return null;
end;
$$;
revoke all on function public.prune_collection_showcase() from public, anon, authenticated;
create trigger prune_showcase_on_transfer after update of owner_id on public.cards
  for each row when (old.owner_id is distinct from new.owner_id) execute function public.prune_collection_showcase();
create trigger prune_showcase_on_delete after delete on public.cards
  for each row execute function public.prune_collection_showcase();

-- One statement evaluates privacy, suspension, Drop visibility and ownership.
-- No wallet, UUID owner identity or NFC secrets enter this public projection.
create function public.get_public_showcase(p_username text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('title', s.title, 'username', u.username, 'displayName', u.display_name,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'shortId', c.nfc_short_id, 'title', d.title, 'artworkUrl', d.artwork_url,
      'unitNumber', c.unit_number, 'variant', c.variant) order by selected.position)
      from unnest(s.card_ids) with ordinality selected(id, position)
      join cards c on c.id = selected.id and c.owner_id = u.id
      join drops d on d.id = c.drop_id and d.status in ('published', 'live', 'sold_out')
    ), '[]'::jsonb))
  from users u join collection_showcases s on s.user_id = u.id
  where lower(u.username) = lower(p_username) and not u.is_anonymous and u.flag_reason is null;
$$;
revoke all on function public.get_public_showcase(text) from public;
grant execute on function public.get_public_showcase(text) to anon, authenticated, service_role;
