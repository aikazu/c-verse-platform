-- Optional editorial snapshots never participate in Drop/stock/Seed settlement gates.
create table public.drop_editorial (
  drop_id text not null references public.drops(id) on delete cascade,
  kind text not null check (kind in ('story', 'seed_campaign')),
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  revision integer not null default 0,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (drop_id, kind)
);
alter table public.drop_editorial enable row level security;
revoke all on public.drop_editorial from anon, authenticated;
grant all on public.drop_editorial to service_role;
grant select on public.drop_editorial to authenticated;
create policy editorial_admin_read on public.drop_editorial for select to authenticated using (
  exists (select 1 from public.users where id = (select auth.uid()) and role = 'admin' and flag_reason is null)
);

create function public.save_drop_editorial(p_drop_id text, p_kind text, p_document jsonb,
  p_action text, p_revision integer, p_ip text default null, p_session_id text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row drop_editorial; v_drop drops; v_media jsonb; v_field text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from users where id=v_user and role='admin' and flag_reason is null)
    then raise exception 'FORBIDDEN'; end if;
  select * into v_drop from drops where id=p_drop_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_kind is null or p_kind not in ('story','seed_campaign') or p_action is null
    or p_action not in ('draft','publish','unpublish') or p_revision is null or p_revision < 0
    or p_document is null or jsonb_typeof(p_document) <> 'object'
    then raise exception 'INVALID_EDITORIAL'; end if;
  if p_document - array['title','body','media','cardId','making','signing','handover'] <> '{}'::jsonb
    then raise exception 'INVALID_EDITORIAL'; end if;
  foreach v_field in array array['title','body','making','signing','handover'] loop
    if jsonb_typeof(p_document->v_field) is distinct from 'string' then raise exception 'INVALID_EDITORIAL'; end if;
  end loop;
  if char_length(p_document->>'title')>120 or char_length(p_document->>'body')>8000
    or char_length(p_document->>'making')>4000 or char_length(p_document->>'signing')>4000
    or char_length(p_document->>'handover')>4000
    or jsonb_typeof(p_document->'media') is distinct from 'array'
    then raise exception 'INVALID_EDITORIAL'; end if;
  if jsonb_array_length(p_document->'media')>6 then raise exception 'INVALID_EDITORIAL'; end if;
  for v_media in select value from jsonb_array_elements(p_document->'media') loop
    if jsonb_typeof(v_media) <> 'object' or v_media - array['type','url','caption'] <> '{}'::jsonb
      or jsonb_typeof(v_media->'type') is distinct from 'string'
      or v_media->>'type' not in ('image','video')
      or jsonb_typeof(v_media->'url') is distinct from 'string'
      or char_length(v_media->>'url')>2048
      or (v_media->>'url') !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
      or jsonb_typeof(v_media->'caption') is distinct from 'string'
      or char_length(trim(v_media->>'caption')) not between 1 and 240
      then raise exception 'INVALID_EDITORIAL'; end if;
  end loop;
  if p_kind='story' then
    if (p_document->'cardId') is distinct from 'null'::jsonb or p_document->>'making'<>''
      or p_document->>'signing'<>'' or p_document->>'handover'<>'' then raise exception 'INVALID_EDITORIAL'; end if;
  else
    -- Enabled by the subsequent Seed campaign migration after Story is implemented.
    raise exception 'INVALID_EDITORIAL';
  end if;
  if p_action='publish' and (trim(p_document->>'title')='' or trim(p_document->>'body')='')
    then raise exception 'EDITORIAL_EMPTY'; end if;
  insert into drop_editorial(drop_id,kind) values(p_drop_id,p_kind) on conflict do nothing;
  select * into v_row from drop_editorial where drop_id=p_drop_id and kind=p_kind for update;
  if v_row.revision<>p_revision then raise exception 'EDITORIAL_CONFLICT'; end if;
  update drop_editorial set draft=p_document, revision=revision+1, updated_by=v_user, updated_at=now(),
    published=case p_action when 'publish' then p_document when 'unpublish' then null else published end
    where drop_id=p_drop_id and kind=p_kind;
  insert into admin_audit_log(id,admin_user_id,action,target_table,target_id,payload_summary,ip,session_id)
    values(gen_random_uuid()::text,v_user,'editorial_'||p_action,'drop_editorial',p_drop_id,
      jsonb_build_object('kind',p_kind,'revision',v_row.revision+1),p_ip,p_session_id);
  return v_row.revision+1;
end;
$$;
revoke all on function public.save_drop_editorial(text,text,jsonb,text,integer,text,text) from public, anon;
grant execute on function public.save_drop_editorial(text,text,jsonb,text,integer,text,text) to authenticated;

create function public.get_public_drop_editorial(p_drop_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'document',e.published,'cardShortId',null)), '[]'::jsonb)
  from drop_editorial e join drops d on d.id=e.drop_id
  where e.drop_id=p_drop_id and e.published is not null and e.kind='story'
    and d.status in ('published','scheduled','live','sold_out','closed');
$$;
revoke all on function public.get_public_drop_editorial(text) from public;
grant execute on function public.get_public_drop_editorial(text) to anon, authenticated, service_role;
