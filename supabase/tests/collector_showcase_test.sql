-- Run on linked remote development. Every fixture/change rolls back.
begin;
create temporary table showcase_results (scenario text, passed boolean);
do $$
declare
  owner uuid := 'ec010000-0000-4000-8000-000000000001';
  other_user uuid := 'ec010000-0000-4000-8000-000000000002';
  result jsonb;
begin
  insert into public.users(id,email,display_name,username) values
    (owner,'showcase@evaluation.invalid','Showcase Owner','showcase-evaluation'),
    (other_user,'other-showcase@evaluation.invalid','Other Owner','showcase-other');
  insert into public.drops(id,title,series,narrative,total_units,signed_count,unsigned_count,
    price_unsigned_ccoin,price_signed_ccoin,status,creator_id,creator_name)
    values ('showcase-evaluation','Showcase Test','Test','',4,0,4,10,30,'live',owner,'Creator');
  insert into public.cards(id,drop_id,unit_number,variant,owner_id,nfc_uid,nfc_short_id)
    select 'showcase-test-'||n,'showcase-evaluation',n,'unsigned',owner,'SHOWCASE'||n,'showcase-test-'||n
    from generate_series(1,4) n;
  perform set_config('request.jwt.claim.sub',owner::text,true);
  perform public.save_collection_showcase('My collection',array['showcase-test-3','showcase-test-1','showcase-test-2']);
  result := public.get_public_showcase('showcase-evaluation');
  insert into showcase_results values ('three cards persist in selected order',
    result->>'title' = 'My collection' and jsonb_array_length(result->'cards') = 3
    and result->'cards'->0->>'id' = 'showcase-test-3');
  begin
    perform public.save_collection_showcase('Too many',array['showcase-test-1','showcase-test-2','showcase-test-3','showcase-test-4']);
    raise exception 'ACCEPTED';
  exception when others then insert into showcase_results values ('max three enforced in DB',sqlerrm='INVALID_SHOWCASE'); end;
  begin
    perform public.save_collection_showcase('Duplicate',array['showcase-test-1','showcase-test-1']);
    raise exception 'ACCEPTED';
  exception when others then insert into showcase_results values ('duplicate rejected',sqlerrm='INVALID_SHOWCASE'); end;
  perform set_config('request.jwt.claim.sub',other_user::text,true);
  begin
    perform public.save_collection_showcase('Stolen',array['showcase-test-1']);
    raise exception 'ACCEPTED';
  exception when others then insert into showcase_results values ('other owner rejected',sqlerrm='NOT_OWNER'); end;
  update public.users set is_anonymous=true where id=owner;
  insert into showcase_results values ('anonymous projection empty',public.get_public_showcase('showcase-evaluation') is null);
  update public.users set is_anonymous=false,flag_reason='evaluation' where id=owner;
  insert into showcase_results values ('suspended projection empty',public.get_public_showcase('showcase-evaluation') is null);
  perform set_config('request.jwt.claim.sub',owner::text,true);
  begin
    perform public.save_collection_showcase('Suspended','{}');
    raise exception 'ACCEPTED';
  exception when others then insert into showcase_results values ('suspended write rejected',sqlerrm='ACCOUNT_SUSPENDED'); end;
  update public.users set flag_reason=null where id=owner;
  update public.cards set owner_id=other_user where id='showcase-test-1';
  result := public.get_public_showcase('showcase-evaluation');
  insert into showcase_results values ('ownership transfer prunes immediately',jsonb_array_length(result->'cards')=2);
  update public.cards set owner_id=owner where id='showcase-test-1';
  insert into showcase_results values ('reacquiring card does not republish old choice',
    jsonb_array_length(public.get_public_showcase('showcase-evaluation')->'cards')=2);
  update public.drops set status='draft' where id='showcase-evaluation';
  insert into showcase_results values ('draft Drop excluded',jsonb_array_length(public.get_public_showcase('showcase-evaluation')->'cards')=0);
  update public.drops set status='closed' where id='showcase-evaluation';
  insert into showcase_results values ('closed edition remains collectible',jsonb_array_length(public.get_public_showcase('showcase-evaluation')->'cards')=2);
  perform public.save_collection_showcase('','{}');
  insert into showcase_results values ('empty showcase allowed',jsonb_array_length(public.get_public_showcase('showcase-evaluation')->'cards')=0);
  insert into showcase_results values ('anon has no table access',not has_table_privilege('anon','public.collection_showcases','SELECT'));
  insert into showcase_results values ('authenticated cannot bypass save RPC',not has_table_privilege('authenticated','public.collection_showcases','UPDATE'));
end;
$$;
select * from showcase_results;
do $$ begin if exists(select 1 from showcase_results where passed is distinct from true) then raise exception 'Showcase checks failed'; end if; end $$;
rollback;
