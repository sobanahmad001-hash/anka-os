-- Explicit provider-managed spend tracking without a local monthly maximum.
-- Existing finite caps remain unchanged. No row or paid switch is seeded.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.ai_execution_budget_limits
  add column spend_guard_mode text not null default 'local_monthly_cap'
    check (spend_guard_mode in ('local_monthly_cap','provider_managed'));
alter table private.ai_execution_budget_limits
  alter column monthly_limit_microusd drop not null;
alter table private.ai_execution_budget_limits
  add constraint ai_execution_budget_limits_mode_value_check check (
    (spend_guard_mode='local_monthly_cap' and monthly_limit_microusd>0)
    or (spend_guard_mode='provider_managed' and monthly_limit_microusd is null)
  );
comment on table private.ai_execution_budget_limits is
  'No rows are seeded. Existing finite local monthly caps remain. Explicit provider_managed rows keep atomic reservation/accounting without a local monthly maximum; external limits are not verified by Anka.';

-- The retired plan-level reservation entry point must remain unavailable.
revoke execute on function public.reserve_pipeline_ai_budget(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;

-- Service-only, authenticated-by-caller summary; never returns an amount or credential.
create function public.get_ai_spend_guard_readiness(p_organization_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mode text;
begin
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active' and member.member_kind='team';
  if not found then
    raise exception 'Current organization team membership is required' using errcode='42501';
  end if;
  select budget.spend_guard_mode into mode from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id;
  return jsonb_build_object('spend_guard_mode',mode,
    'spend_tracking_configured',mode is not null,
    'local_monthly_cap_configured',coalesce(mode='local_monthly_cap',false),
    'external_provider_limit_verified',false);
end;
$$;
revoke all on function public.get_ai_spend_guard_readiness(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_ai_spend_guard_readiness(uuid,uuid) to service_role;

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
$$;

create or replace function private.n6_reserve_step_budget(
  p_organization_id uuid, p_job_id uuid, p_step_id uuid,
  p_actor_id uuid, p_max_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;

create or replace function public.reserve_context_chat_budget(
  p_organization_id uuid, p_conversation_id uuid, p_message_id uuid,
  p_model_configuration_id uuid, p_actor_id uuid, p_max_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  existing private.ai_execution_step_budget_reservations;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  organization_total numeric;
  unlinked_total numeric;
  unknown_completed bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_conversation_id is null or p_message_id is null
    or p_model_configuration_id is null or p_actor_id is null
    or p_max_cost_microusd is null or p_max_cost_microusd <= 0 then
    raise exception 'A scoped positive conversation maximum is required.' using errcode = '22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Positive organization budget is not configured.' using errcode = '42501';
  end if;
  perform public.assert_context_chat_organization_model(
    p_model_configuration_id, p_organization_id, p_actor_id
  );
  perform 1 from public.department_chat_conversations conversation
    join public.department_chat_messages message
      on message.conversation_id = conversation.id
     and message.organization_id = conversation.organization_id
     and message.owner_id = conversation.owner_id
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.owner_id = p_actor_id
      and conversation.context_kind in ('organization', 'project_team', 'department_private')
      and conversation.state = 'active'
      and message.id = p_message_id
      and message.author_id = p_actor_id
      and message.role = 'user' and message.status = 'completed'
    for share of conversation, message;
  if not found then
    raise exception 'Current owner-controlled human turn is required.' using errcode = '42501';
  end if;
  perform private.assert_context_chat_owner_scope(p_organization_id, p_conversation_id, p_actor_id);
  select * into existing from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id;
  if found then
    if existing.actor_id <> p_actor_id
      or existing.context_chat_conversation_id <> p_conversation_id
      or existing.context_chat_model_configuration_id <> p_model_configuration_id
      or existing.max_cost_microusd <> p_max_cost_microusd then
      raise exception 'Message already has a different reservation.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', existing.id, 'status', existing.status,
      'cycle_month', existing.cycle_month, 'max_cost_microusd', existing.max_cost_microusd,
      'idempotent_replay', true);
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
      and not exists (select 1 from private.ai_execution_budget_reservations legacy
        where legacy.ai_run_id = run.id)
      and not exists (select 1 from private.ai_execution_step_budget_reservations reservation
        where reservation.ai_run_id = run.id);
  if unknown_completed > 0 then
    raise exception 'Unmeasured AI cost requires reconciliation first.' using errcode = '55000';
  end if;
  if exists (select 1 from private.ai_execution_budget_reservations legacy
    where legacy.organization_id = p_organization_id
      and legacy.cycle_month <> cycle and legacy.status in ('reserved', 'uncertain'))
    or exists (select 1 from private.ai_execution_step_budget_reservations pending
    where pending.organization_id = p_organization_id
      and pending.cycle_month <> cycle and pending.status in ('reserved', 'uncertain')) then
    raise exception 'Prior-cycle unresolved reservations require reconciliation.' using errcode = '55000';
  end if;
  if budget.spend_guard_mode = 'local_monthly_cap'
    and organization_total + unlinked_total + p_max_cost_microusd > budget.monthly_limit_microusd then
    raise exception 'Conversation reservation would exceed the organization monthly cap.' using errcode = '22003';
  end if;
  insert into private.ai_execution_step_budget_reservations (
    organization_id, context_chat_message_id, context_chat_conversation_id,
    context_chat_model_configuration_id, actor_id, cycle_month,
    max_cost_microusd, status
  ) values (
    p_organization_id, p_message_id, p_conversation_id,
    p_model_configuration_id, p_actor_id, cycle,
    p_max_cost_microusd, 'reserved'
  ) returning id into new_id;
  insert into private.ai_execution_step_budget_events(reservation_id, organization_id, transition)
    values(new_id, p_organization_id, 'reserved');
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$$;

create or replace function public.reserve_workshop_chat_budget(
  p_organization_id uuid, p_conversation_id uuid, p_message_id uuid,
  p_model_configuration_id uuid, p_actor_id uuid, p_max_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  conversation public.department_chat_conversations;
  configuration public.department_chat_model_configurations;
  existing private.ai_execution_step_budget_reservations;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  organization_total numeric;
  unlinked_total numeric;
  unknown_completed bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_conversation_id is null or p_message_id is null
    or p_model_configuration_id is null or p_actor_id is null
    or p_max_cost_microusd is null or p_max_cost_microusd <= 0 then
    raise exception 'A scoped positive Workshop maximum is required.' using errcode = '22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Positive organization budget is not configured.' using errcode = '42501';
  end if;
  select * into conversation from public.department_chat_conversations
    where id = p_conversation_id and organization_id = p_organization_id
      and context_kind = 'department_project' and state = 'active'
    for share;
  if not found then
    raise exception 'Active Workshop conversation is required.' using errcode = '42501';
  end if;
  perform private.require_accessible_department_chat_conversation(
    conversation.id, p_organization_id, conversation.project_id,
    conversation.engagement_id, conversation.department_id, p_actor_id, true
  );
  select * into configuration from public.department_chat_model_configurations
    where id = p_model_configuration_id and organization_id = p_organization_id
      and department_id = conversation.department_id;
  if not found then
    raise exception 'Approved Workshop model is required.' using errcode = '23514';
  end if;
  perform public.assert_department_chat_model_dispatch(
    configuration.id, p_organization_id, conversation.engagement_id,
    conversation.department_id, configuration.connector_connection_id,
    configuration.model_id, p_actor_id
  );
  select * into existing from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and workshop_chat_message_id = p_message_id;
  if found then
    if existing.actor_id <> p_actor_id
      or existing.workshop_chat_conversation_id <> p_conversation_id
      or existing.workshop_chat_model_configuration_id <> p_model_configuration_id
      or existing.max_cost_microusd <> p_max_cost_microusd then
      raise exception 'Workshop turn already has a different reservation.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', existing.id, 'status', existing.status,
      'cycle_month', existing.cycle_month, 'max_cost_microusd', existing.max_cost_microusd,
      'idempotent_replay', true);
  end if;
  perform 1 from public.department_chat_messages message
    where message.id = p_message_id and message.conversation_id = conversation.id
      and message.organization_id = p_organization_id
      and message.project_id = conversation.project_id
      and message.engagement_id = conversation.engagement_id
      and message.department_id = conversation.department_id
      and message.author_id = p_actor_id and message.role = 'user'
      and message.status = 'pending' and message.provider_dispatched_at is null
    for share;
  if not found then
    raise exception 'Pending human Workshop turn is required.' using errcode = '42501';
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
    into unknown_completed, unlinked_total from public.ai_runs run
    where run.organization_id = p_organization_id
      and run.created_at >= timezone('UTC', cycle::timestamp)
      and run.created_at < timezone('UTC', cycle::timestamp + interval '1 month')
      and run.status = 'completed'
      and not exists (select 1 from private.ai_execution_budget_reservations legacy
        where legacy.ai_run_id = run.id)
      and not exists (select 1 from private.ai_execution_step_budget_reservations reservation
        where reservation.ai_run_id = run.id);
  if unknown_completed > 0 then
    raise exception 'Unmeasured AI cost requires reconciliation first.' using errcode = '55000';
  end if;
  if exists (select 1 from private.ai_execution_budget_reservations legacy
    where legacy.organization_id = p_organization_id
      and legacy.cycle_month <> cycle and legacy.status in ('reserved', 'uncertain'))
    or exists (select 1 from private.ai_execution_step_budget_reservations pending
    where pending.organization_id = p_organization_id
      and pending.cycle_month <> cycle and pending.status in ('reserved', 'uncertain')) then
    raise exception 'Prior-cycle unresolved reservations require reconciliation.' using errcode = '55000';
  end if;
  if budget.spend_guard_mode = 'local_monthly_cap'
    and organization_total + unlinked_total + p_max_cost_microusd > budget.monthly_limit_microusd then
    raise exception 'Workshop reservation would exceed the organization monthly cap.' using errcode = '22003';
  end if;
  insert into private.ai_execution_step_budget_reservations (
    organization_id, workshop_chat_message_id, workshop_chat_conversation_id,
    workshop_chat_model_configuration_id, actor_id, cycle_month,
    max_cost_microusd, status
  ) values (
    p_organization_id, p_message_id, p_conversation_id,
    p_model_configuration_id, p_actor_id, cycle,
    p_max_cost_microusd, 'reserved'
  ) returning id into new_id;
  insert into private.ai_execution_step_budget_events(reservation_id, organization_id, transition)
    values(new_id, p_organization_id, 'reserved');
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$$;

create or replace function public.get_design_video_quote(
  p_organization_id uuid, p_direction_version_id uuid, p_actor_id uuid,
  p_duration_seconds integer, p_resolution text, p_aspect_ratio text,
  p_output_format text, p_generate_audio boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote private.design_video_price_quotes;
  cap_configured boolean;
  spend_guard_mode text;
begin
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    join public.design_direction_versions version
      on version.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design')
      and version.id=p_direction_version_id;
  if not found then
    raise exception 'Current Design context is required' using errcode='42501';
  end if;
  select budget.spend_guard_mode into spend_guard_mode
    from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id;
  cap_configured := coalesce(spend_guard_mode='local_monthly_cap',false);
  select * into quote from private.design_video_price_quotes price
    where price.organization_id=p_organization_id
      and price.provider='higgsfield'
      and price.model_id='bytedance/seedance-2.5/text-to-video'
      and price.duration_seconds=p_duration_seconds
      and price.resolution=p_resolution
      and price.aspect_ratio=p_aspect_ratio
      and price.output_format=p_output_format
      and price.generate_audio=p_generate_audio
      and price.verified_at<=clock_timestamp()
      and price.valid_until>clock_timestamp()
      and price.max_charge_microusd between 1 and 2000000
    order by price.verified_at desc,price.id desc limit 1;
  return jsonb_build_object('organization_cap_configured',cap_configured,
    'spend_guard_mode',spend_guard_mode,
    'spend_tracking_configured',spend_guard_mode is not null,
    'quote',case when quote.id is null then null else jsonb_build_object(
      'id',quote.id,'provider',quote.provider,'model_id',quote.model_id,
      'duration_seconds',quote.duration_seconds,'resolution',quote.resolution,
      'aspect_ratio',quote.aspect_ratio,'output_format',quote.output_format,
      'generate_audio',quote.generate_audio,'currency',quote.currency,
      'max_charge_microusd',quote.max_charge_microusd,
      'source_url',quote.source_url,'verified_at',quote.verified_at,
      'valid_until',quote.valid_until) end);
end;
$$;

create or replace function public.create_design_video_job(
  p_organization_id uuid, p_direction_version_id uuid, p_actor_id uuid,
  p_connector_connection_id uuid, p_quote_id uuid, p_operation_key text,
  p_prompt text, p_mode text, p_duration_seconds integer,
  p_resolution text, p_aspect_ratio text, p_output_format text,
  p_generate_audio boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote private.design_video_price_quotes;
  connector public.integration_connections;
  existing private.design_video_generation_jobs;
  checksum text;
  new_id uuid;
begin
  if p_organization_id is null or p_direction_version_id is null
    or p_actor_id is null or p_connector_connection_id is null
    or p_quote_id is null or length(btrim(coalesce(p_operation_key,''))) not between 8 and 200
    or p_operation_key<>btrim(p_operation_key)
    or length(btrim(coalesce(p_prompt,''))) not between 1 and 12000
    or p_mode not in ('explore','production')
    or p_duration_seconds not between 4 and 30
    or p_resolution not in ('480p','720p')
    or p_aspect_ratio not in ('16:9','4:3','1:1','3:4','9:16','21:9')
    or p_output_format not in ('mp4','mov')
    or p_generate_audio is null
    or (p_mode='explore' and p_duration_seconds>5)
    or (p_mode='production' and p_resolution<>'720p') then
    raise exception 'Exact supported video request is required' using errcode='22023';
  end if;
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    join public.design_direction_versions version on version.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design')
      and version.id=p_direction_version_id;
  if not found then
    raise exception 'Current Design context is required' using errcode='42501';
  end if;
  perform 1 from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id
      and budget.spend_guard_mode in ('local_monthly_cap','provider_managed');
  if not found then
    raise exception 'Organization budget is not configured' using errcode='42501';
  end if;
  select * into connector from public.integration_connections
    where id=p_connector_connection_id and organization_id=p_organization_id for share;
  if not found or connector.provider<>'higgsfield'
    or connector.status<>'verified' or connector.archived_at is not null
    or connector.secret_name is null
    or not starts_with(connector.secret_name,'ANKA_HIGGSFIELD_')
    or exists (select 1 from public.integration_connection_departments mapping
      where mapping.connection_id=connector.id
        and mapping.organization_id=p_organization_id)
    or exists (select 1 from public.integration_connection_engagements mapping
      where mapping.connection_id=connector.id
        and mapping.organization_id=p_organization_id) then
    raise exception 'Verified Design video connection is required' using errcode='42501';
  end if;
  select * into quote from private.design_video_price_quotes
    where id=p_quote_id and organization_id=p_organization_id for share;
  if not found or quote.verified_at>clock_timestamp()
    or quote.valid_until<=clock_timestamp()
    or quote.duration_seconds<>p_duration_seconds
    or quote.resolution<>p_resolution or quote.aspect_ratio<>p_aspect_ratio
    or quote.output_format<>p_output_format
    or quote.generate_audio<>p_generate_audio
    or quote.max_charge_microusd>2000000 then
    raise exception 'Fresh exact video price under $2 is required' using errcode='42501';
  end if;
  checksum:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'direction_version_id',p_direction_version_id,
    'actor_id',p_actor_id,'connector_connection_id',p_connector_connection_id,
    'quote_id',p_quote_id,'prompt',btrim(p_prompt),'mode',p_mode,
    'duration_seconds',p_duration_seconds,'resolution',p_resolution,
    'aspect_ratio',p_aspect_ratio,'output_format',p_output_format,
    'generate_audio',p_generate_audio)::text,'UTF8')),'hex');
  insert into private.design_video_generation_jobs(
    organization_id,direction_version_id,requested_by,connector_connection_id,
    operation_key,request_checksum,prompt,mode,duration_seconds,resolution,
    aspect_ratio,output_format,generate_audio,quote_id)
    values(p_organization_id,p_direction_version_id,p_actor_id,
      p_connector_connection_id,p_operation_key,checksum,btrim(p_prompt),p_mode,
      p_duration_seconds,p_resolution,p_aspect_ratio,p_output_format,
      p_generate_audio,p_quote_id)
    on conflict (organization_id,requested_by,operation_key) do nothing
    returning id into new_id;
  if new_id is not null then
    return jsonb_build_object('job_id',new_id,'status','queued',
      'request_checksum',checksum,'idempotent_replay',false);
  end if;
  select * into existing from private.design_video_generation_jobs
    where organization_id=p_organization_id and requested_by=p_actor_id
      and operation_key=p_operation_key;
  if not found or existing.request_checksum<>checksum then
    raise exception 'Operation key already binds another video request' using errcode='23505';
  end if;
  return jsonb_build_object('job_id',existing.id,'status',existing.status,
    'request_checksum',existing.request_checksum,'idempotent_replay',true);
end;
$$;

create or replace function public.reserve_design_video_budget(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_video_generation_jobs;
  quote private.design_video_price_quotes;
  connector public.integration_connections;
  existing private.ai_execution_budget_reservations;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  organization_total numeric;
  unlinked_total numeric;
  unmeasured_count bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null then
    raise exception 'Exact video job and actor are required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then
    raise exception 'Organization budget is not configured' using errcode='42501';
  end if;
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.requested_by<>p_actor_id or job.status<>'queued' then
    raise exception 'Current actor-owned queued video job is required' using errcode='42501';
  end if;
  select * into connector from public.integration_connections
    where id=job.connector_connection_id and organization_id=p_organization_id for share;
  if not found or connector.provider<>'higgsfield'
    or connector.status<>'verified' or connector.archived_at is not null
    or connector.secret_name is null
    or not starts_with(connector.secret_name,'ANKA_HIGGSFIELD_')
    or exists (select 1 from public.integration_connection_departments mapping
      where mapping.connection_id=connector.id
        and mapping.organization_id=p_organization_id)
    or exists (select 1 from public.integration_connection_engagements mapping
      where mapping.connection_id=connector.id
        and mapping.organization_id=p_organization_id) then
    raise exception 'Verified Design video connection is required' using errcode='42501';
  end if;
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design');
  if not found then
    raise exception 'Current Design team authority is required' using errcode='42501';
  end if;
  select * into quote from private.design_video_price_quotes
    where id=job.quote_id and organization_id=p_organization_id for share;
  if not found or quote.verified_at>clock_timestamp()
    or quote.valid_until<=clock_timestamp()
    or quote.provider<>'higgsfield'
    or quote.model_id<>'bytedance/seedance-2.5/text-to-video'
    or quote.duration_seconds<>job.duration_seconds
    or quote.resolution<>job.resolution
    or quote.aspect_ratio<>job.aspect_ratio
    or quote.output_format<>job.output_format
    or quote.generate_audio<>job.generate_audio
    or quote.max_charge_microusd>2000000 then
    raise exception 'Fresh exact video price under $2 is required' using errcode='42501';
  end if;
  select * into existing from private.ai_execution_budget_reservations
    where design_video_job_id=p_job_id and organization_id=p_organization_id;
  if found then
    if existing.actor_id<>p_actor_id
      or existing.max_cost_microusd<>quote.max_charge_microusd then
      raise exception 'Video reservation changed' using errcode='23505';
    end if;
    return jsonb_build_object('reservation_id',existing.id,'status',existing.status,
      'max_cost_microusd',existing.max_cost_microusd,'idempotent_replay',true);
  end if;
  if exists (select 1 from private.ai_execution_budget_reservations r
      where r.organization_id=p_organization_id and r.cycle_month<>cycle
        and r.status in ('reserved','uncertain'))
    or exists (select 1 from private.ai_execution_step_budget_reservations r
      where r.organization_id=p_organization_id and r.cycle_month<>cycle
        and r.status in ('reserved','uncertain')) then
    raise exception 'Prior-cycle unresolved costs require reconciliation' using errcode='55000';
  end if;
  select coalesce(sum(case when r.status='settled'
    then r.actual_cost_microusd else r.max_cost_microusd end),0)
    into organization_total from private.ai_execution_budget_reservations r
    where r.organization_id=p_organization_id and r.cycle_month=cycle
      and r.status in ('reserved','uncertain','settled');
  select organization_total+coalesce(sum(case when r.status='settled'
    then r.actual_cost_microusd else r.max_cost_microusd end),0)
    into organization_total from private.ai_execution_step_budget_reservations r
    where r.organization_id=p_organization_id and r.cycle_month=cycle
      and r.status in ('reserved','uncertain','settled');
  select count(*) filter (where run.estimated_cost_microusd is null),
    coalesce(sum(run.estimated_cost_microusd),0)
    into unmeasured_count,unlinked_total from public.ai_runs run
    where run.organization_id=p_organization_id
      and run.created_at>=timezone('UTC',cycle::timestamp)
      and run.created_at<timezone('UTC',cycle::timestamp+interval '1 month')
      and run.status='completed'
      and not exists (select 1 from private.ai_execution_budget_reservations r
        where r.ai_run_id=run.id)
      and not exists (select 1 from private.ai_execution_step_budget_reservations r
        where r.ai_run_id=run.id);
  if unmeasured_count>0 then
    raise exception 'Unmeasured AI cost requires reconciliation' using errcode='55000';
  end if;
  if budget.spend_guard_mode='local_monthly_cap'
    and organization_total+unlinked_total+quote.max_charge_microusd
    >budget.monthly_limit_microusd then
    raise exception 'Video would exceed the organization monthly cap' using errcode='22003';
  end if;
  insert into private.ai_execution_budget_reservations(
    organization_id,run_plan_id,design_video_job_id,actor_id,cycle_month,
    max_cost_microusd,status)
  values(p_organization_id,null,p_job_id,p_actor_id,cycle,
    quote.max_charge_microusd,'reserved')
  returning id into new_id;
  insert into private.ai_execution_budget_events(reservation_id,organization_id,transition)
    values(new_id,p_organization_id,'reserved');
  return jsonb_build_object('reservation_id',new_id,'status','reserved',
    'max_cost_microusd',quote.max_charge_microusd,'idempotent_replay',false);
end;
$$;
-- Preserve private function boundaries; no direct client budget access.
revoke all on private.ai_execution_budget_limits from public,anon,authenticated,service_role;
commit;
