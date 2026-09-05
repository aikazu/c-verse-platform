-- Catalog and card inventory. Each drop has its own unique front/back artwork.
-- Only neutral card geometry is shared; atlas assignments live in seed-assets.json.

insert into public.drops (
  id,title,series,narrative,artwork_url,artwork_3d_url,total_units,signed_count,unsigned_count,
  price_unsigned_ccoin,price_signed_ccoin,price_ccoin,status,drop_start_at,drop_end_at,
  raffle_end_at,drawn_at,creator_id,creator_name,sold_count,is_seed,created_by
) values
  ('drop-aespa-live','Karina: Eclipse','Karina Genesis','Live FCFS inventory after a completed raffle. Purchases settle to Vault.','https://assets.c-verse.co/mock/v1/artworks/karina.jpg','/placeholder.obj',8,1,7,30,50,30,'live',now()-interval '8 days',now()+interval '14 days',now()-interval '7 days',now()-interval '7 days','00000000-0000-4000-8000-000000000003','Karina Aespa',4,false,'00000000-0000-4000-8000-000000000002'),
  ('drop-genesis-live','Genesis: Monolith','Genesis One','Live Genesis release with Vault-first ownership.','/mock/v1/artworks/genesis.png','/placeholder.obj',8,1,7,25,45,25,'live',now()-interval '7 days',now()+interval '15 days',now()-interval '6 days',now()-interval '6 days','00000000-0000-4000-8000-000000000004','Hype Collective',2,false,'00000000-0000-4000-8000-000000000002'),
  ('drop-aespa-signed','Karina: Seraph Signed','Karina Genesis','Silver moonlight portrait with a feather-and-crescent reverse. Sold-out ten-card raffle; unit 10 is the signed winner.','https://assets.c-verse.co/mock/v2/artworks/karina-seraph.png','/placeholder.obj',10,1,9,30,50,30,'sold_out',now()-interval '11 days',now()-interval '9 days',now()-interval '10 days',now()-interval '10 days','00000000-0000-4000-8000-000000000003','Karina Aespa',10,false,'00000000-0000-4000-8000-000000000002'),
  ('drop-aespa-2027','Aurora: Solstice 2027','Aurora Archive','Amber sun over terracotta dunes, with a copper solar compass reverse. Scheduled 2027 preview.','https://assets.c-verse.co/mock/v2/artworks/aurora-solstice.png','/placeholder.obj',10,1,9,28,48,28,'scheduled',now()+interval '30 days',now()+interval '31 days',now()+interval '31 days',null,'00000000-0000-4000-8000-000000000005','Nova Studio',0,false,'00000000-0000-4000-8000-000000000002'),
  ('drop-genesis-beta','Genesis: Signal Draft','Genesis One','Emerald radio observatory above a cloud sea, with an orbital waveform reverse. Draft for admin review and QC planning.','https://assets.c-verse.co/mock/v2/artworks/genesis-signal.png','/placeholder.obj',10,1,9,25,45,25,'draft',null,null,null,null,'00000000-0000-4000-8000-000000000004','Hype Collective',0,false,'00000000-0000-4000-8000-000000000002'),
  ('drop-aurora-raffle','Aurora: Open Raffle','Aurora Archive','Active 24-hour raffle with regular and premium pools.','/mock/v1/artworks/aurora.png','/placeholder.obj',10,1,9,28,48,28,'live',now()-interval '1 hour',now()+interval '23 hours',now()+interval '23 hours',null,'00000000-0000-4000-8000-000000000005','Nova Studio',0,false,'00000000-0000-4000-8000-000000000002'),
  ('drop-seed-karina-01','Karina: Velvet Seed','Creator Seed C.Card','Burgundy velvet portrait with a rose-and-ribbon reverse. Accepted bid is locked while the physical card moves to Vault.','https://assets.c-verse.co/mock/v2/artworks/karina-velvet.png','/placeholder.obj',1,1,0,60,60,60,'live',now()-interval '30 days',null,null,null,'00000000-0000-4000-8000-000000000003','Karina Aespa',0,true,'00000000-0000-4000-8000-000000000002'),
  ('drop-seed-karina-02','Karina: Starlight Seed','Creator Seed C.Card','Pearl and lilac observatory portrait with a crystal-star reverse. Verified Vault card released to its buyer.','https://assets.c-verse.co/mock/v2/artworks/karina-starlight.png','/placeholder.obj',1,1,0,80,80,80,'closed',now()-interval '45 days',now()-interval '5 days',null,now()-interval '5 days','00000000-0000-4000-8000-000000000003','Karina Aespa',1,true,'00000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- Generate 56 deterministic NFC-ready cards without hiding the variant rules.
with catalog(drop_id,total_units,unsigned_count,prefix) as (values
  ('drop-aespa-live',8,7,'AESL'),
  ('drop-genesis-live',8,7,'GENL'),
  ('drop-aespa-signed',10,9,'AESS'),
  ('drop-aespa-2027',10,9,'A27'),
  ('drop-genesis-beta',10,9,'GBT'),
  ('drop-aurora-raffle',10,9,'AUR')
)
insert into public.cards (
  id,drop_id,unit_number,variant,status,owner_id,nfc_uid,nfc_short_id,
  verify_status,location,buyout_price_ccoin,nfc_configured,qc_status,last_ctr
)
select
  'card-' || replace(c.drop_id,'drop-','') || '-' || lpad(n::text,2,'0'),
  c.drop_id,n,
  case when n>c.unsigned_count then 'signed'::public.card_variant else 'unsigned'::public.card_variant end,
  'inventory'::public.card_status,null,left(upper(md5(c.drop_id || '|' || n)),14),
  c.prefix || '-' || lpad(n::text,3,'0'),'unknown'::public.verify_status,
  'platform_stock'::public.card_location,null,true,'pending',0
from catalog c cross join lateral generate_series(1,c.total_units) n
on conflict (id) do nothing;

insert into public.cards (
  id,drop_id,unit_number,variant,status,owner_id,nfc_uid,nfc_short_id,
  verify_status,location,buyout_price_ccoin,nfc_configured,qc_status,last_ctr
) values
  ('card-seed-karina-01','drop-seed-karina-01',1,'signed','bid_pending','00000000-0000-4000-8000-000000000003',left(upper(md5('seed-karina-01')),14),'SEEDK-001','registered','with_owner',null,true,'passed',2),
  -- Intentionally verified local fixture: production reaches this state only through CMAC.
  ('card-seed-karina-02','drop-seed-karina-02',1,'signed','sold','00000000-0000-4000-8000-000000000001',left(upper(md5('seed-karina-02')),14),'SEEDK-002','verified','platform_vault',null,true,'passed',8)
on conflict (id) do nothing;

-- Primary ownership starts in Vault. Only completed ship-outs below are with_owner.
update public.cards set status='bound',owner_id='00000000-0000-4000-8000-000000000001',verify_status='registered',location='platform_vault',qc_status='passed',last_ctr=1
where id='card-aespa-live-01';
update public.cards set status='bound',owner_id='00000000-0000-4000-8000-000000000006',verify_status='registered',location='with_owner',qc_status='passed',last_ctr=2
where id='card-aespa-live-02';
update public.cards set status='sold',owner_id='00000000-0000-4000-8000-000000000006',verify_status='registered',location='platform_vault',qc_status='passed',last_ctr=3
where id='card-aespa-live-03';
update public.cards set status='listed_buyout',owner_id='00000000-0000-4000-8000-000000000006',verify_status='registered',location='platform_vault',buyout_price_ccoin=65,qc_status='passed',last_ctr=1
where id='card-aespa-live-04';
update public.cards set status='bound',owner_id='00000000-0000-4000-8000-000000000001',verify_status='registered',location='platform_vault',qc_status='passed',last_ctr=1
where id='card-genesis-live-01';
update public.cards set status='bound',owner_id='00000000-0000-4000-8000-000000000006',verify_status='registered',location='with_owner',qc_status='passed',last_ctr=2
where id='card-genesis-live-02';

update public.cards set
  status='bound',
  owner_id=case unit_number
    when 1 then '00000000-0000-4000-8000-000000000001'::uuid
    when 2 then '00000000-0000-4000-8000-000000000001'::uuid
    when 3 then '00000000-0000-4000-8000-000000000003'::uuid
    when 4 then '00000000-0000-4000-8000-000000000004'::uuid
    when 5 then '00000000-0000-4000-8000-000000000001'::uuid
    when 6 then '00000000-0000-4000-8000-000000000006'::uuid
    when 7 then '00000000-0000-4000-8000-000000000001'::uuid
    when 8 then '00000000-0000-4000-8000-000000000006'::uuid
    when 9 then '00000000-0000-4000-8000-000000000006'::uuid
    else '00000000-0000-4000-8000-00000000000a'::uuid end,
  verify_status='registered',location=case when unit_number=4 then 'with_owner'::public.card_location else 'platform_vault'::public.card_location end,
  qc_status='passed',last_ctr=1
where drop_id='drop-aespa-signed';

-- Rich negative-state coverage for admin QC without changing sold counts.
update public.cards set status='defect',qc_status='failed'
where id='card-genesis-beta-09';
update public.cards set status='tampered',verify_status='tamper_detected',qc_status='failed',last_ctr=9
where id='card-genesis-beta-10';

-- Backdate tie-break state after owner updates (owner trigger only reacts to owner changes).
update public.cards c set owner_since=h.acquired_at
from (values
  ('card-aespa-live-01',now()-interval '7 days'),
  ('card-aespa-live-02',now()-interval '6 days'),
  ('card-aespa-live-03',now()-interval '5 days'),
  ('card-aespa-live-04',now()-interval '7 days'),
  ('card-genesis-live-01',now()-interval '6 days'),
  ('card-genesis-live-02',now()-interval '5 days'),
  ('card-seed-karina-01',now()-interval '30 days'),
  ('card-seed-karina-02',now()-interval '5 days')
) h(id,acquired_at) where c.id=h.id;
