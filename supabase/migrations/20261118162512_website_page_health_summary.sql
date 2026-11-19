-- Bounded, read-only evidence. Does not create tasks or change targets.
create function public.website_page_health(p_org uuid,p_project uuid,p_pages uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; job private.gsc_imports; source jsonb; checks jsonb; manual public.project_website_version_checks;
 work jsonb; result jsonb:='[]';
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 if p_pages is null or cardinality(p_pages) not between 1 and 25 then raise exception 'Choose 1 to 25 pages' using errcode='22023';end if;
 job:=private.website_table_snapshot(p_org,p_project);
 for item in select x from private.website_inventory_rows(p_org,p_project)x where (x->>'id')::uuid=any(p_pages) loop
  select jsonb_build_object('meta',s.meta,'url',s.observed_url,'serviceObserved',s.observation_job is not null,
   'scanStarted',j.created_at) into source from private.website_import_sources s
   left join private.website_scan_jobs j on j.id=s.observation_job and j.project_id=p_project and j.organization_id=p_org
   where s.project_id=p_project and s.page_id=(item->>'id')::uuid;
  checks:=null;
  select * into manual from public.project_website_version_checks where organization_id=p_org and project_id=p_project
   and page_id=(item->>'sourceId')::uuid order by created_at desc,id limit 1;
  if found then
   begin
    checks:=public.list_project_website_version_checks(p_org,p_project,manual.page_id,manual.architecture_version_id,'',0,1)->'items'->0;
   exception when insufficient_privilege or no_data_found or raise_exception then
    -- Unavailable current scope cannot certify old findings as current.
    checks:=jsonb_build_object('recheck_required',true,'unavailable',true);
   end;
  end if;
  with latest_rel as (
   select distinct on(subject_kind,subject_id) subject_kind,subject_id,assets from private.project_asset_relation_revisions
   where organization_id=p_org and project_id=p_project and subject_kind in ('engagement_work_item','project_task')
   order by subject_kind,subject_id,revision desc
  ), links as (
   select kind,work_id from private.website_page_work_links where project_id=p_project and page_id::text in(item->>'id',item->>'sourceId')
   union select 'engagement_work_item',work_item_id from public.seo_work_cards where project_id=p_project and page_id::text in(item->>'id',item->>'sourceId')
   union select subject_kind,subject_id from latest_rel cross join lateral jsonb_array_elements(assets)a
    where a->>'kind'='website_page' and a->>'id' in(item->>'id',item->>'sourceId')
   union select 'engagement_work_item',r.work_item_id from (select distinct on(page_id) page_id,work_item_id
    from public.project_website_page_revisions where organization_id=p_org and project_id=p_project
    order by page_id,revision_number desc)r where r.page_id::text in(item->>'id',item->>'sourceId') and r.work_item_id is not null
  ), records as (
   select l.kind,w.id,w.title,w.status,w.assignee_id as owner,w.due_date,c.state as review_state,c.verified_date,c.evidence,sc.slug as service
   from links l join public.work_items w on l.kind='engagement_work_item' and w.id=l.work_id
   left join public.seo_work_cards c on c.work_item_id=w.id and c.project_id=p_project
   left join public.engagement_services es on es.id=c.service_id and es.organization_id=p_org
   left join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=p_org
   where w.organization_id=p_org and w.project_id=p_project and w.deleted_at is null
   union all select l.kind,t.id,t.title,t.status::text,t.assigned_to,t.due_date,null,null,null,null
   from links l join public.tasks t on l.kind='project_task' and t.id=l.work_id
   where t.organization_id=p_org and t.project_id=p_project and t.archived_at is null
  ) select coalesce(jsonb_agg(to_jsonb(r) order by r.due_date nulls last,r.id),'[]') into work from records r;
  result:=result||jsonb_build_array(jsonb_build_object('id',item->>'id','url',item->>'url','source',source,'manual',checks,'work',work,
   'tracking',jsonb_build_object('start',job.start_date,'through',job.end_date,'synced',job.synced_at,
    'pageObserved',exists(select from private.gsc_import_rows where run_id=job.id and query='' and page=item->>'url'))));
 end loop;
 return result;
end;$$;
revoke all on function public.website_page_health(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.website_page_health(uuid,uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
