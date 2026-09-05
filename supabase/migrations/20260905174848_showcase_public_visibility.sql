-- Match public Drop detail visibility, including sold/closed collectible editions.
create or replace function public.get_public_showcase(p_username text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('title', s.title, 'username', u.username, 'displayName', u.display_name,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'shortId', c.nfc_short_id, 'title', d.title, 'artworkUrl', d.artwork_url,
      'unitNumber', c.unit_number, 'variant', c.variant) order by selected.position)
      from unnest(s.card_ids) with ordinality selected(id, position)
      join cards c on c.id = selected.id and c.owner_id = u.id
      join drops d on d.id = c.drop_id and d.status in ('published', 'scheduled', 'live', 'sold_out', 'closed')
    ), '[]'::jsonb))
  from users u join collection_showcases s on s.user_id = u.id
  where lower(u.username) = lower(p_username) and not u.is_anonymous and u.flag_reason is null;
$$;
