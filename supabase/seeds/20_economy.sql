-- Purchase, raffle, ownership, secondary, shipment, NFC, and QC scenarios.

-- Ten unique raffle winners; the premium winner owns signed unit 10.
insert into public.drop_entries (id,drop_id,user_id,pool,hold_ccoin,status,created_at) values
  ('de-signed-01','drop-aespa-signed','00000000-0000-4000-8000-000000000001','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-02','drop-aespa-signed','00000000-0000-4000-8000-000000000002','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-03','drop-aespa-signed','00000000-0000-4000-8000-000000000003','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-04','drop-aespa-signed','00000000-0000-4000-8000-000000000004','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-05','drop-aespa-signed','00000000-0000-4000-8000-000000000005','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-06','drop-aespa-signed','00000000-0000-4000-8000-000000000006','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-07','drop-aespa-signed','00000000-0000-4000-8000-000000000007','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-08','drop-aespa-signed','00000000-0000-4000-8000-000000000008','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-09','drop-aespa-signed','00000000-0000-4000-8000-000000000009','regular',30,'won_regular',now()-interval '10 days'),
  ('de-signed-10','drop-aespa-signed','00000000-0000-4000-8000-00000000000a','premium',50,'won_premium',now()-interval '10 days'),
  ('de-live-demo','drop-aespa-live','00000000-0000-4000-8000-000000000007','both',50,'lost',now()-interval '7 days'),
  ('de-live-rival','drop-genesis-live','00000000-0000-4000-8000-000000000008','regular',25,'refunded',now()-interval '6 days')
on conflict (id) do nothing;

insert into public.orders (
  id,user_id,drop_id,card_id,total_ccoin,total_idr,status,delivery_option,
  shipping_fee_ccoin,escrow_status,shipping_address,created_at,source
) values
  ('ord-aespa-01','00000000-0000-4000-8000-000000000001','drop-aespa-live','card-aespa-live-01',30,300000,'settled','vault',null,'released',null,now()-interval '7 days','fcfs'),
  ('ord-aespa-02','00000000-0000-4000-8000-000000000006','drop-aespa-live','card-aespa-live-02',30,300000,'settled','vault',null,'released',null,now()-interval '7 days','fcfs'),
  ('ord-aespa-03','00000000-0000-4000-8000-000000000005','drop-aespa-live','card-aespa-live-03',30,300000,'settled','vault',null,'released',null,now()-interval '7 days','fcfs'),
  ('ord-aespa-04','00000000-0000-4000-8000-000000000009','drop-aespa-live','card-aespa-live-04',30,300000,'settled','vault',null,'released',null,now()-interval '7 days','fcfs'),
  ('ord-genesis-01','00000000-0000-4000-8000-000000000001','drop-genesis-live','card-genesis-live-01',25,250000,'settled','vault',null,'released',null,now()-interval '6 days','fcfs'),
  ('ord-genesis-02','00000000-0000-4000-8000-000000000006','drop-genesis-live','card-genesis-live-02',25,250000,'settled','vault',null,'released',null,now()-interval '6 days','fcfs'),
  ('ord-seed-released','00000000-0000-4000-8000-000000000001','drop-seed-karina-02','card-seed-karina-02',80,800000,'settled','vault',null,'released',null,now()-interval '5 days','secondary_buyout')
on conflict (id) do nothing;

insert into public.orders (
  id,user_id,drop_id,card_id,total_ccoin,total_idr,status,delivery_option,
  shipping_fee_ccoin,escrow_status,created_at,source
)
select
  'ord-signed-' || lpad(n::text,2,'0'),
  ('00000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid,
  'drop-aespa-signed','card-aespa-signed-' || lpad(n::text,2,'0'),
  case when n=10 then 50 else 30 end,
  case when n=10 then 500000 else 300000 end,
  'settled','vault',null,'released',now()-interval '10 days','raffle'
from generate_series(1,10) n
on conflict (id) do nothing;

-- Bid coverage includes active, outbid, cancelled, accepted, and seed PHASE-1.
insert into public.bids (
  id,card_id,bidder_id,bidder_name,amount_ccoin,status,created_at,
  outbid_at,cancelled_at,accepted_at,destination,shipping_address
) values
  ('bid-genesis-active-demo','card-genesis-live-02','00000000-0000-4000-8000-000000000001','Demo Kolektor',8,'active',now()-interval '2 hours',null,null,null,null,null),
  ('bid-aespa-outbid-ghost','card-aespa-live-03','00000000-0000-4000-8000-000000000007','Anonim',35,'outbid',now()-interval '6 days',now()-interval '5 days',null,null,null,null),
  ('bid-aespa-accepted-rival','card-aespa-live-03','00000000-0000-4000-8000-000000000006','Rival Kolektor',45,'accepted',now()-interval '6 days',null,null,now()-interval '5 days','platform_vault',null),
  ('bid-genesis-cancelled-rival','card-genesis-live-01','00000000-0000-4000-8000-000000000006','Rival Kolektor',12,'cancelled',now()-interval '4 days',null,now()-interval '3 days',null,null,null),
  ('bid-seed-accepted-rival','card-seed-karina-01','00000000-0000-4000-8000-000000000006','Rival Kolektor',60,'accepted',now()-interval '3 hours',null,null,now()-interval '2 hours','platform_vault',null)
on conflict (id) do nothing;

-- Every primary order creates its own ownership event, including all winners.
insert into public.ownership_history (id,card_id,owner_id,acquired_via,order_id,transferred_at)
select 'oh-' || o.id,o.card_id,o.user_id,'primary',o.id,o.created_at
from public.orders o where o.source in ('fcfs','raffle')
on conflict (id) do nothing;

-- Secondary and seed histories preserve the seller-before-buyer chronology.
insert into public.ownership_history (id,card_id,owner_id,acquired_via,order_id,bid_id,transferred_at) values
  ('oh-aespa-03-secondary','card-aespa-live-03','00000000-0000-4000-8000-000000000006','secondary_bid',null,'bid-aespa-accepted-rival',now()-interval '5 days'),
  ('oh-aespa-04-gift','card-aespa-live-04','00000000-0000-4000-8000-000000000006','gift',null,null,now()-interval '6 days'),
  ('oh-seed-01-karina','card-seed-karina-01','00000000-0000-4000-8000-000000000003','gift',null,null,now()-interval '30 days'),
  ('oh-seed-02-karina','card-seed-karina-02','00000000-0000-4000-8000-000000000003','gift',null,null,now()-interval '45 days'),
  ('oh-seed-02-demo','card-seed-karina-02','00000000-0000-4000-8000-000000000001','secondary_buyout','ord-seed-released',null,now()-interval '5 days'),
  ('oh-signed-02-gift','card-aespa-signed-02','00000000-0000-4000-8000-000000000001','gift',null,null,now()-interval '9 days'),
  ('oh-signed-05-gift','card-aespa-signed-05','00000000-0000-4000-8000-000000000001','gift',null,null,now()-interval '9 days'),
  ('oh-signed-07-gift','card-aespa-signed-07','00000000-0000-4000-8000-000000000001','gift',null,null,now()-interval '9 days'),
  ('oh-signed-08-gift','card-aespa-signed-08','00000000-0000-4000-8000-000000000006','gift',null,null,now()-interval '9 days'),
  ('oh-signed-09-gift','card-aespa-signed-09','00000000-0000-4000-8000-000000000006','gift',null,null,now()-interval '9 days')
on conflict (id) do nothing;

-- Purchase-to-Vault only. Physical delivery is a later vault_shipout.
insert into public.shipments (
  id,card_id,requester_id,type,from_location,to_dest,address,fee_ccoin,
  status,tracking_number,platform_check,created_at
) values
  ('ship-primary-vault-aespa','card-aespa-live-01','00000000-0000-4000-8000-000000000001','primary_vault','platform','platform_vault',null,0,'delivered',null,'{"qc":"passed"}',now()-interval '7 days'),
  ('ship-primary-vault-genesis','card-genesis-live-01','00000000-0000-4000-8000-000000000001','primary_vault','platform','platform_vault',null,0,'delivered',null,'{"qc":"passed"}',now()-interval '6 days'),
  ('shipout-aespa-02','card-aespa-live-02','00000000-0000-4000-8000-000000000006','vault_shipout','platform','buyer_address','{"street":"Jl. Rival No. 99, Bandung"}',2,'delivered','JNE-SEED-001','{"handoff":"complete"}',now()-interval '4 days'),
  ('shipout-genesis-02','card-genesis-live-02','00000000-0000-4000-8000-000000000006','vault_shipout','platform','buyer_address','{"street":"Jl. Rival No. 99, Bandung"}',2,'delivered','JNE-SEED-002','{"handoff":"complete"}',now()-interval '3 days'),
  ('shipout-signed-04','card-aespa-signed-04','00000000-0000-4000-8000-000000000004','vault_shipout','platform','buyer_address','{"street":"Jl. Hype No. 8, Jakarta"}',2,'delivered','JNE-SEED-003','{"handoff":"complete"}',now()-interval '2 days'),
  ('ship-seed-seller-vault','card-seed-karina-01','00000000-0000-4000-8000-000000000003','secondary_seller_to_vault','with_owner','platform_vault',null,0,'requested',null,'{"phase":"awaiting_card"}',now()-interval '90 minutes')
on conflict (id) do nothing;

insert into public.nfc_batches (id,batch_code,vendor,qty,status,created_at) values
  ('nb-received','NFC-SEED-RECEIVED','TagTamper Partner',25,'received',now()-interval '2 days'),
  ('nb-provisioned','NFC-SEED-PROVISIONED','TagTamper Partner',50,'provisioned',now()-interval '14 days'),
  ('nb-deployed','NFC-SEED-DEPLOYED','TagTamper Partner',100,'deployed',now()-interval '45 days')
on conflict (id) do nothing;

insert into public.qc_defects (
  id,card_id,defect_type,severity,notes,resolution,redistribute_discount_pct,created_at
) values
  ('qcd-beta-print','card-genesis-beta-09','kartu','major','Print alignment outside tolerance.','return_vendor',null,now()-interval '2 days'),
  ('qcd-beta-nfc','card-genesis-beta-10','nfc','critical','Tamper state detected during batch QC.','destroy',null,now()-interval '1 day'),
  ('qcd-aurora-box','card-aespa-2027-04','dus','minor','Corner dent; safe for disclosed redistribution.','redistribute',20,now()-interval '3 hours')
on conflict (id) do nothing;

insert into public.disputes (
  id,order_id,card_id,reporter_id,reason,status,decision_notes,created_at,updated_at
) values
  ('dsp-open','ord-aespa-04','card-aespa-live-04','00000000-0000-4000-8000-000000000006','Vault photo needs clarification.','open',null,now()-interval '1 day',now()-interval '1 day'),
  ('dsp-review','ord-signed-08','card-aespa-signed-08','00000000-0000-4000-8000-000000000008','Packaging claim under review.','under_review','Waiting for vendor evidence.',now()-interval '4 days',now()-interval '2 days'),
  ('dsp-refund',null,'card-genesis-beta-09','00000000-0000-4000-8000-000000000004','Major print defect.','resolved_refund','Vendor credited replacement batch.',now()-interval '2 days',now()-interval '1 day'),
  ('dsp-strike',null,'card-genesis-beta-10','00000000-0000-4000-8000-000000000004','NFC tamper during provisioning.','resolved_strike','Batch isolated and vendor warned.',now()-interval '2 days',now()-interval '1 day'),
  ('dsp-suspend',null,'card-aespa-2027-04','00000000-0000-4000-8000-000000000005','Repeated packaging miss.','resolved_suspend','Future release paused for remediation.',now()-interval '1 day',now())
on conflict (id) do nothing;
