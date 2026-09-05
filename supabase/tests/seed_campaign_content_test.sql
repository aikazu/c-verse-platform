begin;
create temporary table campaign_results(scenario text, passed boolean);
grant all on campaign_results to authenticated;
insert into public.users(id,email,display_name,role,username) values
  ('ec030000-0000-4000-8000-000000000001','campaign-ops@evaluation.invalid','Campaign Ops','admin','campaign-ops'),
  ('ec030000-0000-4000-8000-000000000002','campaign-creator@evaluation.invalid','Seed Creator','creator','campaign-creator');
insert into public.drops(id,title,series,narrative,total_units,signed_count,unsigned_count,
  price_unsigned_ccoin,price_signed_ccoin,status,creator_id,creator_name,is_seed)
  select 'campaign-evaluation-'||n,'Seed Campaign','Test','',1,1,0,10,30,'live',
    'ec030000-0000-4000-8000-000000000002','Seed Creator',n=1 from generate_series(1,2) n;
insert into public.cards(id,drop_id,unit_number,variant,owner_id,nfc_uid,nfc_short_id,location,verify_status)
  values ('campaign-seed','campaign-evaluation-1',1,'signed','ec030000-0000-4000-8000-000000000002',
    'CONTENTSEED01','campaign-seed','with_owner','unknown');
set local role authenticated;
select set_config('request.jwt.claim.sub','ec030000-0000-4000-8000-000000000001',true);
do $$
declare doc jsonb := '{"title":"First collaboration","body":"An optional campaign","cardId":"campaign-seed","making":"Making the artwork","signing":"Signed in person","handover":"Presented to the creator","media":[]}';
begin
  insert into campaign_results values ('unselected Seed has no campaign',public.get_public_drop_editorial('campaign-evaluation-1')='[]');
  begin
    perform public.save_drop_editorial('campaign-evaluation-2','seed_campaign',doc,'publish',0);
    raise exception 'ACCEPTED';
  exception when others then insert into campaign_results values ('ordinary Drop rejected',sqlerrm='NOT_SEED'); end;
  begin
    perform public.save_drop_editorial('campaign-evaluation-1','seed_campaign',jsonb_set(doc,'{cardId}','"unrelated-card"'),'draft',0);
    raise exception 'ACCEPTED';
  exception when others then insert into campaign_results values ('unrelated card rejected',sqlerrm='INVALID_EDITORIAL'); end;
  begin
    perform public.save_drop_editorial('campaign-evaluation-1','seed_campaign',jsonb_set(doc,'{signing}','""'),'publish',0);
    raise exception 'ACCEPTED';
  exception when others then insert into campaign_results values ('publication needs all stages',sqlerrm='CAMPAIGN_INCOMPLETE'); end;
  perform public.save_drop_editorial('campaign-evaluation-1','seed_campaign',jsonb_set(doc,'{signing}','""'),'draft',0);
  insert into campaign_results values ('partial draft hidden',public.get_public_drop_editorial('campaign-evaluation-1')='[]');
  perform public.save_drop_editorial('campaign-evaluation-1','seed_campaign',doc,'publish',1);
  insert into campaign_results values ('published campaign links to real Seed',
    public.get_public_drop_editorial('campaign-evaluation-1')->0->>'cardShortId'='campaign-seed');
end $$;
set local role postgres;
insert into campaign_results values ('campaign does not imply NFC or custody verification',
  (select verify_status='unknown' and location='with_owner' and owner_id='ec030000-0000-4000-8000-000000000002'
   from public.cards where id='campaign-seed'));
update public.users set is_anonymous=true where id='ec030000-0000-4000-8000-000000000002';
insert into campaign_results values ('anonymous creator campaign hidden',public.get_public_drop_editorial('campaign-evaluation-1')='[]');
update public.users set is_anonymous=false,flag_reason='suspension' where id='ec030000-0000-4000-8000-000000000002';
insert into campaign_results values ('suspended creator campaign hidden',public.get_public_drop_editorial('campaign-evaluation-1')='[]');
update public.users set flag_reason=null where id='ec030000-0000-4000-8000-000000000002';
update public.drops set status='draft' where id='campaign-evaluation-1';
insert into campaign_results values ('draft Seed campaign hidden',public.get_public_drop_editorial('campaign-evaluation-1')='[]');
update public.drops set status='live' where id='campaign-evaluation-1';
delete from public.cards where id='campaign-seed';
insert into campaign_results values ('deleted linked card removes campaign',public.get_public_drop_editorial('campaign-evaluation-1')='[]');
select * from campaign_results;
do $$ begin if exists(select 1 from campaign_results where passed is distinct from true) then raise exception 'Seed campaign checks failed'; end if; end $$;
rollback;
