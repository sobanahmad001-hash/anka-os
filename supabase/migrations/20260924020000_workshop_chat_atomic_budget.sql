-- Reserve shared organization AI budget for a saved Workshop answer before dispatch.
-- This migration alone does not authorize a provider request.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.ai_execution_step_budget_reservations
  drop constraint ai_execution_step_budget_reservations_source_check,
  add column workshop_chat_message_id uuid,
  add column workshop_chat_conversation_id uuid,
  add column workshop_chat_model_configuration_id uuid,
  add constraint ai_execution_step_budget_reservations_source_check check (
    (job_id is not null and configured_step_id is not null
      and context_chat_message_id is null and context_chat_conversation_id is null
      and context_chat_model_configuration_id is null
      and workshop_chat_message_id is null and workshop_chat_conversation_id is null
      and workshop_chat_model_configuration_id is null)
    or (job_id is null and configured_step_id is null
      and context_chat_message_id is not null and context_chat_conversation_id is not null
      and context_chat_model_configuration_id is not null
      and workshop_chat_message_id is null and workshop_chat_conversation_id is null
      and workshop_chat_model_configuration_id is null)
    or (job_id is null and configured_step_id is null
      and context_chat_message_id is null and context_chat_conversation_id is null
      and context_chat_model_configuration_id is null
      and workshop_chat_message_id is not null and workshop_chat_conversation_id is not null
      and workshop_chat_model_configuration_id is not null)
  ),
  add constraint ai_step_budget_workshop_message_fkey
    foreign key (workshop_chat_message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  add constraint ai_step_budget_workshop_conversation_fkey
    foreign key (workshop_chat_conversation_id, organization_id)
    references public.department_chat_conversations(id, organization_id) on delete restrict,
  add constraint ai_step_budget_workshop_model_fkey
    foreign key (workshop_chat_model_configuration_id, organization_id)
    references public.department_chat_model_configurations(id, organization_id) on delete restrict;
create unique index ai_step_budget_workshop_message_unique
  on private.ai_execution_step_budget_reservations(organization_id, workshop_chat_message_id)
  where workshop_chat_message_id is not null;

create function public.reserve_workshop_chat_budget(
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
  if not found or budget.monthly_limit_microusd <= 0 then
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
  if organization_total + unlinked_total + p_max_cost_microusd > budget.monthly_limit_microusd then
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
revoke all on function public.reserve_workshop_chat_budget(uuid,uuid,uuid,uuid,uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_workshop_chat_budget(uuid,uuid,uuid,uuid,uuid,bigint)
  to service_role;

create table private.workshop_chat_dispatch_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_id uuid not null
    references private.ai_execution_step_budget_reservations(id) on delete restrict,
  conversation_id uuid not null,
  message_id uuid not null,
  model_configuration_id uuid not null,
  connector_connection_id uuid not null,
  provider text not null check (provider in ('openai', 'anthropic', 'google_gemini')),
  model_id text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  dispatch_request_id uuid not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  unique (reservation_id),
  unique (organization_id, dispatch_request_id),
  unique (organization_id, message_id),
  foreign key (conversation_id, organization_id)
    references public.department_chat_conversations(id, organization_id) on delete restrict,
  foreign key (message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  foreign key (model_configuration_id, organization_id)
    references public.department_chat_model_configurations(id, organization_id) on delete restrict,
  foreign key (connector_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict
);
create index workshop_chat_dispatch_claims_org_time
  on private.workshop_chat_dispatch_claims(organization_id, claimed_at desc);
alter table private.workshop_chat_dispatch_claims enable row level security;
revoke all on private.workshop_chat_dispatch_claims from public, anon, authenticated, service_role;
create trigger protect_workshop_chat_dispatch_claims before update or delete
  on private.workshop_chat_dispatch_claims for each row
  execute function private.reject_pipeline_template_mutation();

create function public.claim_workshop_chat_dispatch(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reservation private.ai_execution_step_budget_reservations;
  existing private.workshop_chat_dispatch_claims;
  conversation public.department_chat_conversations;
  configuration public.department_chat_model_configurations;
  connection public.integration_connections;
  new_id uuid;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null
    or p_dispatch_request_id is null or p_prompt_sha256 is null
    or p_prompt_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Scoped Workshop dispatch identity and prompt hash are required.'
      using errcode = '22023';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and workshop_chat_message_id = p_message_id
    for update;
  if not found or reservation.actor_id <> p_actor_id
    or reservation.workshop_chat_conversation_id is null
    or reservation.workshop_chat_model_configuration_id is null then
    raise exception 'Workshop reservation is required.' using errcode = '42501';
  end if;
  select * into existing from private.workshop_chat_dispatch_claims
    where reservation_id = reservation.id;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'Workshop turn already has another dispatch claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'already_claimed', 'must_not_submit', true,
      'claim_id', existing.id);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Only an unused Workshop reservation may be claimed.' using errcode = '55000';
  end if;
  select * into conversation from public.department_chat_conversations
    where id = reservation.workshop_chat_conversation_id
      and organization_id = p_organization_id
      and context_kind = 'department_project' and state = 'active'
    for share;
  if not found then
    raise exception 'Active Workshop conversation is required.' using errcode = '42501';
  end if;
  -- Hold the exact contribution authority through the claim commit. A concurrent
  -- membership, project, engagement, or service revocation must win first or wait.
  perform 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    join public.engagements engagement
      on engagement.id = conversation.engagement_id
     and engagement.organization_id = membership.organization_id
     and engagement.project_id = conversation.project_id
     and engagement.status <> 'cancelled'
    join public.projects project
      on project.id = engagement.project_id
     and project.organization_id = engagement.organization_id
     and project.archived_at is null
    join public.engagement_services service
      on service.engagement_id = engagement.id
     and service.organization_id = engagement.organization_id
     and service.status = 'active'
    join public.service_catalog catalog
      on catalog.id = service.service_id
     and catalog.department_id = conversation.department_id
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and (membership.department_id = conversation.department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive'))
    order by service.id
    limit 1
    for share of membership, organization, engagement, project, service, catalog;
  if not found then
    raise exception 'Current Workshop contribution permission is required.' using errcode = '42501';
  end if;
  if conversation.owner_id <> p_actor_id then
    perform 1 from public.department_chat_conversation_shares share
      where share.conversation_id = conversation.id
        and share.organization_id = p_organization_id
        and share.recipient_id = p_actor_id and share.revoked_at is null
      for share;
    if not found then
      raise exception 'Workshop conversation sharing was revoked.' using errcode = '42501';
    end if;
  end if;
  -- Configuration identity is immutable. Lock the connector before the model
  -- so administrator reconfiguration and a dispatch claim have one lock order.
  select * into configuration from public.department_chat_model_configurations
    where id = reservation.workshop_chat_model_configuration_id
      and organization_id = p_organization_id
      and department_id = conversation.department_id;
  if not found then
    raise exception 'Selected Workshop model is unavailable.' using errcode = '23514';
  end if;
  select * into connection from public.integration_connections
    where id = configuration.connector_connection_id
      and organization_id = p_organization_id
      and provider in ('openai', 'anthropic', 'google_gemini')
      and status = 'verified' and archived_at is null and secret_name is not null
    for update;
  if not found then
    raise exception 'Selected Workshop connector is unavailable.' using errcode = '23514';
  end if;
  perform 1 from public.integration_connection_departments mapping
    where mapping.connection_id = connection.id
      and mapping.organization_id = p_organization_id
      and mapping.department_id = conversation.department_id
    for share;
  if not found then
    raise exception 'Selected Workshop department mapping is unavailable.' using errcode = '23514';
  end if;
  perform 1 from public.integration_connection_engagements mapping
    where mapping.connection_id = connection.id
      and mapping.organization_id = p_organization_id
      and mapping.engagement_id = conversation.engagement_id
      and mapping.department_id = conversation.department_id
    for share;
  if not found then
    raise exception 'Selected Workshop engagement mapping is unavailable.' using errcode = '23514';
  end if;
  select * into configuration from public.department_chat_model_configurations
    where id = reservation.workshop_chat_model_configuration_id
      and organization_id = p_organization_id
      and department_id = conversation.department_id
      and connector_connection_id = connection.id
      and revoked_at is null
    for share;
  if not found or not (
    connection.public_config ->> 'model_id' = configuration.model_id
    or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? configuration.model_id
  ) then
    raise exception 'Selected Workshop model is stale.' using errcode = '23514';
  end if;
  perform public.assert_department_chat_model_dispatch(
    configuration.id, p_organization_id, conversation.engagement_id,
    conversation.department_id, connection.id, configuration.model_id, p_actor_id
  );
  perform public.mark_department_chat_turn_dispatched(
    p_message_id, conversation.id, p_organization_id, conversation.project_id,
    conversation.engagement_id, conversation.department_id, p_actor_id
  );
  insert into private.workshop_chat_dispatch_claims (
    organization_id, reservation_id, conversation_id, message_id,
    model_configuration_id, connector_connection_id, provider, model_id,
    actor_id, dispatch_request_id, prompt_sha256
  ) values (
    p_organization_id, reservation.id, conversation.id, p_message_id,
    configuration.id, connection.id, connection.provider, configuration.model_id,
    p_actor_id, p_dispatch_request_id, p_prompt_sha256
  ) returning id into new_id;
  return jsonb_build_object('status', 'claimed', 'must_not_submit', false,
    'claim_id', new_id, 'model_configuration_id', configuration.id,
    'connector_connection_id', connection.id, 'provider', connection.provider,
    'model_id', configuration.model_id);
end;
$$;
revoke all on function public.claim_workshop_chat_dispatch(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_workshop_chat_dispatch(uuid,uuid,uuid,uuid,text)
  to service_role;

create function public.reconcile_workshop_chat_budget(
  p_organization_id uuid, p_message_id uuid, p_outcome text,
  p_actual_cost_microusd bigint, p_ai_run_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  reservation private.ai_execution_step_budget_reservations;
  outcome text := btrim(coalesce(p_outcome, ''));
  evidence text := btrim(coalesce(p_evidence, ''));
  has_claim boolean;
begin
  if p_organization_id is null or p_message_id is null
    or outcome not in ('uncertain', 'settled', 'released')
    or length(evidence) not between 1 and 1000
    or (outcome = 'settled' and (p_actual_cost_microusd is null
      or p_actual_cost_microusd < 0 or p_ai_run_id is null))
    or (outcome <> 'settled' and (p_actual_cost_microusd is not null or p_ai_run_id is not null)) then
    raise exception 'A valid Workshop outcome and evidence are required.' using errcode = '22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Organization budget is not configured.' using errcode = '42501';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and workshop_chat_message_id = p_message_id
    for update;
  if not found then
    raise exception 'Workshop reservation not found.' using errcode = 'P0002';
  end if;
  select exists(select 1 from private.workshop_chat_dispatch_claims claim
    where claim.reservation_id = reservation.id) into has_claim;
  if (outcome = 'released' and has_claim)
    or (outcome in ('uncertain', 'settled') and not has_claim) then
    raise exception 'Workshop outcome conflicts with its provider claim.' using errcode = '55000';
  end if;
  if outcome = 'settled' and p_actual_cost_microusd > reservation.max_cost_microusd then
    raise exception 'Measured cost exceeds the reserved maximum.' using errcode = '22003';
  end if;
  if reservation.status = outcome then
    if reservation.actual_cost_microusd is distinct from p_actual_cost_microusd
      or reservation.ai_run_id is distinct from p_ai_run_id
      or reservation.outcome_evidence <> evidence then
      raise exception 'Conflicting Workshop reconciliation retry.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', reservation.id, 'status', outcome,
      'actual_cost_microusd', reservation.actual_cost_microusd, 'idempotent_replay', true);
  end if;
  if reservation.status in ('settled', 'released') then
    raise exception 'Terminal Workshop reservation cannot change.' using errcode = '55000';
  end if;
  if outcome = 'settled' and not exists (
    select 1 from public.ai_runs run
    join public.department_chat_messages message
      on message.id = reservation.workshop_chat_message_id
     and message.organization_id = reservation.organization_id
     and message.ai_run_id = run.id
     and message.conversation_id = reservation.workshop_chat_conversation_id
     and message.author_id = reservation.actor_id
     and message.role = 'user' and message.status = 'completed'
    join public.department_chat_model_configurations configuration
      on configuration.id = reservation.workshop_chat_model_configuration_id
     and configuration.organization_id = reservation.organization_id
    join public.integration_connections connection
      on connection.id = configuration.connector_connection_id
     and connection.organization_id = configuration.organization_id
    where run.id = p_ai_run_id and run.organization_id = p_organization_id
      and run.user_id = reservation.actor_id and run.status = 'completed'
      and run.capability = 'department_chat_answer'
      and run.department_chat_conversation_id = reservation.workshop_chat_conversation_id
      and run.department_chat_model_configuration_id = configuration.id
      and run.model = configuration.model_id and run.provider = connection.provider
      and run.estimated_cost_microusd = p_actual_cost_microusd
      and exists (select 1 from public.department_chat_messages reply
        where reply.conversation_id = message.conversation_id
          and reply.organization_id = message.organization_id
          and reply.client_request_id = message.client_request_id
          and reply.role = 'assistant' and reply.status = 'completed'
          and reply.ai_run_id = run.id)
  ) then
    raise exception 'Completed Workshop answer does not match the reserved turn.'
      using errcode = '23514';
  end if;
  update private.ai_execution_step_budget_reservations
    set status = outcome, actual_cost_microusd = p_actual_cost_microusd,
      ai_run_id = p_ai_run_id, outcome_evidence = evidence,
      reconciled_at = clock_timestamp()
    where id = reservation.id;
  insert into private.ai_execution_step_budget_events(
    reservation_id, organization_id, transition, actual_cost_microusd, evidence
  ) values (reservation.id, p_organization_id, outcome, p_actual_cost_microusd, evidence);
  return jsonb_build_object('reservation_id', reservation.id, 'status', outcome,
    'actual_cost_microusd', p_actual_cost_microusd, 'idempotent_replay', false);
end;
$$;
revoke all on function public.reconcile_workshop_chat_budget(uuid,uuid,text,bigint,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_workshop_chat_budget(uuid,uuid,text,bigint,uuid,text)
  to service_role;

create function public.complete_workshop_chat_answer_with_budget(
  p_conversation_id uuid, p_message_id uuid,
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_department_id text, p_actor_id uuid,
  p_model_configuration_id uuid, p_connector_connection_id uuid, p_model_id text,
  p_context_manifest jsonb, p_output_text text,
  p_latency_ms integer, p_input_tokens integer, p_output_tokens integer,
  p_actual_cost_microusd bigint, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  reservation private.ai_execution_step_budget_reservations;
  claim private.workshop_chat_dispatch_claims;
  configuration public.department_chat_model_configurations;
  connection public.integration_connections;
  saved jsonb;
  run_id uuid;
  complete_manifest jsonb;
begin
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Organization budget is not configured.' using errcode = '42501';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and workshop_chat_message_id = p_message_id
    for update;
  if not found or reservation.actor_id <> p_actor_id
    or reservation.workshop_chat_conversation_id <> p_conversation_id
    or reservation.workshop_chat_model_configuration_id <> p_model_configuration_id
    or reservation.status not in ('reserved', 'uncertain', 'settled') then
    raise exception 'Exact Workshop reservation is required.' using errcode = '42501';
  end if;
  select * into claim from private.workshop_chat_dispatch_claims
    where reservation_id = reservation.id and organization_id = p_organization_id
      and message_id = p_message_id and conversation_id = p_conversation_id
      and model_configuration_id = p_model_configuration_id and actor_id = p_actor_id;
  if not found then
    raise exception 'Exact Workshop dispatch claim is required.' using errcode = '42501';
  end if;
  if claim.connector_connection_id <> p_connector_connection_id
    or claim.model_id <> p_model_id then
    raise exception 'Workshop provider route differs from dispatch claim.' using errcode = '23514';
  end if;
  select * into configuration from public.department_chat_model_configurations
    where id = p_model_configuration_id and organization_id = p_organization_id
      and connector_connection_id = p_connector_connection_id
      and department_id = p_department_id and model_id = p_model_id;
  if not found then
    raise exception 'Workshop model identity differs from claim.' using errcode = '23514';
  end if;
  select * into connection from public.integration_connections
    where id = p_connector_connection_id and organization_id = p_organization_id
      and provider in ('openai', 'anthropic', 'google_gemini');
  if not found or connection.provider <> claim.provider then
    raise exception 'Workshop provider identity differs from claim.' using errcode = '23514';
  end if;
  if coalesce(p_context_manifest ->> 'prompt_sha256', '') <> claim.prompt_sha256 then
    raise exception 'Workshop prompt differs from dispatch claim.' using errcode = '23514';
  end if;
  complete_manifest := p_context_manifest || jsonb_build_object(
    'dispatch_claim_id', claim.id, 'provider', connection.provider
  );
  saved := public.complete_department_chat_answer(
    p_conversation_id, p_message_id, p_organization_id, p_project_id,
    p_engagement_id, p_department_id, p_actor_id, p_model_configuration_id,
    p_connector_connection_id, p_model_id, complete_manifest, p_output_text,
    p_latency_ms, p_input_tokens, p_output_tokens, p_actual_cost_microusd
  );
  run_id := (saved ->> 'ai_run_id')::uuid;
  update public.ai_runs set provider = connection.provider
    where id = run_id and organization_id = p_organization_id
      and department_chat_conversation_id = p_conversation_id
      and department_chat_model_configuration_id = p_model_configuration_id;
  if not found then
    raise exception 'Completed Workshop run was not persisted.' using errcode = '23514';
  end if;
  perform public.reconcile_workshop_chat_budget(
    p_organization_id, p_message_id, 'settled', p_actual_cost_microusd,
    run_id, p_evidence
  );
  return saved;
end;
$$;
revoke all on function public.complete_workshop_chat_answer_with_budget(
  uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,jsonb,text,integer,integer,integer,bigint,text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_workshop_chat_answer_with_budget(
  uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,jsonb,text,integer,integer,integer,bigint,text
) to service_role;
-- Ordinary answers must persist through the wrapper that settles the shared
-- reservation in the same transaction. Proposal-mode functions are unchanged.
revoke execute on function public.complete_department_chat_answer(
  uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,jsonb,text,integer,integer,integer,bigint
) from service_role;

create function public.mark_workshop_chat_outcome_unknown(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  reservation private.ai_execution_step_budget_reservations;
  conversation public.department_chat_conversations;
  message public.department_chat_messages;
begin
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Organization budget is not configured.' using errcode = '42501';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and workshop_chat_message_id = p_message_id
    for update;
  if not found or reservation.actor_id <> p_actor_id then
    raise exception 'Exact Workshop reservation is required.' using errcode = '42501';
  end if;
  perform 1 from private.workshop_chat_dispatch_claims claim
    where claim.reservation_id = reservation.id;
  if not found then
    raise exception 'Claimed Workshop turn is required.' using errcode = '42501';
  end if;
  select * into conversation from public.department_chat_conversations
    where id = reservation.workshop_chat_conversation_id
      and organization_id = p_organization_id;
  if not found then
    raise exception 'Workshop conversation is unavailable.' using errcode = '42501';
  end if;
  message := public.mark_department_chat_turn_unknown(
    p_message_id, conversation.id, p_organization_id, conversation.project_id,
    conversation.engagement_id, conversation.department_id, p_actor_id
  );
  perform public.reconcile_workshop_chat_budget(
    p_organization_id, p_message_id, 'uncertain', null, null, p_evidence
  );
  return jsonb_build_object('message_id', message.id, 'status', message.status,
    'must_not_submit', true);
end;
$$;
revoke all on function public.mark_workshop_chat_outcome_unknown(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_workshop_chat_outcome_unknown(uuid,uuid,uuid,text)
  to service_role;

create function private.require_claimed_workshop_turn_reconciled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reservation private.ai_execution_step_budget_reservations;
begin
  if new.role <> 'user' or new.status not in ('completed', 'unknown', 'failed', 'unsupported')
    or old.status = new.status then
    return new;
  end if;
  select step_reservation.* into reservation
    from private.workshop_chat_dispatch_claims claim
    join private.ai_execution_step_budget_reservations step_reservation
      on step_reservation.id = claim.reservation_id
    where claim.organization_id = new.organization_id and claim.message_id = new.id;
  if not found then return new; end if;
  if (new.status = 'completed' and (
    reservation.status <> 'settled' or reservation.ai_run_id is distinct from new.ai_run_id))
    or (new.status = 'unknown' and reservation.status <> 'uncertain')
    or new.status in ('failed', 'unsupported') then
    raise exception 'Claimed Workshop turn and budget must finish atomically.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.require_claimed_workshop_turn_reconciled()
  from public, anon, authenticated, service_role;
create constraint trigger claimed_workshop_turn_reconciled
  after update on public.department_chat_messages
  deferrable initially deferred
  for each row execute function private.require_claimed_workshop_turn_reconciled();

-- A stale-turn sweep must leave claimed turns for explicit reconciliation.
-- Otherwise its bulk update to unknown would violate the claimed-turn/budget
-- atomicity trigger and roll back expiry for unrelated unclaimed messages.
create or replace function public.expire_department_chat_pending_turns(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  update public.department_chat_messages message
  set status = case when provider_dispatched_at is null then 'failed' else 'unknown' end,
      error_code = case when provider_dispatched_at is null then 'interrupted' else 'outcome_unknown' end,
      finished_at = now()
  where message.conversation_id = p_conversation_id
    and message.organization_id = p_organization_id
    and message.author_id = p_actor_id
    and message.role = 'user' and message.status = 'pending'
    and message.created_at <= now() - interval '2 minutes'
    and not exists (select 1 from private.workshop_chat_dispatch_claims claim
      where claim.organization_id = message.organization_id
        and claim.message_id = message.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_department_chat_pending_turns(uuid,uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_department_chat_pending_turns(uuid,uuid,uuid,uuid,text,uuid)
  to service_role;

create or replace function private.prevent_claimed_context_budget_release()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'released' and old.status <> 'released' and (
    (old.context_chat_message_id is not null
      and exists (select 1 from private.context_chat_dispatch_claims claim
        where claim.reservation_id = old.id))
    or (old.workshop_chat_message_id is not null
      and exists (select 1 from private.workshop_chat_dispatch_claims claim
        where claim.reservation_id = old.id))
  ) then
    raise exception 'Claimed AI cost requires settlement or explicit independent review.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
commit;
