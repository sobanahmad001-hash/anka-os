-- W05: exact reviewed stage inputs/omissions/reuse on canonical immutable configurations.
-- Preserves published definitions, Tasks/Work Items and historical configurations/jobs.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$declare signature text;checksum text;begin
 if md5(replace(pg_get_functiondef(to_regprocedure('public.create_project_pipeline_configuration(uuid,uuid,uuid,uuid,jsonb,bigint)')),chr(13),'')) is distinct from '7f5cd13ff9c2516a3d781c4da4836a57' then raise exception 'Stage fulfilment prerequisite differs: public.create_project_pipeline_configuration(uuid,uuid,uuid,uuid,jsonb,bigint)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.create_project_pipeline_group_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint)')),chr(13),'')) is distinct from 'b142918a8fad3abb5b948f191479b47f' then raise exception 'Stage fulfilment prerequisite differs: public.create_project_pipeline_group_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_pin_current_project_activation()')),chr(13),'')) is distinct from 'eb327b92b197667bd00fb184101d51ef' then raise exception 'Stage fulfilment prerequisite differs: private.n6_pin_current_project_activation()' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_project_pipeline_impact(uuid)')),chr(13),'')) is distinct from '2603864ade037c5d3ab57bf3a4e41e02' then raise exception 'Stage fulfilment prerequisite differs: private.n6_project_pipeline_impact(uuid)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_materialize_configured_steps(uuid)')),chr(13),'')) is distinct from '1e99c9d11ed79a457e761a206a7b3e44' then raise exception 'Stage fulfilment prerequisite differs: private.n6_materialize_configured_steps(uuid)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_initialize_step_progress()')),chr(13),'')) is distinct from '2dc194d3fbc9117492466264e80f1c30' then raise exception 'Stage fulfilment prerequisite differs: private.n6_initialize_step_progress()' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_reserve_step_budget(uuid,uuid,uuid,uuid,bigint)')),chr(13),'')) is distinct from 'ddcf113e9243ed9877f5f95f5fc0fd4f' then raise exception 'Stage fulfilment prerequisite differs: private.n6_reserve_step_budget(uuid,uuid,uuid,uuid,bigint)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.preflight_pipeline_ai_job(uuid,uuid,uuid)')),chr(13),'')) is distinct from 'bedceef5a378c976934624094ebf4755' then raise exception 'Stage fulfilment prerequisite differs: public.preflight_pipeline_ai_job(uuid,uuid,uuid)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.advance_pipeline_manual_step(uuid,uuid,uuid,uuid,bigint,text,text)')),chr(13),'')) is distinct from 'ea9ef248ba7f7ecc25f976107a7da3fd' then raise exception 'Stage fulfilment prerequisite differs: public.advance_pipeline_manual_step(uuid,uuid,uuid,uuid,bigint,text,text)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.start_project_pipeline_group_run(uuid,uuid,uuid,uuid,uuid[])')),chr(13),'')) is distinct from '6055b1666c74979b59757418446ad8ca' then raise exception 'Stage fulfilment prerequisite differs: public.start_project_pipeline_group_run(uuid,uuid,uuid,uuid,uuid[])' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.start_pipeline_run_intent(uuid,uuid,uuid,uuid[])')),chr(13),'')) is distinct from '16a3bbdd9e73cfdcdbdbb2dc26870cae' then raise exception 'Stage fulfilment prerequisite differs: public.start_pipeline_run_intent(uuid,uuid,uuid,uuid[])' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.guard_pending_multi_approval()')),chr(13),'')) is distinct from 'beb08d176eb19bf0f1c81c0e971a1ab5' then raise exception 'Stage fulfilment prerequisite differs: private.guard_pending_multi_approval()' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.create_artifact_approval_request(uuid,text,uuid[],uuid)')),chr(13),'')) is distinct from 'ef85b5342ed8bb98b5a9111ed32f6ea6' then raise exception 'Stage fulfilment prerequisite differs: public.create_artifact_approval_request(uuid,text,uuid[],uuid)' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.validate_artifact_approval_request_update()')),chr(13),'')) is distinct from '206a36b8ff3bf2157aba3d6809dc4b77' then raise exception 'Installed governed terminal-state guard differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.valid_pipeline_stage_contract(jsonb)')),chr(13),'')) is distinct from 'a7c6bcbf01252ac61af4d9d70d8bcb4e' then raise exception 'Exact published stage contract migration is required first' using errcode='55000';end if;
end;$$;
create table public.project_pipeline_stage_reviews(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,engagement_id uuid not null,project_id uuid not null,
 configuration_id uuid not null unique,request_id uuid not null,reviewed_by uuid not null references auth.users(id) on delete restrict,
 decisions jsonb not null check(jsonb_typeof(decisions)='array' and jsonb_array_length(decisions) between 1 and 50 and octet_length(decisions::text)<=32768),
 resolved_artifacts jsonb not null check(jsonb_typeof(resolved_artifacts)='array' and octet_length(resolved_artifacts::text)<=32768),
 review_sha256 text not null check(review_sha256~'^[0-9a-f]{64}$'),reviewed_at timestamptz not null default clock_timestamp(),
 unique(organization_id,request_id),unique(id,organization_id),
 foreign key(configuration_id,engagement_id,organization_id) references public.project_pipeline_configurations(id,engagement_id,organization_id) on delete restrict,
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id) on delete restrict
);
alter table public.project_pipeline_stage_reviews enable row level security;
revoke all on public.project_pipeline_stage_reviews from public,anon,authenticated,service_role;
grant select on public.project_pipeline_stage_reviews to authenticated,service_role;
create policy "Current team reads reviewed pipeline stage references" on public.project_pipeline_stage_reviews for select to authenticated using(private.is_active_pipeline_team_member(organization_id));
create trigger protect_pipeline_stage_review before update or delete on public.project_pipeline_stage_reviews for each row execute function private.reject_pipeline_template_mutation();
create trigger living_document_supplemental_source after insert on public.project_pipeline_stage_reviews for each row execute function private.invalidate_living_project_supplemental_source();
create function private.require_pipeline_approved_artifact(p_org uuid,p_project uuid,p_version uuid,p_artifact_type text,p_output_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare version public.artifact_versions;artifact public.artifacts;approval public.artifact_approvals;governed public.artifact_approval_requests;begin
 select * into version from public.artifact_versions where id=p_version and organization_id=p_org for share;
 select * into artifact from public.artifacts where id=version.artifact_id and organization_id=p_org for share;
 if version.id is null or artifact.id is null or artifact.project_id is distinct from p_project or artifact.artifact_type is distinct from p_artifact_type
  or version.content->>'output_type' is distinct from p_output_type or version.content_checksum is null then raise exception 'Exact same-project compatible canonical artifact version required' using errcode='42501';end if;
 -- Existing approval and multi-approval creation paths lock this same immutable version FOR UPDATE.
 select * into governed from public.artifact_approval_requests where organization_id=p_org and artifact_version_id=version.id order by created_at desc,id desc limit 1;
 if governed.id is not null and governed.status<>'completed' then raise exception 'Exact artifact version has unresolved governed approval or requested changes' using errcode='55000';end if;
 select * into approval from public.artifact_approvals where organization_id=p_org and artifact_version_id=version.id order by approved_at desc,id desc limit 1;
 if approval.id is null or approval.decision<>'approved' or approval.artifact_id<>artifact.id or approval.engagement_id<>artifact.engagement_id then raise exception 'Current exact artifact approval required' using errcode='42501';end if;
 return jsonb_build_object('artifact_id',artifact.id,'artifact_version_id',version.id,'version_number',version.version_number,'content_checksum',version.content_checksum,'ai_use_allowed',version.ai_use_allowed,'approval_id',approval.id,'approval_request_id',governed.id,'approved_at',approval.approved_at,'artifact_type',artifact.artifact_type,'output_type',p_output_type);
end;$$;
revoke all on function private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function public.create_reviewed_project_pipeline_configuration(p_organization_id uuid,p_engagement_id uuid,p_definition_publication_id uuid,p_pipeline_group_id uuid,p_request_id uuid,p_stage_decisions jsonb,p_max_ai_cost_microusd bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());engagement public.engagements;definition public.pipeline_execution_definitions;existing public.project_pipeline_stage_reviews;
 item jsonb;step jsonb;contract jsonb;input jsonb;requirement jsonb;resolved jsonb:='[]';selected jsonb:='[]';sha text;created jsonb;used text[]:='{}';chosen_services text[]:='{}';input_keys text[];ref jsonb;begin
 if actor is null or p_request_id is null or jsonb_typeof(p_stage_decisions) is distinct from 'array' then raise exception 'Exact authenticated stage review required' using errcode='22023';end if;
 if jsonb_array_length(p_stage_decisions) not between 1 and 50 or octet_length(p_stage_decisions::text)>32768 then raise exception 'Choose 1-50 bounded stage decisions' using errcode='22023';end if;
 select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
 if engagement.id is null or not private.n6_project_configuration_authorized(p_organization_id,engagement.project_id,actor) then raise exception 'Current exact-project configuration authority required' using errcode='42501';end if;
 select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id for update;
 if engagement.status not in ('planning','active') then raise exception 'Current planning or active engagement required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':stage-review:'||p_request_id::text,0));
 sha:=encode(sha256(convert_to(jsonb_build_object('engagement_id',p_engagement_id,'definition_publication_id',p_definition_publication_id,'pipeline_group_id',p_pipeline_group_id,'decisions',p_stage_decisions,'max_ai_cost_microusd',p_max_ai_cost_microusd)::text,'UTF8')),'hex');
 select * into existing from public.project_pipeline_stage_reviews where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if existing.reviewed_by<>actor or existing.review_sha256<>sha then raise exception 'Original stage review has a different exact payload' using errcode='23505';end if;
  return jsonb_build_object('configuration_id',existing.configuration_id,'stage_review_id',existing.id,'stage_review_sha256',existing.review_sha256,'idempotent_replay',true);
 end if;
 if exists(select 1 from public.project_pipeline_configurations where organization_id=p_organization_id and request_id=p_request_id) then raise exception 'Historical configuration request cannot adopt a stage review' using errcode='23505';end if;
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
 insert into public.project_pipeline_stage_reviews(organization_id,engagement_id,project_id,configuration_id,request_id,reviewed_by,decisions,resolved_artifacts,review_sha256)
 values(p_organization_id,p_engagement_id,engagement.project_id,(created->>'configuration_id')::uuid,p_request_id,actor,p_stage_decisions,resolved,sha) returning * into existing;
 return created||jsonb_build_object('stage_review_id',existing.id,'stage_review_sha256',sha);
end;$$;
revoke all on function public.create_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.create_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint) to authenticated;
create function private.current_pipeline_stage_review(p_org uuid,p_configuration uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare configuration public.project_pipeline_configurations;engagement public.engagements;review public.project_pipeline_stage_reviews;item jsonb;ref jsonb;current_ref jsonb;begin
 select * into configuration from public.project_pipeline_configurations where id=p_configuration and organization_id=p_org;
 if not found then raise exception 'Exact configuration missing' using errcode='55000';end if;
 select * into engagement from public.engagements where id=configuration.engagement_id and organization_id=p_org;
 select * into review from public.project_pipeline_stage_reviews where configuration_id=configuration.id and organization_id=p_org;
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
 return jsonb_build_object('id',review.id,'review_sha256',review.review_sha256,'decisions',review.decisions,'resolved_artifacts',review.resolved_artifacts);
end;$$;
revoke all on function private.current_pipeline_stage_review(uuid,uuid) from public,anon,authenticated,service_role;

alter table public.ai_execution_configured_steps add column reused_artifact_version_id uuid,add column reuse_approval_id uuid,
 add constraint configured_step_exact_reuse_pair check((reused_artifact_version_id is null)=(reuse_approval_id is null)),
 add constraint configured_step_exact_reuse_version foreign key(reused_artifact_version_id,organization_id) references public.artifact_versions(id,organization_id) on delete restrict,
 add constraint configured_step_exact_reuse_approval foreign key(reuse_approval_id,organization_id) references public.artifact_approvals(id,organization_id) on delete restrict;

CREATE OR REPLACE FUNCTION private.n6_pin_current_project_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pinned_activation uuid;
  pinned_sha text;
  configuration_id uuid;stage_review jsonb;
begin
  if new.project_activation_id is not null or new.selected_steps_sha256 is not null then
    raise exception 'Project activation is pinned by the server.' using errcode = '42501';
  end if;
  select activation.id, configuration.selected_steps_sha256,configuration.id
    into pinned_activation, pinned_sha,configuration_id
    from public.project_pipeline_activations activation
    join public.project_pipeline_configurations configuration
      on configuration.id = activation.configuration_id
     and configuration.engagement_id = activation.engagement_id
     and configuration.organization_id = activation.organization_id
    where activation.organization_id = new.organization_id
      and activation.engagement_id = new.engagement_id
      and activation.pipeline_group_id is not distinct from new.pipeline_group_id
    order by activation.activation_number desc
    limit 1;
  if new.pipeline_group_id is not null and pinned_activation is null then raise exception 'Explicit group requires a current reviewed activation' using errcode='42501'; end if;
  if pinned_activation is not null then
    new.project_activation_id := pinned_activation;
    new.selected_steps_sha256 := pinned_sha;
    if new.input_manifest ? 'stage_review' then raise exception 'Stage review is pinned by the server' using errcode='42501';end if;
    stage_review:=private.current_pipeline_stage_review(new.organization_id,configuration_id);
    if stage_review is not null then new.input_manifest:=new.input_manifest||jsonb_build_object('stage_review',stage_review);if octet_length(new.input_manifest::text)>32768 then raise exception 'Reviewed pinned inputs exceed the existing 32 KiB limit' using errcode='22023';end if;new.input_sha256:=encode(sha256(convert_to(new.input_manifest::text,'UTF8')),'hex');end if;
  end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.start_project_pipeline_group_run(p_organization_id uuid, p_engagement_id uuid, p_request_id uuid, p_pipeline_group_id uuid, p_asset_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  publication public.pipeline_template_publications;
  existing public.pipeline_run_intents;
  request_sha text;
  manifest jsonb;
  input_sha text;
  assets jsonb;
  services jsonb;
  new_id uuid; pipeline_group public.project_pipeline_groups; activation public.project_pipeline_activations; configuration public.project_pipeline_configurations; execution_definition public.pipeline_execution_definitions;
begin
  select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
  perform 1 from public.projects p where p.id=engagement.project_id and p.organization_id=p_organization_id and p.archived_at is null for share;
  if not found then raise exception 'Current active project required' using errcode='42501'; end if;
  perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_organization_id and o.status='active' and m.user_id=actor and m.member_kind='team' and m.status='active' and m.role in ('system_owner','operations_admin') for share of o,m;
  if not found then raise exception 'Current owner or operations authority required' using errcode='42501'; end if;
  if actor is null or p_organization_id is null or p_engagement_id is null or p_request_id is null
    or not private.has_active_pipeline_template_role(p_organization_id, array['system_owner', 'operations_admin']) then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_asset_ids), 0) > 20 or array_position(p_asset_ids, null) is not null
    or (select count(distinct id) from unnest(p_asset_ids) id) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'Choose at most 20 unique assets.' using errcode = '22023';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id,'pipeline_group_id',p_pipeline_group_id, 'asset_ids', to_jsonb(p_asset_ids)
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_id::text, 0));
  select * into existing from public.pipeline_run_intents
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.requested_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request id belongs to another run intent.' using errcode = '23505';
    end if;
    return jsonb_build_object('run_intent_id', existing.id, 'status', existing.status,
      'input_sha256', existing.input_sha256, 'idempotent_replay', true);
  end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for share;
  if not found or engagement.status not in ('planning', 'active') then
    raise exception 'An active or planning engagement is required.' using errcode = '42501';
  end if;
  select * into pipeline_group from public.project_pipeline_groups where id=p_pipeline_group_id and organization_id=p_organization_id and engagement_id=p_engagement_id and project_id=engagement.project_id;
  if not found then raise exception 'Exact pipeline group required' using errcode='42501'; end if;
  select * into publication from public.pipeline_template_publications where id=pipeline_group.preset_publication_id and organization_id=p_organization_id;
  select * into activation from public.project_pipeline_activations where pipeline_group_id=pipeline_group.id and organization_id=p_organization_id order by group_activation_number desc limit 1;
  select * into configuration from public.project_pipeline_configurations where id=activation.configuration_id and pipeline_group_id=pipeline_group.id and organization_id=p_organization_id;
  select d.* into execution_definition from public.pipeline_execution_definitions d join public.pipeline_execution_publications p on p.definition_id=d.id and p.organization_id=d.organization_id where p.id=configuration.definition_publication_id and p.organization_id=p_organization_id;
  if publication.id is null or configuration.id is null or execution_definition.id is null or execution_definition.preset_publication_id<>publication.id then raise exception 'Exact current reviewed group configuration required' using errcode='42501'; end if;
  origin.pipeline_template_id:=publication.pipeline_template_id; origin.pipeline_template_version_id:=publication.pipeline_template_version_id;
  origin.final_selection_sha256:=configuration.selected_steps_sha256; origin.preview_rule_sha256:=publication.published_rule_sha256;
  perform 1 from public.engagement_assets asset join unnest(p_asset_ids) chosen(id) on chosen.id = asset.id where asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id for share of asset;
  perform 1 from public.engagement_services item where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id for share;
  select coalesce(jsonb_agg(jsonb_build_object('id', asset.id, 'kind', asset.asset_kind,
    'name', asset.name, 'source_url', asset.source_url, 'notes', asset.notes,
    'created_at', asset.created_at) order by chosen.position), '[]'::jsonb)
    into assets
  from unnest(p_asset_ids) with ordinality chosen(id, position)
  join public.engagement_assets asset on asset.id = chosen.id
    and asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id;
  if jsonb_array_length(assets) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'An asset is unavailable in this engagement.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', item.id, 'service_id', item.service_id,
    'status', item.status, 'owner_id', item.owner_id) order by item.service_id), '[]'::jsonb)
    into services from public.engagement_services item
    where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id
      and item.status in ('planned', 'active')
      and exists(select 1 from jsonb_array_elements(configuration.selected_steps) selected(value) join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'key'=selected.value->>'key' where (step.value->>'service_id')::uuid=item.service_id);
  if exists(select 1 from jsonb_array_elements(configuration.selected_steps) selected(value)
      join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'key'=selected.value->>'key'
      left join public.engagement_services es on es.organization_id=p_organization_id and es.engagement_id=engagement.id and es.service_id=(step.value->>'service_id')::uuid and es.status in ('planned','active')
      where es.id is null) then raise exception 'Every selected pipeline service must remain current' using errcode='42501'; end if;
  perform 1 from public.service_catalog sc join jsonb_array_elements(execution_definition.steps) step(value) on (step.value->>'service_id')::uuid=sc.id
    join jsonb_array_elements(configuration.selected_steps) selected(value) on selected.value->>'key'=step.value->>'key' where sc.is_active for share of sc;
  if exists(select 1 from jsonb_array_elements(configuration.selected_steps) selected(value) join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'key'=selected.value->>'key'
      left join public.service_catalog sc on sc.id=(step.value->>'service_id')::uuid and sc.is_active
      left join public.project_department_participation pd on pd.project_id=engagement.project_id and pd.organization_id=p_organization_id and pd.department_id=step.value->>'department_id' and pd.status='active'
      where sc.id is null or pd.project_id is null) then raise exception 'Selected service catalogue and project departments must remain current' using errcode='42501'; end if;
  perform 1 from public.project_department_participation pd join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'department_id'=pd.department_id
    join jsonb_array_elements(configuration.selected_steps) selected(value) on selected.value->>'key'=step.value->>'key' where pd.project_id=engagement.project_id and pd.organization_id=p_organization_id and pd.status='active' for share of pd;
  if jsonb_array_length(services) = 0 then
    raise exception 'No active or planned services remain.' using errcode = '22023';
  end if;
  manifest := jsonb_build_object(
    'engagement', jsonb_build_object('id', engagement.id, 'client_id', engagement.client_id,
      'brand_id', engagement.brand_id, 'name', engagement.name,
      'objective', engagement.objective, 'status', engagement.status),
    'pipeline', jsonb_build_object('version_id', origin.pipeline_template_version_id,
      'selection_sha256', origin.final_selection_sha256,
      'preview_rule_sha256', origin.preview_rule_sha256,
      'publication_id', publication.id, 'rule_sha256', publication.published_rule_sha256),
    'services', services, 'assets', assets,'pipeline_group_id',pipeline_group.id);
  if pg_catalog.octet_length(manifest::text) > 32768 then
    raise exception 'Pinned inputs exceed the 32 KiB limit.' using errcode = '22023';
  end if;
  input_sha := encode(extensions.digest(convert_to(manifest::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_run_intents(organization_id, engagement_id, pipeline_template_id,
    pipeline_template_version_id, publication_id, request_id, request_sha256,
    input_manifest, input_sha256, requested_by,pipeline_group_id)
  values(p_organization_id, p_engagement_id, origin.pipeline_template_id,
    origin.pipeline_template_version_id, publication.id, p_request_id, request_sha,
    manifest, input_sha, actor,pipeline_group.id) returning id,input_sha256 into new_id,input_sha;
  return jsonb_build_object('run_intent_id', new_id, 'status', 'awaiting_review',
    'input_sha256', input_sha, 'idempotent_replay', false);
end;
$function$;


CREATE OR REPLACE FUNCTION public.start_pipeline_run_intent(p_organization_id uuid, p_engagement_id uuid, p_request_id uuid, p_asset_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  publication public.pipeline_template_publications;
  existing public.pipeline_run_intents;
  request_sha text;
  manifest jsonb;
  input_sha text;
  assets jsonb;
  services jsonb;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_engagement_id is null or p_request_id is null
    or not private.has_active_pipeline_template_role(p_organization_id, array['system_owner', 'operations_admin']) then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_asset_ids), 0) > 20 or array_position(p_asset_ids, null) is not null
    or (select count(distinct id) from unnest(p_asset_ids) id) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'Choose at most 20 unique assets.' using errcode = '22023';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id, 'asset_ids', to_jsonb(p_asset_ids)
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_id::text, 0));
  select * into existing from public.pipeline_run_intents
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.requested_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request id belongs to another run intent.' using errcode = '23505';
    end if;
    return jsonb_build_object('run_intent_id', existing.id, 'status', existing.status,
      'input_sha256', existing.input_sha256, 'idempotent_replay', true);
  end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for share;
  if not found or engagement.status not in ('planning', 'active') then
    raise exception 'An active or planning engagement is required.' using errcode = '42501';
  end if;
  select * into origin from public.engagement_pipeline_origins
    where engagement_id = p_engagement_id and organization_id = p_organization_id;
  if not found then
    raise exception 'This engagement has no published pipeline origin.' using errcode = '22023';
  end if;
  select * into publication from public.pipeline_template_publications
    where pipeline_template_version_id = origin.pipeline_template_version_id
      and pipeline_template_id = origin.pipeline_template_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Published pipeline version is unavailable.' using errcode = '42501';
  end if;
  perform 1 from public.engagement_assets asset join unnest(p_asset_ids) chosen(id) on chosen.id = asset.id where asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id for share of asset;
  perform 1 from public.engagement_services item where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id for share;
  select coalesce(jsonb_agg(jsonb_build_object('id', asset.id, 'kind', asset.asset_kind,
    'name', asset.name, 'source_url', asset.source_url, 'notes', asset.notes,
    'created_at', asset.created_at) order by chosen.position), '[]'::jsonb)
    into assets
  from unnest(p_asset_ids) with ordinality chosen(id, position)
  join public.engagement_assets asset on asset.id = chosen.id
    and asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id;
  if jsonb_array_length(assets) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'An asset is unavailable in this engagement.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', item.id, 'service_id', item.service_id,
    'status', item.status, 'owner_id', item.owner_id) order by item.service_id), '[]'::jsonb)
    into services from public.engagement_services item
    where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id
      and item.status in ('planned', 'active');
  if jsonb_array_length(services) = 0 then
    raise exception 'No active or planned services remain.' using errcode = '22023';
  end if;
  manifest := jsonb_build_object(
    'engagement', jsonb_build_object('id', engagement.id, 'client_id', engagement.client_id,
      'brand_id', engagement.brand_id, 'name', engagement.name,
      'objective', engagement.objective, 'status', engagement.status),
    'pipeline', jsonb_build_object('version_id', origin.pipeline_template_version_id,
      'selection_sha256', origin.final_selection_sha256,
      'preview_rule_sha256', origin.preview_rule_sha256,
      'publication_id', publication.id, 'rule_sha256', publication.published_rule_sha256),
    'services', services, 'assets', assets);
  if pg_catalog.octet_length(manifest::text) > 32768 then
    raise exception 'Pinned inputs exceed the 32 KiB limit.' using errcode = '22023';
  end if;
  input_sha := encode(extensions.digest(convert_to(manifest::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_run_intents(organization_id, engagement_id, pipeline_template_id,
    pipeline_template_version_id, publication_id, request_id, request_sha256,
    input_manifest, input_sha256, requested_by)
  values(p_organization_id, p_engagement_id, origin.pipeline_template_id,
    origin.pipeline_template_version_id, publication.id, p_request_id, request_sha,
    manifest, input_sha, actor) returning id,input_sha256 into new_id,input_sha;
  return jsonb_build_object('run_intent_id', new_id, 'status', 'awaiting_review',
    'input_sha256', input_sha, 'idempotent_replay', false);
end;
$function$;

CREATE OR REPLACE FUNCTION private.n6_project_pipeline_impact(p_configuration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  configuration public.project_pipeline_configurations;
  current_activation public.project_pipeline_activations;
  previous public.project_pipeline_configurations;
  new_keys jsonb;
  removed_keys jsonb;
  existing_jobs integer;
  job_ids text;
  token text;stage_review jsonb;
begin
  select * into configuration from public.project_pipeline_configurations
    where id = p_configuration_id;
  if not found then raise exception 'Configuration is unavailable.' using errcode = 'P0002'; end if;
  stage_review:=private.current_pipeline_stage_review(configuration.organization_id,configuration.id);
  select * into current_activation from public.project_pipeline_activations
    where engagement_id = configuration.engagement_id
      and organization_id = configuration.organization_id
      and pipeline_group_id is not distinct from configuration.pipeline_group_id
    order by activation_number desc limit 1;
  if current_activation.id is not null then
    select * into previous from public.project_pipeline_configurations
      where id = current_activation.configuration_id
        and organization_id = configuration.organization_id;
  end if;
  select coalesce(jsonb_agg(selected.value ->> 'key' order by selected.position), '[]'::jsonb)
    into new_keys
    from jsonb_array_elements(configuration.selected_steps)
      with ordinality selected(value, position)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(previous.selected_steps, '[]'::jsonb)) old(value)
      where old.value ->> 'key' = selected.value ->> 'key'
    );
  select coalesce(jsonb_agg(old.value ->> 'key' order by old.position), '[]'::jsonb)
    into removed_keys
    from jsonb_array_elements(coalesce(previous.selected_steps, '[]'::jsonb))
      with ordinality old(value, position)
    where not exists (
      select 1 from jsonb_array_elements(configuration.selected_steps) selected(value)
      where selected.value ->> 'key' = old.value ->> 'key'
    );
  select count(*), coalesce(string_agg(job.id::text, ',' order by job.id), '')
    into existing_jobs, job_ids
    from public.pipeline_run_intents intent
    join public.ai_execution_jobs job
      on job.run_intent_id = intent.id and job.organization_id = intent.organization_id
    where intent.engagement_id = configuration.engagement_id
      and intent.organization_id = configuration.organization_id
      and intent.pipeline_group_id is not distinct from configuration.pipeline_group_id;
  token := encode(extensions.digest(convert_to((jsonb_build_object(
    'configuration_id', configuration.id,'pipeline_group_id',configuration.pipeline_group_id,
    'selected_steps_sha256', configuration.selected_steps_sha256,
    'previous_activation_id', current_activation.id,
    'previous_configuration_id', previous.id,
    'existing_job_ids', job_ids
  )||case when stage_review is null then '{}'::jsonb else jsonb_build_object('stage_review_sha256',stage_review->>'review_sha256') end)::text, 'UTF8'), 'sha256'), 'hex');
  return jsonb_build_object(
    'configuration_id', configuration.id,'pipeline_group_id',configuration.pipeline_group_id,
    'previous_activation_id', current_activation.id,
    'previous_configuration_id', previous.id,
    'added_step_keys', new_keys,
    'removed_step_keys', removed_keys,
    'previous_selected_steps', coalesce(previous.selected_steps, '[]'::jsonb),
    'new_selected_steps', configuration.selected_steps,
    'previous_max_ai_cost_microusd', previous.max_ai_cost_microusd,
    'existing_jobs_preserved', existing_jobs,
    'new_step_count', jsonb_array_length(configuration.selected_steps),
    'new_max_ai_cost_microusd', configuration.max_ai_cost_microusd,
    'impact_token_sha256', token
  )||case when stage_review is null then '{}'::jsonb else jsonb_build_object('stage_review',stage_review) end;
end;
$function$;


CREATE OR REPLACE FUNCTION private.n6_materialize_configured_steps(p_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  definition public.pipeline_execution_definitions;
  selected jsonb;
  source_step jsonb;
  quantity integer;
  instance_index integer;
  ordinal_index integer := 0;
  persisted_count integer;
  step_manifest jsonb;stage_review jsonb;reuse_ref jsonb;
begin
  select * into job from public.ai_execution_jobs where id = p_job_id;
  if not found then raise exception 'Execution job is unavailable.' using errcode = 'P0002'; end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = job.organization_id;
  if not found then raise exception 'Pinned run intent is unavailable.' using errcode = '55000'; end if;
  if intent.project_activation_id is null then return 0; end if;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id
      and organization_id = job.organization_id
      and engagement_id = intent.engagement_id;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id
      and organization_id = job.organization_id
      and engagement_id = intent.engagement_id;
  select source_definition.* into definition
    from public.pipeline_execution_publications publication
    join public.pipeline_execution_definitions source_definition
      on source_definition.id = publication.definition_id
     and source_definition.organization_id = publication.organization_id
    where publication.id = configuration.definition_publication_id
      and publication.organization_id = job.organization_id;
  if activation.id is null or configuration.id is null or definition.id is null
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256 then
    raise exception 'Configured execution lineage or integrity has changed.' using errcode = '55000';
  end if;
  stage_review:=private.current_pipeline_stage_review(job.organization_id,configuration.id);
  if intent.input_manifest->'stage_review' is distinct from stage_review then raise exception 'Exact reviewed stage source snapshot missing or changed' using errcode='55000';end if;
  for selected in select value from jsonb_array_elements(configuration.selected_steps)
  loop
    select value into source_step from jsonb_array_elements(definition.steps)
      where value ->> 'key' = selected ->> 'key';
    if not found then
      raise exception 'Configured step is absent from its published definition.' using errcode = '55000';
    end if;
    select value->'reference' into reuse_ref from jsonb_array_elements(coalesce(stage_review->'resolved_artifacts','[]')) where value->>'step_key'=selected->>'key' and value->'input_key'='null'::jsonb;
    quantity := (selected ->> 'quantity')::integer;
    if quantity not between 1 and 50 then
      raise exception 'Configured quantity is invalid.' using errcode = '55000';
    end if;
    for instance_index in 1..quantity loop
      ordinal_index := ordinal_index + 1;
      if ordinal_index > 50 then
        raise exception 'Configured step count exceeds 50.' using errcode = '55000';
      end if;
      step_manifest := jsonb_build_object(
        'job_input_sha256', job.input_sha256,
        'project_activation_id', activation.id,
        'selected_steps_sha256', intent.selected_steps_sha256,
        'definition_step', source_step,
        'instance_number', instance_index,
        'ordinal', ordinal_index
      )||case when stage_review is null then '{}'::jsonb else jsonb_build_object('stage_review_sha256',stage_review->>'review_sha256','reused_artifact',reuse_ref) end;
      insert into public.ai_execution_configured_steps(
        organization_id, job_id, project_activation_id, ordinal,
        step_key, instance_number, definition_step, input_sha256,reused_artifact_version_id,reuse_approval_id
      ) values (
        job.organization_id, job.id, activation.id, ordinal_index,
        selected ->> 'key', instance_index, source_step,
        encode(extensions.digest(convert_to(step_manifest::text, 'UTF8'), 'sha256'), 'hex'),(reuse_ref->>'artifact_version_id')::uuid,(reuse_ref->>'approval_id')::uuid
      )
      on conflict (job_id, step_key, instance_number) do nothing;
    end loop;
  end loop;
  select count(*) into persisted_count from public.ai_execution_configured_steps
    where job_id = job.id and organization_id = job.organization_id
      and project_activation_id = activation.id;
  if persisted_count <> ordinal_index then
    raise exception 'Configured step materialization is incomplete.' using errcode = '55000';
  end if;
  return persisted_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.n6_initialize_step_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.ai_execution_step_progress(configured_step_id,organization_id,job_id,status,completed_by,completed_at)
    values(new.id,new.organization_id,new.job_id,case when new.reused_artifact_version_id is null then 'waiting' else 'completed' end,
      case when new.reused_artifact_version_id is not null then (select requested_by from public.ai_execution_jobs where id=new.job_id and organization_id=new.organization_id) end,
      case when new.reused_artifact_version_id is not null then clock_timestamp() end);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.n6_reserve_step_budget(p_organization_id uuid, p_job_id uuid, p_step_id uuid, p_actor_id uuid, p_max_cost_microusd bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  budget private.ai_execution_budget_limits;
  job public.ai_execution_jobs;
  step public.ai_execution_configured_steps;
  intent public.pipeline_run_intents;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  existing private.ai_execution_step_budget_reservations;
  preflight jsonb;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  local_total numeric;
  organization_total numeric;
  unlinked_total numeric;
  unknown_completed bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_step_id is null
    or p_actor_id is null or p_max_cost_microusd is null
    or p_max_cost_microusd <= 0 then
    raise exception 'A scoped positive step maximum is required.' using errcode = '22023';
  end if;
  if exists(select 1 from public.ai_execution_configured_steps where id=p_step_id and job_id=p_job_id and organization_id=p_organization_id and reused_artifact_version_id is not null) then raise exception 'This stage is satisfied by its exact approved artifact; regeneration is not permitted' using errcode='42501';end if;
  -- The same organization row serializes legacy and step-level reservations.
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Positive organization budget is not configured.' using errcode = '42501';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = p_step_id and job_id = p_job_id
      and organization_id = p_organization_id;
  if job.id is null or step.id is null or job.requested_by <> p_actor_id
    or job.status <> 'blocked_configuration'
    or (step.definition_step ->> 'kind') not in ('ai_assisted', 'automatic') then
    raise exception 'Actor-owned blocked AI step is required.' using errcode = '42501';
  end if;
  select * into existing from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and configured_step_id = step.id;
  if found then
    if existing.actor_id <> p_actor_id or existing.max_cost_microusd <> p_max_cost_microusd
      or existing.job_id <> job.id then
      raise exception 'Step already has a different reservation.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', existing.id, 'status', existing.status,
      'max_cost_microusd', existing.max_cost_microusd, 'idempotent_replay', true);
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  if intent.id is null or activation.id is null or configuration.id is null
    or step.project_activation_id <> activation.id
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or configuration.max_ai_cost_microusd <= 0 then
    raise exception 'Current pinned project limit is required.' using errcode = '42501';
  end if;
  preflight := public.preflight_pipeline_ai_job(p_organization_id, job.id, p_actor_id);
  if preflight ->> 'configuration_ready' is distinct from 'true'
    or preflight ->> 'project_activation_id' is distinct from activation.id::text then
    raise exception 'Current configured job preflight is not ready.' using errcode = '42501';
  end if;
  select coalesce(sum(case when reservation.status = 'settled'
      then reservation.actual_cost_microusd else reservation.max_cost_microusd end), 0)
    into local_total from private.ai_execution_step_budget_reservations reservation
    where reservation.organization_id = p_organization_id and reservation.job_id = job.id
      and reservation.status in ('reserved', 'uncertain', 'settled');
  if local_total + p_max_cost_microusd > configuration.max_ai_cost_microusd then
    raise exception 'Step reservation would exceed the project-local AI limit.' using errcode = '22003';
  end if;
  select coalesce(sum(case when reservation.status = 'settled'
      then reservation.actual_cost_microusd else reservation.max_cost_microusd end), 0)
    into organization_total from private.ai_execution_budget_reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.cycle_month = cycle
      and reservation.status in ('reserved', 'uncertain', 'settled');
  select organization_total + coalesce(sum(case when reservation.status = 'settled'
      then reservation.actual_cost_microusd else reservation.max_cost_microusd end), 0)
    into organization_total from private.ai_execution_step_budget_reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.cycle_month = cycle
      and reservation.status in ('reserved', 'uncertain', 'settled');
  select count(*) filter (where run.estimated_cost_microusd is null),
    coalesce(sum(run.estimated_cost_microusd), 0)
    into unknown_completed, unlinked_total
    from public.ai_runs run
    where run.organization_id = p_organization_id
      and run.created_at >= timezone('UTC', cycle::timestamp)
      and run.created_at < timezone('UTC', cycle::timestamp + interval '1 month')
      and run.status = 'completed'
      and not exists (
        select 1 from private.ai_execution_budget_reservations legacy
        where legacy.ai_run_id = run.id
      )
      and not exists (
        select 1 from private.ai_execution_step_budget_reservations reservation
        where reservation.ai_run_id = run.id
      );
  if unknown_completed > 0 then
    raise exception 'Unmeasured AI cost requires reconciliation first.' using errcode = '55000';
  end if;
  if exists (
    select 1 from private.ai_execution_budget_reservations legacy
    where legacy.organization_id = p_organization_id
      and legacy.cycle_month <> cycle and legacy.status in ('reserved', 'uncertain')
  ) or exists (
    select 1 from private.ai_execution_step_budget_reservations pending
    where pending.organization_id = p_organization_id
      and pending.cycle_month <> cycle and pending.status in ('reserved', 'uncertain')
  ) then
    raise exception 'Prior-cycle unresolved reservations require reconciliation.' using errcode = '55000';
  end if;
  if budget.spend_guard_mode = 'local_monthly_cap'
    and organization_total + unlinked_total + p_max_cost_microusd > budget.monthly_limit_microusd then
    raise exception 'Step reservation would exceed the organization monthly cap.' using errcode = '22003';
  end if;
  insert into private.ai_execution_step_budget_reservations(
    organization_id, job_id, configured_step_id, actor_id, cycle_month,
    max_cost_microusd, status
  ) values (
    p_organization_id, job.id, step.id, p_actor_id, cycle,
    p_max_cost_microusd, 'reserved'
  ) returning id into new_id;
  insert into private.ai_execution_step_budget_events(
    reservation_id, organization_id, transition
  ) values(new_id, p_organization_id, 'reserved');
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.preflight_pipeline_ai_job(p_organization_id uuid, p_job_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  plan public.pipeline_run_plans;
  approval public.ai_execution_input_approvals;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  expected_steps integer;
  configured_steps integer;
  has_ai_steps boolean;
  missing_routes jsonb := '[]'::jsonb;
  step_department text;
  route_count integer;
  has_budget boolean;
  spend_guard_mode text;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null then
    raise exception 'An exact organization, job and actor are required.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = p_actor_id and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin');
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  if not found or job.requested_by <> p_actor_id
    or job.status <> 'blocked_configuration' then
    raise exception 'Actor-owned blocked job is unavailable.' using errcode = '42501';
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  select * into plan from public.pipeline_run_plans
    where id = job.run_plan_id and run_intent_id = job.run_intent_id
      and organization_id = p_organization_id;
  if intent.id is null or plan.id is null then
    raise exception 'Pinned request or work plan is unavailable.' using errcode = '55000';
  end if;
  if intent.project_activation_id is null or intent.selected_steps_sha256 is null then
    raise exception 'A project activation is required for configured AI execution.' using errcode = '42501';
  end if;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  if activation.id is null or configuration.id is null
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.selected_steps_sha256
    or exists (
      select 1 from public.project_pipeline_activations newer
      where newer.engagement_id = intent.engagement_id
        and newer.organization_id = p_organization_id
        and newer.pipeline_group_id is not distinct from activation.pipeline_group_id
        and newer.activation_number > activation.activation_number
    ) then
    raise exception 'Pinned project activation is unavailable, changed, or superseded.' using errcode = '55000';
  end if;
  if intent.input_manifest->'stage_review' is distinct from private.current_pipeline_stage_review(p_organization_id,configuration.id) then raise exception 'Pinned stage source snapshot changed' using errcode='55000';end if;
  select sum((selected.value ->> 'quantity')::integer) into expected_steps
    from jsonb_array_elements(configuration.selected_steps) selected(value);
  select count(*), coalesce(bool_or(step.reused_artifact_version_id is null and step.reused_artifact_version_id is null and (step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')), false)
    into configured_steps, has_ai_steps
    from public.ai_execution_configured_steps step
    where step.organization_id = p_organization_id and step.job_id = job.id
      and step.project_activation_id = activation.id;
  if expected_steps not between 1 and 50 or configured_steps <> expected_steps
    or exists (
      select 1 from public.ai_execution_configured_steps step
      where step.job_id = job.id and step.organization_id = p_organization_id
        and step.project_activation_id <> activation.id
    ) then
    raise exception 'Configured step identities are incomplete.' using errcode = '55000';
  end if;
  select * into approval from public.ai_execution_input_approvals
    where job_id = job.id and organization_id = p_organization_id;
  if approval.id is null or approval.approved_by <> p_actor_id
    or approval.job_input_sha256 <> job.input_sha256
    or approval.work_sha256 <> plan.work_sha256 then
    raise exception 'Exact-job input acknowledgement is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active')
  ) then
    raise exception 'Engagement is no longer current.' using errcode = '55000';
  end if;
  if jsonb_typeof(intent.input_manifest -> 'assets') is distinct from 'array'
    or jsonb_array_length(intent.input_manifest -> 'assets') <> 0 then
    raise exception 'Asset AI-use classification is not available.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(intent.input_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.input_sha256
    or encode(extensions.digest(convert_to(plan.work_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> plan.work_sha256
    or encode(extensions.digest(convert_to(job.input_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> job.input_sha256
    or job.input_manifest ->> 'input_sha256' is distinct from intent.input_sha256
    or job.input_manifest ->> 'work_sha256' is distinct from plan.work_sha256 then
    raise exception 'Pinned input integrity failed.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service
      on service.id = (selected.value ->> 'id')::uuid
     and service.engagement_id = intent.engagement_id
     and service.organization_id = p_organization_id
     and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'A pinned service is no longer available.' using errcode = '55000';
  end if;
  if (select count(*) from public.ai_execution_job_steps step where step.job_id = job.id)
       <> jsonb_array_length(plan.work_manifest)
    or exists (
      select 1 from public.ai_execution_job_steps step
      left join public.work_items item
        on item.id = step.work_item_id and item.organization_id = step.organization_id
       and item.engagement_id = intent.engagement_id and item.deleted_at is null
      where step.job_id = job.id and (
        item.id is null or item.row_version <> step.source_row_version
        or item.status = 'done'
        or item.department_id is distinct from step.department_id
      )
    ) then
    raise exception 'Pinned work has changed; start a new run request.' using errcode = '55000';
  end if;
  for step_department in
    select distinct step.definition_step ->> 'department_id'
      from public.ai_execution_configured_steps step
      where step.job_id = job.id and step.organization_id = p_organization_id
        and step.reused_artifact_version_id is null and (step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')
      order by 1
  loop
    if step_department is null then
      missing_routes := missing_routes || jsonb_build_array('unassigned');
    else
      route_count := jsonb_array_length(public.get_pipeline_ai_text_routes(
        p_organization_id, job.id, step_department, p_actor_id
      ));
      if route_count = 0 then
        missing_routes := missing_routes || jsonb_build_array(step_department);
      end if;
    end if;
  end loop;
  select budget.spend_guard_mode into spend_guard_mode
    from private.ai_execution_budget_limits budget
    where budget.organization_id = p_organization_id;
  has_budget := coalesce(spend_guard_mode in ('local_monthly_cap', 'provider_managed'), false);
  return jsonb_build_object(
    'job_id', job.id, 'inputs_current', true,
    'missing_route_departments', missing_routes,
    'budget_cap_configured', coalesce(spend_guard_mode = 'local_monthly_cap', false),
    'spend_guard_mode', spend_guard_mode,
    'spend_tracking_configured', has_budget,
    'project_activation_id', activation.id,
    'configured_step_count', configured_steps,
    'local_ai_cost_limit_microusd', configuration.max_ai_cost_microusd,
    'configuration_ready', has_ai_steps and configuration.max_ai_cost_microusd > 0
      and has_budget and jsonb_array_length(missing_routes) = 0,
    'dispatch_enabled', false
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.advance_pipeline_manual_step(p_organization_id uuid, p_job_id uuid, p_step_id uuid, p_request_id uuid, p_expected_version bigint, p_action text, p_evidence text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  plan public.pipeline_run_plans;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  step public.ai_execution_configured_steps;
  progress public.ai_execution_step_progress;
  prior_event public.ai_execution_step_action_events;
  engagement public.engagements;
  approval public.ai_execution_input_approvals;
  dependency text;
  evidence text := trim(coalesce(p_evidence, ''));
  step_kind text;
begin
  if actor is null or p_organization_id is null or p_job_id is null
    or p_step_id is null or p_request_id is null or p_expected_version is null
    or p_expected_version <= 0 or p_action is null or p_action not in ('start', 'complete', 'approve', 'pause', 'resume')
    or length(evidence) > 1000
    or (p_action in ('complete', 'approve') and length(evidence) = 0) then
    raise exception 'Exact manual action, version and completion evidence are required.' using errcode = '22023';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id for share;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id for share;
  select * into plan from public.pipeline_run_plans
    where id = job.run_plan_id and organization_id = p_organization_id
      and run_intent_id = job.run_intent_id for share;
  select * into engagement from public.engagements
    where id = intent.engagement_id and organization_id = p_organization_id for share;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id for share;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id for share;
  if job.id is null or intent.id is null or plan.id is null or engagement.id is null or activation.id is null or configuration.id is null
    or job.status <> 'blocked_configuration'
    or engagement.status not in ('planning', 'active')
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
      <> intent.selected_steps_sha256
    or exists (select 1 from public.project_pipeline_activations newer
      where newer.organization_id = p_organization_id
        and newer.engagement_id = engagement.id
        and newer.pipeline_group_id is not distinct from activation.pipeline_group_id
        and newer.activation_number > activation.activation_number) then
    raise exception 'Current pinned manual run is required.' using errcode = '55000';
  end if;
  if intent.input_manifest->'stage_review' is distinct from private.current_pipeline_stage_review(p_organization_id,configuration.id) then raise exception 'Pinned stage source snapshot changed' using errcode='55000';end if;
  select * into step from public.ai_execution_configured_steps
    where id = p_step_id and job_id = job.id and organization_id = p_organization_id
      and project_activation_id = activation.id;
  step_kind := step.definition_step ->> 'kind';
  if step.id is null or step_kind not in ('human', 'approval_gate') then
    raise exception 'Only a pinned human or approval step may be advanced here.' using errcode = '42501';
  end if;
  if not (private.n6_project_configuration_authorized(
      p_organization_id, engagement.project_id, actor)
    or private.n1e_department_head(p_organization_id, engagement.project_id,
      step.definition_step ->> 'department_id', actor)) then
    raise exception 'Current exact-project or department authority is required.' using errcode = '42501';
  end if;
  select * into approval from public.ai_execution_input_approvals
    where job_id = job.id and organization_id = p_organization_id;
  if approval.id is null or approval.job_input_sha256 <> job.input_sha256
    or approval.work_sha256 <> plan.work_sha256 then
    raise exception 'Exact pinned input acknowledgement is required.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(intent.input_manifest::text, 'UTF8'), 'sha256'), 'hex') <> intent.input_sha256
    or encode(extensions.digest(convert_to(plan.work_manifest::text, 'UTF8'), 'sha256'), 'hex') <> plan.work_sha256
    or encode(extensions.digest(convert_to(job.input_manifest::text, 'UTF8'), 'sha256'), 'hex') <> job.input_sha256
    or job.input_manifest ->> 'input_sha256' is distinct from intent.input_sha256
    or job.input_manifest ->> 'work_sha256' is distinct from plan.work_sha256 then
    raise exception 'Pinned input integrity failed.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service
      on service.id = (selected.value ->> 'id')::uuid
      and service.organization_id = p_organization_id
      and service.engagement_id = intent.engagement_id
      and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'A pinned service is no longer available.' using errcode = '55000';
  end if;
  if (select count(*) from public.ai_execution_job_steps linked where linked.job_id = job.id)
       <> jsonb_array_length(plan.work_manifest)
    or exists (
      select 1 from public.ai_execution_job_steps linked
      left join public.work_items item
        on item.id = linked.work_item_id and item.organization_id = linked.organization_id
          and item.engagement_id = intent.engagement_id and item.deleted_at is null
      where linked.job_id = job.id and (
        item.id is null or item.row_version <> linked.source_row_version
        or item.status = 'done'
        or item.department_id is distinct from linked.department_id
      )
    ) then
    raise exception 'Pinned work has changed; start a new run request.' using errcode = '55000';
  end if;
  select * into progress from public.ai_execution_step_progress
    where configured_step_id = step.id and organization_id = p_organization_id for update;
  if not found then raise exception 'Step progress is missing.' using errcode = '55000'; end if;
  select * into prior_event from public.ai_execution_step_action_events
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if prior_event.job_id <> job.id or prior_event.configured_step_id <> step.id
      or prior_event.actor_id <> actor or prior_event.action <> p_action
      or prior_event.prior_version <> p_expected_version
      or prior_event.evidence <> evidence then
      raise exception 'Request ID has a different manual action.' using errcode = '23505';
    end if;
    return jsonb_build_object('step_id', step.id, 'status', case when prior_event.action in ('complete', 'approve') then 'completed'
        when prior_event.action = 'pause' then 'paused' else 'in_progress' end,
      'state_version', prior_event.resulting_version, 'idempotent_replay', true);
  end if;
  if progress.state_version <> p_expected_version then
    raise exception 'Step version changed; refresh the run.' using errcode = '40001';
  end if;
  if p_action in ('start', 'approve') then
    for dependency in select value from jsonb_array_elements_text(step.definition_step -> 'depends_on') loop
      if exists (select 1 from public.ai_execution_configured_steps required
        join public.ai_execution_step_progress required_progress
          on required_progress.configured_step_id = required.id
        where required.job_id = job.id and required.organization_id = p_organization_id
          and required.step_key = dependency and required_progress.status <> 'completed') then
        raise exception 'A pinned dependency is not complete.' using errcode = '55000';
      end if;
    end loop;
  end if;
  if (p_action = 'start' and (step_kind <> 'human' or progress.status <> 'waiting'))
    or (p_action = 'complete' and (step_kind <> 'human' or progress.status <> 'in_progress'))
    or (p_action = 'approve' and (step_kind <> 'approval_gate' or progress.status <> 'waiting'
      or actor = job.requested_by))
    or (p_action = 'pause' and (step_kind <> 'human' or progress.status <> 'in_progress'))
    or (p_action = 'resume' and (step_kind <> 'human' or progress.status <> 'paused')) then
    raise exception 'Manual step transition is not permitted.' using errcode = '55000';
  end if;
  update public.ai_execution_step_progress
    set status = case p_action
      when 'start' then 'in_progress' when 'complete' then 'completed'
      when 'approve' then 'completed' when 'pause' then 'paused'
      else 'in_progress' end,
      state_version = state_version + 1,
      started_by = case when p_action = 'start' then actor else started_by end,
      started_at = case when p_action = 'start' then clock_timestamp() else started_at end,
      completed_by = case when p_action in ('complete', 'approve') then actor else completed_by end,
      completed_at = case when p_action in ('complete', 'approve') then clock_timestamp() else completed_at end,
      updated_at = clock_timestamp()
    where configured_step_id = step.id;
  insert into public.ai_execution_step_action_events(
    organization_id, job_id, configured_step_id, request_id, actor_id,
    action, prior_version, resulting_version, evidence
  ) values (
    p_organization_id, job.id, step.id, p_request_id, actor,
    p_action, p_expected_version, p_expected_version + 1, evidence
  );
  return jsonb_build_object('step_id', step.id,
    'status', case when p_action in ('complete', 'approve') then 'completed'
      when p_action = 'pause' then 'paused' else 'in_progress' end,
    'state_version', p_expected_version + 1, 'idempotent_replay', false);
end;
$function$;



create function public.list_project_pipeline_stage_artifacts(p_organization_id uuid,p_engagement_id uuid,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());engagement public.engagements;items jsonb;extra boolean;begin
 if actor is null or p_query is null or length(p_query)>120 or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded current project artifact search required' using errcode='22023';end if;
 select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
 if engagement.id is null or not private.n6_project_configuration_authorized(p_organization_id,engagement.project_id,actor) then raise exception 'Current exact-project configuration authority required' using errcode='42501';end if;
 with available as (
  select a.id artifact_id,a.title,a.artifact_type,v.id artifact_version_id,v.version_number,v.content_checksum,v.ai_use_allowed,v.content->>'output_type' output_type,approval.id approval_id,v.created_at
  from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
  cross join lateral (select ap.* from public.artifact_approvals ap where ap.organization_id=v.organization_id and ap.artifact_version_id=v.id order by ap.approved_at desc,ap.id desc limit 1)approval
  where a.organization_id=p_organization_id and a.project_id=engagement.project_id and approval.decision='approved' and approval.artifact_id=a.id and approval.engagement_id=a.engagement_id
   and coalesce((select governed.status='completed' from public.artifact_approval_requests governed where governed.organization_id=v.organization_id and governed.artifact_version_id=v.id order by governed.created_at desc,governed.id desc limit 1),true)
   and (p_query='' or a.title ilike '%'||p_query||'%' or v.id::text=p_query or a.id::text=p_query)
  order by v.created_at desc,v.id desc offset p_offset limit p_limit+1
 ) select coalesce(jsonb_agg(to_jsonb(row)-'created_at' order by row.created_at desc,row.artifact_version_id desc) filter(where ordinal<=p_limit),'[]'),count(*)>p_limit
 into items,extra from (select available.*,row_number()over(order by created_at desc,artifact_version_id desc)ordinal from available)row;
 -- Search is advisory only; confirmation rechecks exact source/version/current approval under the existing lock boundary.
 return jsonb_build_object('artifacts',items,'offset',p_offset,'limit',p_limit,'has_more',extra);
end;$$;
revoke all on function public.list_project_pipeline_stage_artifacts(uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_project_pipeline_stage_artifacts(uuid,uuid,text,integer,integer) to authenticated;
commit;
