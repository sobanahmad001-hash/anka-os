-- Read-only stage evidence. The existing Work command helper and all writer
-- grants remain unchanged. This closed read projection uses the same material
-- fingerprints, current source checks and bounded canonical slot lineage.
do $guard$ begin
 if md5(pg_get_functiondef(to_regprocedure('private.project_pipeline_work_context(uuid,uuid,uuid,uuid,jsonb,uuid[])'))) is distinct from 'f5d1502101181448a3c4c62b7648a6e2'
 or to_regprocedure('private.project_stage_partition_context(uuid,uuid,uuid,uuid,jsonb,uuid[])') is not null then
  raise exception 'Current Work projection prerequisite or new namespace differs' using errcode='55000';end if;
end;$guard$;
CREATE OR REPLACE FUNCTION private.project_stage_partition_context(p_org uuid, p_project uuid, p_engagement uuid, p_configuration uuid, p_partition jsonb, p_work_ids uuid[])
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
 perform private.n2_scope_require_member(p_org,p_project,false);
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
end;$function$
;
revoke all on function private.project_stage_partition_context(uuid,uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;

create function public.read_project_stage_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $plan$
declare plan private.project_delivery_plan_versions;groups jsonb:='[]';g jsonb;live_group public.project_pipeline_groups;
 bindings jsonb;configuration public.project_pipeline_configurations;begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
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
  'plan_id',plan.id,'plan_version',plan.version_number,'can_manage',private.n6_project_configuration_authorized(p_organization_id,p_project_id,auth.uid()),
  'state',case when plan.id is null then 'unconfigured' else 'available' end,'phases',private.project_stage_phase_catalog(),'groups',groups,
  'bindings',coalesce(plan.snapshot->'stage_bindings'->'bindings','[]'),'read_only',true);
end;$plan$;
revoke all on function public.read_project_stage_plan(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_project_stage_plan(uuid,uuid,uuid) to authenticated;

create function public.read_project_stage_partition(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_plan_id uuid,p_group_id uuid,p_partition jsonb) returns jsonb
language plpgsql security definer set search_path='' as $partition$
declare plan private.project_delivery_plan_versions;g jsonb;configuration public.project_pipeline_configurations;definition public.pipeline_execution_definitions;
 review public.project_pipeline_stage_reviews;receipt private.project_work_commands;work public.work_items;slot jsonb;decision jsonb;stage jsonb;source_stage jsonb;
 binding jsonb;reference jsonb;output jsonb;rows jsonb:='[]';items jsonb;context jsonb;context_state text:='current';phase text;
 quantity integer;idx integer;material_current boolean;source_update boolean;dependency_blocked boolean;approved boolean;work_done boolean;
 current_ref jsonb;ref jsonb;keyword_revision jsonb;page_meta jsonb;seo_meta jsonb;occurrence_meta jsonb;result jsonb;batch_key text;ancestor_keys text[];page_source jsonb;content_value jsonb;begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
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
 begin context:=private.project_stage_partition_context(p_organization_id,p_project_id,p_engagement_id,configuration.id,p_partition,'{}'::uuid[]);
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
end;$partition$;
revoke all on function public.read_project_stage_partition(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_project_stage_partition(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;

create function public.list_project_stage_partitions(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_plan_id uuid,p_group_id uuid,p_kind text,p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $list$
declare plan private.project_delivery_plan_versions;g jsonb;items jsonb;total bigint;begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 perform 1 from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id and status in ('planning','active');
 if not found then raise exception 'Current exact engagement required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded exact partition paging required' using errcode='22023';end if;
 select * into plan from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id order by version_number desc limit 1;
 if plan.id is null or plan.id is distinct from p_plan_id then raise exception 'Saved stage plan changed; refresh before selecting a partition' using errcode='40001';end if;
 select value into g from jsonb_array_elements(plan.snapshot->'groups') where value->>'pipeline_group_id'=p_group_id::text;
 if g is null or p_kind is null then raise exception 'Exact saved pipeline group and partition kind required' using errcode='42501';end if;
 if p_kind='engagement' and g->>'kind'='branding' then
  total:=1;items:=case when p_offset=0 then jsonb_build_array(jsonb_build_object('title','Shared foundation','partition',jsonb_build_object('kind','engagement','id',p_engagement_id))) else '[]'::jsonb end;
 elsif p_kind='website_page' and g->>'kind'='website' then
  select count(*) into total from public.project_website_pages where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
  select coalesce(jsonb_agg(x.item order by x.id),'[]') into items from (
   select p.id,jsonb_build_object('title',p.initial_path,'page_key',p.page_key,'source_selection',case when head.partition->>'architecture_version_id' is null then 'registration' else 'retained_work_binding' end,
    'partition',jsonb_build_object('kind','website_page','id',p.id,'architecture_version_id',coalesce(head.partition->>'architecture_version_id',p.initial_architecture_version_id::text))) as item
   from public.project_website_pages p
   left join lateral(select r.result->'partition' as partition from private.project_work_commands r where r.organization_id=p_organization_id and r.project_id=p_project_id and r.payload->>'action'='pipeline_work_batch_v1'
    and r.result->>'batch_key'=encode(sha256(convert_to(jsonb_build_array(p_engagement_id,p_group_id,'website_page',p.id::text)::text,'UTF8')),'hex')
    order by (r.result->>'revision')::bigint desc limit 1) head on true
   where p.organization_id=p_organization_id and p.project_id=p_project_id and p.engagement_id=p_engagement_id order by p.id offset p_offset limit p_limit
  ) x;
 elsif p_kind='campaign_asset' and g->>'kind'='marketing' then
  select count(*) into total from public.project_campaign_assets a join public.engagements e on e.organization_id=a.organization_id and e.project_id=a.project_id and e.brand_id=a.brand_id
   where a.organization_id=p_organization_id and a.project_id=p_project_id and e.id=p_engagement_id;
  select coalesce(jsonb_agg(x.item order by x.id),'[]') into items from (
   select a.id,jsonb_build_object('title',coalesce(nullif(a.source_descriptor->>'title',''),'Campaign asset'),'source_kind',a.source_kind,'source_version_id',a.source_version_id,
    'partition',jsonb_build_object('kind','campaign_asset','id',a.id)) as item
   from public.project_campaign_assets a join public.engagements e on e.organization_id=a.organization_id and e.project_id=a.project_id and e.brand_id=a.brand_id
   where a.organization_id=p_organization_id and a.project_id=p_project_id and e.id=p_engagement_id order by a.id offset p_offset limit p_limit
  ) x;
 elsif p_kind='recurring_occurrence' and g->>'kind'='marketing' then
  select count(*) into total from public.recurring_work_occurrences o where o.organization_id=p_organization_id and o.project_id=p_project_id and o.engagement_id=p_engagement_id
   and exists(select 1 from jsonb_array_elements(g->'contributions') c where c->>'service_id'=o.service_id::text);
  select coalesce(jsonb_agg(x.item order by x.period_start desc,x.id),'[]') into items from (
   select o.id,o.period_start,jsonb_build_object('title',o.period_start::text||' to '||o.period_end::text,'period_start',o.period_start,'period_end',o.period_end,'timezone',o.timezone,'status',o.status,
    'partition',jsonb_build_object('kind','recurring_occurrence','id',o.id)) as item
   from public.recurring_work_occurrences o where o.organization_id=p_organization_id and o.project_id=p_project_id and o.engagement_id=p_engagement_id
    and exists(select 1 from jsonb_array_elements(g->'contributions') c where c->>'service_id'=o.service_id::text)
   order by o.period_start desc,o.id offset p_offset limit p_limit
  ) x;
 else raise exception 'Partition kind does not belong to this saved track' using errcode='42501';end if;
 return jsonb_build_object('version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'plan_id',plan.id,'group_id',p_group_id,
  'kind',p_kind,'items',items,'total',total,'offset',p_offset,'limit',p_limit,'has_more',p_offset+jsonb_array_length(items)<total,'read_only',true);
end;$list$;
revoke all on function public.list_project_stage_partitions(uuid,uuid,uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_project_stage_partitions(uuid,uuid,uuid,uuid,uuid,text,integer,integer) to authenticated;
