begin;
set local lock_timeout='5s';
create table private.website_scan_jobs(
 id uuid primary key, organization_id uuid not null,project_id uuid not null,created_by uuid not null,
 origin text not null,keywords jsonb not null,blocked jsonb not null default '[]',revision integer not null default 0,
 limited boolean not null default false, created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
create index website_scan_project_idx on private.website_scan_jobs(project_id,created_at desc);
create table private.website_scan_queue(
 id bigint generated always as identity primary key, job_id uuid not null references private.website_scan_jobs(id),
 kind text not null check(kind in ('robots','wp','map','page')), url text not null,wp_id bigint,
 state text not null default 'pending', attempts integer not null default 0, unique(job_id,kind,url)
);
create index website_scan_queue_pending on private.website_scan_queue(job_id,state,kind,id);
create table private.website_scan_pages(
 job_id uuid not null references private.website_scan_jobs(id),url text not null,meta jsonb not null,
 decision text not null default 'pending',primary key(job_id,url)
);
alter table private.website_scan_pages add column service_observed boolean not null default false;
alter table private.website_import_sources add column observation_job uuid references private.website_scan_jobs(id);
create function private.website_clear_observation_origin() returns trigger
language plpgsql set search_path='' as $
begin
 new.observation_job:=null;
 return new;
end; $;
revoke all on function private.website_clear_observation_origin() from public,anon,authenticated;
create trigger website_import_observation_origin before insert or update of meta,origin,observed_url,wp_id on private.website_import_sources
for each row execute function private.website_clear_observation_origin();
create or replace function public.read_website_import_source(p_org uuid,p_project uuid,p_page uuid)
returns jsonb language plpgsql security definer set search_path='' as $
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('origin',origin,'wpId',wp_id,'meta',meta,'observationSource',case when observation_job is null then 'reviewed_import' else 'discovery_service' end,'managedTitle',manage_title) from private.website_import_sources where project_id=p_project and page_id=p_page);
end; $;
create index website_scan_page_decision on private.website_scan_pages(job_id,decision,url);
create table private.website_scan_batches(
 job_id uuid not null references private.website_scan_jobs(id),request_id uuid not null,actor uuid not null,
 digest text not null,result jsonb not null,primary key(job_id,request_id)
);
create table private.website_page_work_links(
 project_id uuid not null references public.projects(id),page_id uuid not null,kind text not null,
 work_id uuid not null,seo boolean not null,primary key(project_id,page_id,kind,work_id)
);
alter table private.website_scan_jobs enable row level security;
alter table private.website_scan_queue enable row level security;
alter table private.website_scan_pages enable row level security;
alter table private.website_scan_batches enable row level security;
alter table private.website_page_work_links enable row level security;
revoke all on private.website_scan_jobs,private.website_scan_queue,private.website_scan_pages,private.website_scan_batches,private.website_page_work_links from public,anon,authenticated;

create function private.website_scan_scope(p_org uuid,p_project uuid,p_job uuid)
returns private.website_scan_jobs language plpgsql security definer set search_path='' as $$
declare j private.website_scan_jobs;
begin
 perform private.website_write_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 select * into strict j from private.website_scan_jobs where id=p_job and organization_id=p_org and project_id=p_project;
 return j;
end; $$;
create function public.website_scan_start(p_org uuid,p_project uuid,p_job uuid,p_origin text,p_keywords jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.website_write_authorized(p_org,p_project); j private.website_scan_jobs;
begin
 if not coalesce(private.can_access_project(p_project),false) or p_origin is null or length(p_origin)>255 or p_origin !~ '^https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
 or jsonb_typeof(p_keywords) is distinct from 'array' or jsonb_array_length(p_keywords)>1000 or octet_length(p_keywords::text)>1000000 then raise exception 'Invalid scan scope';end if;
 insert into private.website_scan_jobs(id,organization_id,project_id,created_by,origin,keywords) values(p_job,p_org,p_project,actor,p_origin,p_keywords) on conflict do nothing;
 j:=private.website_scan_scope(p_org,p_project,p_job);
 if j.origin<>p_origin or j.keywords<>p_keywords or j.created_by<>actor then raise exception 'Original scan differs';end if;
 insert into private.website_scan_queue(job_id,kind,url) values(p_job,'robots',p_origin||'/robots.txt') on conflict do nothing;
 return p_job;
end; $$;
create function public.website_scan_status(p_org uuid,p_project uuid,p_job uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.website_scan_jobs;result jsonb;
begin
 perform private.website_write_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 if p_job is null then
  return coalesce((select jsonb_agg(to_jsonb(s)) from (select id,origin,created_at from private.website_scan_jobs where project_id=p_project and organization_id=p_org order by created_at desc limit 100) s),'[]');
 end if;
 j:=private.website_scan_scope(p_org,p_project,p_job);
 select jsonb_build_object('id',j.id,'actor',auth.uid(),'origin',j.origin,'revision',j.revision,'limited',j.limited,'blocked',j.blocked,
 'queued',count(*),'remaining',count(*) filter(where state='pending'),'failed',count(*) filter(where state='failed'),
 'retryable',count(*) filter(where state='failed' and attempts<3),'excluded',count(*) filter(where state in ('excluded','unsupported','unavailable')),
 'discovered',(select count(*) from private.website_scan_pages where job_id=p_job),
 'reviewed',(select count(*) from private.website_scan_pages where job_id=p_job and decision<>'pending'),
 'applied',(select count(*) from private.website_scan_pages where job_id=p_job and decision='applied'),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by seq) from (select id,kind,url,wp_id,row_number() over(order by case kind when 'robots' then 0 when 'wp' then 1 when 'map' then 2 else 3 end,id) seq from private.website_scan_queue where job_id=p_job and state='pending' order by seq limit 20)t),'[]'))
 into result from private.website_scan_queue where job_id=p_job;
 return result;
end; $$;
create function public.website_scan_checkpoint(p_org uuid,p_project uuid,p_job uuid,p_actor uuid,p_revision int,p_results jsonb)
returns int language plpgsql security definer set search_path='' as $$
declare j private.website_scan_jobs; t private.website_scan_queue; r jsonb; a jsonb; n int; cap int:=6000;
begin
 -- The Edge handler receives the actor from the authenticated status RPC.
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found or p_actor is null or not coalesce(private.n6_project_configuration_authorized(p_org,p_project,p_actor),false) then
  raise exception 'Current project writer required' using errcode='42501';
 end if;
 select * into strict j from private.website_scan_jobs where id=p_job and project_id=p_project and organization_id=p_org for update;
 if j.revision is distinct from p_revision then raise exception 'Scan advanced. Reload progress.' using errcode='40001';end if;
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) not between 1 and 20 or octet_length(p_results::text)>4000000 then raise exception 'Invalid checkpoint';end if;
 select count(*) into n from private.website_scan_queue where job_id=p_job;
 for r in select value from jsonb_array_elements(p_results) loop
  select * into strict t from private.website_scan_queue where job_id=p_job and id=(r->>'id')::bigint and state='pending';
  if coalesce(r->>'state','') not in ('read','failed','excluded','unsupported','unavailable') then raise exception 'Unexpected discovery outcome';end if;
  update private.website_scan_queue set state=r->>'state',attempts=attempts+1 where id=t.id;
  if r?'limited' and r->>'limited'='true' then j.limited:=true;end if;
  if t.kind='robots' and r?'blocked' then j.blocked:=r->'blocked';end if;
  if r?'meta' then
   if left(r->'meta'->>'url',length(j.origin)+1) is distinct from j.origin||'/' then raise exception 'Page outside selected site';end if;
   insert into private.website_scan_pages(job_id,url,meta,service_observed) values(p_job,r->'meta'->>'url',r->'meta',true) on conflict do nothing;
  end if;
  for a in select value from jsonb_array_elements(r->'added') loop
   if left(a->>'url',length(j.origin)+1) is distinct from j.origin||'/' or length(a->>'url')>2048 then raise exception 'URL outside scan scope';end if;
   if n>=cap and not exists(select 1 from private.website_scan_queue where job_id=p_job and kind=a->>'kind' and url=a->>'url') then j.limited:=true;continue;end if;
   insert into private.website_scan_queue(job_id,kind,url,wp_id) values(p_job,a->>'kind',a->>'url',(a->>'wpId')::bigint) on conflict do nothing;
   if found then n:=n+1;elsif a->>'wpId' is not null then
    update private.website_scan_queue set wp_id=coalesce(wp_id,(a->>'wpId')::bigint) where job_id=p_job and kind='page' and url=a->>'url';
    update private.website_scan_pages set meta=jsonb_set(meta,'{wpId}',a->'wpId') where job_id=p_job and url=a->>'url' and decision='pending' and meta->>'wpId' is null;
   end if;
  end loop;
 end loop;
 update private.website_scan_jobs set revision=revision+1,limited=j.limited,blocked=j.blocked where id=p_job;
 return j.revision+1;
end; $$;
create function public.website_scan_retry(p_org uuid,p_project uuid,p_job uuid,p_revision int)
returns void language plpgsql security definer set search_path='' as $$
declare j private.website_scan_jobs:=private.website_scan_scope(p_org,p_project,p_job);
begin
 if j.revision<>p_revision then raise exception 'Scan advanced' using errcode='40001';end if;
 update private.website_scan_queue set state='pending' where job_id=p_job and attempts<3 and state='failed';
 if found then update private.website_scan_jobs set revision=revision+1 where id=p_job;end if;
end; $$;

create function private.website_inventory_rows(p_org uuid,p_project uuid) returns setof jsonb language sql stable set search_path='' as $$ with registered as (
 select p.id, '/'||ltrim(p.initial_path,'/') path, coalesce(r.recorded_live_url,r.planned_url,'') url,
 coalesce(t.targets,'[]') source_targets
 from public.project_website_pages p
 left join lateral (select recorded_live_url,planned_url from public.project_website_page_revisions where page_id=p.id order by revision_number desc limit 1) r on true
 left join lateral (select targets from private.project_page_keyword_target_revisions where page_id=p.id order by revision desc limit 1) t on true
 where p.organization_id=p_org and p.project_id=p_project
 ), manual as (select m.*,coalesce(m.registered_page_id,(select r.id from registered r where r.path=m.page_path)) match_id from private.website_manual_pages m where project_id=p_project and organization_id=p_org)
 select jsonb_build_object('id',coalesce(m.id,r.id),'sourceId',r.id,'path',coalesce(m.page_path,r.path),
 'title',coalesce(m.title,r.path),'url',coalesce(m.intended_url,r.url),'state',m.page_state,'brief',coalesce(m.brief,''),
 'mode',coalesce(m.organic_mode,'undecided'),'targets',coalesce(m.targets,'[]'),'sourceTargets',coalesce(r.source_targets,'[]'),
 'revision',coalesce(m.revision,0))
 from registered r full join manual m on m.match_id=r.id; $$;
create function public.website_scan_review(p_org uuid,p_project uuid,p_job uuid,p_offset int default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.website_scan_jobs:=private.website_scan_scope(p_org,p_project,p_job); batch jsonb; sources jsonb; pages jsonb; terms jsonb;
begin
 if p_offset is null or p_offset<0 then raise exception 'Invalid review page';end if;
 select coalesce(jsonb_agg(v.meta||jsonb_build_object('collision',v.collision) order by v.url),'[]') into batch from
 (select p.url,p.meta,exists(select 1 from private.website_scan_pages d where d.job_id=p_job and d.url<>p.url
  and p.meta->>'wpId' is not null and d.meta->>'wpId'=p.meta->>'wpId') collision from private.website_scan_pages p
  where p.job_id=p_job and decision='pending' order by p.url limit 25 offset p_offset) v;
 select coalesce(jsonb_agg(to_jsonb(s)-'project_id'),'[]') into sources from private.website_import_sources s where s.project_id=p_project and exists
  (select 1 from jsonb_array_elements(batch) b where b->>'url'=s.observed_url or (s.origin=j.origin and b->>'wpId'=s.wp_id::text));
 select coalesce(jsonb_agg(p),'[]') into pages from private.website_inventory_rows(p_org,p_project) p where exists(select 1 from jsonb_array_elements(batch)b
  where p->>'url'=b->>'url' or p->>'path'=substr(b->>'url',length(j.origin)+1)) or exists(select 1 from jsonb_array_elements(sources)s where s->>'page_id'=p->>'id');
 select coalesce(jsonb_agg(to_jsonb(s)-'project_id'),'[]') into sources from private.website_import_sources s where s.project_id=p_project and exists(select 1 from jsonb_array_elements(pages)p where p->>'id'=s.page_id::text);
 select coalesce(jsonb_agg(k),'[]') into terms from jsonb_array_elements(j.keywords) k where exists(select 1 from jsonb_array_elements(batch)b where b->>'url'=k->>'url');
 return jsonb_build_object('batch',batch,'pages',pages,'sources',sources,'keywords',terms,'unmatched',(select count(*) from jsonb_array_elements(j.keywords) k where not exists(select 1 from private.website_scan_pages p where p.job_id=p_job and p.url=k->>'url')));
end; $$;
create function public.website_scan_decide(p_org uuid,p_project uuid,p_job uuid,p_request uuid,p_choices jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.website_scan_jobs:=private.website_scan_scope(p_org,p_project,p_job); b private.website_scan_batches; c jsonb; m jsonb; edits jsonb:='[]'; result jsonb;hash text;
begin
 if p_request is null or jsonb_typeof(p_choices) is distinct from 'array' or jsonb_array_length(p_choices) not between 1 and 25 or octet_length(p_choices::text)>500000 then raise exception 'Invalid reviewed batch';end if;
 hash:=encode(sha256(convert_to(p_choices::text,'UTF8')),'hex');
 select * into b from private.website_scan_batches where job_id=p_job and request_id=p_request;
 if found then if b.actor<>auth.uid() or b.digest<>hash then raise exception 'Original batch differs';end if;return b.result;end if;
 for c in select value from jsonb_array_elements(p_choices) loop
  select meta into strict m from private.website_scan_pages where job_id=p_job and url=c->>'url' and decision='pending';
  if jsonb_typeof(c->'edit')='object' then
   if c->'edit'->>'origin' is distinct from j.origin or c->'edit'->'meta' is distinct from m then raise exception 'Reviewed discovery changed';end if;
   if m->>'wpId' is not null and exists(select 1 from private.website_scan_pages p where p.job_id=p_job and p.url<>c->>'url' and p.meta->>'wpId'=m->>'wpId') then raise exception 'Ambiguous WordPress identity';end if;
   edits:=edits||jsonb_build_array(c->'edit');
  elsif jsonb_typeof(c->'edit') is distinct from 'null' then raise exception 'Explicit review decision required';end if;
  update private.website_scan_pages set decision=case when jsonb_typeof(c->'edit')='object' then 'applied' else 'skipped' end where job_id=p_job and url=c->>'url';
 end loop;
 if jsonb_array_length(edits)>0 then
  perform public.apply_website_import(p_org,p_project,p_request,edits);
  update private.website_import_sources s set observation_job=j.id
  from jsonb_array_elements(edits) e join private.website_scan_pages p on p.job_id=j.id and p.url=e->'meta'->>'url'
  where p.service_observed and s.project_id=p_project and s.page_id=(e->>'id')::uuid
    and s.origin=j.origin and s.meta=p.meta and s.wp_id is not distinct from (p.meta->>'wpId')::bigint;
 end if;
 result:=jsonb_build_object('applied',jsonb_array_length(edits),'reviewed',jsonb_array_length(p_choices),'request',p_request);
 insert into private.website_scan_batches values(p_job,p_request,auth.uid(),hash,result);
 return result;
end; $$;
create function public.website_scan_receipt(p_org uuid,p_project uuid,p_job uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.website_scan_scope(p_org,p_project,p_job);
 return (select result from private.website_scan_batches where job_id=p_job and request_id=p_request and actor=auth.uid());
end; $$;

create function public.website_page_work_link(p_org uuid,p_project uuid,p_page uuid,p_kind text,p_work uuid,p_seo boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.website_write_authorized(p_org,p_project);
 if p_kind not in ('engagement_work_item','project_task') or p_seo is null or not exists(select 1 from private.website_inventory_rows(p_org,p_project) x where x->>'id'=p_page::text) then raise exception 'Choose an existing page and Work';end if;
 perform private.asset_relation_subject(p_org,p_project,p_kind,p_work,true);
 insert into private.website_page_work_links values(p_project,p_page,p_kind,p_work,p_seo) on conflict(project_id,page_id,kind,work_id) do update set seo=excluded.seo;
end; $$;
create function public.website_page_index(p_org uuid,p_project uuid,p_search text default '',p_filter text default 'all',p_owner uuid default null,
 p_offset int default 0,p_view text default 'pages',p_page uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise exception 'Project unavailable' using errcode='42501';end if;
 if p_filter not in ('all','open','seo','unlinked','overdue') or p_view not in ('pages','assignments') or p_offset<0 or length(p_search)>240 then raise exception 'Invalid inventory filter';end if;
 with inventory as materialized(select x as page from private.website_inventory_rows(p_org,p_project)x where
 (p_page is null or x->>'id'=p_page::text) and (p_search='' or strpos(lower(concat_ws(' ',x->>'title',x->>'url',x->>'path')),lower(p_search))>0)),
 latest_rel as (select distinct on(subject_kind,subject_id) subject_kind,subject_id,assets from private.project_asset_relation_revisions
 where organization_id=p_org and project_id=p_project and subject_kind in ('engagement_work_item','project_task') order by subject_kind,subject_id,revision desc),
 linked as (
 select page_id,kind,work_id,seo from private.website_page_work_links where project_id=p_project
 union all select (a->>'id')::uuid,subject_kind,subject_id,false from latest_rel cross join lateral jsonb_array_elements(assets)a where a->>'kind'='website_page'
 union all select page_id,'engagement_work_item',work_item_id,false from (select distinct on(page_id) page_id,work_item_id from public.project_website_page_revisions
 where organization_id=p_org and project_id=p_project order by page_id,revision_number desc)s where work_item_id is not null),
 records as (select 'engagement_work_item' kind,w.id,w.status,w.assignee_id owner,w.title,w.due_date from public.work_items w where w.organization_id=p_org and w.project_id=p_project and w.deleted_at is null
 union all select 'project_task',t.id,t.status::text,t.assigned_to,t.title,t.due_date from public.tasks t where t.organization_id=p_org and t.project_id=p_project and t.archived_at is null),
 attached as (select l.page_id,r.kind,r.id,r.status,r.owner,r.title,r.due_date,bool_or(l.seo) seo from linked l join records r on r.kind=l.kind and r.id=l.work_id group by l.page_id,r.kind,r.id,r.status,r.owner,r.title,r.due_date),
 pages as (select i.page||jsonb_build_object('work',coalesce(w.items,'[]')) as item from inventory i left join lateral (
 select jsonb_agg(to_jsonb(a)-'page_id' order by a.title,a.id) items,bool_or(
 (p_owner is null or a.owner=p_owner) and case p_filter when 'open' then a.status not in ('done','cancelled') when 'seo' then a.seo
 when 'overdue' then a.due_date<current_date and a.status not in ('done','cancelled') else true end) matches from attached a
 where a.page_id::text in (i.page->>'id',i.page->>'sourceId')) w on true
 where case when p_filter='unlinked' then w.items is null and p_owner is null when p_filter='all' and p_owner is null then true else w.matches end),
 entries as (
 select item,null::jsonb as target,0::bigint as ord from pages where p_view='pages'
 union all select item - 'work' - 'targets' - 'sourceTargets' - 'brief',t,ordinality from pages cross join lateral jsonb_array_elements(
 case item->>'mode' when 'undecided' then (select coalesce(jsonb_agg(jsonb_build_object('query',s->'source'->>'term','intent',s->'source'->>'intent','locale',s->'source'->>'locale','role',s->>'role')),'[]') from jsonb_array_elements(item->'sourceTargets')s)
 else item->'targets' end) with ordinality terms(t,ordinality) where p_view='assignments'),
 slice as (select item,target,ord from entries order by item->>'path',item->>'id',ord limit 25 offset p_offset)
 select jsonb_build_object('total',(select count(*) from entries),'items',coalesce((select jsonb_agg(case when p_view='pages' then item else item||jsonb_build_object('target',target) end order by item->>'path',item->>'id',ord) from slice),'[]')) into result;
 return result;
end; $$;
revoke all on function private.website_scan_scope(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.website_scan_start(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.website_scan_start(uuid,uuid,uuid,text,jsonb) to authenticated;
revoke all on function public.website_scan_status(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.website_scan_status(uuid,uuid,uuid) to authenticated;
revoke all on function public.website_scan_checkpoint(uuid,uuid,uuid,uuid,int,jsonb) from public,anon,authenticated;
grant execute on function public.website_scan_checkpoint(uuid,uuid,uuid,uuid,int,jsonb) to service_role;
revoke all on function public.website_scan_retry(uuid,uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.website_scan_retry(uuid,uuid,uuid,int) to authenticated;
revoke all on function private.website_inventory_rows(uuid,uuid) from public,anon,authenticated;
revoke all on function public.website_scan_review(uuid,uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.website_scan_review(uuid,uuid,uuid,int) to authenticated;
revoke all on function public.website_scan_decide(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.website_scan_decide(uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function public.website_scan_receipt(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.website_scan_receipt(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.website_page_work_link(uuid,uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.website_page_work_link(uuid,uuid,uuid,text,uuid,boolean) to authenticated;
revoke all on function public.website_page_index(uuid,uuid,text,text,uuid,int,text,uuid) from public,anon,authenticated;
grant execute on function public.website_page_index(uuid,uuid,text,text,uuid,int,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
