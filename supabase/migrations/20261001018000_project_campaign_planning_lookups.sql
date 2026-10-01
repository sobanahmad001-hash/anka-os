-- B5 bounded selectors for existing canonical campaign/source/work rows.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '339ae8372edf7afa3115655da7a2255f'
 or md5(replace(pg_get_functiondef('private.campaign_asset_source(uuid,uuid,uuid,text,uuid)'::regprocedure),chr(13),'')) is distinct from 'f4811900ded59d458496e64f74a799ae'
 or (select md5(prosrc) from pg_proc where oid='private.p7_assignment_authority(uuid,uuid,text,uuid)'::regprocedure) is distinct from '0e2dbef44ce9c734f375116a4169e394' then raise exception 'Exact campaign lookup prerequisites changed' using errcode='55000';end if;
end $$;
create function private.campaign_lookup_scope(p_org uuid,p_project uuid,p_engagement uuid,p_query text,p_offset integer,p_limit integer)
returns public.engagements language plpgsql security definer set search_path='' as $$declare engagement public.engagements%rowtype;begin
 perform private.website_read_authorized(p_org,p_project);
 if p_engagement is null or p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded exact engagement lookup required' using errcode='22023';end if;
 select * into engagement from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Exact same-project engagement required' using errcode='42501';end if;return engagement;
end $$;
create function public.list_project_campaign_planning_contexts(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_campaign_id uuid default null,p_query text default '',p_offset integer default 0,p_limit integer default 25,p_service_offset integer default 0,p_service_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare engagement public.engagements%rowtype;items jsonb;services jsonb;total bigint;matching bigint;result jsonb;can_write boolean:=false;archived boolean;service_total bigint;
begin
 engagement:=private.campaign_lookup_scope(p_organization_id,p_project_id,p_engagement_id,p_query,p_offset,p_limit);
 if p_service_offset is null or p_service_offset not between 0 and 10000 or p_service_limit is null or p_service_limit not between 1 and 50 then raise exception 'Bounded Marketing service paging required' using errcode='22023';end if;
 select archived_at is not null into archived from public.projects where id=p_project_id and organization_id=p_organization_id;
 if not archived then can_write:=private.p7_assignment_authority(p_organization_id,p_project_id,'marketing',auth.uid());end if;
 if p_campaign_id is null then
 select count(*) into total from public.marketing_campaigns where organization_id=p_organization_id and engagement_id=engagement.id and brand_id=engagement.brand_id;
 select count(*) into matching from public.marketing_campaigns where organization_id=p_organization_id and engagement_id=engagement.id and brand_id=engagement.brand_id and (p_query='' or strpos(lower(name),lower(p_query))>0);
 select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc,row.id),'[]'::jsonb) into items from(select id,organization_id,engagement_id,brand_id,name,objective,status,planned_channels,starts_on,ends_on,updated_at from public.marketing_campaigns where organization_id=p_organization_id and engagement_id=engagement.id and brand_id=engagement.brand_id and (p_query='' or strpos(lower(name),lower(p_query))>0) order by updated_at desc,id limit p_limit offset p_offset) row;
 else
 perform 1 from public.marketing_campaigns where id=p_campaign_id and organization_id=p_organization_id and engagement_id=engagement.id and brand_id=engagement.brand_id;
 if not found then raise exception 'Exact current project campaign required' using errcode='42501';end if;
 select count(*) into total from public.marketing_campaign_plan_versions where organization_id=p_organization_id and campaign_id=p_campaign_id and engagement_id=engagement.id and brand_id=engagement.brand_id;
 select count(*) into matching from public.marketing_campaign_plan_versions where organization_id=p_organization_id and campaign_id=p_campaign_id and engagement_id=engagement.id and brand_id=engagement.brand_id and (p_query='' or strpos(lower(title),lower(p_query))>0);
 select coalesce(jsonb_agg(to_jsonb(row) order by row.version_number desc,row.id),'[]'::jsonb) into items from(select id,organization_id,campaign_id,engagement_id,brand_id,version_number,title,objective,channels,starts_on,ends_on,audience,landing_page_url,approved_message_version_id,measurement_plan_version_id,created_at from public.marketing_campaign_plan_versions where organization_id=p_organization_id and campaign_id=p_campaign_id and engagement_id=engagement.id and brand_id=engagement.brand_id and (p_query='' or strpos(lower(title),lower(p_query))>0) order by version_number desc,id limit p_limit offset p_offset) row;
 end if;
 select count(*) into service_total from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.organization_id=p_organization_id and es.engagement_id=engagement.id and es.status='active' and sc.is_active and sc.department_id='marketing';
 select coalesce(jsonb_agg(to_jsonb(row) order by row.name,row.id),'[]'::jsonb) into services from(select es.id,sc.id service_id,sc.name,es.status,sc.is_active catalog_active from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.organization_id=p_organization_id and es.engagement_id=engagement.id and es.status='active' and sc.is_active and sc.department_id='marketing' order by sc.name,es.id limit p_service_limit offset p_service_offset) row;
 result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',engagement.id,'brand_id',engagement.brand_id,'campaign_id',p_campaign_id,'items',items,'services',services,'service_total',service_total,'service_offset',p_service_offset,'services_has_more',p_service_offset+jsonb_array_length(services)<service_total,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching,'can_write',can_write,'project_archived',archived);
 if octet_length(result::text)>131072 then raise exception 'Campaign selection exceeds whole bounded response' using errcode='22023';end if;return result;
end $$;
create function public.list_project_campaign_source_candidates(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_source_kind text,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare engagement public.engagements%rowtype;ids uuid[];total bigint;matching bigint;items jsonb:='[]';version uuid;source jsonb;reason text;result jsonb;
begin
 engagement:=private.campaign_lookup_scope(p_organization_id,p_project_id,p_engagement_id,p_query,p_offset,p_limit);
 if p_source_kind is null or p_source_kind not in ('artifact_version','deliverable_version') then raise exception 'Exact supported canonical source kind required' using errcode='22023';end if;
 if p_source_kind='artifact_version' then
 select count(*) into total from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id where a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=engagement.brand_id and a.artifact_type in ('content','scripts','campaign_messaging','social_graphics','page_mockups','brand_identity','design_direction') and exists(select 1 from public.artifact_approvals ap where ap.organization_id=v.organization_id and ap.artifact_version_id=v.id);
 select count(*) into matching from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id where a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=engagement.brand_id and a.artifact_type in ('content','scripts','campaign_messaging','social_graphics','page_mockups','brand_identity','design_direction') and exists(select 1 from public.artifact_approvals ap where ap.organization_id=v.organization_id and ap.artifact_version_id=v.id) and (p_query='' or strpos(lower(a.title),lower(p_query))>0);
 select coalesce(array_agg(row.id order by row.created_at desc,row.id),array[]::uuid[]) into ids from(select v.id,v.created_at from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id where a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=engagement.brand_id and a.artifact_type in ('content','scripts','campaign_messaging','social_graphics','page_mockups','brand_identity','design_direction') and exists(select 1 from public.artifact_approvals ap where ap.organization_id=v.organization_id and ap.artifact_version_id=v.id) and (p_query='' or strpos(lower(a.title),lower(p_query))>0) order by v.created_at desc,v.id limit p_limit offset p_offset) row;
 else
 -- Only current-project canonical file/version identities; availability/PM/client policy rechecked below.
 select count(*) into total from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.organization_id=v.organization_id where v.organization_id=p_organization_id and v.project_id=p_project_id and v.file_id is not null;
 select count(*) into matching from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.organization_id=v.organization_id where v.organization_id=p_organization_id and v.project_id=p_project_id and v.file_id is not null and (p_query='' or strpos(lower(v.title),lower(p_query))>0);
 select coalesce(array_agg(row.id order by row.created_at desc,row.id),array[]::uuid[]) into ids from(select v.id,v.created_at from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.organization_id=v.organization_id where v.organization_id=p_organization_id and v.project_id=p_project_id and v.file_id is not null and (p_query='' or strpos(lower(v.title),lower(p_query))>0) order by v.created_at desc,v.id limit p_limit offset p_offset) row;
 end if;
 foreach version in array ids loop
 source:=null;reason:=null;begin source:=private.campaign_asset_source(p_organization_id,p_project_id,engagement.brand_id,p_source_kind,version);
 exception when sqlstate '42501' or sqlstate '55000' or sqlstate '22023' then reason:='canonical_source_unavailable';end;
 items:=items||jsonb_build_array(jsonb_build_object('source_kind',p_source_kind,'source_version_id',version,'source',source,'available',reason is null,'reason',reason));
 end loop;
 result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',engagement.id,'brand_id',engagement.brand_id,'source_kind',p_source_kind,'items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching);
 if octet_length(result::text)>131072 then raise exception 'Canonical source selection exceeds whole bounded response' using errcode='22023';end if;return result;
end $$;
create function public.list_project_campaign_contribution_candidates(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_kind text,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$declare engagement public.engagements%rowtype;items jsonb;total bigint;matching bigint;result jsonb;begin
 engagement:=private.campaign_lookup_scope(p_organization_id,p_project_id,p_engagement_id,p_query,p_offset,p_limit);
 if p_kind='project_task' then
 select count(*) into total from public.tasks where organization_id=p_organization_id and project_id=p_project_id and archived_at is null;
 select count(*) into matching from public.tasks where organization_id=p_organization_id and project_id=p_project_id and archived_at is null and (p_query='' or strpos(lower(title),lower(p_query))>0);
 select coalesce(jsonb_agg(to_jsonb(row) order by row.title,row.id),'[]'::jsonb) into items from(select id,title,assigned_to assignee_id,due_date,status,row_version from public.tasks where organization_id=p_organization_id and project_id=p_project_id and archived_at is null and (p_query='' or strpos(lower(title),lower(p_query))>0) order by title,id limit p_limit offset p_offset) row;
 elsif p_kind='engagement_work_item' then
 select count(*) into total from public.work_items where organization_id=p_organization_id and project_id=p_project_id and engagement_id=engagement.id and brand_id=engagement.brand_id and deleted_at is null;
 select count(*) into matching from public.work_items where organization_id=p_organization_id and project_id=p_project_id and engagement_id=engagement.id and brand_id=engagement.brand_id and deleted_at is null and (p_query='' or strpos(lower(title),lower(p_query))>0);
 select coalesce(jsonb_agg(to_jsonb(row) order by row.title,row.id),'[]'::jsonb) into items from(select id,title,assignee_id,due_date,status,row_version from public.work_items where organization_id=p_organization_id and project_id=p_project_id and engagement_id=engagement.id and brand_id=engagement.brand_id and deleted_at is null and (p_query='' or strpos(lower(title),lower(p_query))>0) order by title,id limit p_limit offset p_offset) row;
 else raise exception 'Choose canonical Project Tasks or Engagement Work Items' using errcode='22023';end if;
 result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',engagement.id,'kind',p_kind,'items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching);
 if octet_length(result::text)>131072 then raise exception 'Contribution selection exceeds whole bounded response' using errcode='22023';end if;return result;
end $$;
do $$declare f record;begin
 for f in select p.oid,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname='campaign_lookup_scope') or (n.nspname='public' and p.proname in ('list_project_campaign_planning_contexts','list_project_campaign_source_candidates','list_project_campaign_contribution_candidates')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 end loop;
end $$;
commit;
