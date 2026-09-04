-- C.Verse local seed: stable passwordless personas and identity-side fixtures.
-- UUIDs are an E2E contract. There are intentionally no password or MFA factors.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change, email_change_token_new, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','demo@cverse.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@cverse.id',null,now(),'{"provider":"email","providers":["email"],"role":"admin","access":"cloudflare_access"}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','karina@creator.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hype@creator.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nova@creator.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rival@cverse.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ghost@cverse.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','marked@cverse.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','atlas@cverse.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now()),
  ('00000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','luna@cverse.id',null,now(),'{"provider":"email","providers":["email"]}','{}','','','','',now()-interval '90 days',now())
on conflict (id) do nothing;

insert into public.users (
  id,email,display_name,username,role,avatar_url,is_anonymous,flag_reason,
  consent_analytics_detail,username_is_auto
) values
  ('00000000-0000-4000-8000-000000000001','demo@cverse.id','Demo Kolektor','demo_kolektor','user','/mock/v1/avatars/demo.png',false,null,true,false),
  ('00000000-0000-4000-8000-000000000002','admin@cverse.id','Admin C.Verse','admin','admin',null,false,null,false,false),
  ('00000000-0000-4000-8000-000000000003','karina@creator.id','Karina Aespa','karina_aespa','creator',null,false,null,true,false),
  ('00000000-0000-4000-8000-000000000004','hype@creator.id','Hype Collective','hype_collective','creator',null,false,null,false,false),
  ('00000000-0000-4000-8000-000000000005','nova@creator.id','Nova Studio','nova_studio','creator','/mock/v1/avatars/nova.png',false,null,true,false),
  ('00000000-0000-4000-8000-000000000006','rival@cverse.id','Rival Kolektor','rival','user',null,false,null,false,false),
  ('00000000-0000-4000-8000-000000000007','ghost@cverse.id','Ghost Collector','ghost','user',null,true,null,false,false),
  ('00000000-0000-4000-8000-000000000008','marked@cverse.id','Marked Account','marked','user',null,false,'tos_violation_2026_08',false,false),
  ('00000000-0000-4000-8000-000000000009','atlas@cverse.id','Atlas Collector','atlas','user',null,false,null,false,false),
  ('00000000-0000-4000-8000-00000000000a','luna@cverse.id','Luna Collector','luna','user',null,false,null,false,false)
on conflict (id) do update set
  email=excluded.email, display_name=excluded.display_name, username=excluded.username,
  role=excluded.role, avatar_url=excluded.avatar_url, is_anonymous=excluded.is_anonymous,
  flag_reason=excluded.flag_reason, consent_analytics_detail=excluded.consent_analytics_detail,
  username_is_auto=excluded.username_is_auto;

update public.users set role='user', is_anonymous=true
where id='00000000-0000-4000-8000-0000000000c0';

insert into public.wallets (user_id)
select id from public.users
where id in (
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-00000000000a'
) on conflict (user_id) do nothing;

insert into public.badges (id,code,name,description,icon,icon_url,xp,xp_reward,criteria,is_active) values
  ('b1','first_drop','First Drop','Beli kartu pertama','CARD','CARD',100,100,'{"type":"collect_count","min":1}',true),
  ('b2','first_bid','First Bid','Pasang bid pertama','BID','BID',50,50,'{"type":"first_bid"}',true),
  ('b3','collector_5','Collector','Miliki lima kartu','FIVE','FIVE',200,200,'{"type":"collect_count","min":5}',true),
  ('b4','curator','Curator','Miliki sepuluh kartu kreator yang sama','TEN','TEN',300,300,'{"type":"creator_cards","min":10}',true),
  ('b5','whale','Whale','Pasang bid di atas 100 C-Coin','WHALE','WHALE',500,500,'{"type":"single_bid_gt","min":100}',true),
  ('b6','verified','Verified','KYC terverifikasi','KYC','KYC',50,50,'{"type":"kyc_verified"}',true)
on conflict (id) do nothing;

insert into public.creators (
  id,user_id,handle,total_followers_combined,status,bank_account,kyc_completed,notes
) values
  ('cr-karina','00000000-0000-4000-8000-000000000003','karina_aespa',185000,'active','{"bank":"BCA","account_no":"1234567890","holder":"Karina"}',true,'Flagship seed creator'),
  ('cr-hype','00000000-0000-4000-8000-000000000004','hype_collective',320000,'active','{"bank":"Mandiri","account_no":"9876543210","holder":"Hype Collective"}',true,'Genesis creator and locked Gems persona'),
  ('cr-nova','00000000-0000-4000-8000-000000000005','nova_studio',110000,'active','{"bank":"BCA","account_no":"1122334455","holder":"Nova Studio"}',true,'Aurora preview creator')
on conflict (id) do nothing;

-- KYC document values are private Cloudflare R2 object keys, never public URLs.
insert into public.kyc_records (
  id,user_id,full_name,nik,address,dob,ktp_object_key,npwp_object_key,selfie_object_key,status
) values
  ('kyc-demo','00000000-0000-4000-8000-000000000001','Demo Kolektor','3174000000000001','Jakarta','1995-01-01','00000000-0000-4000-8000-000000000001/ktp-demo.jpg',null,'00000000-0000-4000-8000-000000000001/selfie-demo.jpg','pending'),
  ('kyc-karina','00000000-0000-4000-8000-000000000003','Karina Aespa','3174000000000003','Jakarta','1994-02-02','00000000-0000-4000-8000-000000000003/ktp-karina.jpg','00000000-0000-4000-8000-000000000003/npwp-karina.jpg','00000000-0000-4000-8000-000000000003/selfie-karina.jpg','approved'),
  ('kyc-hype','00000000-0000-4000-8000-000000000004','Hype Collective','3174000000000004','Jakarta','1993-03-03','00000000-0000-4000-8000-000000000004/ktp-hype.jpg',null,'00000000-0000-4000-8000-000000000004/selfie-hype.jpg','approved'),
  ('kyc-nova','00000000-0000-4000-8000-000000000005','Nova Studio','3174000000000005','Bandung','1992-04-04','00000000-0000-4000-8000-000000000005/ktp-nova.jpg',null,'00000000-0000-4000-8000-000000000005/selfie-nova.jpg','approved'),
  ('kyc-rival','00000000-0000-4000-8000-000000000006','Rival Kolektor','3174000000000006','Bandung','1991-05-05','00000000-0000-4000-8000-000000000006/ktp-rival.jpg',null,'00000000-0000-4000-8000-000000000006/selfie-rival.jpg','approved'),
  ('kyc-marked','00000000-0000-4000-8000-000000000008','Marked Account','3174000000000008','Bandung','1990-06-06','00000000-0000-4000-8000-000000000008/ktp-marked.jpg',null,'00000000-0000-4000-8000-000000000008/selfie-marked.jpg','rejected')
on conflict (id) do nothing;

-- Approved KYC rows are direct fixtures, so materialize their badge explicitly.
insert into public.user_badges (user_id,badge_id,earned_at,awarded_at,xp_reward_snapshot) values
  ('00000000-0000-4000-8000-000000000003','b6',now()-interval '60 days',now()-interval '60 days',50),
  ('00000000-0000-4000-8000-000000000004','b6',now()-interval '45 days',now()-interval '45 days',50),
  ('00000000-0000-4000-8000-000000000005','b6',now()-interval '30 days',now()-interval '30 days',50),
  ('00000000-0000-4000-8000-000000000006','b6',now()-interval '20 days',now()-interval '20 days',50)
on conflict (user_id,badge_id) do nothing;
