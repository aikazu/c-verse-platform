-- Achievement ladder fixtures: synthetic archival gifts, never purchases or wallet events.
insert into public.drops (
  id,title,series,narrative,artwork_url,artwork_3d_url,total_units,signed_count,unsigned_count,
  price_unsigned_ccoin,price_signed_ccoin,price_ccoin,status,creator_id,creator_name,sold_count,created_by
) values (
  'drop-nova-archive-gifts','Nova Archive: Gifted Constellation','Nova Archive',
  'Fixture development archive: 126 C.Card gifts allocated for achievement-tier demos; not a sale or payment record.',
  'https://assets.c-verse.co/mock/v2/artworks/nova-constellation.png','/placeholder.obj',126,13,113,20,40,20,'closed',
  '00000000-0000-4000-8000-000000000005','Nova Studio',0,'00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

with allocation(unit_number,owner_id) as (
  select n,
    case
      when n = 1 then '00000000-0000-4000-8000-000000000101'::uuid
      when n <= 6 then '00000000-0000-4000-8000-000000000102'::uuid
      when n <= 21 then '00000000-0000-4000-8000-000000000103'::uuid
      when n <= 51 then '00000000-0000-4000-8000-000000000104'::uuid
      else '00000000-0000-4000-8000-000000000105'::uuid
    end
  from generate_series(1,126) n
)
insert into public.cards (
  id,drop_id,unit_number,variant,status,owner_id,nfc_uid,nfc_short_id,
  verify_status,location,nfc_configured,qc_status,last_ctr
)
select
  'card-nova-archive-' || lpad(unit_number::text,3,'0'),
  'drop-nova-archive-gifts',unit_number,
  case when unit_number >= 114 then 'signed'::public.card_variant else 'unsigned'::public.card_variant end,
  'bound'::public.card_status,owner_id,
  left(upper(md5('nova-archive|' || unit_number)),14),
  'NAR-' || lpad(unit_number::text,3,'0'),
  'unknown'::public.verify_status,'platform_vault'::public.card_location,false,'passed',0
from allocation
on conflict (id) do nothing;

with allocation(unit_number,owner_id) as (
  select n,
    case
      when n = 1 then '00000000-0000-4000-8000-000000000101'::uuid
      when n <= 6 then '00000000-0000-4000-8000-000000000102'::uuid
      when n <= 21 then '00000000-0000-4000-8000-000000000103'::uuid
      when n <= 51 then '00000000-0000-4000-8000-000000000104'::uuid
      else '00000000-0000-4000-8000-000000000105'::uuid
    end
  from generate_series(1,126) n
)
insert into public.ownership_history (id,card_id,owner_id,acquired_via,transferred_at)
select
  'oh-nova-archive-' || lpad(unit_number::text,3,'0'),
  'card-nova-archive-' || lpad(unit_number::text,3,'0'),owner_id,'gift',
  now() - interval '12 days' + unit_number * interval '1 minute'
from allocation
on conflict (id) do nothing;

-- KYC is inserted directly in 00_identities, so it needs this idempotent pass;
-- tier gifts also converge here without synthetic user_badges rows.
select public.backfill_badges();
