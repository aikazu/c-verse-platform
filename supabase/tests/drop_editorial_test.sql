begin;
create temporary table editorial_results (scenario text, passed boolean);
grant all on editorial_results to authenticated;
insert into public.users(id,email,display_name,role) values
  ('ec020000-0000-4000-8000-000000000001','editor@evaluation.invalid','Editorial Admin','admin'),
  ('ec020000-0000-4000-8000-000000000002','reader@evaluation.invalid','Editorial Reader','user');
insert into public.drops(id,title,series,narrative,total_units,signed_count,unsigned_count,
  price_unsigned_ccoin,price_signed_ccoin,status,creator_id,creator_name)
  values ('editorial-evaluation','Editorial Test','Test','',1,0,1,10,30,'live','ec020000-0000-4000-8000-000000000002','Creator');
set local role authenticated;
select set_config('request.jwt.claim.sub','ec020000-0000-4000-8000-000000000001',true);
do $$
declare doc jsonb := '{"title":"Meaning of the work","body":"Published meaning","media":[],"cardId":null,"making":"","signing":"","handover":""}';
begin
  perform public.save_drop_editorial('editorial-evaluation','story',doc,'draft',0);
  insert into editorial_results values ('draft invisible on live Drop',public.get_public_drop_editorial('editorial-evaluation')='[]');
  perform public.save_drop_editorial('editorial-evaluation','story',doc,'publish',1);
  insert into editorial_results values ('story published without media',public.get_public_drop_editorial('editorial-evaluation')->0->'document'->>'body'='Published meaning');
  doc := jsonb_set(doc,'{body}','"Unpublished changes"');
  perform public.save_drop_editorial('editorial-evaluation','story',doc,'draft',2);
  insert into editorial_results values ('draft update preserves published snapshot',public.get_public_drop_editorial('editorial-evaluation')->0->'document'->>'body'='Published meaning');
  begin
    perform public.save_drop_editorial('editorial-evaluation','story',doc,'publish',2);
    raise exception 'ACCEPTED';
  exception when others then insert into editorial_results values ('stale revision rejected',sqlerrm='EDITORIAL_CONFLICT'); end;
  perform public.save_drop_editorial('editorial-evaluation','story',doc,'unpublish',3);
  insert into editorial_results values ('unpublish removes public content',public.get_public_drop_editorial('editorial-evaluation')='[]');
  doc := jsonb_set(doc,'{body}','""');
  begin
    perform public.save_drop_editorial('editorial-evaluation','story',doc,'publish',4);
    raise exception 'ACCEPTED';
  exception when others then insert into editorial_results values ('empty publication rejected',sqlerrm='EDITORIAL_EMPTY'); end;
  perform public.save_drop_editorial('editorial-evaluation','story',doc,'draft',4);
  insert into editorial_results values ('empty draft saved',(select revision=5 from public.drop_editorial where drop_id='editorial-evaluation'));
  doc := jsonb_set(doc,'{media}','[{"type":"image","url":"javascript:alert(1)","caption":"bad"}]');
  begin
    perform public.save_drop_editorial('editorial-evaluation','story',doc,'draft',5);
    raise exception 'ACCEPTED';
  exception when others then insert into editorial_results values ('unsafe URL rejected by DB',sqlerrm='INVALID_EDITORIAL'); end;
end $$;
select set_config('request.jwt.claim.sub','ec020000-0000-4000-8000-000000000002',true);
do $$ begin
  insert into editorial_results values ('non-admin cannot read drafts',not exists(select 1 from public.drop_editorial where drop_id='editorial-evaluation'));
  begin
    perform public.save_drop_editorial('editorial-evaluation','story','{}','draft',0);
    raise exception 'ACCEPTED';
  exception when others then insert into editorial_results values ('non-admin write rejected',sqlerrm='FORBIDDEN'); end;
  insert into public.collector_preferences(user_id,guide_dismissed) values(auth.uid(),true);
  insert into editorial_results values ('guide dismissal persisted',(select guide_dismissed from public.collector_preferences where user_id=auth.uid()));
  update public.collector_preferences set guide_dismissed=false where user_id=auth.uid();
  insert into editorial_results values ('guide reopens',(select not guide_dismissed from public.collector_preferences where user_id=auth.uid()));
  begin
    insert into public.collector_preferences(user_id,guide_dismissed) values('ec020000-0000-4000-8000-000000000001',true);
    raise exception 'ACCEPTED';
  exception when insufficient_privilege then insert into editorial_results values ('cannot change another guide preference',true); end;
end $$;
set local role postgres;
update public.users set flag_reason='test suspension' where id in ('ec020000-0000-4000-8000-000000000001','ec020000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
  insert into editorial_results values ('suspended guide read denied',not exists(select 1 from public.collector_preferences where user_id=auth.uid()));
  perform set_config('request.jwt.claim.sub','ec020000-0000-4000-8000-000000000001',true);
  begin
    perform public.save_drop_editorial('editorial-evaluation','story','{}','draft',0);
    raise exception 'ACCEPTED';
  exception when others then insert into editorial_results values ('suspended admin write denied',sqlerrm='FORBIDDEN'); end;
end $$;
set local role postgres;
insert into editorial_results values ('mutations audited atomically',(select count(*)=5 from public.admin_audit_log where target_id='editorial-evaluation'));
select * from editorial_results;
do $$ begin if exists(select 1 from editorial_results where passed is distinct from true) then raise exception 'Editorial checks failed'; end if; end $$;
rollback;
