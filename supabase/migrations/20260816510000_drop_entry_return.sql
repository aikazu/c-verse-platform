-- ── fix drop_entry: INSERT ... RETURNING tanpa INTO = error PL/pgSQL
-- "query has no destination for result data" — fungsi gagal di SETIAP panggilan
-- (fase raffle C-15 tidak pernah bisa jalan). Ditemukan oleh race test R4
-- (konkurensi entry), eksekusi pertama fungsi ini.

create or replace function public.drop_entry(
  p_drop_id text,
  p_pool text                  -- 'regular' | 'premium' | 'both'
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
