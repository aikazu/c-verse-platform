-- Read-model breadth for admin and creator pages.
insert into public.admin_audit_log (
  id,admin_user_id,action,target_table,target_id,payload_summary,ip,session_id,created_at
) values
  ('al-login-otp','00000000-0000-4000-8000-000000000002','login','auth.users','00000000-0000-4000-8000-000000000002','{"method":"email_otp","edge":"cloudflare_access","access_role":"admin"}','10.0.0.1','sess-otp',now()-interval '2 hours'),
  ('al-kyc-demo','00000000-0000-4000-8000-000000000002','view_sensitive','public.kyc_records','kyc-demo','{"fields":["full_name","nik","object_keys"]}','10.0.0.1','sess-otp',now()-interval '90 minutes'),
  ('al-kyc-karina','00000000-0000-4000-8000-000000000002','update','public.kyc_records','kyc-karina','{"status":"approved"}','10.0.0.1','sess-kyc',now()-interval '60 days'),
  ('al-drop-live','00000000-0000-4000-8000-000000000002','update','public.drops','drop-aespa-live','{"status":"live"}','10.0.0.1','sess-drop',now()-interval '8 days'),
  ('al-drop-draft','00000000-0000-4000-8000-000000000002','create','public.drops','drop-genesis-beta','{"status":"draft"}','10.0.0.1','sess-drop',now()-interval '4 days'),
  ('al-payout-paid','00000000-0000-4000-8000-000000000002','payout_trigger','public.payout_batches','pb-seed-paid','{"count":2,"status":"paid"}','10.0.0.1','sess-payout',now()-interval '3 days'),
  ('al-qc-print','00000000-0000-4000-8000-000000000002','update','public.qc_defects','qcd-beta-print','{"resolution":"return_vendor"}','10.0.0.1','sess-qc',now()-interval '1 day'),
  ('al-user-marked','00000000-0000-4000-8000-000000000002','update','public.users','00000000-0000-4000-8000-000000000008','{"flag_reason":"tos_violation_2026_08"}','10.0.0.1','sess-risk',now()-interval '5 days'),
  ('al-dispute','00000000-0000-4000-8000-000000000002','update','public.disputes','dsp-review','{"status":"under_review"}','10.0.0.1','sess-risk',now()-interval '2 days'),
  ('al-config','00000000-0000-4000-8000-000000000002','config_change','local.seed','asset_contract','{"public_assets":6,"private_kyc":"r2"}','10.0.0.1','sess-config',now()-interval '1 hour')
on conflict (id) do nothing;

insert into public.creator_page_views (id,creator_id,viewed_at,referrer,city,user_id) values
  ('cpv-01','cr-karina',now()-interval '1 hour','https://instagram.com','Jakarta','00000000-0000-4000-8000-000000000001'),
  ('cpv-02','cr-karina',now()-interval '2 hours','https://tiktok.com','Bandung','00000000-0000-4000-8000-000000000006'),
  ('cpv-03','cr-karina',now()-interval '1 day',null,'Surabaya',null),
  ('cpv-04','cr-karina',now()-interval '2 days','https://instagram.com','Jakarta',null),
  ('cpv-05','cr-karina',now()-interval '3 days','https://x.com','Medan','00000000-0000-4000-8000-000000000009'),
  ('cpv-06','cr-karina',now()-interval '5 days',null,'Yogyakarta',null),
  ('cpv-07','cr-karina',now()-interval '7 days','https://instagram.com','Jakarta','00000000-0000-4000-8000-000000000001'),
  ('cpv-08','cr-hype',now()-interval '3 hours','https://x.com','Jakarta','00000000-0000-4000-8000-000000000001'),
  ('cpv-09','cr-hype',now()-interval '2 days',null,'Bandung',null),
  ('cpv-10','cr-hype',now()-interval '6 days','https://instagram.com','Surabaya',null),
  ('cpv-11','cr-nova',now()-interval '4 hours','https://instagram.com','Bandung','00000000-0000-4000-8000-000000000006'),
  ('cpv-12','cr-nova',now()-interval '4 days',null,'Jakarta',null)
on conflict (id) do nothing;

insert into public.notifications (id,user_id,channel,template_key,payload,status,attempts,created_at,read_at) values
  ('n-kyc-pending','00000000-0000-4000-8000-000000000001','in_app','kyc_pending_review','{"kycId":"kyc-demo"}','sent',0,now()-interval '1 day',null),
  ('n-drop-live','00000000-0000-4000-8000-000000000001','in_app','drop_live','{"dropId":"drop-aespa-live"}','sent',0,now()-interval '8 days',now()-interval '7 days'),
  ('n-raffle-win','00000000-0000-4000-8000-00000000000a','in_app','raffle_result_won','{"dropId":"drop-aespa-signed","cardId":"card-aespa-signed-10","variant":"signed"}','sent',0,now()-interval '10 days',null),
  ('n-seed-lock','00000000-0000-4000-8000-000000000003','in_app','seed_sale_vault_required','{"cardId":"card-seed-karina-01"}','sent',0,now()-interval '2 hours',null),
  ('n-seed-released','00000000-0000-4000-8000-000000000001','email','seed_sale_released','{"cardId":"card-seed-karina-02"}','sent',1,now()-interval '5 days',now()-interval '4 days'),
  ('n-payout-paid','00000000-0000-4000-8000-000000000003','email','payout_disbursed','{"payoutId":"po-karina-paid","amount":120}','sent',1,now()-interval '3 days',now()-interval '2 days'),
  ('n-payout-processing','00000000-0000-4000-8000-000000000003','in_app','payout_processing','{"payoutId":"po-karina-processing","amount":45}','sent',0,now()-interval '2 days',null),
  ('n-ship-aespa','00000000-0000-4000-8000-000000000006','email','shipment_delivered','{"shipmentId":"shipout-aespa-02"}','sent',1,now()-interval '4 days',now()-interval '3 days'),
  ('n-qc-hype','00000000-0000-4000-8000-000000000004','in_app','qc_action_required','{"cardId":"card-genesis-beta-09"}','sent',0,now()-interval '1 day',null),
  ('n-admin-failed','00000000-0000-4000-8000-000000000002','email','daily_admin_digest','{"failedJobs":1}','failed',3,now()-interval '1 day',null)
on conflict (id) do nothing;

-- Normalize leaderboard tie-break timestamps after all triggered awards.
update public.cards c set owner_since=h.transferred_at
from (
  select distinct on (card_id) card_id,transferred_at
  from public.ownership_history order by card_id,transferred_at desc,id desc
) h where c.id=h.card_id;

update public.users u set xp_reached_at=v.reached_at
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid,now()-interval '9 days'),
  ('00000000-0000-4000-8000-000000000002'::uuid,now()-interval '30 days'),
  ('00000000-0000-4000-8000-000000000003'::uuid,now()-interval '21 days'),
  ('00000000-0000-4000-8000-000000000004'::uuid,now()-interval '18 days'),
  ('00000000-0000-4000-8000-000000000005'::uuid,now()-interval '15 days'),
  ('00000000-0000-4000-8000-000000000006'::uuid,now()-interval '2 days'),
  ('00000000-0000-4000-8000-000000000007'::uuid,now()-interval '7 days'),
  ('00000000-0000-4000-8000-000000000008'::uuid,now()-interval '5 days'),
  ('00000000-0000-4000-8000-000000000009'::uuid,now()-interval '4 days'),
  ('00000000-0000-4000-8000-00000000000a'::uuid,now()-interval '3 days')
) v(id,reached_at) where u.id=v.id;

-- Fail the reset on fixture drift. These checks intentionally overlap at
-- domain boundaries so an internally balanced but economically false seed fails.
do $$
declare failures text[] := array[]::text[];
begin
  if (select count(*) from auth.users where id between '00000000-0000-4000-8000-000000000001' and '00000000-0000-4000-8000-000000000008')<>8 then
    failures:=array_append(failures,'eight core auth personas missing'); end if;
  if (select count(*) from auth.users where id in ('00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-00000000000a'))<>2 then
    failures:=array_append(failures,'synthetic raffle participants missing'); end if;
  if not exists (select 1 from auth.users a join public.users u using(id)
    where a.id='00000000-0000-4000-8000-000000000002' and a.encrypted_password is null
      and a.raw_app_meta_data->>'provider'='email' and a.raw_app_meta_data->>'access'='cloudflare_access' and u.role='admin') then
    failures:=array_append(failures,'passwordless Access-backed admin missing'); end if;
  if not exists (select 1 from public.kyc_records where id='kyc-demo' and status='pending') then
    failures:=array_append(failures,'Demo KYC must be pending'); end if;
  if exists (select 1 from public.kyc_records where coalesce(ktp_object_key,'') like 'http%' or coalesce(selfie_object_key,'') like 'http%') then
    failures:=array_append(failures,'KYC must use private R2 object keys'); end if;

  if exists (select path from (values
      ('https://assets.c-verse.co/mock/v1/artworks/karina.jpg'),('/mock/v1/artworks/genesis.png'),('/mock/v1/artworks/aurora.png'),
      ('/mock/v1/avatars/demo.png'),('/mock/v1/avatars/nova.png'),('/placeholder.obj')
    ) expected(path) where not exists (
      select 1 from (select artwork_url path from public.drops union all select artwork_3d_url from public.drops union all select avatar_url from public.users) actual
      where actual.path=expected.path
    )) then failures:=array_append(failures,'approved asset path missing'); end if;
  if exists (select 1 from (
      select artwork_url path from public.drops union all select artwork_3d_url from public.drops union all select avatar_url from public.users
    ) a where path is not null and path not in (
      'https://assets.c-verse.co/mock/v1/artworks/karina.jpg','/mock/v1/artworks/genesis.png','/mock/v1/artworks/aurora.png',
      '/mock/v1/avatars/demo.png','/mock/v1/avatars/nova.png','/placeholder.obj'
    )) then failures:=array_append(failures,'unmapped public asset URL present'); end if;

  if (select count(*) from public.drops where id in ('drop-aespa-live','drop-genesis-live','drop-aespa-signed','drop-aespa-2027','drop-genesis-beta'))<>5 then
    failures:=array_append(failures,'stable drop set missing'); end if;
  if not exists (select 1 from public.drops d where d.id='drop-aurora-raffle' and d.status='live'
    and d.total_units=10 and d.unsigned_count=9 and d.signed_count=1 and d.sold_count=0
    and d.drop_start_at<=now() and d.drop_end_at>now() and d.raffle_end_at>now() and d.drawn_at is null)
    or (select count(*) from public.cards where drop_id='drop-aurora-raffle')<>10 then
    failures:=array_append(failures,'active Aurora raffle inventory missing'); end if;
  if exists (select 1 from public.drops d left join public.cards c on c.drop_id=d.id group by d.id,d.total_units having count(c.id)<>d.total_units) then
    failures:=array_append(failures,'drop inventory count mismatch'); end if;
  if exists (select 1 from public.drops d left join public.orders o on o.drop_id=d.id and o.status<>'refunded' group by d.id,d.sold_count having count(o.id)<>d.sold_count) then
    failures:=array_append(failures,'drop sold_count does not match orders'); end if;
  if (select count(distinct user_id) from public.drop_entries where drop_id='drop-aespa-signed' and status like 'won%')<>10
     or (select count(*) from public.orders where drop_id='drop-aespa-signed')<>10
     or not exists (select 1 from public.cards where id='card-aespa-signed-10' and unit_number=10 and variant='signed' and owner_id is not null) then
    failures:=array_append(failures,'ten-winner signed raffle mismatch'); end if;
  if exists (select 1 from public.orders where source in ('fcfs','raffle') group by user_id,drop_id having count(*)>1) then
    failures:=array_append(failures,'primary one-per-user-per-drop violated'); end if;
  if exists (select 1 from public.drop_entries e where not exists (
    select 1 from public.wallet_transactions w where w.user_id=e.user_id and w.type='escrow_hold'
      and w.ref_type='drop' and w.ref_id=e.drop_id and w.amount_ccoin=-e.hold_ccoin
  )) then failures:=array_append(failures,'raffle entry lacks exact escrow funding'); end if;
  if exists (select 1 from public.drop_entries e where e.status in ('lost','refunded') and (
    not exists (select 1 from public.wallet_transactions w where w.user_id=e.user_id and w.type='escrow_hold'
      and w.ref_type='drop' and w.ref_id=e.drop_id and w.amount_ccoin=-e.hold_ccoin)
    or not exists (select 1 from public.wallet_transactions w where w.user_id=e.user_id and w.type='escrow_release'
      and w.ref_type='drop' and w.ref_id=e.drop_id and w.amount_ccoin=e.hold_ccoin)
  )) then failures:=array_append(failures,'lost or refunded raffle entry is not ledger-closed'); end if;
  if exists (select 1 from public.orders o where o.source='fcfs' and not exists (
    select 1 from public.wallet_transactions w where w.user_id=o.user_id and w.type='checkout'
      and w.ref_type='drop' and w.ref_id=o.drop_id and w.amount_ccoin=-o.total_ccoin
  )) then failures:=array_append(failures,'FCFS order lacks exact checkout funding'); end if;
  if exists (select 1 from public.orders o where o.source='raffle' and (
    not exists (select 1 from public.drop_entries e where e.user_id=o.user_id and e.drop_id=o.drop_id
      and e.status like 'won%' and e.hold_ccoin=o.total_ccoin)
    or not exists (select 1 from public.wallet_transactions w where w.user_id=o.user_id and w.type='checkout'
      and w.amount_ccoin=0 and w.ref_type='order' and w.ref_id=o.id
      and w.metadata->>'conversion_of_hold'='true' and (w.metadata->>'spend_ccoin')::int=o.total_ccoin)
  )) then failures:=array_append(failures,'raffle order lacks winner hold conversion'); end if;
  if exists (select 1 from public.orders o where o.source='secondary_buyout' and not exists (
    select 1 from public.wallet_transactions w where w.user_id=o.user_id and w.type='escrow_hold'
      and w.ref_type='card' and w.ref_id=o.card_id and w.amount_ccoin=-o.total_ccoin
  )) then failures:=array_append(failures,'seed buyout order lacks exact escrow funding'); end if;
  if exists (select 1 from public.orders o where not exists (
    select 1 from public.ownership_history h where h.order_id=o.id and h.owner_id=o.user_id and h.card_id=o.card_id
  )) then failures:=array_append(failures,'order lacks matching buyer ownership event'); end if;
  if exists (select 1 from public.cards c join lateral (
    select owner_id from public.ownership_history h where h.card_id=c.id order by transferred_at desc,id desc limit 1
  ) h on c.owner_id is not null where c.owner_id<>h.owner_id) then
    failures:=array_append(failures,'current owner differs from latest history'); end if;
  if not exists (select 1 from public.cards where id='card-aespa-live-02'
    and owner_id='00000000-0000-4000-8000-000000000006' and location='with_owner'
    and status not in ('tampered','defect','lost','bid_pending')) then
    failures:=array_append(failures,'rival tradable card contract broken'); end if;
  if not exists (select 1 from public.cards c where c.id='card-aespa-live-04'
    and c.owner_id='00000000-0000-4000-8000-000000000006' and c.location='platform_vault'
    and c.status='listed_buyout' and c.buyout_price_ccoin=65 and c.verify_status in ('registered','verified')
    and c.qc_status='passed' and not exists (select 1 from public.bids b where b.card_id=c.id and b.status='active')) then
    failures:=array_append(failures,'valid marketplace listing missing'); end if;

  if exists (select 1 from public.orders where delivery_option<>'vault' or shipping_address is not null or shipping_fee_ccoin is not null) then
    failures:=array_append(failures,'purchase must settle to Vault without shipping'); end if;
  if exists (select 1 from public.shipments where type='primary_shipping') then
    failures:=array_append(failures,'legacy primary shipping present'); end if;
  if exists (select 1 from public.shipments where type='vault_shipout' and fee_ccoin<>2) then
    failures:=array_append(failures,'vault ship-out fee must be 2'); end if;
  if exists (select 1 from public.shipments s where s.type='vault_shipout' and not exists (
    select 1 from public.platform_revenue p where p.source='shipment' and p.ref_id=s.id and p.platform_ccoin=s.fee_ccoin
  )) then failures:=array_append(failures,'ship-out revenue missing'); end if;
  if exists (select 1 from public.cards c join public.drops d on d.id=c.drop_id
    where c.location='with_owner' and not d.is_seed and not exists (
      select 1 from public.shipments s where s.card_id=c.id and s.type='vault_shipout' and s.status='delivered'
    )) then failures:=array_append(failures,'with_owner card lacks completed ship-out'); end if;

  if exists (select 1 from public.wallets w left join (
    select user_id,sum(amount_ccoin)::int balance,
      coalesce(sum(amount_ccoin) filter(where type='top_up'),0)::int topup,
      coalesce(-sum(amount_ccoin) filter(where amount_ccoin<0),0)::int spent
    from public.wallet_transactions group by user_id
  ) x on x.user_id=w.user_id where w.balance_ccoin<>coalesce(x.balance,0)
    or w.total_topup_ccoin<>coalesce(x.topup,0) or w.total_spent_ccoin<>coalesce(x.spent,0)) then
    failures:=array_append(failures,'C-Coin wallet cache mismatch'); end if;
  if exists (select 1 from (
    select balance_after_ccoin,sum(amount_ccoin) over(partition by user_id order by created_at,id)::int expected
    from public.wallet_transactions
  ) x where balance_after_ccoin<>expected or expected<0) then
    failures:=array_append(failures,'C-Coin running balance mismatch'); end if;
  if exists (select 1 from public.wallets w left join (
    select user_id,sum(amount)::int balance from public.gem_transactions group by user_id
  ) x on x.user_id=w.user_id where w.balance_gems<>coalesce(x.balance,0)) then
    failures:=array_append(failures,'Gems wallet cache mismatch'); end if;
  if exists (select 1 from (
    select balance_after_gems,sum(amount) over(partition by user_id order by created_at,idem_key)::int expected
    from public.gem_transactions
  ) x where balance_after_gems<>expected or expected<0) then
    failures:=array_append(failures,'Gems running balance mismatch'); end if;
  if exists (select 1 from public.wallets w left join (
    select user_id,sum(remaining)::int balance from public.gem_lots group by user_id
  ) x on x.user_id=w.user_id where w.balance_gems<>coalesce(x.balance,0)) then
    failures:=array_append(failures,'Gems lots do not match wallet'); end if;

  if exists (select 1 from public.platform_revenue p where p.gross_ccoin<>p.platform_ccoin+p.royalty_ccoin+p.seller_ccoin) then
    failures:=array_append(failures,'revenue split does not close'); end if;
  if exists (select 1 from public.platform_revenue p where p.royalty_ccoin>0 and not exists (
    select 1 from public.gem_transactions g where g.ref_id=p.ref_id and g.ref_type='royalty' and g.amount=p.royalty_ccoin
  )) then failures:=array_append(failures,'royalty Gems event missing'); end if;
  if exists (select 1 from public.platform_revenue p where p.seller_ccoin>0 and not exists (
    select 1 from public.gem_transactions g where g.ref_id=p.ref_id and g.ref_type='settlement' and g.amount=p.seller_ccoin
  )) then failures:=array_append(failures,'seller Gems event missing'); end if;
  if not exists (select 1 from public.wallet_transactions w join public.gem_transactions g using(ref_id)
    where w.ref_id='support-demo-hype' and w.type='support' and w.amount_ccoin=-7 and g.ref_type='support' and g.amount=7) then
    failures:=array_append(failures,'support funding pair missing'); end if;
  if exists (select 1 from public.payouts p where not exists (
    select 1 from public.gem_transactions g where g.ref_id=p.id and g.ref_type='payout' and g.amount=-p.ccoin_amount
  )) then failures:=array_append(failures,'payout lacks Gems debit'); end if;
  if exists (select 1 from public.gem_transactions debit where debit.ref_type='payout' and debit.amount<0
    and coalesce((select sum(credit.amount) from public.gem_transactions credit
      where credit.user_id=debit.user_id and credit.amount>0
        and credit.created_at+interval '24 hours'<=debit.created_at),0)
      - coalesce((select -sum(prior.amount) from public.gem_transactions prior
        where prior.user_id=debit.user_id and prior.amount<0
          and (prior.created_at,prior.idem_key)<(debit.created_at,debit.idem_key)),0)
      < -debit.amount
  ) then failures:=array_append(failures,'payout consumed insufficient matured Gems'); end if;
  if (select balance_gems from public.wallets where user_id='00000000-0000-4000-8000-000000000003')<>45
     or exists (select 1 from public.gem_lots where user_id='00000000-0000-4000-8000-000000000003' and remaining>0 and mature_at>now()) then
    failures:=array_append(failures,'Karina must have 45 matured Gems'); end if;
  if not exists (select 1 from public.gem_lots where user_id='00000000-0000-4000-8000-000000000004' and remaining=7 and mature_at>now() and ref_id='support-demo-hype') then
    failures:=array_append(failures,'funded locked Gems persona missing'); end if;
  if (select balance_ccoin from public.wallets where user_id='00000000-0000-4000-8000-0000000000c0')<>(select sum(platform_ccoin) from public.platform_revenue)
     or exists (select 1 from public.platform_revenue p where p.platform_ccoin>0 and not exists (
       select 1 from public.wallet_transactions w where w.user_id='00000000-0000-4000-8000-0000000000c0'
         and w.ref_type='platform_revenue' and w.ref_id=p.id and w.amount_ccoin=p.platform_ccoin
     )) then failures:=array_append(failures,'treasury does not match revenue events'); end if;

  if not exists (select 1 from public.cards c join public.bids b on b.card_id=c.id
    join public.shipments s on s.card_id=c.id where c.id='card-seed-karina-01' and c.status='bid_pending'
      and c.location='with_owner' and b.status='accepted' and s.type='secondary_seller_to_vault' and s.status='requested') then
    failures:=array_append(failures,'Creator Seed phase one missing'); end if;
  if not exists (select 1 from public.cards c join public.orders o on o.card_id=c.id
    where c.id='card-seed-karina-02' and c.verify_status='verified' and c.location='platform_vault'
      and c.owner_id=o.user_id and o.status='settled' and o.escrow_status='released') then
    failures:=array_append(failures,'Creator Seed phase two missing'); end if;
  if exists (select 1 from public.admin_audit_log where action in ('login_mfa','2fa_enroll','2fa_reset'))
     or not exists (select 1 from public.admin_audit_log where id='al-login-otp' and payload_summary->>'method'='email_otp') then
    failures:=array_append(failures,'admin auth audit must be OTP plus Access only'); end if;
  if (select count(*) from public.admin_audit_log)<10 or (select count(*) from public.notifications)<10
     or (select count(*) from public.qc_defects)<3 or (select count(*) from public.disputes)<5 then
    failures:=array_append(failures,'admin read-model breadth missing'); end if;

  if (select count(*) from public.badges)<>43 or (select count(distinct code) from public.badges)<>43 then
    failures:=array_append(failures,'achievement catalog must contain 43 distinct definitions'); end if;
  if exists (select 1 from (values
      ('first_drop','First Light',1),('collector_5','Collector',5),('collector_tier_3','Card Keeper',15),
      ('collector_tier_4','Grand Collector',30),('collector_tier_5','Collection Nova',75)
    ) expected(code,name,min) where not exists (
      select 1 from public.badges b where b.code=expected.code and b.name=expected.name
        and (b.criteria->>'min')::integer=expected.min
    )) then failures:=array_append(failures,'collector tier names or thresholds drifted'); end if;
  if not exists (select 1 from public.drops where id='drop-nova-archive-gifts' and total_units=126
    and signed_count=13 and unsigned_count=113 and sold_count=0 and status='closed')
    or (select count(*) from public.cards where drop_id='drop-nova-archive-gifts')<>126 then
    failures:=array_append(failures,'achievement archive inventory missing'); end if;
  if exists (select 1 from (values
      ('00000000-0000-4000-8000-000000000101'::uuid,1,'first_drop'),
      ('00000000-0000-4000-8000-000000000102'::uuid,5,'collector_5'),
      ('00000000-0000-4000-8000-000000000103'::uuid,15,'collector_tier_3'),
      ('00000000-0000-4000-8000-000000000104'::uuid,30,'collector_tier_4'),
      ('00000000-0000-4000-8000-000000000105'::uuid,75,'collector_tier_5')
    ) expected(user_id,cards,highest_code) where
      (select count(distinct card_id) from public.ownership_history where owner_id=expected.user_id)<>expected.cards
      or not exists (select 1 from public.user_badges ub join public.badges b on b.id=ub.badge_id
        where ub.user_id=expected.user_id and b.code=expected.highest_code)
  ) then failures:=array_append(failures,'achievement tier personas missing their earned collector tier'); end if;
  if exists (select 1 from public.users u left join public.user_badges ub on ub.user_id=u.id
    where u.id between '00000000-0000-4000-8000-000000000101' and '00000000-0000-4000-8000-000000000105'
    group by u.id,u.total_xp,u.cumulative_spend_ccoin
    having u.total_xp<>u.cumulative_spend_ccoin+coalesce(sum(ub.xp_reward_snapshot),0)) then
    failures:=array_append(failures,'achievement persona XP lacks badge snapshot accounting'); end if;
  if exists (select 1 from public.wallet_transactions where user_id between
      '00000000-0000-4000-8000-000000000101' and '00000000-0000-4000-8000-000000000105')
    or exists (select 1 from public.wallets where user_id between
      '00000000-0000-4000-8000-000000000101' and '00000000-0000-4000-8000-000000000105'
      and (balance_ccoin<>0 or balance_gems<>0 or total_spent_ccoin<>0 or total_topup_ccoin<>0)) then
    failures:=array_append(failures,'achievement personas must not have wallet activity'); end if;

  if cardinality(failures)>0 then
    raise exception 'seed invariant failure: %',array_to_string(failures,'; ');
  end if;
end $$;
