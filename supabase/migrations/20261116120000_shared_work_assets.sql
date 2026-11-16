begin;
set local lock_timeout='5s';

-- Files and deliverable versions keep their existing identities. URLs identify immutable
-- saved references; the remote document may still change at its provider.
create table private.work_asset_urls (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects,
 url text not null check(length(url) between 9 and 2000),
 unique(project_id,url)
);
create table private.work_asset_pins (
 project_id uuid not null references public.projects,
 card_kind text not null check(card_kind in ('page','project_task','engagement_work_item')),
 card_id uuid not null, asset_kind text not null check(asset_kind in ('file','version','link','page_revision','campaign_asset')),
 asset_id uuid not null, created_by uuid not null, created_at timestamptz not null default now(),
 primary key(project_id,card_kind,card_id,asset_kind,asset_id)
);
create index work_asset_reverse on private.work_asset_pins(project_id,asset_kind,asset_id);
revoke all on private.work_asset_urls,private.work_asset_pins from public,anon,authenticated,service_role;

create function private.work_asset_card(p_org uuid,p_project uuid,p_kind text,p_id uuid,p_write boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 if p_kind='page' then
  perform private.n1c_require_scope(p_org,p_project,auth.uid());
  if p_write then perform private.website_write_authorized(p_org,p_project);
  else perform private.website_read_authorized(p_org,p_project); end if;
  if not exists(select from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_id::text)
  then raise exception 'Page unavailable' using errcode='42501'; end if;
 elsif p_kind in ('project_task','engagement_work_item') then
  perform private.asset_relation_subject(p_org,p_project,p_kind,p_id,p_write);
 else raise exception 'Unknown card'; end if;
end;$$;

create function private.work_asset_catalog(p_org uuid,p_project uuid)
returns table(kind text,id uuid,label text,url text,bucket text,path text) language sql stable set search_path='' as $$
 select 'file',f.id,f.file_name,null::text,f.storage_bucket,f.storage_path from public.files f
 where f.organization_id=p_org and f.project_id=p_project and f.archived_at is null and f.storage_bucket in ('sphere-deliverables','work-card-files')
 union all
 select 'version',v.id,d.title||' · v'||v.version_number,
 case when v.preview_metadata->>'preview_url' ~ '^https://' then v.preview_metadata->>'preview_url' end,f.storage_bucket,f.storage_path
 from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.project_id=p_project and d.organization_id=p_org
 left join public.files f on f.id=v.file_id and f.project_id=p_project and f.organization_id=p_org and f.archived_at is null
 where v.project_id=p_project and v.organization_id=p_org and v.withdrawn_at is null
 union all select 'page_revision',r.id,p.page_key||' · revision '||r.revision_number,
 case when coalesce(r.recorded_live_url,r.planned_url) ~ '^https://' then coalesce(r.recorded_live_url,r.planned_url) end,null,null
 from public.project_website_page_revisions r join public.project_website_pages p on p.id=r.page_id and p.project_id=p_project and p.organization_id=p_org
 where r.project_id=p_project and r.organization_id=p_org
 union all select 'campaign_asset',c.id,coalesce(c.source_descriptor->>'title','Campaign asset')||' · '||c.source_kind||' '||c.source_version_id,null,null,null
 from public.project_campaign_assets c where c.project_id=p_project and c.organization_id=p_org
 union all select 'link',u.id,u.url,u.url,null,null from private.work_asset_urls u where u.project_id=p_project
$$;

create function private.work_asset_refs(p_project uuid)
returns table(card_kind text,card_id uuid,asset_kind text,asset_id uuid) language sql stable set search_path='' as $$
 select p.card_kind,p.card_id,p.asset_kind,p.asset_id from private.work_asset_pins p where p.project_id=p_project
 union select 'engagement_work_item',c.work_item_id,'version',v.id from public.brand_deliverable_cards c
 join public.deliverable_versions v on v.deliverable_id=c.deliverable_id and v.project_id=c.project_id and v.withdrawn_at is null where c.project_id=p_project
 union select h.subject_kind,h.subject_id,'campaign_asset',(a->>'id')::uuid from
 (select distinct on(subject_kind,subject_id) subject_kind,subject_id,assets from private.project_asset_relation_revisions where project_id=p_project and subject_kind in ('project_task','engagement_work_item') order by subject_kind,subject_id,revision desc)h
 cross join lateral jsonb_array_elements(h.assets)a where a->>'kind'='campaign_asset'
 union select 'engagement_work_item',c.work_item_id,'version',c.asset_version_id from public.marketing_delivery_cards c where c.project_id=p_project and c.asset_version_id is not null
 union select 'engagement_work_item',c.work_item_id,'version',c.asset_version_id from public.social_work_cards c where c.project_id=p_project and c.asset_version_id is not null
 union select 'engagement_work_item',c.work_item_id,a.kind,a.id from public.brand_deliverable_cards c
 cross join lateral(values('version',c.final_version_id),('version',c.source_version_id),('file',c.supplied_file_id)) a(kind,id)
 where c.project_id=p_project and a.id is not null
$$;

create function public.list_work_card_assets(p_org uuid,p_project uuid,p_card_kind text default null,p_card_id uuid default null,p_offset integer default 0,p_search text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.n1c_require_scope(p_org,p_project,auth.uid());
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 if p_offset is null or p_offset<0 or length(p_search)>200 then raise exception 'Invalid asset search';end if;
 if p_card_kind is not null then perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,false);end if;
 select jsonb_build_object('options',coalesce((select jsonb_agg(to_jsonb(a) order by a.kind,a.id) from
 (select * from private.work_asset_catalog(p_org,p_project) where strpos(lower(label),lower(p_search))>0 order by kind,id limit 51 offset p_offset)a),'[]'::jsonb),
 'attached',coalesce((select jsonb_agg(to_jsonb(a) order by a.kind,a.id) from private.work_asset_refs(p_project) r join private.work_asset_catalog(p_org,p_project) a on a.kind=r.asset_kind and a.id=r.asset_id where r.card_kind=p_card_kind and r.card_id=p_card_id),'[]'::jsonb)) into result;
 return result;
end;$$;

create function public.work_card_asset_usage(p_org uuid,p_project uuid,p_kind text,p_id uuid,p_offset integer default 0)
returns table(card_kind text,card_id uuid,title text) language plpgsql security definer set search_path='' as $$
begin
 perform private.n1c_require_scope(p_org,p_project,auth.uid());
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset';end if;
 return query with refs as (select * from private.work_asset_refs(p_project) r where r.asset_kind=p_kind and r.asset_id=p_id),
 cards as (select 'engagement_work_item' k,w.id,w.title from public.work_items w where w.project_id=p_project and w.organization_id=p_org and w.deleted_at is null
 union all select 'project_task',t.id,t.title from public.tasks t where t.project_id=p_project and t.organization_id=p_org and t.archived_at is null
 union all select 'page',(p->>'id')::uuid,p->>'title' from private.website_inventory_rows(p_org,p_project)p)
 select c.k,c.id,c.title from refs join cards c on c.k=refs.card_kind and c.id=refs.card_id order by c.k,c.id limit 51 offset p_offset;
end;$$;

create function public.attach_work_card_asset(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid,p_kind text,p_id uuid default null,p_url text default null,p_upload text default null,p_filename text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare asset uuid:=p_id; obj storage.objects; object_path text;
begin
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,true);
 if p_kind='link' and p_url is not null then
  if length(p_url)>2000 or p_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$' or strpos(p_url,chr(92))>0 then raise exception 'Use an HTTPS link without credentials';end if;
  insert into private.work_asset_urls(project_id,url) values(p_project,p_url) on conflict(project_id,url) do nothing;
  select id into strict asset from private.work_asset_urls where project_id=p_project and url=p_url;
 elsif p_kind='file' and p_upload is not null then
  if p_upload !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file digest';end if;
  if coalesce(length(trim(p_filename)),0) not between 1 and 240 then raise exception 'File name required'; end if;
  object_path:=p_project::text||'/'||auth.uid()::text||'/'||p_upload::text;
  select * into strict obj from storage.objects where bucket_id='work-card-files' and name=object_path and owner_id=auth.uid()::text for share;
  insert into public.files(organization_id,project_id,storage_bucket,storage_path,file_name,mime_type,size_bytes,checksum,visibility,uploaded_by)
  values(p_org,p_project,obj.bucket_id,obj.name,trim(p_filename),obj.metadata->>'mimetype',(obj.metadata->>'size')::bigint,p_upload,'internal_only',auth.uid())
  on conflict(storage_bucket,storage_path) do nothing;
  select id into strict asset from public.files where project_id=p_project and organization_id=p_org and storage_bucket=obj.bucket_id and storage_path=obj.name and archived_at is null;
 end if;
 if not exists(select from private.work_asset_catalog(p_org,p_project) a where a.kind=p_kind and a.id=asset) then raise exception 'Asset unavailable in this project';end if;
 insert into private.work_asset_pins(project_id,card_kind,card_id,asset_kind,asset_id,created_by) values(p_project,p_card_kind,p_card_id,p_kind,asset,auth.uid()) on conflict do nothing;
 return asset;
end;$$;

insert into storage.buckets(id,name,public) values('work-card-files','work-card-files',false);
create policy work_card_file_upload on storage.objects for insert to authenticated with check(
 bucket_id='work-card-files' and (storage.foldername(storage.objects.name))[2]=auth.uid()::text and exists(
 select from public.projects p where p.id::text=(storage.foldername(storage.objects.name))[1] and p.archived_at is null and private.can_access_project(p.id) and public.is_team_organization_member(p.organization_id)));
-- Storage reads back a newly inserted object before the file metadata is registered.
-- Only its uploader may read that intermediate object in the authorized project.
create policy work_card_file_read on storage.objects for select to authenticated using(
 bucket_id='work-card-files' and exists(select from public.projects p where p.id::text=(storage.foldername(storage.objects.name))[1]
 and private.can_access_project(p.id) and public.is_team_organization_member(p.organization_id)
 and ((storage.foldername(storage.objects.name))[2]=auth.uid()::text or exists(select from public.files f
 where f.project_id=p.id and f.storage_bucket='work-card-files' and f.storage_path=storage.objects.name and f.archived_at is null))));
revoke all on function private.work_asset_card(uuid,uuid,text,uuid,boolean),private.work_asset_catalog(uuid,uuid),private.work_asset_refs(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_work_card_assets(uuid,uuid,text,uuid,integer,text),public.work_card_asset_usage(uuid,uuid,text,uuid,integer),public.attach_work_card_asset(uuid,uuid,text,uuid,text,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.list_work_card_assets(uuid,uuid,text,uuid,integer,text),public.work_card_asset_usage(uuid,uuid,text,uuid,integer),public.attach_work_card_asset(uuid,uuid,text,uuid,text,uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
