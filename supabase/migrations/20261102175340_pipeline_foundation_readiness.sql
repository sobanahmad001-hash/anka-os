-- LOCAL WIP: requires native verification and consumer review; no production authority.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('create_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint)')),chr(13),'')) is distinct from 'f1d4081729728085604fd495d6787714' then raise exception 'Exact pipeline foundation prerequisite changed: create_reviewed_project_pipeline_configuration' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.current_pipeline_stage_review(uuid,uuid)')),chr(13),'')) is distinct from '4a0485cb3872e0872b6c4f59660b5d69' then raise exception 'Exact pipeline foundation prerequisite changed: private.current_pipeline_stage_review' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.resolve_project_foundation(uuid,uuid,jsonb)')),chr(13),'')) is distinct from 'b82bdad62f57b82c19564a4b419426f1' then raise exception 'Exact saved foundation contract changed' using errcode='55000';end if;
 if to_regprocedure('private.pipeline_foundation_context(uuid,uuid,uuid,uuid,boolean)') is not null or to_regprocedure('private.create_foundation_reviewed_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint,jsonb)') is not null or to_regprocedure('public.create_foundation_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint,jsonb)') is not null or exists(select 1 from pg_attribute where attrelid='public.project_pipeline_stage_reviews'::regclass and attname='foundation_context' and not attisdropped) then raise exception 'New foundation stage contract already exists' using errcode='55000';end if;
end;$$;
alter table public.project_pipeline_stage_reviews add column foundation_context jsonb check(foundation_context is null or (jsonb_typeof(foundation_context)='object' and octet_length(foundation_context::text)<=8192));
create function private.pipeline_foundation_context(p_org uuid,p_engagement uuid,p_group uuid,p_pinned_plan uuid,p_allow_legacy boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.engagements;g public.project_pipeline_groups;latest private.project_delivery_plan_versions;pinned private.project_delivery_plan_versions;
 b jsonb;latest_binding jsonb;pin jsonb;role_name text;refs jsonb:='{}';
begin
 -- Internal metadata validator. Its callers retain their current normal actor
 -- checks; service-role execution need not impersonate auth.uid(). Never grant
 -- this helper directly to application or service clients.
 if p_group is null then return null;end if;
 select * into e from public.engagements where id=p_engagement and organization_id=p_org and status in ('planning','active') for share;
 if e.id is null then raise exception 'Current pipeline engagement required' using errcode='42501';end if;
 select * into g from public.project_pipeline_groups where id=p_group and organization_id=p_org and engagement_id=e.id and project_id=e.project_id for share;
 if g.id is null then raise exception 'Exact project pipeline group required' using errcode='42501';end if;
 if g.kind='branding' then return null;end if;
 if g.kind not in ('website','marketing') then raise exception 'Supported project track required' using errcode='55000';end if;
 -- Canonical plan writers lock this engagement FOR UPDATE before inserting a
 -- new version. Holding FOR SHARE keeps the selected material head stable.
 select * into latest from private.project_delivery_plan_versions where organization_id=p_org and project_id=e.project_id and engagement_id=e.id order by version_number desc limit 1 for share;
 latest_binding:=latest.snapshot->'foundation';
 if latest_binding is null or latest_binding='null'::jsonb then
  if p_allow_legacy and p_pinned_plan is null then return null;end if;
  raise exception 'Review and save project guidance before preparing this pipeline' using errcode='55000';
 end if;
 if not exists(select 1 from jsonb_array_elements(coalesce(latest.snapshot->'groups','[]')) x where x->>'pipeline_group_id'=g.id::text) then raise exception 'This pipeline is not included in the current reviewed plan' using errcode='55000';end if;
 if p_pinned_plan is null then pinned:=latest;
 else
  select * into pinned from private.project_delivery_plan_versions where id=p_pinned_plan and organization_id=p_org and project_id=e.project_id and engagement_id=e.id for share;
  if pinned.id is null or not exists(select 1 from jsonb_array_elements(coalesce(pinned.snapshot->'groups','[]')) x where x->>'pipeline_group_id'=g.id::text) then raise exception 'Original reviewed foundation plan is unavailable' using errcode='55000';end if;
 end if;
 b:=pinned.snapshot->'foundation';
 if b->'version' is distinct from '1'::jsonb or b->>'organization_id' is distinct from p_org::text or b->>'project_id' is distinct from e.project_id::text
  or b->>'engagement_id' is distinct from e.id::text or b->>'brand_id' is distinct from e.brand_id::text
  or b->'sources_available' is distinct from 'true'::jsonb or b->'gaps' is distinct from '[]'::jsonb
  or coalesce(b->>'binding_checksum','')!~'^[a-f0-9]{64}$'
  or b->>'binding_checksum' is distinct from encode(sha256(convert_to((b-'binding_checksum')::text,'UTF8')),'hex')
  or b->>'binding_checksum' is distinct from latest_binding->>'binding_checksum' then raise exception 'Reviewed foundation is missing, changed or incomplete; review the exact plan guidance' using errcode='55000';end if;
 perform 1 from public.projects p join public.brands brand on brand.id=e.brand_id and brand.organization_id=p.organization_id and brand.client_id=e.client_id and brand.status='active'
 join public.agency_clients client on client.id=e.client_id and client.organization_id=p.organization_id and client.status='active'
 where p.id=e.project_id and p.organization_id=p_org and p.archived_at is null for share of p,brand,client;
 if not found then raise exception 'Current project, client and brand required for preparation' using errcode='55000';end if;
 foreach role_name in array array['written','visual'] loop
  pin:=b->'pins'->role_name;
  if pin->>'mode'='minimum' then
   if jsonb_typeof(pin->'guidance') is distinct from 'string' or jsonb_typeof(pin->'reason') is distinct from 'string' then raise exception 'Reviewed minimum guidance is unavailable' using errcode='55000';end if;
   refs:=refs||jsonb_build_object(role_name,jsonb_build_object('mode','minimum','guidance_checksum',encode(sha256(convert_to(jsonb_build_array(pin->'guidance',pin->'reason')::text,'UTF8')),'hex')));
  elsif pin->>'mode'='approved_version' then
   perform 1 from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
   join public.artifact_approvals approval on approval.artifact_id=a.id and approval.artifact_version_id=v.id and approval.organization_id=a.organization_id and approval.engagement_id=a.engagement_id and approval.decision='approved'
   join public.engagements se on se.id=a.engagement_id and se.organization_id=a.organization_id and se.project_id=a.project_id and se.brand_id=a.brand_id and se.client_id=e.client_id and se.status<>'cancelled'
   where a.id=(pin->>'artifact_id')::uuid and v.id=(pin->>'version_id')::uuid and approval.id=(pin->>'approval_id')::uuid
    and a.organization_id=p_org and a.project_id=e.project_id and a.brand_id=e.brand_id and v.content_checksum=pin->>'checksum'
    and ((role_name='written' and a.artifact_type in ('discovery','vision','audience','content')) or (role_name='visual' and a.artifact_type in ('design_system','brand_identity','design_direction')))
   for share of a,v,approval,se;
   if not found then raise exception 'Pinned approved guidance is unavailable or changed; review exact replacement' using errcode='55000';end if;
   refs:=refs||jsonb_build_object(role_name,jsonb_build_object('mode','approved_version','artifact_id',pin->'artifact_id','version_id',pin->'version_id','approval_id',pin->'approval_id','checksum',pin->'checksum'));
  else raise exception 'Both reviewed foundation roles are required for preparation' using errcode='55000';
  end if;
 end loop;
 return jsonb_build_object('schema_version',1,'plan_version_id',pinned.id,'foundation_checksum',b->>'binding_checksum','roles',refs);
end;$$;
revoke all on function private.pipeline_foundation_context(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.create_foundation_reviewed_configuration(p_organization_id uuid, p_engagement_id uuid, p_definition_publication_id uuid, p_pipeline_group_id uuid, p_request_id uuid, p_stage_decisions jsonb, p_max_ai_cost_microusd bigint, p_foundation_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());engagement public.engagements;definition public.pipeline_execution_definitions;existing public.project_pipeline_stage_reviews;
 item jsonb;step jsonb;contract jsonb;input jsonb;requirement jsonb;resolved jsonb:='[]';selected jsonb:='[]';sha text;created jsonb;used text[]:='{}';chosen_services text[]:='{}';input_keys text[];ref jsonb;v_context jsonb;begin
 if actor is null or p_request_id is null or jsonb_typeof(p_stage_decisions) is distinct from 'array' then raise exception 'Exact authenticated stage review required' using errcode='22023';end if;
 if p_foundation_context is not null and (jsonb_typeof(p_foundation_context) is distinct from 'object' or octet_length(p_foundation_context::text)>8192) then raise exception 'Bounded exact foundation review context required' using errcode='22023';end if;
 if jsonb_array_length(p_stage_decisions) not between 1 and 50 or octet_length(p_stage_decisions::text)>32768 then raise exception 'Choose 1-50 bounded stage decisions' using errcode='22023';end if;
 select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
 if engagement.id is null or not private.n6_project_configuration_authorized(p_organization_id,engagement.project_id,actor) then raise exception 'Current exact-project configuration authority required' using errcode='42501';end if;
 -- Match canonical plan lock order before taking engagement FOR UPDATE.
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||engagement.project_id::text,0));
 select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id for update;
 if engagement.status not in ('planning','active') then raise exception 'Current planning or active engagement required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':stage-review:'||p_request_id::text,0));
 sha:=encode(sha256(convert_to(jsonb_build_object('engagement_id',p_engagement_id,'definition_publication_id',p_definition_publication_id,'pipeline_group_id',p_pipeline_group_id,'decisions',p_stage_decisions,'max_ai_cost_microusd',p_max_ai_cost_microusd)::text,'UTF8')),'hex');
 if p_foundation_context is not null then sha:=encode(sha256(convert_to(jsonb_build_array(sha,p_foundation_context)::text,'UTF8')),'hex');end if;
 select * into existing from public.project_pipeline_stage_reviews where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if existing.reviewed_by<>actor or existing.review_sha256<>sha then raise exception 'Original stage review has a different exact payload' using errcode='23505';end if;
  return jsonb_build_object('configuration_id',existing.configuration_id,'stage_review_id',existing.id,'stage_review_sha256',existing.review_sha256,'idempotent_replay',true);
 end if;
 if exists(select 1 from public.project_pipeline_configurations where organization_id=p_organization_id and request_id=p_request_id) then raise exception 'Historical configuration request cannot adopt a stage review' using errcode='23505';end if;
 v_context:=private.pipeline_foundation_context(p_organization_id,p_engagement_id,p_pipeline_group_id,null,true);
 if v_context is distinct from p_foundation_context then raise exception 'Review the exact current foundation context in this stage review' using errcode='40001';end if;
 select d.* into definition from public.pipeline_execution_definitions d join public.pipeline_execution_publications p on p.definition_id=d.id and p.organization_id=d.organization_id where p.id=p_definition_publication_id and p.organization_id=p_organization_id;
 if definition.id is null or jsonb_array_length(p_stage_decisions)<>jsonb_array_length(definition.steps) or definition.steps_sha256<>encode(sha256(convert_to(definition.steps::text,'UTF8')),'hex') then raise exception 'Exact complete published stage definition required' using errcode='42501';end if;
 -- All referenced immutable versions are locked in deterministic order before their approval rows are read.
 perform 1 from public.artifact_versions version where version.organization_id=p_organization_id and version.id in (
  select (decision->>'artifact_version_id')::uuid from jsonb_array_elements(p_stage_decisions) decision where decision->>'action'='reuse'
  union select (i->>'artifact_version_id')::uuid from jsonb_array_elements(p_stage_decisions) decision cross join lateral jsonb_array_elements(case when jsonb_typeof(decision->'inputs')='array' then decision->'inputs' else '[]'::jsonb end)i where i ? 'artifact_version_id'
 ) order by version.id for share;
 for step in select value from jsonb_array_elements(definition.steps) loop
  item:=p_stage_decisions->cardinality(used);contract:=step->'stage_contract';
  if jsonb_typeof(item) is distinct from 'object' or item->>'key' is distinct from step->>'key' or not coalesce(item->>'action' in ('run','omit','reuse','outside_scope'),false) then raise exception 'Review every stage once in published dependency order' using errcode='22023';end if;
  used:=array_append(used,step->>'key');
  if contract is not null and private.valid_pipeline_stage_contract(contract) is distinct from true then raise exception 'Published stage contract is invalid' using errcode='55000';end if;
  if item->>'action' in ('run','reuse') then chosen_services:=array_append(chosen_services,step->>'service_id');end if;
 end loop;
 used:='{}';
 for step in select value from jsonb_array_elements(definition.steps) loop
  select value into item from jsonb_array_elements(p_stage_decisions) where value->>'key'=step->>'key';contract:=step->'stage_contract';
  if item->>'action'='outside_scope' then
   if item-'key'-'action'<>'{}'::jsonb or (contract is not null and (step->>'service_id')=any(chosen_services)) then raise exception 'A selected service must resolve its declared stages explicitly' using errcode='22023';end if;
   continue;
  elsif item->>'action'='omit' then
   if item-'key'-'action'-'reason'<>'{}'::jsonb or contract->>'optional' is distinct from 'true' or jsonb_typeof(item->'reason') is distinct from 'string' or length(btrim(item->>'reason')) not between 1 and 1000 or item->>'reason'<>btrim(item->>'reason') then raise exception 'Only a declared optional stage may be omitted with an exact reason' using errcode='22023';end if;
   continue;
  end if;
  if exists(select 1 from jsonb_array_elements_text(step->'depends_on') dependency where dependency<>all(used)) then raise exception 'Included stage requires each earlier included or satisfied dependency' using errcode='22023';end if;
  if item->>'action'='reuse' then
   if item-'key'-'action'-'artifact_version_id'<>'{}'::jsonb or step->>'kind'='approval_gate' or contract->>'reuse_allowed' is distinct from 'true' then raise exception 'Exact artifact reuse must be allowed by this published stage' using errcode='22023';end if;
   ref:=private.require_pipeline_approved_artifact(p_organization_id,engagement.project_id,(item->>'artifact_version_id')::uuid,contract->>'artifact_type',contract->>'output_type');
   resolved:=resolved||jsonb_build_array(jsonb_build_object('step_key',step->>'key','input_key',null,'reference',ref));
   selected:=selected||jsonb_build_array(jsonb_build_object('key',step->>'key','quantity',1));
  else
   if item-'key'-'action'-'quantity'-'inputs'<>'{}'::jsonb or jsonb_typeof(item->'quantity') is distinct from 'number' or not coalesce((item->>'quantity')~'^[0-9]{1,2}$',false) or (item->>'quantity')::integer not between 1 and 50 or jsonb_typeof(item->'inputs') is distinct from 'array' then raise exception 'Run requires bounded exact quantity and declared input values' using errcode='22023';end if;
   if jsonb_array_length(item->'inputs')<>coalesce(jsonb_array_length(contract->'required_inputs'),0) then raise exception 'Every declared required input must be reviewed' using errcode='22023';end if;
   input_keys:='{}';
   for requirement in select value from jsonb_array_elements(coalesce(contract->'required_inputs','[]')) loop
    select value into input from jsonb_array_elements(item->'inputs') where value->>'key'=requirement->>'key';
    if input is null or (input->>'key')=any(input_keys) then raise exception 'Exact unique required input missing' using errcode='22023';end if;
    if requirement->>'kind'='manual' then
     if input-'key'-'value'<>'{}'::jsonb or jsonb_typeof(input->'value') is distinct from 'string' or length(btrim(input->>'value')) not between 1 and 1000 then raise exception 'Bounded manual input is required' using errcode='22023';end if;
    else
     if input-'key'-'artifact_version_id'<>'{}'::jsonb then raise exception 'Exact approved input version only is required' using errcode='22023';end if;
     ref:=private.require_pipeline_approved_artifact(p_organization_id,engagement.project_id,(input->>'artifact_version_id')::uuid,requirement->>'artifact_type',requirement->>'output_type');
     if step->>'kind' in ('ai_assisted','automatic') and ref->>'ai_use_allowed' is distinct from 'true' then raise exception 'This exact input version does not permit AI use' using errcode='42501';end if;
     resolved:=resolved||jsonb_build_array(jsonb_build_object('step_key',step->>'key','input_key',requirement->>'key','reference',ref));
    end if;
    input_keys:=array_append(input_keys,input->>'key');
   end loop;
   selected:=selected||jsonb_build_array(jsonb_build_object('key',step->>'key','quantity',(item->>'quantity')::integer));
  end if;
  used:=array_append(used,step->>'key');
 end loop;
 if p_pipeline_group_id is null then created:=public.create_project_pipeline_configuration(p_organization_id,p_engagement_id,p_definition_publication_id,p_request_id,selected,p_max_ai_cost_microusd);
 else created:=public.create_project_pipeline_group_configuration(p_organization_id,p_engagement_id,p_definition_publication_id,p_pipeline_group_id,p_request_id,selected,p_max_ai_cost_microusd);end if;
 if coalesce((created->>'idempotent_replay')::boolean,false) then raise exception 'Unreviewed configuration cannot adopt a new stage receipt' using errcode='23505';end if;
 insert into public.project_pipeline_stage_reviews(organization_id,engagement_id,project_id,configuration_id,request_id,reviewed_by,decisions,resolved_artifacts,review_sha256,foundation_context)
 values(p_organization_id,p_engagement_id,engagement.project_id,(created->>'configuration_id')::uuid,p_request_id,actor,p_stage_decisions,resolved,sha,v_context) returning * into existing;
 return created||jsonb_build_object('stage_review_id',existing.id,'stage_review_sha256',sha);
end;$function$
;
create or replace function public.create_reviewed_project_pipeline_configuration(p_organization_id uuid,p_engagement_id uuid,p_definition_publication_id uuid,p_pipeline_group_id uuid,p_request_id uuid,p_stage_decisions jsonb,p_max_ai_cost_microusd bigint) returns jsonb language plpgsql security definer set search_path='' as $$begin return private.create_foundation_reviewed_configuration(p_organization_id,p_engagement_id,p_definition_publication_id,p_pipeline_group_id,p_request_id,p_stage_decisions,p_max_ai_cost_microusd,null);end;$$;
create or replace function public.create_foundation_reviewed_project_pipeline_configuration(p_organization_id uuid,p_engagement_id uuid,p_definition_publication_id uuid,p_pipeline_group_id uuid,p_request_id uuid,p_stage_decisions jsonb,p_max_ai_cost_microusd bigint,p_foundation_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin return private.create_foundation_reviewed_configuration(p_organization_id,p_engagement_id,p_definition_publication_id,p_pipeline_group_id,p_request_id,p_stage_decisions,p_max_ai_cost_microusd,p_foundation_context);end;$$;
revoke all on function private.create_foundation_reviewed_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_foundation_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_foundation_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION private.current_pipeline_stage_review(p_org uuid, p_configuration uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare configuration public.project_pipeline_configurations;engagement public.engagements;review public.project_pipeline_stage_reviews;item jsonb;ref jsonb;current_ref jsonb;foundation_context jsonb;begin
 select * into configuration from public.project_pipeline_configurations where id=p_configuration and organization_id=p_org;
 if not found then raise exception 'Exact configuration missing' using errcode='55000';end if;
 select * into engagement from public.engagements where id=configuration.engagement_id and organization_id=p_org;
 select * into review from public.project_pipeline_stage_reviews where configuration_id=configuration.id and organization_id=p_org;
 foundation_context:=private.pipeline_foundation_context(p_org,configuration.engagement_id,configuration.pipeline_group_id,(review.foundation_context->>'plan_version_id')::uuid,true);
 if foundation_context is distinct from review.foundation_context then raise exception 'Pinned foundation changed; review a new exact stage configuration' using errcode='55000';end if;
 if review.id is null then
  if exists(select 1 from public.pipeline_execution_publications p join public.pipeline_execution_definitions d on d.id=p.definition_id and d.organization_id=p.organization_id cross join lateral jsonb_array_elements(d.steps)step where p.id=configuration.definition_publication_id and p.organization_id=p_org and step ? 'stage_contract') then raise exception 'Declared stages require their exact immutable reviewed configuration' using errcode='55000';end if;
  return null;
 end if;
 if review.engagement_id<>engagement.id or review.project_id<>engagement.project_id or review.reviewed_by<>configuration.configured_by or review.request_id<>configuration.request_id then raise exception 'Stage review lineage changed' using errcode='55000';end if;
 perform 1 from public.artifact_versions version where version.organization_id=p_org and version.id in(select (value->'reference'->>'artifact_version_id')::uuid from jsonb_array_elements(review.resolved_artifacts)) order by version.id for share;
 for item in select value from jsonb_array_elements(review.resolved_artifacts) loop
  ref:=item->'reference';current_ref:=private.require_pipeline_approved_artifact(p_org,engagement.project_id,(ref->>'artifact_version_id')::uuid,ref->>'artifact_type',ref->>'output_type');
  if current_ref is distinct from ref then raise exception 'Exact stage source approval changed; review a new configuration' using errcode='55000';end if;
 end loop;
 return jsonb_build_object('id',review.id,'review_sha256',review.review_sha256,'decisions',review.decisions,'resolved_artifacts',review.resolved_artifacts)||case when foundation_context is null then '{}'::jsonb else jsonb_build_object('foundation_context',foundation_context) end;
end;$function$
;

create function public.get_project_pipeline_foundation_context(p_organization_id uuid,p_engagement_id uuid,p_pipeline_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.engagements;context jsonb;legacy_unbound boolean:=false;begin
 if auth.uid() is null then raise exception 'Authenticated project context required' using errcode='42501';end if;
 select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
 if e.id is null then raise exception 'Exact project engagement required' using errcode='42501';end if;
 perform private.n2_scope_require_member(p_organization_id,e.project_id,false);
 begin context:=private.pipeline_foundation_context(p_organization_id,p_engagement_id,p_pipeline_group_id,null,true);
 exception when sqlstate '55000' then return jsonb_build_object('organization_id',p_organization_id,'project_id',e.project_id,'engagement_id',e.id,'pipeline_group_id',p_pipeline_group_id,'foundation_context',null,'blockers',jsonb_build_array(jsonb_build_object('code','foundation_review_required','reason',SQLERRM)),'ready_for_preparation',false,'ready_for_traffic',false);end;
 legacy_unbound:=context is null and exists(select 1 from public.project_pipeline_groups where id=p_pipeline_group_id and organization_id=p_organization_id and engagement_id=e.id and project_id=e.project_id and kind in ('website','marketing'));
 return jsonb_build_object('organization_id',p_organization_id,'project_id',e.project_id,'engagement_id',e.id,'pipeline_group_id',p_pipeline_group_id,'foundation_context',context,'blockers','[]'::jsonb,'state',case when legacy_unbound then 'legacy_unbound' when context is null then 'not_required_for_this_pipeline' else 'available_for_stage_review' end,'legacy_configuration_allowed',legacy_unbound,'warnings',case when legacy_unbound then jsonb_build_array(jsonb_build_object('code','legacy_without_foundation','reason','Existing legacy configuration rules apply; foundation readiness has not been reviewed')) else '[]'::jsonb end,'ready_for_preparation',false,'ready_for_traffic',false);
end;$$;
revoke all on function public.get_project_pipeline_foundation_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_pipeline_foundation_context(uuid,uuid,uuid) to authenticated;

commit;
