create function private.website_table_snapshot(p_org uuid,p_project uuid)
returns private.gsc_imports language plpgsql security definer set search_path='' as $$
declare job private.gsc_imports;ctx jsonb;
begin
 for job in select * from private.gsc_imports where project_id=p_project and phase='done' order by end_date desc,synced_at desc loop
 begin ctx:=private.gsc_active_scope(p_org,p_project,job.binding_id);exception when no_data_found or raise_exception or insufficient_privilege or invalid_parameter_value then continue;end;
 if (ctx->>'revision')::int=job.revision then return job;end if;
 end loop;return null;
end;$$;
revoke all on function private.website_table_snapshot(uuid,uuid) from public,anon,authenticated;
create function private.website_table_targets(page jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select case when page->>'mode'='undecided' then coalesce((select jsonb_agg(jsonb_build_object('query',t->'source'->>'term','role',t->>'role','locale',t->'source'->>'locale')) from jsonb_array_elements(page->'sourceTargets')t),'[]') else page->'targets' end
$$;
revoke all on function private.website_table_targets(jsonb) from public,anon,authenticated;
create function public.website_pages_table(p_org uuid,p_project uuid,p_search text default '',p_filter text default 'all',p_owner uuid default null,
 p_offset integer default 0,p_sort text default 'title',p_attention text default 'all')
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.gsc_imports;result jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 if p_offset<0 or length(p_search)>240 or p_sort not in ('title','url','clicks','impressions','keywords') or p_attention not in ('all','unassigned','observed','missing') or p_filter not in ('all','open','seo','unlinked','overdue') then raise exception 'Invalid table filter';end if;
 job:=private.website_table_snapshot(p_org,p_project);
 with inventory as materialized(select x as page from private.website_inventory_rows(p_org,p_project)x where
 true),
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

 enriched as (
 select item,private.website_table_targets(item) as targets,r.clicks,r.impressions,
 exists(select from private.gsc_import_rows q where q.run_id=job.id and q.page=item->>'url' and q.query<>'') as observed
 from pages left join private.gsc_import_rows r on r.run_id=job.id and r.page=item->>'url' and r.query=''
 ), filtered as (
 select item->>'id' as id,item->>'title' as title,item->>'url' as url,item->>'path' as path,jsonb_array_length(targets) as keywords,clicks,impressions,observed
 from enriched where
 (p_search='' or strpos(lower(concat_ws(' ',item->>'title',item->>'url',item->>'path')),lower(p_search))>0
 or exists(select from jsonb_array_elements(targets)t where strpos(lower(t->>'query'),lower(p_search))>0)
 or exists(select from private.gsc_import_rows q where q.run_id=job.id and q.page=item->>'url' and q.query<>'' and strpos(lower(q.query),lower(p_search))>0))
 and case p_attention when 'unassigned' then jsonb_array_length(targets)=0 when 'observed' then observed when 'missing' then not observed else true end
 ), slice as (
 select *,row_number() over(order by case when p_sort='clicks' then clicks end desc nulls last,
 case when p_sort='impressions' then impressions end desc nulls last,case when p_sort='keywords' then keywords end desc,
 case when p_sort='url' then url else lower(title) end,id) as ord from filtered
 ), bounded as (select * from slice order by ord limit 25 offset p_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'start',job.start_date,'end',job.end_date,'synced',job.synced_at,
 'items',coalesce((select jsonb_agg(to_jsonb(b)-'ord' order by ord) from bounded b),'[]')) into result;
 return result;
end;$$;

create function public.website_keywords_table(p_org uuid,p_project uuid,p_page uuid,p_search text default '',p_state text default 'all',p_sort text default 'clicks',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.gsc_imports;page_record jsonb;result jsonb;source jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 select x into strict page_record from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_page::text;
 if p_offset<0 or length(p_search)>240 or p_state not in ('all','selected','dismissed','suggested','assigned') or p_sort not in ('clicks','impressions','position','query') then raise exception 'Invalid keyword filter';end if;
 job:=private.website_table_snapshot(p_org,p_project);
 select meta into source from private.website_import_sources where project_id=p_project and page_id=p_page;
 with targets as (select t from jsonb_array_elements(private.website_table_targets(page_record))t),
 queries as (select query from private.gsc_import_rows where run_id=job.id and page=page_record->>'url' and query<>''
 union select t->>'query' from targets
 union select query from private.website_keyword_decisions where project_id=p_project and page_id=p_page),
 rows as (
 select q.query,r.clicks,r.impressions,r.ctr,r.position,coalesce(d.state,case when t.roles is not null then 'selected' else 'suggested' end) as state,
 coalesce(d.revision,0) as decision_revision,t.roles,
 (select count(*) from private.gsc_import_rows x where x.run_id=job.id and x.query=q.query and x.page<>page_record->>'url') as overlap_count
 from queries q left join private.gsc_import_rows r on r.run_id=job.id and r.page=page_record->>'url' and r.query=q.query
 left join private.website_keyword_decisions d on d.project_id=p_project and d.page_id=p_page and d.query=q.query
 left join lateral(select string_agg(distinct t->>'role',', ' order by t->>'role') as roles from targets where t->>'query'=q.query)t on true
 ), filtered as (select * from rows where (p_search='' or strpos(lower(query),lower(p_search))>0)
 and (p_state='all' or p_state=state or p_state='assigned' and roles is not null)),
 ordered as(select *,row_number() over(order by
 case when p_sort='clicks' then clicks end desc nulls last,case when p_sort='impressions' then impressions end desc nulls last,
 case when p_sort='position' then position end asc nulls last,query) as ord from filtered),
 bounded as(select * from ordered order by ord limit 25 offset p_offset)
 select jsonb_build_object('page',page_record,'source',source,'start',job.start_date,'end',job.end_date,'total',(select count(*) from filtered),
 'items',coalesce((select jsonb_agg(to_jsonb(b)-'ord' order by ord) from bounded b),'[]')) into result;
 return result;
end;$$;
revoke all on function public.website_pages_table(uuid,uuid,text,text,uuid,integer,text,text),public.website_keywords_table(uuid,uuid,uuid,text,text,text,integer) from public,anon;
grant execute on function public.website_pages_table(uuid,uuid,text,text,uuid,integer,text,text),public.website_keywords_table(uuid,uuid,uuid,text,text,text,integer) to authenticated;
notify pgrst,'reload schema';
