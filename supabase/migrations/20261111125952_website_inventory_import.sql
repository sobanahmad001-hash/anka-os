begin;
set local lock_timeout='5s';
create table private.website_import_sources (
 page_id uuid primary key references private.website_manual_pages(id), project_id uuid not null,
 origin text not null, observed_url text not null, wp_id bigint, meta jsonb not null,
 manage_title boolean not null, manage_url boolean not null, manage_path boolean not null,
 unique(project_id,origin,wp_id),unique(project_id,observed_url)
);
create table private.website_import_receipts (
 project_id uuid not null references public.projects(id),actor uuid not null,request_id uuid not null,
 digest text not null, result jsonb not null, primary key(project_id,actor,request_id)
);
alter table private.website_import_sources enable row level security;
alter table private.website_import_receipts enable row level security;
revoke all on private.website_import_sources,private.website_import_receipts from public,anon,authenticated;
create function private.website_import_manual_overrides() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.website_import_sources set manage_title=manage_title and new.title=old.title,
 manage_url=manage_url and new.intended_url=old.intended_url,manage_path=manage_path and new.page_path=old.page_path
 where page_id=new.id;
 return new;
end; $$;
revoke all on function private.website_import_manual_overrides() from public,anon,authenticated;
create trigger website_manual_override_flags after update of title,intended_url,page_path on private.website_manual_pages
for each row execute function private.website_import_manual_overrides();
create function public.website_import_context(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.website_write_authorized(p_org,p_project);
 return jsonb_build_object('pages',public.website_manual_inventory(p_org,p_project),'sources',coalesce(
 (select jsonb_agg(to_jsonb(s)-'project_id') from private.website_import_sources s where project_id=p_project),'[]'));
end; $$;
create function public.read_website_import_source(p_org uuid,p_project uuid,p_page uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('origin',origin,'wpId',wp_id,'meta',meta) from private.website_import_sources where project_id=p_project and page_id=p_page);
end; $$;
create function public.apply_website_import(p_org uuid,p_project uuid,p_request uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; hash text; receipt private.website_import_receipts; item jsonb; page jsonb; inventory jsonb;
 old private.website_import_sources; targets jsonb; meta jsonb; origin text; page_id_value uuid; wp bigint; result jsonb;
begin
 actor:=private.website_write_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 if p_request is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 35 or octet_length(p_rows::text)>500000 then raise exception 'Review 1–35 pages';end if;
 hash:=encode(sha256(convert_to(p_rows::text,'UTF8')),'hex');
 select * into receipt from private.website_import_receipts r where r.project_id=p_project and r.actor=auth.uid() and r.request_id=p_request;
 if found then if receipt.digest<>hash then raise exception 'Request content changed';end if;return receipt.result;end if;
 inventory:=public.website_manual_inventory(p_org,p_project);
 if (select count(distinct x->>'id') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then raise exception 'Duplicate page identity';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  page_id_value:=(item->>'id')::uuid; wp:=(item->>'wpId')::bigint;meta:=item->'meta';origin:=item->>'origin';
  if origin is null or origin!~'^https://[a-z0-9.-]+$' or length(origin)>255 or wp<=0
   or meta->>'url' is null or left(meta->>'url',length(origin)+1)<>origin||'/' or length(meta->>'url')>2048
   or (meta->>'status')::int is distinct from 200 or jsonb_typeof(meta) is distinct from 'object'
   or not(meta ?& array['title','h1','description','canonical','url','status']) or octet_length(meta::text)>24000
   or exists(select 1 from unnest(array['title','h1','description','canonical','url']) k where jsonb_typeof(meta->k) is distinct from 'string' or length(meta->>k)>2048)
   or jsonb_typeof(item->'additions') is distinct from 'array' then raise exception 'Invalid discovered page';end if;
  select x into page from jsonb_array_elements(inventory) x where x->>'id'=page_id_value::text;
  select s.* into old from private.website_import_sources s where s.project_id=p_project and s.page_id=page_id_value;
  if old.origin is not null and (old.origin<>origin or (old.wp_id is not null and old.wp_id is distinct from wp)) then raise exception 'Import identity changed';end if;
  if (page->>'sourceId') is distinct from (item->>'sourceId') or coalesce((page->>'revision')::int,0) is distinct from (item->>'revision')::int then raise exception 'Page changed; refresh preview' using errcode='40001';end if;
  targets:=coalesce(page->'targets','[]');
  if jsonb_array_length(item->'additions')>0 then
   if page->>'mode'='none' then raise exception 'Manual no-organic-target decision is protected';end if;
   if page->>'mode'='undecided' then
    select coalesce(jsonb_agg(jsonb_build_object('query',t->'source'->>'term','locale',t->'source'->>'locale','intent',t->'source'->>'intent','role',t->>'role')),'[]') into targets from jsonb_array_elements(page->'sourceTargets') t;
   end if;
   targets:=targets||(item->'additions');
  end if;
  perform public.save_website_manual_page(p_org,p_project,page_id_value,(item->>'sourceId')::uuid,(item->>'revision')::int,
    jsonb_build_object('path',item->>'path','title',item->>'title','url',item->>'url','state',coalesce(page->>'state','existing'),
     'brief',coalesce(page->>'brief',''),'mode',case when jsonb_array_length(item->'additions')>0 then 'targets' else coalesce(page->>'mode','undecided') end,'targets',targets));
  insert into private.website_import_sources values(page_id_value,p_project,origin,meta->>'url',wp,meta,
    coalesce(old.manage_title,page is null) and item->>'title'=left(meta->>'title',240),coalesce(old.manage_url,page is null) and item->>'url'=meta->>'url',coalesce(old.manage_path,page is null))
   on conflict(page_id) do update set observed_url=excluded.observed_url,wp_id=excluded.wp_id,meta=excluded.meta,manage_title=excluded.manage_title,manage_url=excluded.manage_url,manage_path=excluded.manage_path;
 end loop;
 result:=jsonb_build_object('applied',jsonb_array_length(p_rows),'request',p_request);
 insert into private.website_import_receipts values(p_project,actor,p_request,hash,result);
 return result;
end; $$;
create function public.recover_website_import(p_org uuid,p_project uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 return (select result from private.website_import_receipts where project_id=p_project and actor=auth.uid() and request_id=p_request);
end; $$;
revoke all on function public.website_import_context(uuid,uuid),public.apply_website_import(uuid,uuid,uuid,jsonb),public.recover_website_import(uuid,uuid,uuid),public.read_website_import_source(uuid,uuid,uuid) from public,anon;
grant execute on function public.website_import_context(uuid,uuid),public.apply_website_import(uuid,uuid,uuid,jsonb),public.recover_website_import(uuid,uuid,uuid),public.read_website_import_source(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
