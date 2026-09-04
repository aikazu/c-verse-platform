-- Closed C-Coin and C-Gems ledgers. Every cache below is derived from its
-- append-only ledger, and every revenue event has a matching treasury credit.

with events(seq,id,user_id,type,amount,ref_type,ref_id,note,happened_at,metadata) as (values
  (1,'wtx-demo-topup','00000000-0000-4000-8000-000000000001'::uuid,'top_up'::public.wallet_tx_type,500,'topup','topup-demo','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-demo"}'::jsonb),
  (2,'wtx-admin-topup','00000000-0000-4000-8000-000000000002'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-admin','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-admin"}'::jsonb),
  (3,'wtx-karina-topup','00000000-0000-4000-8000-000000000003'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-karina','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-karina"}'::jsonb),
  (4,'wtx-hype-topup','00000000-0000-4000-8000-000000000004'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-hype','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-hype"}'::jsonb),
  (5,'wtx-nova-topup','00000000-0000-4000-8000-000000000005'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-nova','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-nova"}'::jsonb),
  (6,'wtx-rival-topup','00000000-0000-4000-8000-000000000006'::uuid,'top_up'::public.wallet_tx_type,500,'topup','topup-rival','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-rival"}'::jsonb),
  (7,'wtx-ghost-topup','00000000-0000-4000-8000-000000000007'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-ghost','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-ghost"}'::jsonb),
  (8,'wtx-marked-topup','00000000-0000-4000-8000-000000000008'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-marked','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-marked"}'::jsonb),
  (9,'wtx-atlas-topup','00000000-0000-4000-8000-000000000009'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-atlas','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-atlas"}'::jsonb),
  (10,'wtx-luna-topup','00000000-0000-4000-8000-00000000000a'::uuid,'top_up'::public.wallet_tx_type,100,'topup','topup-luna','Local Midtrans settlement',now()-interval '20 days','{"idempotency_key":"topup-luna"}'::jsonb),
  (11,'wtx-signed-hold-01','00000000-0000-4000-8000-000000000001'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-01"}'::jsonb),
  (12,'wtx-signed-hold-02','00000000-0000-4000-8000-000000000002'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-02"}'::jsonb),
  (13,'wtx-signed-hold-03','00000000-0000-4000-8000-000000000003'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-03"}'::jsonb),
  (14,'wtx-signed-hold-04','00000000-0000-4000-8000-000000000004'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-04"}'::jsonb),
  (15,'wtx-signed-hold-05','00000000-0000-4000-8000-000000000005'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-05"}'::jsonb),
  (16,'wtx-signed-hold-06','00000000-0000-4000-8000-000000000006'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-06"}'::jsonb),
  (17,'wtx-signed-hold-07','00000000-0000-4000-8000-000000000007'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-07"}'::jsonb),
  (18,'wtx-signed-hold-08','00000000-0000-4000-8000-000000000008'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-08"}'::jsonb),
  (19,'wtx-signed-hold-09','00000000-0000-4000-8000-000000000009'::uuid,'escrow_hold'::public.wallet_tx_type,-30,'drop','drop-aespa-signed','Raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-09"}'::jsonb),
  (20,'wtx-signed-hold-10','00000000-0000-4000-8000-00000000000a'::uuid,'escrow_hold'::public.wallet_tx_type,-50,'drop','drop-aespa-signed','Premium raffle hold',now()-interval '11 days','{"idempotency_key":"entry-signed-10"}'::jsonb),
  (21,'wtx-aespa-01','00000000-0000-4000-8000-000000000001'::uuid,'checkout'::public.wallet_tx_type,-30,'drop','drop-aespa-live','Vault checkout',now()-interval '7 days','{"idempotency_key":"checkout-aespa-01"}'::jsonb),
  (22,'wtx-aespa-02','00000000-0000-4000-8000-000000000006'::uuid,'checkout'::public.wallet_tx_type,-30,'drop','drop-aespa-live','Vault checkout',now()-interval '7 days','{"idempotency_key":"checkout-aespa-02"}'::jsonb),
  (23,'wtx-aespa-03','00000000-0000-4000-8000-000000000005'::uuid,'checkout'::public.wallet_tx_type,-30,'drop','drop-aespa-live','Vault checkout',now()-interval '7 days','{"idempotency_key":"checkout-aespa-03"}'::jsonb),
  (24,'wtx-aespa-04','00000000-0000-4000-8000-000000000009'::uuid,'checkout'::public.wallet_tx_type,-30,'drop','drop-aespa-live','Vault checkout',now()-interval '7 days','{"idempotency_key":"checkout-aespa-04"}'::jsonb),
  (25,'wtx-genesis-01','00000000-0000-4000-8000-000000000001'::uuid,'checkout'::public.wallet_tx_type,-25,'drop','drop-genesis-live','Vault checkout',now()-interval '6 days','{"idempotency_key":"checkout-genesis-01"}'::jsonb),
  (26,'wtx-genesis-02','00000000-0000-4000-8000-000000000006'::uuid,'checkout'::public.wallet_tx_type,-25,'drop','drop-genesis-live','Vault checkout',now()-interval '6 days','{"idempotency_key":"checkout-genesis-02"}'::jsonb),
  (27,'wtx-ghost-bid-hold','00000000-0000-4000-8000-000000000007'::uuid,'escrow_hold'::public.wallet_tx_type,-35,'bid','bid-aespa-outbid-ghost','Bid hold',now()-interval '6 days','{"idempotency_key":"bid-hold-ghost"}'::jsonb),
  (28,'wtx-rival-bid-hold','00000000-0000-4000-8000-000000000006'::uuid,'escrow_hold'::public.wallet_tx_type,-45,'bid','bid-aespa-accepted-rival','Winning bid hold',now()-interval '6 days','{"idempotency_key":"bid-hold-rival"}'::jsonb),
  (29,'wtx-demo-seed-hold','00000000-0000-4000-8000-000000000001'::uuid,'escrow_hold'::public.wallet_tx_type,-80,'card','card-seed-karina-02','Released seed buyout hold',now()-interval '5 days 12 hours','{"idempotency_key":"buyout-seed-released"}'::jsonb),
  (30,'wtx-ghost-bid-release','00000000-0000-4000-8000-000000000007'::uuid,'escrow_release'::public.wallet_tx_type,35,'bid','bid-aespa-outbid-ghost','Outbid release',now()-interval '5 days','{"idempotency_key":"release-bid-ghost"}'::jsonb),
  (31,'wtx-rival-cancel-hold','00000000-0000-4000-8000-000000000006'::uuid,'escrow_hold'::public.wallet_tx_type,-12,'bid','bid-genesis-cancelled-rival','Cancelled bid hold',now()-interval '4 days','{"idempotency_key":"bid-hold-cancelled"}'::jsonb),
  (32,'wtx-rival-cancel-release','00000000-0000-4000-8000-000000000006'::uuid,'escrow_release'::public.wallet_tx_type,12,'bid','bid-genesis-cancelled-rival','Cancelled bid release',now()-interval '3 days','{"idempotency_key":"bid-release-cancelled"}'::jsonb),
  (33,'wtx-rival-ship-aespa','00000000-0000-4000-8000-000000000006'::uuid,'vault_shipout'::public.wallet_tx_type,-2,'shipment','shipout-aespa-02','Vault ship-out fee',now()-interval '4 days','{"idempotency_key":"shipout-aespa-02"}'::jsonb),
  (34,'wtx-rival-ship-genesis','00000000-0000-4000-8000-000000000006'::uuid,'vault_shipout'::public.wallet_tx_type,-2,'shipment','shipout-genesis-02','Vault ship-out fee',now()-interval '3 days','{"idempotency_key":"shipout-genesis-02"}'::jsonb),
  (35,'wtx-hype-ship-signed','00000000-0000-4000-8000-000000000004'::uuid,'vault_shipout'::public.wallet_tx_type,-2,'shipment','shipout-signed-04','Vault ship-out fee',now()-interval '2 days','{"idempotency_key":"shipout-signed-04"}'::jsonb),
  (36,'wtx-rival-seed-hold','00000000-0000-4000-8000-000000000006'::uuid,'escrow_hold'::public.wallet_tx_type,-60,'bid','bid-seed-accepted-rival','Creator Seed phase-one hold',now()-interval '3 hours','{"idempotency_key":"seed-lock-rival"}'::jsonb),
  (37,'wtx-demo-support','00000000-0000-4000-8000-000000000001'::uuid,'support'::public.wallet_tx_type,-7,'support','support-demo-hype','Support to Hype',now()-interval '1 hour','{"idempotency_key":"support-demo-hype"}'::jsonb),
  (38,'wtx-demo-active-bid','00000000-0000-4000-8000-000000000001'::uuid,'escrow_hold'::public.wallet_tx_type,-8,'bid','bid-genesis-active-demo','Active bid hold',now()-interval '2 hours','{"idempotency_key":"bid-active-demo"}'::jsonb),
  (39,'wtx-ghost-entry-hold','00000000-0000-4000-8000-000000000007'::uuid,'escrow_hold'::public.wallet_tx_type,-50,'drop','drop-aespa-live','Lost raffle hold',now()-interval '8 days','{"idempotency_key":"entry-live-ghost"}'::jsonb),
  (40,'wtx-ghost-entry-release','00000000-0000-4000-8000-000000000007'::uuid,'escrow_release'::public.wallet_tx_type,50,'drop','drop-aespa-live','Lost raffle refund',now()-interval '7 days','{"idempotency_key":"entry-live-ghost-refund"}'::jsonb),
  (41,'wtx-marked-entry-hold','00000000-0000-4000-8000-000000000008'::uuid,'escrow_hold'::public.wallet_tx_type,-25,'drop','drop-genesis-live','Cancelled raffle hold',now()-interval '7 days','{"idempotency_key":"entry-live-marked"}'::jsonb),
  (42,'wtx-marked-entry-release','00000000-0000-4000-8000-000000000008'::uuid,'escrow_release'::public.wallet_tx_type,25,'drop','drop-genesis-live','Cancelled raffle refund',now()-interval '6 days','{"idempotency_key":"entry-live-marked-refund"}'::jsonb)
), signed_conversions as (
  select 100+n as seq,'wtx-signed-convert-'||lpad(n::text,2,'0') id,
    ('00000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid user_id,
    'checkout'::public.wallet_tx_type type,0 amount,'order' ref_type,
    'ord-signed-'||lpad(n::text,2,'0') ref_id,'Raffle hold converted to purchase' note,
    now()-interval '10 days' happened_at,
    jsonb_build_object('conversion_of_hold',true,'spend_ccoin',case when n=10 then 50 else 30 end) metadata
  from generate_series(1,10) n
), all_events as (select * from events union all select * from signed_conversions), balanced as (
  select e.*,sum(amount) over(partition by user_id order by happened_at,seq,id)::int balance_after
  from all_events e
)
insert into public.wallet_transactions (
  id,user_id,type,amount_ccoin,balance_after_ccoin,ref_type,ref_id,note,created_at,metadata
)
select id,user_id,type,amount,balance_after,ref_type,ref_id,note,happened_at,metadata
from balanced on conflict (id) do nothing;

update public.wallets w set
  balance_ccoin=x.balance,
  total_topup_ccoin=x.topup,
  total_spent_ccoin=x.spent
from (
  select user_id,sum(amount_ccoin)::int balance,
    sum(amount_ccoin) filter(where type='top_up')::int topup,
    -sum(amount_ccoin) filter(where amount_ccoin<0)::int spent
  from public.wallet_transactions group by user_id
) x where x.user_id=w.user_id;

-- Primary revenue is generated from orders so price and creator handling cannot
-- drift. FCFS suppresses creator self-buy royalty; raffle draw credits it.
insert into public.platform_revenue (
  id,source,ref_type,ref_id,gross_ccoin,platform_ccoin,royalty_ccoin,seller_ccoin,fee_snapshot,created_at
)
select 'pr-'||o.id,'primary','order',o.id,o.total_ccoin,
  o.total_ccoin-case when o.source='fcfs' and d.creator_id=o.user_id then 0 else floor(o.total_ccoin*0.3)::int end,
  case when o.source='fcfs' and d.creator_id=o.user_id then 0 else floor(o.total_ccoin*0.3)::int end,0,
  '{"platform_pct":0.7,"royalty_pct":0.3,"rate_idr":10000}'::jsonb,o.created_at
from public.orders o join public.drops d on d.id=o.drop_id
where o.source in ('fcfs','raffle')
on conflict (ref_type,ref_id) do nothing;

insert into public.platform_revenue (
  id,source,ref_type,ref_id,gross_ccoin,platform_ccoin,royalty_ccoin,seller_ccoin,fee_snapshot,created_at
) values
  ('pr-bid-aespa-accepted','secondary_bid','bid','bid-aespa-accepted-rival',45,4,4,37,'{"platform_pct":0.075,"royalty_pct":0.075,"seller_pct":0.85,"rate_idr":10000}',now()-interval '5 days'),
  ('pr-seed-released','secondary_buyout','order','ord-seed-released',80,6,6,68,'{"platform_pct":0.075,"royalty_pct":0.075,"seller_pct":0.85,"rate_idr":10000}',now()-interval '5 days')
on conflict (ref_type,ref_id) do nothing;

insert into public.platform_revenue (
  id,source,ref_type,ref_id,gross_ccoin,platform_ccoin,royalty_ccoin,seller_ccoin,fee_snapshot,created_at
)
select 'pr-'||id,'shipment','shipment',id,fee_ccoin,fee_ccoin,0,0,
  '{"platform_pct":1.0,"royalty_pct":0,"seller_pct":0,"rate_idr":10000}'::jsonb,created_at
from public.shipments where type='vault_shipout'
on conflict (ref_type,ref_id) do nothing;

-- One treasury transaction per revenue event preserves referential traceability.
with revenue as (
  select p.*,sum(platform_ccoin) over(order by created_at,id)::int running
  from public.platform_revenue p
)
insert into public.wallet_transactions (
  id,user_id,type,amount_ccoin,balance_after_ccoin,ref_type,ref_id,note,created_at,metadata
)
select 'wtx-treasury-'||id,'00000000-0000-4000-8000-0000000000c0','platform_revenue',
  platform_ccoin,running,'platform_revenue',id,'Platform revenue event',created_at,
  jsonb_build_object('idempotency_key','rev-'||ref_type||'-'||ref_id)
from revenue where platform_ccoin>0 on conflict (id) do nothing;

update public.wallets w set balance_ccoin=x.balance,total_topup_ccoin=0,total_spent_ccoin=0
from (select user_id,sum(amount_ccoin)::int balance from public.wallet_transactions
      where user_id='00000000-0000-4000-8000-0000000000c0' group by user_id) x
where w.user_id=x.user_id;

insert into public.payout_batches (id,batch_code,status,total_ccoin,total_idr,fee_1pct_idr,created_at) values
  ('pb-seed-paid','PB-SEED-PAID','paid',140,1386000,14000,now()-interval '3 days'),
  ('pb-seed-processing','PB-SEED-PROCESSING','processing',45,445500,4500,now()-interval '2 days')
on conflict (id) do nothing;

insert into public.payouts (
  id,batch_id,user_id,type,ccoin_amount,idr_amount,withholding_tax,status,requested_at
) values
  ('po-karina-paid','pb-seed-paid','00000000-0000-4000-8000-000000000003','creator_share',120,1188000,'{"pph21":0}','disbursed',now()-interval '3 days'),
  ('po-nova-paid','pb-seed-paid','00000000-0000-4000-8000-000000000005','seller_proceeds',20,198000,'{"pph21":0}','disbursed',now()-interval '3 days'),
  ('po-karina-processing','pb-seed-processing','00000000-0000-4000-8000-000000000003','royalty',45,445500,'{"pph21":0}','processing',now()-interval '2 days')
on conflict (id) do nothing;

-- Credit events mirror their settlement source; payout events debit mature lots.
with credits(user_id,amount,ref_type,ref_table,ref_id,idem_key,happened_at) as (
  select d.creator_id,p.royalty_ccoin,'royalty','order',p.ref_id,'royalty-'||p.ref_id,p.created_at
  from public.platform_revenue p join public.orders o on o.id=p.ref_id join public.drops d on d.id=o.drop_id
  where p.source='primary' and p.royalty_ccoin>0
  union all select '00000000-0000-4000-8000-000000000005',37,'settlement','bid','bid-aespa-accepted-rival','settle-bid-aespa-accepted-rival',now()-interval '5 days'
  union all select '00000000-0000-4000-8000-000000000003',4,'royalty','bid','bid-aespa-accepted-rival','royalty-bid-aespa-accepted-rival',now()-interval '5 days'
  union all select '00000000-0000-4000-8000-000000000003',68,'settlement','order','ord-seed-released','settle-ord-seed-released',now()-interval '5 days'
  union all select '00000000-0000-4000-8000-000000000003',6,'royalty','order','ord-seed-released','royalty-ord-seed-released',now()-interval '5 days'
  union all select '00000000-0000-4000-8000-000000000004',7,'support','support','support-demo-hype','support-demo-hype',now()-interval '1 hour'
), events as (
  select * from credits
  union all select '00000000-0000-4000-8000-000000000003',-120,'payout','payouts','po-karina-paid','payout-po-karina-paid',now()-interval '3 days'
  union all select '00000000-0000-4000-8000-000000000005',-20,'payout','payouts','po-nova-paid','payout-po-nova-paid',now()-interval '3 days'
  union all select '00000000-0000-4000-8000-000000000003',-45,'payout','payouts','po-karina-processing','payout-po-karina-processing',now()-interval '2 days'
), balanced as (
  select e.*,sum(amount) over(partition by user_id order by happened_at,idem_key)::int running
  from events e
)
insert into public.gem_transactions (
  id,user_id,amount,balance_after_gems,ref_type,ref_table,ref_id,idem_key,created_at
)
select (substr(md5(idem_key),1,8)||'-'||substr(md5(idem_key),9,4)||'-4'||substr(md5(idem_key),14,3)||'-8'||substr(md5(idem_key),18,3)||'-'||substr(md5(idem_key),21,12))::uuid,
  user_id,amount,running,ref_type,ref_table,ref_id,idem_key,happened_at
from balanced on conflict (idem_key) do nothing;

-- FIFO remaining is derived from total payout debits, not hand-maintained.
with credits as (
  select g.*,coalesce(sum(g.amount) over(partition by g.user_id order by g.created_at,g.id rows between unbounded preceding and 1 preceding),0)::int before_credit
  from public.gem_transactions g where g.amount>0
), debits as (
  select user_id,-sum(amount)::int debit from public.gem_transactions where amount<0 group by user_id
)
insert into public.gem_lots (id,user_id,amount,remaining,ref_type,ref_id,created_at,mature_at)
select (substr(md5('lot-'||c.idem_key),1,8)||'-'||substr(md5('lot-'||c.idem_key),9,4)||'-4'||substr(md5('lot-'||c.idem_key),14,3)||'-8'||substr(md5('lot-'||c.idem_key),18,3)||'-'||substr(md5('lot-'||c.idem_key),21,12))::uuid,
  c.user_id,c.amount,greatest(0,c.amount-greatest(0,coalesce(d.debit,0)-c.before_credit)),
  c.ref_type,c.ref_id,c.created_at,c.created_at+interval '24 hours'
from credits c left join debits d on d.user_id=c.user_id
on conflict (id) do nothing;

update public.wallets w set balance_gems=x.balance
from (select user_id,sum(amount)::int balance from public.gem_transactions group by user_id) x
where x.user_id=w.user_id;

-- Spend-derived XP plus badge snapshots; raffle conversion and released seed
-- purchases count once even though the underlying C-Coin was held earlier.
with spend as (
  select user_id,sum(total_ccoin)::int amount from public.orders where source in ('fcfs','raffle') group by user_id
  union all select bidder_id,amount_ccoin from public.bids where id='bid-aespa-accepted-rival'
  union all select user_id,total_ccoin from public.orders where id='ord-seed-released'
  union all select user_id,-amount_ccoin from public.wallet_transactions where type='support'
), totals as (select user_id,sum(amount)::int amount from spend group by user_id), rewards as (
  select user_id,sum(xp_reward_snapshot)::int amount from public.user_badges group by user_id
)
update public.users u set cumulative_spend_ccoin=coalesce(t.amount,0),
  total_xp=coalesce(t.amount,0)+coalesce(r.amount,0),
  level=least(100,greatest(1,floor((coalesce(t.amount,0)+coalesce(r.amount,0))/10)+1))
from totals t full join rewards r using(user_id) where u.id=coalesce(t.user_id,r.user_id);
