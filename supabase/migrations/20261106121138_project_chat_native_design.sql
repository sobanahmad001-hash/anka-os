begin;
-- Exact reviewed existing definitions; no production action before payload approval.
do $guard$ begin
 if md5(pg_get_functiondef('private.n1c_require_scope(uuid,uuid,uuid)'::regprocedure)) is distinct from 'cf0fcfb76ab01c76024b40ae2debb874' then raise exception 'Reviewed prerequisite changed: private.n1c_require_scope(uuid,uuid,uuid)';end if;
 if md5(pg_get_functiondef('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)'::regprocedure)) is distinct from '9caba1d019b048bb034248815e3974b7' then raise exception 'Reviewed prerequisite changed: private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)';end if;
 if md5(pg_get_functiondef('private.website_native_actor(uuid,uuid,uuid,uuid,boolean)'::regprocedure)) is distinct from 'a44b39376c60b7f55de3d17e7885a63c' then raise exception 'Reviewed prerequisite changed: private.website_native_actor(uuid,uuid,uuid,uuid,boolean)';end if;
 if md5(pg_get_functiondef('private.website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure)) is distinct from 'dde03f16e30bebfa602954f77e18d634' then raise exception 'Reviewed prerequisite changed: private.website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)';end if;
 if md5(pg_get_functiondef('public.get_website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure)) is distinct from 'e3358e4095c750ae069dd90cc4d4f61b' then raise exception 'Reviewed prerequisite changed: public.get_website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)';end if;
 if md5(pg_get_functiondef('public.save_website_native_design(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)) is distinct from '374dd28130145c7c6c29775ec008c1a7' then raise exception 'Reviewed prerequisite changed: public.save_website_native_design(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text)';end if;
 if md5(pg_get_functiondef('private.lock_project_chat_content_sources(uuid,uuid,uuid[])'::regprocedure)) is distinct from '564b6ae44da807d5a4813ad2aac26cae' then raise exception 'Reviewed prerequisite changed: private.lock_project_chat_content_sources(uuid,uuid,uuid[])';end if;
 if md5(pg_get_functiondef('private.n2_scope_require_member(uuid,uuid,boolean)'::regprocedure)) is distinct from '236cdc17144704560cad6ce98bf7ea3b' then raise exception 'Reviewed prerequisite changed: private.n2_scope_require_member(uuid,uuid,boolean)';end if;
 if md5(pg_get_functiondef('private.project_stage_chat_metadata(uuid,uuid,jsonb,uuid[])'::regprocedure)) is distinct from '56957213e5b3ffb7e1272f7caa8f0969' then raise exception 'Reviewed prerequisite changed: private.project_stage_chat_metadata(uuid,uuid,jsonb,uuid[])';end if;
 if md5(pg_get_functiondef('private.project_stage_partition_context(uuid,uuid,uuid,uuid,jsonb,uuid[])'::regprocedure)) is distinct from '54beb61fc9968f42fd494f44272d6ff4' then raise exception 'Reviewed prerequisite changed: private.project_stage_partition_context(uuid,uuid,uuid,uuid,jsonb,uuid[])';end if;
 if md5(pg_get_functiondef('private.require_project_chat_action_owner(uuid,uuid,uuid,uuid,boolean)'::regprocedure)) is distinct from '8b84b764d3b34a84c17098e1ce4c4aac' then raise exception 'Reviewed prerequisite changed: private.require_project_chat_action_owner(uuid,uuid,uuid,uuid,boolean)';end if;
 if md5(pg_get_functiondef('public.read_project_stage_partition(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure)) is distinct from '27aea7c3adf83b87f18af0d90d1c66fd' then raise exception 'Reviewed prerequisite changed: public.read_project_stage_partition(uuid,uuid,uuid,uuid,uuid,jsonb)';end if;
 if md5(pg_get_functiondef('public.read_project_stage_plan(uuid,uuid,uuid)'::regprocedure)) is distinct from 'b6d2a468dee140f40b6435daba096c3e' then raise exception 'Reviewed prerequisite changed: public.read_project_stage_plan(uuid,uuid,uuid)';end if;
end;$guard$;

-- Frozen from private.lock_project_chat_content_sources full-definition MD5 564b6ae44da807d5a4813ad2aac26cae
CREATE FUNCTION private.project_chat_design_sources_actor(p_actor uuid, p_org uuid, p_project uuid, p_artifact_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare root uuid; n integer; initial_requests uuid[]; locked_requests uuid[];
begin
 if p_actor is null or p_artifact_ids is null or cardinality(p_artifact_ids) not between 1 and 21
  or array_position(p_artifact_ids,null) is not null
  or (select count(distinct x) from unnest(p_artifact_ids)x)<>cardinality(p_artifact_ids)
 then raise exception 'Bounded exact source roots required' using errcode='22023';end if;
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 for root in select x from unnest(p_artifact_ids)x order by x loop
  perform 1 from public.artifacts a where a.id=root and a.organization_id=p_org and a.project_id=p_project for update nowait;
  if not found then raise exception 'Current same-project source root required' using errcode='42501';end if;
 end loop;
 select count(*) into n from public.artifact_versions where organization_id=p_org and artifact_id=any(p_artifact_ids);
 if n>2000 then raise exception 'Source history exceeds bounded review' using errcode='54000';end if;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into initial_requests
  from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids);
 perform r.id from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by r.id for share of r nowait;
 perform v.id from public.artifact_versions v where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by v.id for share nowait;
 -- Fresh statement: request creation can have committed between enumeration
 -- and version acquisition. All normal request/approval writers lock versions.
 perform r.id from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by r.id for share of r nowait;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into locked_requests
  from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids);
 if initial_requests is distinct from locked_requests then
  raise exception 'Governed review changed during source acquisition; review current source explicitly' using errcode='40001';end if;
exception when lock_not_available or deadlock_detected then
 raise exception 'Selected Content source is busy; preserve the original request and review current source explicitly' using errcode='40001';
end;$function$;

-- Frozen from private.n2_scope_require_member full-definition MD5 236cdc17144704560cad6ce98bf7ea3b
CREATE FUNCTION private.project_chat_design_scope_actor(p_actor uuid, p_org uuid, p_project uuid, p_write boolean)
 RETURNS public.projects
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare actor uuid:=p_actor; project public.projects%rowtype; actor_role text;
begin
  if actor is null or p_org is null or p_project is null then
    raise exception 'Authenticated project scope required.' using errcode='42501';
  end if;
  select * into project from public.projects where id=p_project and organization_id=p_org
    and archived_at is null for share;
  if not found then raise exception 'Same-organization project required.' using errcode='42501'; end if;
  select m.role into actor_role from public.organization_memberships m join public.organizations o
    on o.id=m.organization_id where m.organization_id=p_org and m.user_id=actor
    and m.member_kind='team' and m.status='active' and o.status='active' for share of m,o;
  if not found then raise exception 'Active same-organization team member required.' using errcode='42501'; end if;
  if p_write and actor_role not in ('system_owner','operations_admin') and not exists (
    select 1 from public.project_manager_bindings b where b.organization_id=p_org
      and b.project_id=p_project and b.user_id=actor and b.status='active'
  ) then
    raise exception 'Exact project-manager or organization admin required.' using errcode='42501';
  end if;
  return project;
end; $function$;

-- Frozen from private.project_stage_chat_metadata full-definition MD5 56957213e5b3ffb7e1272f7caa8f0969
CREATE FUNCTION private.project_chat_design_metadata_actor(p_actor uuid, p_org uuid, p_project uuid, p_selection jsonb, p_output_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare h jsonb;u jsonb;g jsonb;steps jsonb;items jsonb;refs jsonb:='[]';works jsonb;vid uuid;ref jsonb;matches jsonb;result jsonb;begin
 if jsonb_typeof(p_selection) is distinct from 'object' or octet_length(p_selection::text)>4096
 or (select count(*) from jsonb_object_keys(p_selection))<>9 or not p_selection?&array['version','organization_id','project_id','engagement_id','plan_id','group_id','phase','partition','context_sha256']
 or p_selection->'version' is distinct from '1'::jsonb or p_selection->>'organization_id' is distinct from p_org::text or p_selection->>'project_id' is distinct from p_project::text
 or coalesce(p_selection->>'context_sha256','')!~'^[a-f0-9]{64}$'
 or p_output_ids is null or coalesce(array_ndims(p_output_ids),1)<>1 or cardinality(p_output_ids)>20 or array_position(p_output_ids,null) is not null
 or (select count(distinct x) from unnest(p_output_ids)x)<>cardinality(p_output_ids)
 then raise exception 'Exact bounded explicit stage and output selection required' using errcode='22023';end if;
 h:=private.project_chat_design_plan_actor(p_actor,p_org,p_project,(p_selection->>'engagement_id')::uuid);
 if h->>'plan_id' is distinct from p_selection->>'plan_id' or h->>'state' is distinct from 'available' then raise exception 'Selected plan changed' using errcode='40001';end if;
 u:=private.project_chat_design_partition_actor(p_actor,p_org,p_project,(p_selection->>'engagement_id')::uuid,(p_selection->>'plan_id')::uuid,(p_selection->>'group_id')::uuid,p_selection->'partition');
 if u->>'state' is distinct from 'current' or u->>'context_sha256' is distinct from p_selection->>'context_sha256' then raise exception 'Selected stage changed; retain the draft and explicitly review current context' using errcode='40001';end if;
 select value into g from jsonb_array_elements(h->'groups') where value->>'id'=p_selection->>'group_id';
 select coalesce(jsonb_agg(s.value order by s.step_order),'[]') into steps from jsonb_array_elements(u->'steps') with ordinality s(value,step_order) where s.value->>'phase'=p_selection->>'phase'
 and exists(select 1 from jsonb_array_elements(h->'bindings') b where b->>'group_id'=g->>'id' and b->>'publication_id'=g->>'publication_id' and b->>'step_key'=s.value->>'key' and b->>'phase'=p_selection->>'phase');
 if jsonb_array_length(steps)=0 or jsonb_array_length(steps)<>(select count(*) from jsonb_array_elements(h->'bindings') b where b->>'group_id'=g->>'id' and b->>'publication_id'=g->>'publication_id' and b->>'phase'=p_selection->>'phase') then raise exception 'Complete configured stage selection required' using errcode='42501';end if;
 select coalesce(jsonb_agg(i.value||jsonb_build_object('step_key',s.value->>'key') order by s.step_order,i.item_order),'[]') into items from jsonb_array_elements(steps) with ordinality s(value,step_order) cross join lateral jsonb_array_elements(s.value->'items') with ordinality i(value,item_order);
 if jsonb_array_length(items)>100 then raise exception 'Stage metadata exceeds bound' using errcode='54000';end if;
 foreach vid in array p_output_ids loop
  select coalesce(jsonb_agg(i.value order by i.item_order),'[]') into matches from jsonb_array_elements(items) with ordinality i(value,item_order) where i.value->'output'->>'artifact_version_id'=vid::text;
  ref:=matches->0->'output';
  if jsonb_array_length(matches)=0 or ref->>'artifact_id' is null or coalesce(ref->>'content_checksum','')!~'^[a-f0-9]{64}$'
  or exists(select 1 from jsonb_array_elements(matches)i where i->'output' is distinct from ref) then raise exception 'Selected exact output differs from this stage' using errcode='42501';end if;
  refs:=refs||jsonb_build_array(jsonb_build_object('artifact_id',ref->'artifact_id','artifact_version_id',vid,'version_number',ref->'version_number','content_checksum',ref->'content_checksum','approval_id',ref->'approval_id',
   'ai_use_allowed',coalesce(ref->'ai_use_allowed','false'::jsonb),'approved',(select bool_and(i->'output_approved'='true'::jsonb) from jsonb_array_elements(matches)i),
   'material_current',(select bool_and(i->'material_current'='true'::jsonb) from jsonb_array_elements(matches)i),'needs_update',(select bool_or(i->'needs_update'='true'::jsonb) from jsonb_array_elements(matches)i)));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('step_key',i.value->'step_key','instance',i.value->'instance','work_item_id',i.value->'work_item_id','status',i.value->'work_status') order by i.item_order),'[]') into works from jsonb_array_elements(items) with ordinality i(value,item_order);
 result:=jsonb_build_object('version',1,'selection',p_selection,'output_version_ids',to_jsonb(p_output_ids),'work',works,'outputs',refs,'body_included',false,'attachments_included',false);
 if octet_length(result::text)>32768 then raise exception 'Stage metadata exceeds bound' using errcode='54000';end if;return result;
end;$function$;

-- Frozen from private.project_stage_partition_context full-definition MD5 54beb61fc9968f42fd494f44272d6ff4
CREATE FUNCTION private.project_chat_design_partition_context_actor(p_actor uuid, p_org uuid, p_project uuid, p_engagement uuid, p_configuration uuid, p_partition jsonb, p_work_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.project_pipeline_configurations;d public.pipeline_execution_definitions;g public.project_pipeline_groups;
 e public.engagements;page public.project_website_pages;asset public.project_campaign_assets;occ public.recurring_work_occurrences;
 stage_review jsonb;stages jsonb:='[]';s jsonb;decision jsonb;ref jsonb;source jsonb;partition_source jsonb;stage_hash text;batch_key text;
 head private.project_work_commands;prior jsonb:='[]';options jsonb:='[]';edges jsonb;assets jsonb;w public.work_items;r bigint;binding jsonb;ids uuid[];answer jsonb;prior_lock_timeout text:=current_setting('lock_timeout');
begin
 if (select setting::bigint from pg_settings where name='lock_timeout') not between 1 and 500 then perform set_config('lock_timeout','500ms',true);end if;
 perform private.project_chat_design_scope_actor(p_actor,p_org,p_project,false);
 perform 1 from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status in ('planning','active') for share;
 if not found then raise exception 'Exact current project engagement required' using errcode='42501';end if;
 if jsonb_typeof(p_partition) is distinct from 'object' or octet_length(p_partition::text)>2048 or p_partition->>'kind' is null
  or exists(select 1 from jsonb_object_keys(p_partition) k where k not in ('kind','id','architecture_version_id'))
  or p_partition->>'id' is null or coalesce(cardinality(p_work_ids),0)>100 then raise exception 'Bounded exact partition and Work identities required' using errcode='22023';end if;
 select * into e from public.engagements where id=p_engagement and organization_id=p_org;
 select * into c from public.project_pipeline_configurations where id=p_configuration and organization_id=p_org and project_id=p_project and engagement_id=p_engagement for share;
 if not found then raise exception 'Exact reviewed configuration required' using errcode='42501';end if;
 if exists(select 1 from public.project_pipeline_configurations x where x.organization_id=p_org and x.engagement_id=p_engagement and x.pipeline_group_id is not distinct from c.pipeline_group_id and x.revision>c.revision) then raise exception 'Configuration superseded; review the exact current configuration' using errcode='40001';end if;
 select x.* into d from public.pipeline_execution_publications p join public.pipeline_execution_definitions x on x.id=p.definition_id and x.organization_id=p.organization_id where p.id=c.definition_publication_id and p.organization_id=p_org for share of p,x;
 if d.id is null or d.steps_sha256<>encode(sha256(convert_to(d.steps::text,'UTF8')),'hex') or c.selected_steps_sha256<>encode(sha256(convert_to(c.selected_steps::text,'UTF8')),'hex') then raise exception 'Published configuration integrity changed' using errcode='55000';end if;
 if c.pipeline_group_id is not null then
  select * into g from public.project_pipeline_groups where id=c.pipeline_group_id and organization_id=p_org and project_id=p_project and engagement_id=p_engagement and preset_publication_id=d.preset_publication_id for share;
  if not found then raise exception 'Exact configured pipeline group required' using errcode='42501';end if;
 end if;
 stage_review:=private.current_pipeline_stage_review(p_org,c.id);
 if stage_review is null then raise exception 'Review every configured stage before creating Work' using errcode='55000';end if;
 if p_partition->>'kind'='engagement' then
  if (p_partition->>'id')::uuid<>e.id or g.kind in ('website','marketing') or p_partition ? 'architecture_version_id' then raise exception 'Use the existing page or deliverable partition for this track' using errcode='42501';end if;
  partition_source:=jsonb_build_object('kind','engagement','id',e.id,'brand_id',e.brand_id);
 elsif p_partition->>'kind'='website_page' then
  select * into page from public.project_website_pages where id=(p_partition->>'id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=e.id and brand_id=e.brand_id for share;
  if not found or g.kind is distinct from 'website' or p_partition->>'architecture_version_id' is null then raise exception 'Exact existing Website page and approved architecture required' using errcode='42501';end if;
  source:=private.website_approved_source(p_org,p_project,(p_partition->>'architecture_version_id')::uuid);
  if source->>'engagement_id' is distinct from e.id::text or source->>'brand_id' is distinct from e.brand_id::text
   or not exists(select 1 from public.artifact_versions v where v.id=(p_partition->>'architecture_version_id')::uuid and v.organization_id=p_org and v.artifact_id=page.architecture_artifact_id)
   or not exists(select 1 from jsonb_array_elements(source->'pages') x where x->>'page_key'=page.page_key) then raise exception 'Exact registered page no longer belongs to the approved architecture' using errcode='55000';end if;
  partition_source:=jsonb_build_object('kind','website_page','id',page.id,'page_key',page.page_key,'source_reference',source->'reference');
 elsif p_partition->>'kind'='campaign_asset' then
  if g.kind is distinct from 'marketing' or p_partition ? 'architecture_version_id' then raise exception 'Exact Marketing asset partition required' using errcode='42501';end if;
  select * into asset from public.project_campaign_assets where id=(p_partition->>'id')::uuid and organization_id=p_org and project_id=p_project and brand_id=e.brand_id for share;
  if not found then raise exception 'Exact existing campaign asset required' using errcode='42501';end if;
  source:=private.campaign_asset_source(p_org,p_project,e.brand_id,asset.source_kind,asset.source_version_id);
  if source->>'reference_checksum' is distinct from asset.source_reference_checksum then raise exception 'Exact registered campaign source reference changed' using errcode='55000';end if;
  -- Current canonical descriptor/reference checksum is revalidated by the existing asset helper.
  perform private.asset_relation_assets(p_org,p_project,jsonb_build_array(jsonb_build_object('kind','campaign_asset','id',asset.id)));
  partition_source:=jsonb_build_object('kind','campaign_asset','id',asset.id,'source_version_id',asset.source_version_id,'source_reference_checksum',asset.source_reference_checksum,'source_sha256',encode(sha256(convert_to(source::text,'UTF8')),'hex'));
 elsif p_partition->>'kind'='recurring_occurrence' then
  if p_partition ? 'architecture_version_id' then raise exception 'Exact existing occurrence only' using errcode='22023';end if;
  select * into occ from public.recurring_work_occurrences where id=(p_partition->>'id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=e.id and status='generated' for share;
  if not found then raise exception 'Exact current existing occurrence required' using errcode='42501';end if;
  partition_source:=jsonb_build_object('kind','recurring_occurrence','id',occ.id,'plan_version_id',occ.plan_version_id,'engagement_service_id',occ.engagement_service_id,'period_start',occ.period_start,'period_end',occ.period_end,'timezone',occ.timezone);
 else raise exception 'Choose one existing canonical partition' using errcode='22023';end if;
 batch_key:=encode(sha256(convert_to(jsonb_build_array(p_engagement,c.pipeline_group_id,p_partition->>'kind',p_partition->>'id')::text,'UTF8')),'hex');
 select * into head from private.project_work_commands where organization_id=p_org and project_id=p_project and payload->>'action'='pipeline_work_batch_v1' and result->>'batch_key'=batch_key order by (result->>'revision')::bigint desc limit 1;
 -- Material fingerprints deliberately exclude configuration ID/quantity/receipt head.
 for s in select value from jsonb_array_elements(d.steps) loop
  select value into decision from jsonb_array_elements(stage_review->'decisions') where value->>'key'=s->>'key';
  if decision is null then raise exception 'Every published stage requires its original reviewed decision' using errcode='55000';end if;
  if decision->>'action'='run' then
   perform 1 from public.service_catalog cat join public.engagement_services es on es.service_id=cat.id and es.organization_id=cat.organization_id
    where cat.id=(s->>'service_id')::uuid and cat.organization_id=p_org and cat.is_active and cat.department_id=s->>'department_id' and es.engagement_id=e.id and es.status in ('planned','active') order by es.id for share of cat,es;
   if not found then raise exception 'Current scoped service commitment required; no activation is performed' using errcode='42501';end if;
   perform 1 from public.project_service_scopes where organization_id=p_org and project_id=p_project and service_id=(s->>'service_id')::uuid order by id for share;
   if exists(select 1 from public.project_service_scopes sc where sc.organization_id=p_org and sc.project_id=p_project and sc.service_id=(s->>'service_id')::uuid and sc.status<>'active') then raise exception 'Current accepted service scope required' using errcode='42501';end if;
  end if;
  select value->'reference' into ref from jsonb_array_elements(stage_review->'resolved_artifacts') where value->>'step_key'=s->>'key' and value->'input_key'='null'::jsonb;
  stage_hash:=encode(sha256(convert_to(jsonb_build_object('step',s,'decision',decision-'quantity','resolved', (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(stage_review->'resolved_artifacts') x where x->>'step_key'=s->>'key'), 'foundation',(stage_review->'foundation_context')-'plan_version_id','partition',partition_source)::text,'UTF8')),'hex');
  stages:=stages||jsonb_build_array(jsonb_build_object('key',s->'key','label',s->'label','department_id',s->'department_id','service_id',s->'service_id','quantity',decision->'quantity','depends_on',s->'depends_on','action',decision->'action','source_reference',ref,'source_sha256',stage_hash));
 end loop;
 select array_agg(distinct id) into ids from (select unnest(coalesce(p_work_ids,'{}')) id union select (x->>'work_item_id')::uuid from jsonb_array_elements(coalesce(head.result->'bindings','[]')) x) q;
 if coalesce(cardinality(ids),0)>100 then raise exception 'Choose at most 100 exact existing Work identities' using errcode='54000';end if;
 for w in select * from public.work_items where id=any(coalesce(ids,'{}')) and organization_id=p_org and project_id=p_project and engagement_id=e.id and deleted_at is null order by id for share nowait loop
  if p_partition->>'kind'='recurring_occurrence' and w.recurring_occurrence_id is distinct from occ.id then raise exception 'Only exact occurrence Work may be reused' using errcode='42501';end if;
  select x into binding from jsonb_array_elements(coalesce(head.result->'bindings','[]')) x where x->>'work_item_id'=w.id::text;
  select coalesce(max(revision),0) into r from private.project_asset_relation_revisions where organization_id=p_org and project_id=p_project and subject_kind='engagement_work_item' and subject_id=w.id;
  select x.assets into assets from private.project_asset_relation_revisions x where x.organization_id=p_org and x.project_id=p_project and x.subject_kind='engagement_work_item' and x.subject_id=w.id and x.revision=r for share;
  options:=options||jsonb_build_array(jsonb_build_object('id',w.id,'row_version',w.row_version,'organization_id',p_org,'project_id',p_project,'engagement_id',e.id,'department_id',w.department_id,'eligible',true,'status',w.status,'relation_revision',r,'assets',coalesce(assets,'[]'),'material_current',binding is not null and exists(select 1 from jsonb_array_elements(stages) x where x->>'key'=binding->>'key' and x->>'source_sha256'=binding->>'source_sha256')));
  if binding is not null then prior:=prior||jsonb_build_array(binding||jsonb_build_object('row_version',w.row_version,'status',w.status));end if;
 end loop;
 if jsonb_array_length(options)<>coalesce(cardinality(ids),0) then raise exception 'Exact same-project live Work unavailable; history is not silently replaced' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('work_item_id',x.work_item_id,'depends_on_work_item_id',x.depends_on_work_item_id) order by x.work_item_id,x.depends_on_work_item_id),'[]') into edges from public.work_item_dependencies x where x.organization_id=p_org and x.work_item_id=any(coalesce(ids,'{}')) and x.depends_on_work_item_id=any(coalesce(ids,'{}'));
 if jsonb_array_length(prior)>50 or jsonb_array_length(edges)>100 then raise exception 'Review a smaller explicit batch; preserve original receipts' using errcode='54000';end if;
 answer:=jsonb_build_object('version',1,'scope',jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',e.id),'configuration_id',c.id,'partition',p_partition,'partition_source',partition_source,'batch_key',batch_key,'receipt_head',case when head.request_id is null then 'null'::jsonb else jsonb_build_object('request_id',head.request_id,'actor_id',head.actor_id,'revision',head.result->'revision','review_sha256',head.result->'review_sha256') end,'receipt_revision',coalesce((head.result->>'revision')::bigint,0),'creation_allowed',false,'stages',stages,'work_options',options,'prior_slots',prior,'existing_work_edges',edges,'asset_options',case when p_partition->>'kind' in ('website_page','campaign_asset') then jsonb_build_array(jsonb_build_object('kind',p_partition->'kind','id',p_partition->'id')) else '[]'::jsonb end,'source_sha256',encode(sha256(convert_to(jsonb_build_object('configuration_id',c.id,'selected',c.selected_steps_sha256,'stage_review_sha256',stage_review->'review_sha256','stages',stages,'partition',partition_source)::text,'UTF8')),'hex'));
 perform set_config('lock_timeout',prior_lock_timeout,true);return answer;
exception when lock_not_available or deadlock_detected then raise exception 'Work or its source is busy; retain this draft and review current Work again' using errcode='40001';
end;$function$;

-- Frozen from private.require_project_chat_action_owner full-definition MD5 8b84b764d3b34a84c17098e1ce4c4aac
CREATE FUNCTION private.project_chat_design_owner_actor(p_actor uuid, p_org uuid, p_project uuid, p_conversation uuid, p_message uuid, p_write boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if p_actor is null then raise exception 'Authenticated action owner required' using errcode='42501';end if;
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 perform 1 from public.department_chat_conversations c where c.id=p_conversation and c.organization_id=p_org
  and c.project_id=p_project and c.owner_id=p_actor and c.context_kind='project_team'
  and c.engagement_id is null and c.department_id is null
  and (not p_write or (c.state='active' and c.archived_at is null)) for share;
 if not found then raise exception 'Original owned Project Chat required' using errcode='42501';end if;
 if p_message is not null then
  perform 1 from public.department_chat_messages m where m.id=p_message and m.organization_id=p_org
   and m.project_id=p_project and m.conversation_id=p_conversation and m.author_id=p_actor
   and m.role='user' and m.status='completed' and m.ai_run_id is null for share;
  if not found then raise exception 'Original saved human message required' using errcode='42501';end if;
 end if;
end;$function$;

-- Frozen from public.read_project_stage_partition full-definition MD5 27aea7c3adf83b87f18af0d90d1c66fd
CREATE FUNCTION private.project_chat_design_partition_actor(p_actor uuid, p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_plan_id uuid, p_group_id uuid, p_partition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare plan private.project_delivery_plan_versions;g jsonb;configuration public.project_pipeline_configurations;definition public.pipeline_execution_definitions;
 review public.project_pipeline_stage_reviews;receipt private.project_work_commands;work public.work_items;slot jsonb;decision jsonb;stage jsonb;source_stage jsonb;
 binding jsonb;reference jsonb;output jsonb;rows jsonb:='[]';items jsonb;context jsonb;context_state text:='current';phase text;
 quantity integer;idx integer;material_current boolean;source_update boolean;dependency_blocked boolean;approved boolean;work_done boolean;
 current_ref jsonb;ref jsonb;keyword_revision jsonb;page_meta jsonb;seo_meta jsonb;occurrence_meta jsonb;result jsonb;batch_key text;ancestor_keys text[];page_source jsonb;content_value jsonb;begin
 perform private.project_chat_design_scope_actor(p_actor,p_organization_id,p_project_id,false);
 perform 1 from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id and status in ('planning','active') for share;
 if not found then raise exception 'Current exact engagement required' using errcode='42501';end if;
 select * into plan from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id order by version_number desc limit 1;
 if plan.id is null or plan.id is distinct from p_plan_id then raise exception 'Saved stage plan changed; refresh this exact context' using errcode='40001';end if;
 select value into g from jsonb_array_elements(plan.snapshot->'groups') where value->>'pipeline_group_id'=p_group_id::text;
 if g is null then raise exception 'Exact saved pipeline group required' using errcode='42501';end if;
 if jsonb_typeof(p_partition) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_partition) k where k not in ('kind','id','architecture_version_id'))
  or jsonb_typeof(p_partition->'kind') is distinct from 'string' or jsonb_typeof(p_partition->'id') is distinct from 'string'
  or octet_length(p_partition::text)>2048 then raise exception 'Exact bounded stage partition required' using errcode='22023';end if;
 -- Scope the requested identity BEFORE catching changed/unavailable source errors.
 if p_partition->>'kind'='engagement' then
  if g->>'kind'<>'branding' or p_partition->>'id'<>p_engagement_id::text or p_partition ? 'architecture_version_id' then raise exception 'Exact foundation partition required' using errcode='42501';end if;
 elsif p_partition->>'kind'='website_page' then
  select jsonb_build_object('id',p.id,'page_key',p.page_key,'initial_path',p.initial_path,'architecture_artifact_id',p.architecture_artifact_id) into page_meta
   from public.project_website_pages p where p.id=(p_partition->>'id')::uuid and p.organization_id=p_organization_id and p.project_id=p_project_id and p.engagement_id=p_engagement_id;
  if page_meta is null or g->>'kind'<>'website' or p_partition->>'architecture_version_id' is null
   or not exists(select 1 from public.artifact_versions v where v.id=(p_partition->>'architecture_version_id')::uuid and v.organization_id=p_organization_id and v.artifact_id=(page_meta->>'architecture_artifact_id')::uuid)
   then raise exception 'Exact registered page and architecture version required' using errcode='42501';end if;
  select jsonb_build_object('revision',k.revision,'strategy_version_id',k.strategy_version_id,'source_checksum',k.source_checksum,'targets',k.targets,'created_at',k.created_at) into keyword_revision
   from private.project_page_keyword_target_revisions k where k.organization_id=p_organization_id and k.project_id=p_project_id and k.page_id=(p_partition->>'id')::uuid order by revision desc limit 1;
  select jsonb_build_object('link_number',s.link_number,'tracked_page_id',s.tracked_page_id,'architecture_version_id',s.architecture_version_id) into seo_meta
   from public.project_website_page_seo_links s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.page_id=(p_partition->>'id')::uuid order by link_number desc limit 1;
 elsif p_partition->>'kind'='campaign_asset' then
  if g->>'kind'<>'marketing' or p_partition ? 'architecture_version_id' or not exists(select 1 from public.project_campaign_assets a join public.engagements e on e.brand_id=a.brand_id and e.organization_id=a.organization_id and e.project_id=a.project_id
   where a.id=(p_partition->>'id')::uuid and a.organization_id=p_organization_id and a.project_id=p_project_id and e.id=p_engagement_id) then raise exception 'Exact registered campaign asset required' using errcode='42501';end if;
 elsif p_partition->>'kind'='recurring_occurrence' then
  select jsonb_build_object('id',o.id,'plan_version_id',o.plan_version_id,'period_start',o.period_start,'period_end',o.period_end,'timezone',o.timezone,'status',o.status) into occurrence_meta
   from public.recurring_work_occurrences o where o.id=(p_partition->>'id')::uuid and o.organization_id=p_organization_id and o.project_id=p_project_id and o.engagement_id=p_engagement_id
    and exists(select 1 from jsonb_array_elements(g->'contributions') x where x->>'service_id'=o.service_id::text);
  if occurrence_meta is null or g->>'kind'<>'marketing' or p_partition ? 'architecture_version_id' then raise exception 'Exact existing service occurrence required' using errcode='42501';end if;
 else raise exception 'Unknown canonical partition' using errcode='22023';end if;
 select * into configuration from public.project_pipeline_configurations where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and pipeline_group_id=p_group_id order by revision desc limit 1;
 if configuration.id is null or configuration.definition_publication_id::text is distinct from g->>'definition_publication_id' then
  return jsonb_build_object('version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'plan_id',plan.id,'group_id',p_group_id,'partition',p_partition,
   'state','unconfigured','steps','[]'::jsonb,'page',page_meta,'keywords',keyword_revision,'performance_association',seo_meta,'occurrence',occurrence_meta,'read_only',true);
 end if;
 select d.* into definition from public.pipeline_execution_publications p join public.pipeline_execution_definitions d on d.id=p.definition_id and d.organization_id=p.organization_id where p.id=configuration.definition_publication_id and p.organization_id=p_organization_id;
 select * into review from public.project_pipeline_stage_reviews where organization_id=p_organization_id and configuration_id=configuration.id and project_id=p_project_id and engagement_id=p_engagement_id;
 if definition.id is null or review.id is null or review.reviewed_by<>configuration.configured_by or review.request_id<>configuration.request_id then
  raise exception 'Exact reviewed configuration unavailable' using errcode='55000';end if;
 batch_key:=encode(sha256(convert_to(jsonb_build_array(p_engagement_id,p_group_id,p_partition->>'kind',p_partition->>'id')::text,'UTF8')),'hex');
 select r.* into receipt from private.project_work_commands r where r.organization_id=p_organization_id and r.project_id=p_project_id and r.payload->>'action'='pipeline_work_batch_v1' and r.result->>'batch_key'=batch_key order by (r.result->>'revision')::bigint desc limit 1;
 begin context:=private.project_chat_design_partition_context_actor(p_actor,p_organization_id,p_project_id,p_engagement_id,configuration.id,p_partition,'{}'::uuid[]);
 exception when insufficient_privilege or object_not_in_prerequisite_state then context_state:='source_unavailable_or_changed';
  when serialization_failure or lock_not_available or deadlock_detected then context_state:='temporarily_unavailable';
 end;
 for stage in select value from jsonb_array_elements(definition.steps) loop
  select value into binding from jsonb_array_elements(coalesce(plan.snapshot->'stage_bindings'->'bindings','[]')) x where x->>'group_id'=p_group_id::text and x->>'publication_id'=configuration.definition_publication_id::text and x->>'step_key'=stage->>'key';
  phase:=binding->>'phase';
  select value into decision from jsonb_array_elements(review.decisions) x where x->>'key'=stage->>'key';
  select value into source_stage from jsonb_array_elements(coalesce(context->'stages','[]')) x where x->>'key'=stage->>'key';
  if decision is null or decision->>'action' not in ('run','reuse','omit','outside_scope') then raise exception 'Reviewed step decision unavailable' using errcode='55000';end if;
  items:='[]';source_update:=false;
  -- A newer approved source is a review signal, never an implicit replacement.
  with recursive ancestors(key) as (select stage->>'key' union select dep from ancestors a join lateral (select s from jsonb_array_elements(definition.steps) s where s->>'key'=a.key) v on true cross join lateral jsonb_array_elements_text(v.s->'depends_on') dep)
   select array_agg(key) into ancestor_keys from ancestors;
  for ref in select value->'reference' from jsonb_array_elements(review.resolved_artifacts) x where x->>'step_key'=any(ancestor_keys) loop
   if exists(select 1 from public.artifact_versions v join public.artifact_approvals a on a.artifact_version_id=v.id and a.organization_id=v.organization_id
    where v.organization_id=p_organization_id and v.artifact_id=(ref->>'artifact_id')::uuid and v.version_number>(ref->>'version_number')::integer and a.decision='approved') then source_update:=true;end if;
  end loop;
  if keyword_revision is not null and receipt.created_at is not null and (keyword_revision->>'created_at')::timestamptz>receipt.created_at
   and exists(select 1 from jsonb_array_elements(review.resolved_artifacts) x where x->>'step_key'=any(ancestor_keys) and x->'reference'->>'artifact_type'='keyword_strategy') then source_update:=true;end if;
  if decision->>'action'='reuse' then
   reference:=source_stage->'source_reference';
   if reference is null then select value->'reference' into reference from jsonb_array_elements(review.resolved_artifacts) x where x->>'step_key'=stage->>'key' and x->'input_key'='null'::jsonb;end if;
   items:=jsonb_build_array(jsonb_build_object('instance',1,'work_item_id',null,'work_required',false,'work_done',false,
    'output',reference,'output_approved',context_state='current' and reference is not null,'material_current',context_state='current','needs_update',source_update,'dependency_blocked',false));
  elsif decision->>'action'='run' then
   if coalesce(decision->>'quantity','')!~'^[1-9][0-9]?$' or (decision->>'quantity')::integer>50 then raise exception 'Reviewed bounded quantity unavailable' using errcode='55000';end if;
   quantity:=(decision->>'quantity')::integer;
   for idx in 1..quantity loop
    work:=null;output:=null;approved:=false;work_done:=false;dependency_blocked:=false;material_current:=false;
    select value into slot from jsonb_array_elements(coalesce(receipt.result->'bindings','[]')) x where x->>'key'=stage->>'key' and x->'instance'=to_jsonb(idx);
    if slot is not null then
     select * into work from public.work_items w where w.id=(slot->>'work_item_id')::uuid and w.organization_id=p_organization_id and w.project_id=p_project_id and w.engagement_id=p_engagement_id and w.deleted_at is null;
     if work.id is not null and (p_partition->>'kind'<>'recurring_occurrence' or work.recurring_occurrence_id::text=p_partition->>'id') then
      work_done:=work.status='done';
      material_current:=context_state='current' and slot->>'source_sha256'=source_stage->>'source_sha256'
       and (p_partition->>'kind' not in ('website_page','campaign_asset') or exists(select 1 from jsonb_array_elements(coalesce(context->'work_options','[]')) wo cross join lateral jsonb_array_elements(coalesce(wo->'assets','[]')) asset_link where wo->>'id'=work.id::text and asset_link->>'kind'=p_partition->>'kind' and asset_link->>'id'=p_partition->>'id'));
      select exists(select 1 from public.work_item_dependencies dep left join public.work_items upstream on upstream.id=dep.depends_on_work_item_id and upstream.organization_id=dep.organization_id
       and upstream.project_id=p_project_id and upstream.engagement_id=p_engagement_id and upstream.deleted_at is null
       where dep.organization_id=p_organization_id and dep.work_item_id=work.id and (upstream.id is null or upstream.status<>'done')) into dependency_blocked;
      if work.linked_artifact_version_id is not null and exists(select 1 from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id where v.id=work.linked_artifact_version_id and v.organization_id=p_organization_id and v.artifact_id=work.linked_artifact_id and a.project_id=p_project_id and a.engagement_id=p_engagement_id) then
       begin
        output:=private.require_pipeline_approved_artifact(p_organization_id,p_project_id,work.linked_artifact_version_id,stage->'stage_contract'->>'artifact_type',stage->'stage_contract'->>'output_type');
        approved:=true;
        if p_partition->>'kind'='website_page' and stage->'stage_contract'->>'artifact_type'='content' then
         page_source:=private.website_approved_source(p_organization_id,p_project_id,(p_partition->>'architecture_version_id')::uuid);
         select value into current_ref from jsonb_array_elements(page_source->'pages') x where x->>'page_key'=page_meta->>'page_key';
         select v.content into content_value from public.artifact_versions v where v.id=work.linked_artifact_version_id and v.organization_id=p_organization_id
          and v.content_checksum=encode(sha256(convert_to(v.content::text,'UTF8')),'hex');
         if content_value ? 'schema_version' then
          -- Normal Content Writer v2 pins one exact architecture and page; never fall back to legacy pages.
          approved:=coalesce(current_ref is not null and content_value->'schema_version'='2'::jsonb
           and content_value->>'output_type'='website_page_copy'
           and content_value->>'source_architecture_version_id'=p_partition->>'architecture_version_id'
           and content_value->>'target_page_key'=page_meta->>'page_key'
           and private.normalize_content_page_path(content_value->>'target_page_path')=current_ref->>'path',false);
         else
          approved:=coalesce(current_ref is not null and jsonb_typeof(content_value->'pages')='array',false);
          if approved then approved:=(select count(*)=1 from jsonb_array_elements(content_value->'pages') x where private.normalize_content_page_path(x->>'page_path')=current_ref->>'path' and (not(x ? 'page_key') or x->>'page_key'=page_meta->>'page_key'));end if;
         end if;
        end if;
       exception when insufficient_privilege or object_not_in_prerequisite_state then
        approved:=false;
        -- Return scoped identity only, without an unapproved body or false approval.
        select jsonb_build_object('artifact_id',a.id,'artifact_version_id',v.id,'version_number',v.version_number,'content_checksum',v.content_checksum,'artifact_type',a.artifact_type) into output
         from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
         where a.organization_id=p_organization_id and a.project_id=p_project_id and a.engagement_id=p_engagement_id and a.id=work.linked_artifact_id and v.id=work.linked_artifact_version_id;
       end;
      end if;
     else work:=null;
     end if;
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('instance',idx,'work_item_id',case when work.id is null then null else work.id end,'work_required',true,
     'work_status',work.status,'work_done',work_done,'output',output,'output_approved',approved,'material_current',coalesce(material_current,false),
     'needs_update',source_update or (slot is not null and context_state='current' and slot->>'source_sha256' is distinct from source_stage->>'source_sha256'),
     'dependency_blocked',dependency_blocked,'missing_work',slot is not null and work.id is null));
   end loop;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('key',stage->'key','label',stage->'label','phase',phase,'action',decision->'action','reason',decision->'reason','depends_on',stage->'depends_on','items',items));
 end loop;
 result:=jsonb_build_object('version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
  'plan_id',plan.id,'group_id',p_group_id,'configuration_id',configuration.id,'partition',p_partition,'state',context_state,
  'steps',rows,'page',page_meta,'keywords',keyword_revision,'performance_association',seo_meta,'occurrence',occurrence_meta,'read_only',true);
 if octet_length(result::text)>262144 then raise exception 'Choose a smaller bounded stage partition' using errcode='54000';end if;
 return result||jsonb_build_object('context_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$function$;

-- Frozen from public.read_project_stage_plan full-definition MD5 b6d2a468dee140f40b6435daba096c3e
CREATE FUNCTION private.project_chat_design_plan_actor(p_actor uuid, p_organization_id uuid, p_project_id uuid, p_engagement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare plan private.project_delivery_plan_versions;groups jsonb:='[]';g jsonb;live_group public.project_pipeline_groups;
 bindings jsonb;configuration public.project_pipeline_configurations;begin
 perform private.project_chat_design_scope_actor(p_actor,p_organization_id,p_project_id,false);
 perform 1 from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id and status in ('planning','active') for share;
 if not found then raise exception 'Current exact engagement required' using errcode='42501';end if;
 select * into plan from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id order by version_number desc limit 1;
 if plan.id is not null then
  if jsonb_typeof(plan.snapshot->'groups') is distinct from 'array' or jsonb_array_length(plan.snapshot->'groups')>100 then raise exception 'Bounded saved stage plan unavailable' using errcode='54000';end if;
  for g in select value from jsonb_array_elements(plan.snapshot->'groups') loop
   select * into live_group from public.project_pipeline_groups where id=(g->>'pipeline_group_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and kind=g->>'kind';
   select * into configuration from public.project_pipeline_configurations where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and pipeline_group_id=live_group.id order by revision desc limit 1;
   select coalesce(jsonb_agg(x order by x->>'step_key'),'[]') into bindings from jsonb_array_elements(coalesce(plan.snapshot->'stage_bindings'->'bindings','[]')) x where x->>'group_id'=g->>'pipeline_group_id';
   groups:=groups||jsonb_build_array(jsonb_build_object('id',g->'pipeline_group_id','kind',g->'kind','name',g->'name','cadence',g->'cadence',
    'publication_id',g->'definition_publication_id','configuration_id',configuration.id,'configuration_current',live_group.id is not null and configuration.definition_publication_id::text=g->>'definition_publication_id',
    'bindings',bindings,'steps',g->'stages','contributions',g->'contributions'));
  end loop;
 end if;
 return jsonb_build_object('version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
  'plan_id',plan.id,'plan_version',plan.version_number,'can_manage',private.n6_project_configuration_authorized(p_organization_id,p_project_id,p_actor),
  'state',case when plan.id is null then 'unconfigured' else 'available' end,'phases',private.project_stage_phase_catalog(),'groups',groups,
  'bindings',coalesce(plan.snapshot->'stage_bindings'->'bindings','[]'),'read_only',true);
end;$function$;



revoke all on function private.project_chat_design_sources_actor(uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.project_chat_design_scope_actor(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.project_chat_design_metadata_actor(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.project_chat_design_partition_context_actor(uuid,uuid,uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.project_chat_design_owner_actor(uuid,uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.project_chat_design_partition_actor(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.project_chat_design_plan_actor(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;


CREATE FUNCTION private.project_chat_design_brand_sources_actor(p_actor uuid, p_org uuid, p_project uuid, p_artifact_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare root uuid; n integer; initial_requests uuid[]; locked_requests uuid[];
begin
 if p_actor is null or p_artifact_ids is null or cardinality(p_artifact_ids) not between 1 and 21
  or array_position(p_artifact_ids,null) is not null
  or (select count(distinct x) from unnest(p_artifact_ids)x)<>cardinality(p_artifact_ids)
 then raise exception 'Bounded exact source roots required' using errcode='22023';end if;
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 for root in select x from unnest(p_artifact_ids)x order by x loop
  perform 1 from public.artifacts a where a.id=root and a.organization_id=p_org for update nowait;
  if not found then raise exception 'Current same-project source root required' using errcode='42501';end if;
 end loop;
 select count(*) into n from public.artifact_versions where organization_id=p_org and artifact_id=any(p_artifact_ids);
 if n>2000 then raise exception 'Source history exceeds bounded review' using errcode='54000';end if;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into initial_requests
  from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids);
 perform r.id from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by r.id for share of r nowait;
 perform v.id from public.artifact_versions v where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by v.id for share nowait;
 -- Fresh statement: request creation can have committed between enumeration
 -- and version acquisition. All normal request/approval writers lock versions.
 perform r.id from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids)
  order by r.id for share of r nowait;
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into locked_requests
  from public.artifact_approval_requests r join public.artifact_versions v
  on v.id=r.artifact_version_id and v.organization_id=r.organization_id
  where v.organization_id=p_org and v.artifact_id=any(p_artifact_ids);
 if initial_requests is distinct from locked_requests then
  raise exception 'Governed review changed during source acquisition; review current source explicitly' using errcode='40001';end if;
exception when lock_not_available or deadlock_detected then
 raise exception 'Selected Content source is busy; preserve the original request and review current source explicitly' using errcode='40001';
end;$function$
;
revoke all on function private.project_chat_design_brand_sources_actor(uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION private.website_native_source(p_org uuid, p_project uuid, p_engagement uuid, p_actor uuid, p_page uuid, p_architecture uuid, p_content uuid, p_brief uuid, p_site uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ar jsonb;pg public.project_website_pages;cv public.artifact_versions;ca public.artifacts;bv public.design_creative_brief_versions;b public.design_creative_briefs;sv private.website_site_versions;cp jsonb;identity jsonb;result jsonb;begin
 perform private.website_native_actor(p_org,p_project,p_engagement,p_actor,false);
 ar:=private.website_approved_source(p_org,p_project,p_architecture);
 select * into pg from public.project_website_pages where id=p_page and organization_id=p_org and project_id=p_project and engagement_id=p_engagement for share;
 select value into identity from jsonb_array_elements(ar->'pages') where value->>'page_key'=pg.page_key;
 if pg.id is null or identity is null or pg.architecture_artifact_id is distinct from (ar->'reference'->>'artifact_id')::uuid or pg.engagement_id is distinct from (ar->>'engagement_id')::uuid or pg.brand_id is distinct from (ar->>'brand_id')::uuid then raise exception 'Exact registered architecture page required' using errcode='42501';end if;
 select * into cv from public.artifact_versions where id=p_content and organization_id=p_org for share;
 select * into ca from public.artifacts where id=cv.artifact_id and organization_id=p_org for share;
 if ca.id is null or ca.artifact_type<>'content' or ca.project_id is distinct from p_project or ca.engagement_id is distinct from p_engagement or ca.brand_id is distinct from pg.brand_id or encode(sha256(convert_to(cv.content::text,'UTF8')),'hex') is distinct from cv.content_checksum then raise exception 'Exact project Content version required' using errcode='42501';end if;
 if cv.content->'schema_version'='2'::jsonb then
  perform private.validate_project_chat_writer(cv.content);
  if cv.content->>'output_type' is distinct from 'website_page_copy'
   or cv.content->>'source_architecture_version_id' is distinct from p_architecture::text
   or cv.content->>'target_page_key' is distinct from pg.page_key
   or (cv.content->>'target_page_path' is not null and private.normalize_content_page_path(cv.content->>'target_page_path') is distinct from identity->>'path')
  then raise exception 'Exact approved architecture, page key and path required for Writer-v2 Content' using errcode='42501';end if;
  -- Projection only: keep the original Content row/version/checksum immutable.
  -- Objective remains design context; absent SEO copy is not invented.
  cp:=jsonb_build_object('source_format','writer_v2','page_key',pg.page_key,'page_path',identity->>'path',
    'page_brief',cv.content->'objective','draft_copy',cv.content->'body','meta_title',cv.content->'working_title',
    'meta_description','','primary_cta',cv.content->'cta');
 else
  if jsonb_typeof(cv.content->'pages') is distinct from 'array' then raise exception 'Page copy required' using errcode='22023';end if;
  if (select count(*) from jsonb_array_elements(cv.content->'pages') x where private.normalize_content_page_path(x->>'page_path')=identity->>'path')<>1 then raise exception 'One exact Content page required' using errcode='22023';end if;
  select value into cp from jsonb_array_elements(cv.content->'pages') where private.normalize_content_page_path(value->>'page_path')=identity->>'path';
  if cp?'page_key' and cp->>'page_key' is distinct from pg.page_key then raise exception 'Content page key differs' using errcode='22023';end if;
 end if;
 select * into bv from public.design_creative_brief_versions where id=p_brief and organization_id=p_org for share;
 select * into b from public.design_creative_briefs where id=bv.creative_brief_id and organization_id=p_org for share;
 if b.id is null or b.visibility<>'official' or b.engagement_id is distinct from p_engagement or b.brand_id is distinct from pg.brand_id or b.frozen_version_id is distinct from p_brief or b.current_version_id is distinct from p_brief or bv.validation_snapshot->>'valid' is distinct from 'true' or bv.content->>'output_type' is distinct from 'website' then raise exception 'Current confirmed Website brief required' using errcode='42501';end if;
 perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.id=b.engagement_service_id and es.organization_id=p_org and es.engagement_id=p_engagement and es.status='active' and sc.department_id='design' and sc.is_active and sc.slug in ('website_ux_ui','setup_design_unique_page_ui_layout','setup_design_wireframe','setup_design_responsive_design_adaptation') for share of es,sc;
 if not found then raise exception 'Selected active Website layout service required' using errcode='42501';end if;
 select * into sv from private.website_site_versions where id=p_site and organization_id=p_org and project_id=p_project and engagement_id=p_engagement;
 if sv.id is null then raise exception 'Exact project site settings required' using errcode='42501';end if;
 if sv.identity_version_id is not null then perform private.website_native_identity(p_org,p_engagement,sv.identity_version_id);end if;
 result:=jsonb_build_object('scope',jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',p_engagement,'page_id',p_page,'page_key',pg.page_key),'architecture',ar->'reference','page',identity,'content_version',jsonb_build_object('id',cv.id,'content_checksum',cv.content_checksum),'content_page',cp,'brief_version',jsonb_build_object('id',bv.id,'content_checksum',bv.content_checksum),'brief_revision',b.revision,'site_version',to_jsonb(sv),'architecture_head',(select id from public.artifact_versions where artifact_id=(ar->'reference'->>'artifact_id')::uuid and organization_id=p_org order by version_number desc limit 1),'content_head',(select id from public.artifact_versions where artifact_id=ca.id and organization_id=p_org order by version_number desc limit 1),'site_head',(select id from private.website_site_versions where project_id=p_project and organization_id=p_org order by version_number desc limit 1),'design_head',(select design_id from private.website_native_bindings where page_id=p_page and organization_id=p_org order by version_number desc limit 1));
 if octet_length(result::text)>262144 then raise exception 'Source context exceeds bound; resolve in Content without truncation' using errcode='22023';end if;
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$function$
;



CREATE FUNCTION private.project_chat_native_design_save(p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_actor_id uuid, p_request_id uuid, p_direction_version_id uuid, p_architecture_approval_id uuid, p_review_sha256 text, p_manifest jsonb, p_html text, p_css text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare existing private.website_native_bindings;ctx jsonb;digest text;direction public.design_direction_versions;session public.design_workshop_sessions;brief public.design_creative_briefs;page uuid;design uuid;session_id uuid;direction_id uuid;brief_version public.design_creative_brief_versions;provenance jsonb;direction_content jsonb;direction_sha text;begin
 perform pg_advisory_xact_lock(hashtextextended('website-native:'||p_organization_id::text||':'||p_project_id::text,0));
 perform private.website_native_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 if p_request_id is null or jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>262144 or length(p_html) not between 1 and 500000 or length(p_css) not between 1 and 200000 or p_html is null or p_css is null then raise exception 'Bounded compiled design request required' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('project',p_project_id,'engagement',p_engagement_id,'direction',p_direction_version_id,'approval',p_architecture_approval_id,'review',p_review_sha256,'manifest',p_manifest,'html',p_html,'css',p_css)::text,'UTF8')),'hex');
 select * into existing from private.website_native_bindings where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id;
 if found then if existing.request_sha256<>digest then raise exception 'Changed original design request' using errcode='23505';end if;return to_jsonb(existing);end if;
 if p_manifest->'scope'->>'organization_id' is distinct from p_organization_id::text or p_manifest->'scope'->>'project_id' is distinct from p_project_id::text or p_manifest->'scope'->>'engagement_id' is distinct from p_engagement_id::text then raise exception 'Manifest scope differs' using errcode='42501';end if;
 page:=(p_manifest->'scope'->>'page_id')::uuid;
 ctx:=private.website_native_source(p_organization_id,p_project_id,p_engagement_id,p_actor_id,page,(p_manifest->'sources'->'architecture'->>'version_id')::uuid,(p_manifest->'sources'->'content'->>'version_id')::uuid,(p_manifest->'sources'->'brief'->>'version_id')::uuid,(p_manifest->'sources'->'site_system'->>'version_id')::uuid);
 if ctx->>'review_sha256' is distinct from p_review_sha256 or ctx->'architecture'->>'approval_id' is distinct from p_architecture_approval_id::text or ctx->'scope' is distinct from p_manifest->'scope' or ctx->'site_version'->'site' is distinct from p_manifest->'site' or p_manifest->'sources'->'architecture'->>'checksum' is distinct from ctx->'architecture'->>'content_checksum' or p_manifest->'sources'->'content'->>'checksum' is distinct from ctx->'content_version'->>'content_checksum' or p_manifest->'sources'->'brief'->>'checksum' is distinct from ctx->'brief_version'->>'content_checksum' or p_manifest->'sources'->'site_system'->>'checksum' is distinct from ctx->'site_version'->>'request_sha256' then raise exception 'Source context changed; review again' using errcode='40001';end if;
 select * into brief_version from public.design_creative_brief_versions where id=(p_manifest->'sources'->'brief'->>'version_id')::uuid and organization_id=p_organization_id;
 select * into brief from public.design_creative_briefs where id=brief_version.creative_brief_id and organization_id=p_organization_id;
 select v.* into direction from public.design_direction_versions v join public.design_directions d on d.id=v.direction_id and d.organization_id=v.organization_id join public.design_workshop_sessions ss on ss.id=d.session_id and ss.organization_id=d.organization_id where v.organization_id=p_organization_id and v.creative_brief_version_id=brief_version.id and not v.is_experimental and ss.engagement_id=p_engagement_id and ss.engagement_service_id=brief.engagement_service_id and ss.output_family='website_design' and v.id=p_direction_version_id order by v.created_at desc,v.id desc limit 1 for share of v,d,ss;
 if direction.id is null and p_direction_version_id is not null then raise exception 'Exact confirmed Website direction required' using errcode='42501';end if;
 if direction.id is null then
  provenance:=jsonb_build_object('mode','native_website_draft','creative_brief_id',brief.id,'creative_brief_version_id',brief_version.id,'creative_brief_checksum',brief_version.content_checksum);
  direction_content:=brief_version.content||jsonb_build_object('provenance',provenance,'draft_kind','native_website_direction');direction_sha:=encode(sha256(convert_to(direction_content::text,'UTF8')),'hex');
  insert into public.design_workshop_sessions(organization_id,engagement_id,brand_id,engagement_service_id,project_task_id,engagement_work_item_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,created_by) values(p_organization_id,p_engagement_id,brief.brand_id,brief.engagement_service_id,brief.project_task_id,brief.engagement_work_item_id,'website_design',brief_version.content,coalesce(brief_version.content->>'instructions',''),provenance,encode(sha256(convert_to(provenance::text,'UTF8')),'hex'),p_actor_id) returning id into session_id;
  insert into public.design_directions(organization_id,session_id,direction_slot) values(p_organization_id,session_id,1) returning id into direction_id;
  insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id) values(p_organization_id,direction_id,1,direction_content,direction_sha,direction_sha,p_actor_id,brief_version.id) returning * into direction;
 end if;
 if p_html~*'<script\y|<iframe\y|<object\y|<embed\y|javascript\s*:|\son[a-z]+\s*=' or p_css~*'@import|url\s*\(' then raise exception 'Executable or remote code is not accepted' using errcode='22023';end if;
 insert into public.website_page_designs(organization_id,design_direction_version_id,slug,html_content,css_content,status,created_by,native_input_checksum) values(p_organization_id,direction.id,ctx->'page'->>'path',p_html,p_css,'draft',p_actor_id,encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex')) returning id into design;
 insert into private.website_native_bindings(design_id,organization_id,project_id,engagement_id,page_id,parent_design_id,version_number,site_version_id,architecture_version_id,content_version_id,brief_version_id,manifest,request_id,request_sha256,created_by) values(design,p_organization_id,p_project_id,p_engagement_id,page,nullif(ctx->>'design_head','')::uuid,coalesce((select max(version_number) from private.website_native_bindings where page_id=page and organization_id=p_organization_id),0)+1,(p_manifest->'sources'->'site_system'->>'version_id')::uuid,(p_manifest->'sources'->'architecture'->>'version_id')::uuid,(p_manifest->'sources'->'content'->>'version_id')::uuid,direction.creative_brief_version_id,p_manifest,p_request_id,digest,p_actor_id) returning * into existing;
 return to_jsonb(existing);
end;$function$
;
revoke all on function private.project_chat_native_design_save(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated,service_role;


-- LOCAL WIP: assemble and verify natively before release.
create function private.project_chat_design_source_actor(p_actor uuid,p_org uuid,p_project uuid,p_conversation uuid,p_message uuid,p_context jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare engagement uuid;h jsonb;native jsonb;chat jsonb;approval jsonb;selection jsonb;part jsonb;
 w public.work_items;r public.work_items;v public.artifact_versions;a public.artifacts;
 bv public.design_creative_brief_versions;b public.design_creative_briefs;
 ids uuid[];roots uuid[];vid uuid;av public.artifact_versions;ar public.artifacts;ref jsonb;
 site private.website_site_versions;identity_root uuid;source_relation jsonb;receiver_relation jsonb;expected_assets jsonb;
begin
 if p_actor is null or p_org is null or p_project is null or p_conversation is null or p_message is null or jsonb_typeof(p_context) is distinct from 'object' or octet_length(p_context::text)>8192
 or (select count(*) from jsonb_object_keys(p_context))<>11
 or not p_context?&array['engagement_id','selection','handoff_request_id','source_work','receiving_work','page_id','architecture_version_id','brief_version_id','site_version_id','direction_version_id','expected_parent_design_id']
 then raise exception 'Exact bounded native Design context required' using errcode='22023';end if;
 engagement:=(p_context->>'engagement_id')::uuid;selection:=nullif(p_context->'selection','null'::jsonb);
 if engagement is null or p_context->>'page_id' is null or p_context->>'architecture_version_id' is null
 or p_context->>'brief_version_id' is null or p_context->>'site_version_id' is null or p_context->>'handoff_request_id' is null
 then raise exception 'Exact native Design prerequisites required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_org::text||':'||p_project::text,0));
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found then raise exception 'Active project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(p_actor,p_org,p_project,p_conversation,p_message,true);
 perform private.website_native_actor(p_org,p_project,engagement,p_actor,true);
 perform 1 from public.engagements where id=engagement and organization_id=p_org and project_id=p_project and status in ('planning','active') for share;
 if not found then raise exception 'Active exact engagement required' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||engagement::text,0)) then raise exception 'Work graph is busy' using errcode='40001';end if;
 select result into h from private.project_work_commands where organization_id=p_org and project_id=p_project and actor_id=p_actor
 and request_id=(p_context->>'handoff_request_id')::uuid and payload->>'action'='project_chat_content_v1'
 and payload->>'conversation_id'=p_conversation::text;
 if h is null or h->>'kind' is distinct from 'handoff_design' or h->>'status' is distinct from 'handoff_recorded'
 or h->>'engagement_id' is distinct from engagement::text or h->>'actor_id' is distinct from p_actor::text
 or h->>'conversation_id' is distinct from p_conversation::text
 then raise exception 'Exact original owned Content handoff required' using errcode='42501';end if;
 if h->'selection' is distinct from 'null'::jsonb and (selection is null or
 (selection-'context_sha256') is distinct from ((h->'selection')-'context_sha256')) then raise exception 'Retain original handoff stage and explicitly refresh current context' using errcode='40001';end if;
 if jsonb_typeof(p_context->'source_work') is distinct from 'object' or jsonb_typeof(p_context->'receiving_work') is distinct from 'object'
 or (select count(*) from jsonb_object_keys(p_context->'source_work'))<>2 or (select count(*) from jsonb_object_keys(p_context->'receiving_work'))<>2
 or not (p_context->'source_work')?&array['id','row_version'] or not (p_context->'receiving_work')?&array['id','row_version']
 or p_context->'source_work'->>'id' is distinct from h->'source_work'->>'id'
 or p_context->'receiving_work'->>'id' is distinct from h->'handoff'->>'receiving_work_item_id'
 or p_context->'source_work'->>'id'=p_context->'receiving_work'->>'id'
 then raise exception 'Exact distinct source and receiving Work required' using errcode='42501';end if;
 select * into v from public.artifact_versions where id=(h->'output'->>'artifact_version_id')::uuid and organization_id=p_org;
 if v.id is null or v.content_checksum is distinct from h->'output'->>'content_checksum' then raise exception 'Original Content unavailable' using errcode='40001';end if;
 ids:=array[v.id,(p_context->>'architecture_version_id')::uuid]||array(select x::uuid from unnest(private.content_n3_source_ids(v.content))x);
 if selection is not null then
  if selection->>'engagement_id' is distinct from engagement::text then raise exception 'Selected engagement differs' using errcode='42501';end if;
  select ids||coalesce(array_agg((x->'reference'->>'artifact_version_id')::uuid) filter(where x->'reference'->>'artifact_version_id' is not null),'{}'::uuid[]) into ids
  from public.project_pipeline_configurations c join public.project_pipeline_stage_reviews sr on sr.configuration_id=c.id and sr.organization_id=c.organization_id
  cross join lateral jsonb_array_elements(sr.resolved_artifacts)x
  where c.organization_id=p_org and c.project_id=p_project and c.engagement_id=engagement and c.pipeline_group_id=(selection->>'group_id')::uuid
  and c.revision=(select max(c2.revision) from public.project_pipeline_configurations c2 where c2.organization_id=c.organization_id and c2.project_id=c.project_id and c2.engagement_id=c.engagement_id and c2.pipeline_group_id=c.pipeline_group_id);
 end if;
 with recursive pinned(id) as (select unnest(ids) union select child::uuid from pinned p join public.artifact_versions x on x.id=p.id and x.organization_id=p_org cross join lateral unnest(private.content_n3_source_ids(x.content))child)
 select array_agg(id) into ids from (select id from pinned limit 21)bounded;
 if cardinality(ids)>20 or array_position(ids,null) is not null then raise exception 'Bounded pinned source set required' using errcode='54000';end if;
 if (select count(*) from public.artifact_versions x join public.artifacts source_artifact on source_artifact.id=x.artifact_id and source_artifact.organization_id=x.organization_id where x.id=any(ids) and x.organization_id=p_org and source_artifact.project_id=p_project)<>cardinality(ids)
 then raise exception 'Exact project sources required' using errcode='42501';end if;
 select array_agg(distinct artifact_id) into roots from public.artifact_versions where id=any(ids) and organization_id=p_org;
 perform private.project_chat_design_sources_actor(p_actor,p_org,p_project,roots);
 -- Site identity has the canonical same-brand scope, which can cross engagements/projects.
 -- Freeze its entire approval/request/version history without widening project source authority.
 select * into site from private.website_site_versions where id=(p_context->>'site_version_id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=engagement;
 if site.id is null then raise exception 'Exact project site settings required' using errcode='42501';end if;
 if site.identity_version_id is not null then
  select x.artifact_id into identity_root from public.artifact_versions x join public.artifacts identity_artifact on identity_artifact.id=x.artifact_id and identity_artifact.organization_id=x.organization_id join public.engagements e on e.id=engagement and e.organization_id=p_org
  where x.id=site.identity_version_id and x.organization_id=p_org and identity_artifact.artifact_type='design_system' and identity_artifact.brand_id=e.brand_id;
  if identity_root is null then raise exception 'Exact same-brand identity required' using errcode='42501';end if;
  perform private.project_chat_design_brand_sources_actor(p_actor,p_org,p_project,array[identity_root]);
  perform private.website_native_identity(p_org,engagement,site.identity_version_id);
 end if;
 foreach vid in array ids loop
  select * into av from public.artifact_versions where id=vid and organization_id=p_org;
  select * into ar from public.artifacts where id=av.artifact_id and organization_id=p_org;
  ref:=private.require_pipeline_approved_artifact(p_org,p_project,vid,ar.artifact_type,av.content->>'output_type');
  if exists(select 1 from public.artifact_versions newer join public.artifact_approvals ap on ap.artifact_version_id=newer.id and ap.organization_id=newer.organization_id where newer.artifact_id=ar.id and newer.organization_id=p_org and newer.version_number>av.version_number and ap.decision='approved') then raise exception 'Pinned source has newer approval' using errcode='40001';end if;
 end loop;
 if selection is not null then
  perform private.project_chat_design_metadata_actor(p_actor,p_org,p_project,selection,'{}');
  part:=private.project_chat_design_partition_actor(p_actor,p_org,p_project,engagement,(selection->>'plan_id')::uuid,(selection->>'group_id')::uuid,selection->'partition');
 end if;
 -- Stage reader visits sorted Work first; no mutating Work locks or updates.
 perform id from public.work_items where organization_id=p_org and id in ((p_context->'source_work'->>'id')::uuid,(p_context->'receiving_work'->>'id')::uuid) order by id for share nowait;
 select * into w from public.work_items where id=(p_context->'source_work'->>'id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=engagement and department_id='content' and deleted_at is null;
 select * into r from public.work_items where id=(p_context->'receiving_work'->>'id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=engagement and department_id='design' and deleted_at is null;
 if w.id is null or r.id is null or r.status='done' or w.row_version is distinct from (p_context->'source_work'->>'row_version')::bigint or r.row_version is distinct from (p_context->'receiving_work'->>'row_version')::bigint
 or w.linked_artifact_version_id is distinct from v.id or w.linked_artifact_id is distinct from (h->'output'->>'artifact_id')::uuid
 then raise exception 'Exact current Work references required' using errcode='40001';end if;
 select jsonb_build_object('revision',revision,'assets',assets) into source_relation from private.project_asset_relation_revisions where organization_id=p_org and project_id=p_project and subject_kind='engagement_work_item' and subject_id=w.id order by revision desc limit 1;
 select jsonb_build_object('revision',revision,'assets',assets) into receiver_relation from private.project_asset_relation_revisions where organization_id=p_org and project_id=p_project and subject_kind='engagement_work_item' and subject_id=r.id order by revision desc limit 1;
 expected_assets:=jsonb_build_array(jsonb_build_object('kind','website_page','id',p_context->'page_id'));
 if source_relation->'assets' is distinct from expected_assets or receiver_relation->'assets' is distinct from expected_assets then raise exception 'Both current Work page relations must match the reviewed page' using errcode='40001';end if;
 if selection is not null and (selection->'partition'->>'kind' is distinct from 'website_page' or selection->'partition'->>'id' is distinct from p_context->>'page_id') then raise exception 'Selected Chat stage must belong to exact native page' using errcode='42501';end if;
 if selection is not null and not exists(select 1 from jsonb_array_elements(part->'steps')s cross join lateral jsonb_array_elements(s->'items')i where s->>'phase'=selection->>'phase' and i->>'work_item_id' in(w.id::text,r.id::text) and i->'material_current'='true'::jsonb and i->'needs_update'='false'::jsonb)
 then raise exception 'Selected stage does not contain current handoff Work' using errcode='40001';end if;
 approval:=private.require_pipeline_approved_artifact(p_org,p_project,v.id,'content',v.content->>'output_type');
 if approval->>'approval_id' is distinct from h->'handoff'->>'approval_id' then raise exception 'Original exact Content approval changed' using errcode='40001';end if;
 select * into bv from public.design_creative_brief_versions where id=(p_context->>'brief_version_id')::uuid and organization_id=p_org for share;
 select * into b from public.design_creative_briefs where id=bv.creative_brief_id and organization_id=p_org for share;
 if b.id is null or b.engagement_work_item_id is distinct from r.id or b.project_task_id is not null or b.engagement_service_id is distinct from (h->'handoff'->>'receiving_service_id')::uuid
 then raise exception 'Confirmed brief must belong to exact receiving Design Work and service' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('website-native:'||p_org::text||':'||p_project::text,0)) then raise exception 'Native Website source is busy' using errcode='40001';end if;
 native:=private.website_native_source(p_org,p_project,engagement,p_actor,(p_context->>'page_id')::uuid,(p_context->>'architecture_version_id')::uuid,v.id,bv.id,(p_context->>'site_version_id')::uuid);
 if native->>'design_head' is distinct from p_context->>'expected_parent_design_id' then raise exception 'Native Design parent changed' using errcode='40001';end if;
 if p_context->>'direction_version_id' is not null then
  perform 1 from public.design_direction_versions dv join public.design_directions d on d.id=dv.direction_id and d.organization_id=dv.organization_id join public.design_workshop_sessions ss on ss.id=d.session_id and ss.organization_id=d.organization_id
  where dv.id=(p_context->>'direction_version_id')::uuid and dv.organization_id=p_org and dv.creative_brief_version_id=bv.id and not dv.is_experimental and ss.engagement_id=engagement and ss.engagement_service_id=b.engagement_service_id and ss.engagement_work_item_id=r.id and ss.output_family='website_design' for share of dv,d,ss;
  if not found then raise exception 'Exact receiving Work direction required' using errcode='42501';end if;
 end if;
 chat:=jsonb_build_object('version',1,'organization_id',p_org,'project_id',p_project,'engagement_id',engagement,'conversation_id',p_conversation,'source_message_id',p_message,'actor_id',p_actor,'context',p_context,'handoff_receipt',h,'source_work',p_context->'source_work','receiving_work',p_context->'receiving_work','content_approval',jsonb_build_object('artifact_id',h->'output'->'artifact_id','artifact_version_id',v.id,'content_checksum',v.content_checksum,'approval_id',approval->'approval_id'));
 return native||jsonb_build_object('chat_context',chat,'chat_review_sha256',encode(sha256(convert_to(jsonb_build_object('review_sha256',native->'review_sha256','chat_context',chat,'work_relations',jsonb_build_object('source',source_relation,'receiving',receiver_relation))::text,'UTF8')),'hex'));
end;$$;
revoke all on function private.project_chat_design_source_actor(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.get_project_chat_native_design_source(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare answer jsonb;old_timeout text:=current_setting('lock_timeout');
begin
 if auth.uid() is null then raise exception 'Authenticated actor required' using errcode='42501';end if;
 perform set_config('lock_timeout','500ms',true);
 answer:=private.project_chat_design_source_actor(auth.uid(),p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_context);
 perform set_config('lock_timeout',old_timeout,true);return answer;
exception when lock_not_available or deadlock_detected then raise exception 'Design source is busy; retain the current draft' using errcode='40001';
end;$$;
revoke all on function public.get_project_chat_native_design_source(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_project_chat_native_design_source(uuid,uuid,uuid,uuid,jsonb) to authenticated;


-- LOCAL WIP: service-only atomic canonical native save plus original Chat receipt.
create function public.apply_project_chat_native_design_action(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid,p_context jsonb,p_chat_review_sha256 text,p_review_sha256 text,p_architecture_approval_id uuid,p_manifest jsonb,p_html text,p_css text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;prior private.project_work_commands;src jsonb;saved jsonb;answer jsonb;old_timeout text:=current_setting('lock_timeout');
begin
 if p_actor_id is null or p_request_id is null or p_source_message_id is null or p_manifest is null or p_context is null
 or octet_length(p_manifest::text)>262144 or octet_length(p_context::text)>8192
 or p_chat_review_sha256 is null or p_chat_review_sha256!~'^[a-f0-9]{64}$' or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$'
 then raise exception 'Exact bounded server-compiled Chat Design request required' using errcode='22023';end if;
 perform set_config('lock_timeout','500ms',true);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for update;
 if not found then raise exception 'Active exact project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,false);
 payload:=jsonb_build_object('action','project_chat_native_design_v1','conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'context',p_context,'chat_review_sha256',p_chat_review_sha256,'review_sha256',p_review_sha256,'architecture_approval_id',p_architecture_approval_id,'manifest',p_manifest,'html_sha256',encode(sha256(convert_to(p_html,'UTF8')),'hex'),'css_sha256',encode(sha256(convert_to(p_css,'UTF8')),'hex'));
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 select * into prior from private.project_work_commands where organization_id=p_organization_id and actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if prior.project_id is distinct from p_project_id or prior.payload is distinct from payload then raise exception 'Original request owns a different action' using errcode='23505';end if;
  perform set_config('lock_timeout',old_timeout,true);return prior.result;
 end if;
 src:=private.project_chat_design_source_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_context);
 if src->>'chat_review_sha256' is distinct from p_chat_review_sha256 or src->>'review_sha256' is distinct from p_review_sha256
 or src->'architecture'->>'approval_id' is distinct from p_architecture_approval_id::text
 then raise exception 'Reviewed Chat Design sources changed' using errcode='40001';end if;
 -- Never adopt a previously standalone native action as a new Chat action.
 if exists(select 1 from private.website_native_bindings where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id)
 then raise exception 'Original native request already belongs to another flow' using errcode='23505';end if;
 saved:=private.project_chat_native_design_save(p_organization_id,p_project_id,(p_context->>'engagement_id')::uuid,p_actor_id,p_request_id,(p_context->>'direction_version_id')::uuid,p_architecture_approval_id,p_review_sha256,p_manifest,p_html,p_css);
 if saved->>'page_id' is distinct from p_context->>'page_id' or saved->>'parent_design_id' is distinct from p_context->>'expected_parent_design_id'
 or saved->>'content_version_id' is distinct from src->'content_version'->>'id' then raise exception 'Canonical native result differs from exact Chat request' using errcode='40001';end if;
 perform 1 from public.website_page_designs pd join public.design_direction_versions dv on dv.id=pd.design_direction_version_id and dv.organization_id=pd.organization_id join public.design_directions d on d.id=dv.direction_id and d.organization_id=dv.organization_id join public.design_workshop_sessions ss on ss.id=d.session_id and ss.organization_id=d.organization_id
 where pd.id=(saved->>'design_id')::uuid and pd.organization_id=p_organization_id and dv.creative_brief_version_id=(p_context->>'brief_version_id')::uuid and ss.engagement_id=(p_context->>'engagement_id')::uuid and ss.engagement_work_item_id=(p_context->'receiving_work'->>'id')::uuid
 and (p_context->>'direction_version_id' is null or dv.id=(p_context->>'direction_version_id')::uuid);
 if not found then raise exception 'Saved Design direction differs from exact receiving Work' using errcode='40001';end if;
 answer:=jsonb_build_object('version',1,'kind','save_native_design','status','design_draft_saved','organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_context->'engagement_id','conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'actor_id',p_actor_id,'request_id',p_request_id,'selection',p_context->'selection','handoff_request_id',p_context->'handoff_request_id','source_work',p_context->'source_work','receiving_work',p_context->'receiving_work','output',jsonb_build_object('kind','website_native_design','design_id',saved->'design_id','page_id',saved->'page_id','parent_design_id',saved->'parent_design_id','version_number',saved->'version_number','request_sha256',saved->'request_sha256'),'review_required',true);
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,p_actor_id,p_request_id,payload,answer);
 perform set_config('lock_timeout',old_timeout,true);return answer;
exception when lock_not_available or deadlock_detected then raise exception 'Design sources are busy; preserve original request for read-only recovery' using errcode='40001';
end;$$;
revoke all on function public.apply_project_chat_native_design_action(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.apply_project_chat_native_design_action(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,uuid,jsonb,text,text) to service_role;

create function public.recover_project_chat_native_design_action(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();prior private.project_work_commands;
begin
 perform private.project_chat_design_owner_actor(actor,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,false);
 if p_request_id is null then raise exception 'Original request identity required' using errcode='22023';end if;
 select * into prior from private.project_work_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then
  if prior.project_id is distinct from p_project_id or prior.payload->>'action' is distinct from 'project_chat_native_design_v1' or prior.payload->>'conversation_id' is distinct from p_conversation_id::text or prior.payload->>'source_message_id' is distinct from p_source_message_id::text then raise exception 'Original request belongs to another action' using errcode='42501';end if;
  return jsonb_build_object('status','recorded','receipt',prior.result);
 end if;
 return jsonb_build_object('status','not_recorded','must_not_submit',true);
end;$$;
revoke all on function public.recover_project_chat_native_design_action(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_project_chat_native_design_action(uuid,uuid,uuid,uuid,uuid) to authenticated;

create function public.read_project_chat_native_design_actions(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();items jsonb;more boolean;
begin
 perform private.project_chat_design_owner_actor(actor,p_organization_id,p_project_id,p_conversation_id,null,false);
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Bounded action history required' using errcode='22023';end if;
 select coalesce(jsonb_agg(q.result order by q.created_at desc,q.request_id desc),'[]') into items from (
  select result,created_at,request_id from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=actor and payload->>'action'='project_chat_native_design_v1' and payload->>'conversation_id'=p_conversation_id::text order by created_at desc,request_id desc limit p_limit offset p_offset
 )q;
 select exists(select 1 from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=actor and payload->>'action'='project_chat_native_design_v1' and payload->>'conversation_id'=p_conversation_id::text order by created_at desc,request_id desc limit 1 offset p_offset+p_limit) into more;
 return jsonb_build_object('items',items,'limit',p_limit,'offset',p_offset,'has_more',more);
end;$$;
revoke all on function public.read_project_chat_native_design_actions(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_project_chat_native_design_actions(uuid,uuid,uuid,integer,integer) to authenticated;

commit;
