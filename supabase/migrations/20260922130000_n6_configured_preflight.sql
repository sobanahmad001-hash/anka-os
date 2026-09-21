-- Require current activation and configured steps in service-only preflight.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.preflight_pipeline_ai_job(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
        and newer.activation_number > activation.activation_number
    ) then
    raise exception 'Pinned project activation is unavailable, changed, or superseded.' using errcode = '55000';
  end if;
  select sum((selected.value ->> 'quantity')::integer) into expected_steps
    from jsonb_array_elements(configuration.selected_steps) selected(value);
  select count(*), coalesce(bool_or((step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')), false)
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
        and (step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')
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
  select exists (
    select 1 from private.ai_execution_budget_limits budget
    where budget.organization_id = p_organization_id
      and budget.monthly_limit_microusd > 0
  ) into has_budget;
  return jsonb_build_object(
    'job_id', job.id, 'inputs_current', true,
    'missing_route_departments', missing_routes,
    'budget_cap_configured', has_budget,
    'project_activation_id', activation.id,
    'configured_step_count', configured_steps,
    'local_ai_cost_limit_microusd', configuration.max_ai_cost_microusd,
    'configuration_ready', has_ai_steps and configuration.max_ai_cost_microusd > 0
      and has_budget and jsonb_array_length(missing_routes) = 0,
    'dispatch_enabled', false
  );
end;
$$;
revoke all on function public.preflight_pipeline_ai_job(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preflight_pipeline_ai_job(uuid, uuid, uuid) to service_role;
commit;
