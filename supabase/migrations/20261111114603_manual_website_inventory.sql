begin;
set local lock_timeout='5s';
create table private.website_manual_pages (
 id uuid primary key, project_id uuid not null, organization_id uuid not null,
 page_path text not null, registered_page_id uuid references public.project_website_pages(id),
 title text not null, intended_url text not null, page_state text not null check(page_state in ('new','existing')),
 brief text not null, organic_mode text not null check(organic_mode in ('undecided','targets','none')),
 targets jsonb not null, revision integer not null, updated_by uuid not null references auth.users(id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(project_id,page_path), unique(registered_page_id)
);
alter table private.website_manual_pages enable row level security;
revoke all on private.website_manual_pages from public,anon,authenticated;
create function public.website_manual_inventory(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501'; end if;
 with registered as (
 select p.id, '/'||ltrim(p.initial_path,'/') path, coalesce(r.recorded_live_url,r.planned_url,'') url,
 coalesce(t.targets,'[]') source_targets
 from public.project_website_pages p
 left join lateral (select recorded_live_url,planned_url from public.project_website_page_revisions where page_id=p.id order by revision_number desc limit 1) r on true
 left join lateral (select targets from private.project_page_keyword_target_revisions where page_id=p.id order by revision desc limit 1) t on true
 where p.organization_id=p_org and p.project_id=p_project
 ), manual as (select m.*,coalesce(m.registered_page_id,(select r.id from registered r where r.path=m.page_path)) match_id from private.website_manual_pages m where project_id=p_project and organization_id=p_org)
 select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(m.id,r.id),'sourceId',r.id,'path',coalesce(m.page_path,r.path),
 'title',coalesce(m.title,r.path),'url',coalesce(m.intended_url,r.url),'state',m.page_state,'brief',coalesce(m.brief,''),
 'mode',coalesce(m.organic_mode,'undecided'),'targets',coalesce(m.targets,'[]'),'sourceTargets',coalesce(r.source_targets,'[]'),
 'revision',coalesce(m.revision,0)) order by coalesce(m.page_path,r.path)), '[]') into result
 from registered r full join manual m on m.match_id=r.id;
 return result;
end; $$;
create function public.save_website_manual_page(p_org uuid,p_project uuid,p_id uuid,p_source uuid,p_revision integer,p_page jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; path text:=p_page->>'path'; url text:=p_page->>'url'; ts jsonb:=p_page->'targets'; current_page private.website_manual_pages; registered uuid;
begin
 actor:=private.website_write_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501'; end if;
 if p_id is null or p_revision is null or p_revision<0 or path is null or path !~ '^/[^?#[:space:]]*$' or left(path,2)='//' or length(path)>1201
 or url is null or (p_page->>'mode'='targets' and url='') or length(url)>2048 or (url<>'' and url !~ '^https?://[^/@?#[:space:]]+(/[^#[:space:]]*)?$')
 or coalesce(length(btrim(p_page->>'title')),0) not between 1 and 240 or length(p_page->>'brief')>6000
 or jsonb_typeof(ts) is distinct from 'array' or jsonb_array_length(ts)>200
 or (p_page->>'mode'='targets') is distinct from (jsonb_array_length(ts)>0)
 or exists(select from jsonb_array_elements(ts) t where not(t ?& array['query','intent','locale','role']) or coalesce(t->>'role','') not in ('primary','supporting')
 or coalesce(length(btrim(t->>'query')),0) not between 1 and 240 or coalesce(length(btrim(t->>'locale')),0) not between 1 and 60 or coalesce(length(btrim(t->>'intent')),0) not between 1 and 250)
 or (select count(distinct (lower(btrim(t->>'query')),lower(btrim(t->>'locale')))) from jsonb_array_elements(ts) t)<>jsonb_array_length(ts)
 then raise exception 'Invalid page or keyword assignments' using errcode='22023'; end if;
 select * into current_page from private.website_manual_pages where id=p_id and project_id=p_project and organization_id=p_org;
 if coalesce(current_page.revision,0)<>p_revision then raise exception 'Page changed; reopen before saving' using errcode='40001'; end if;
 select id into registered from public.project_website_pages where project_id=p_project and organization_id=p_org and '/'||ltrim(initial_path,'/')=path;
 if registered is distinct from p_source or (current_page.registered_page_id is not null and current_page.registered_page_id is distinct from registered)
 or (registered is not null and current_page.id is null and registered<>p_id) then raise exception 'Registered page identity changed'; end if;
 if p_revision=0 then
 insert into private.website_manual_pages values(p_id,p_project,p_org,path,registered,btrim(p_page->>'title'),url,p_page->>'state',coalesce(p_page->>'brief',''),p_page->>'mode',ts,1,actor);
 else
 update private.website_manual_pages set page_path=path, registered_page_id=registered,title=btrim(p_page->>'title'),intended_url=url,page_state=p_page->>'state',
 brief=coalesce(p_page->>'brief',''),organic_mode=p_page->>'mode',targets=ts,revision=revision+1,updated_by=actor where id=p_id and project_id=p_project;
 end if;
 return p_id;
end; $$;
revoke all on function public.website_manual_inventory(uuid,uuid),public.save_website_manual_page(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.website_manual_inventory(uuid,uuid),public.save_website_manual_page(uuid,uuid,uuid,uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
