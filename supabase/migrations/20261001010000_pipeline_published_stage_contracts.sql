-- W05: immutable published stage contracts; legacy definitions and approvals remain exact.
-- This declares outputs/inputs/optional/reuse support only; no provider or work is started.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('public.create_pipeline_execution_definition(uuid,uuid,uuid,text,jsonb)')),chr(13),'')) is distinct from 'af48e06988cfcb0706dc7db5c663b580' then raise exception 'Installed definition author contract changed' using errcode='55000';end if;
end;$$;
create function private.valid_pipeline_stage_contract(p_contract jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;keys text[]:='{}';allowed text[]:=array['discovery','vision','audience','brand_statement','website_architecture','keyword_strategy','content','campaign_messaging','scripts','channel_strategy','campaign_brief','measurement_plan','marketing_report','seo_research','technical_brief','launch_checklist','design_system','design_delivery_package'];begin
 if jsonb_typeof(p_contract) is distinct from 'object' or p_contract-'optional'-'output_label'-'reuse_allowed'-'artifact_type'-'output_type'-'required_inputs'<>'{}'::jsonb
  or jsonb_typeof(p_contract->'optional') is distinct from 'boolean' or jsonb_typeof(p_contract->'reuse_allowed') is distinct from 'boolean'
  or jsonb_typeof(p_contract->'output_label') is distinct from 'string' or p_contract->>'output_label'<>btrim(p_contract->>'output_label') or length(p_contract->>'output_label') not between 1 and 300
  or jsonb_typeof(p_contract->'required_inputs') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_contract->'required_inputs')>8 then return false;end if;
 if p_contract->>'reuse_allowed'='true' then
  if jsonb_typeof(p_contract->'artifact_type') is distinct from 'string' or not coalesce((p_contract->>'artifact_type')=any(allowed),false)
   or jsonb_typeof(p_contract->'output_type') is distinct from 'string' or not coalesce((p_contract->>'output_type')~'^[a-z][a-z0-9_]{0,63}$',false) then return false;end if;
 elsif p_contract ? 'artifact_type' or p_contract ? 'output_type' then return false;end if;
 for item in select value from jsonb_array_elements(p_contract->'required_inputs') loop
  if jsonb_typeof(item) is distinct from 'object' or item-'key'-'label'-'kind'-'artifact_type'-'output_type'<>'{}'::jsonb
   or jsonb_typeof(item->'key') is distinct from 'string' or not coalesce((item->>'key')~'^[a-z][a-z0-9_]{0,63}$',false) or (item->>'key')=any(keys)
   or jsonb_typeof(item->'label') is distinct from 'string' or item->>'label'<>btrim(item->>'label') or length(item->>'label') not between 1 and 160
   or jsonb_typeof(item->'kind') is distinct from 'string' or not coalesce(item->>'kind' in ('manual','approved_artifact'),false) then return false;end if;
  if item->>'kind'='approved_artifact' then
   if jsonb_typeof(item->'artifact_type') is distinct from 'string' or not coalesce((item->>'artifact_type')=any(allowed),false)
    or jsonb_typeof(item->'output_type') is distinct from 'string' or not coalesce((item->>'output_type')~'^[a-z][a-z0-9_]{0,63}$',false) then return false;end if;
  elsif item ? 'artifact_type' or item ? 'output_type' then return false;end if;
  keys:=array_append(keys,item->>'key');
 end loop;return true;
end;$$;
revoke all on function private.valid_pipeline_stage_contract(jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.create_pipeline_execution_definition(p_organization_id uuid, p_preset_publication_id uuid, p_request_id uuid, p_name text, p_steps jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  preset public.pipeline_template_publications;
  existing public.pipeline_execution_definitions;
  selected jsonb;
  step_key text;
  step_label text;
  step_kind text;
  step_department text;
  step_service uuid;
  dependency text;
  prior_keys text[] := '{}'::text[];
  next_version integer;
  request_sha text;
  steps_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_preset_publication_id is null
    or p_request_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception 'Authenticated preset, request and name are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception 'Execution steps must be an ordered array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_steps) not between 1 and 50
    or pg_catalog.octet_length(p_steps::text) > 32768 then
    raise exception 'Choose 1â€“50 bounded execution steps.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin', 'department_manager')
    for update of organization, membership;
  if not found then
    raise exception 'Current template author authority is required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'preset_publication_id', p_preset_publication_id,
    'name', trim(p_name), 'steps', p_steps
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing from public.pipeline_execution_definitions
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.created_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request ID belongs to another execution definition.' using errcode = '23505';
    end if;
    return jsonb_build_object('definition_id', existing.id,
      'version_number', existing.version_number, 'idempotent_replay', true);
  end if;
  select * into preset from public.pipeline_template_publications
    where id = p_preset_publication_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Published same-organization service preset is required.' using errcode = '42501';
  end if;
  for selected in select value from jsonb_array_elements(p_steps)
  loop
    if jsonb_typeof(selected) is distinct from 'object'
      or selected - 'key' - 'label' - 'kind' - 'department_id' - 'service_id' - 'depends_on' - 'stage_contract' <> '{}'::jsonb then
      raise exception 'Each step requires only supported execution fields.' using errcode = '22023';
    end if;
    if selected ? 'stage_contract' and (private.valid_pipeline_stage_contract(selected->'stage_contract') is distinct from true
      or (selected->>'kind'='approval_gate' and selected->'stage_contract'->>'reuse_allowed'='true')) then
      raise exception 'Invalid published stage output, input, omission or reuse contract' using errcode='22023';
    end if;
    step_key := selected ->> 'key';
    step_label := selected ->> 'label';
    step_kind := selected ->> 'kind';
    step_department := selected ->> 'department_id';
    if coalesce(step_key ~ '^[a-z][a-z0-9_]{0,63}$', false) is false
      or step_key = any(prior_keys)
      or length(trim(coalesce(step_label, ''))) not between 1 and 160
      or coalesce(step_kind in ('human', 'ai_assisted', 'automatic', 'approval_gate'), false) is false
      or jsonb_typeof(selected -> 'depends_on') is distinct from 'array' then
      raise exception 'Step key, label, kind or dependencies are invalid.' using errcode = '22023';
    end if;
    if step_department is null or selected ->> 'service_id' is null then
      raise exception 'Each step needs a service and accountable department.' using errcode = '22023';
    end if;
    step_service := (selected ->> 'service_id')::uuid;
    perform 1 from public.pipeline_template_version_services version_service
      join public.service_catalog service
        on service.id = version_service.service_id
       and service.organization_id = version_service.organization_id
      where version_service.pipeline_template_version_id = preset.pipeline_template_version_id
        and version_service.organization_id = p_organization_id
        and version_service.service_id = step_service
        and service.department_id = step_department and service.is_active
      for share of version_service,service;
    if not found then
      raise exception 'Step service must belong to the published preset and department.' using errcode = '42501';
    end if;
    if jsonb_array_length(selected -> 'depends_on') > 10
      or (select count(*) from jsonb_array_elements_text(selected -> 'depends_on')) <>
         (select count(distinct value) from jsonb_array_elements_text(selected -> 'depends_on')) then
      raise exception 'Step dependencies must be distinct and bounded.' using errcode = '22023';
    end if;
    for dependency in select value from jsonb_array_elements_text(selected -> 'depends_on')
    loop
      if dependency is null or dependency <> all(prior_keys) then
        raise exception 'A step may depend only on an earlier step.' using errcode = '22023';
      end if;
    end loop;
    prior_keys := array_append(prior_keys, step_key);
  end loop;
  select coalesce(max(version_number), 0) + 1 into next_version
    from public.pipeline_execution_definitions
    where preset_publication_id = p_preset_publication_id;
  steps_sha := encode(extensions.digest(convert_to(p_steps::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_execution_definitions(
    organization_id, preset_publication_id, version_number, request_id,
    request_sha256, name, steps, steps_sha256, created_by
  ) values (
    p_organization_id, p_preset_publication_id, next_version, p_request_id,
    request_sha, trim(p_name), p_steps, steps_sha, actor
  ) returning id into new_id;
  return jsonb_build_object('definition_id', new_id,
    'version_number', next_version, 'steps_sha256', steps_sha,
    'idempotent_replay', false);
end;
$function$;
commit;
