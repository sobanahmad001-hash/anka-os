-- Extend audited owner-private replies to project and department scopes.

-- All scopes retain the same organization-only verified model, shared cap, and immutable dispatch claim.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '120s';

create function private.assert_context_chat_owner_scope(
  p_organization_id uuid, p_conversation_id uuid, p_actor_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  conversation public.department_chat_conversations;
  membership public.organization_memberships;
begin
  select * into membership from public.organization_memberships
    where organization_id = p_organization_id and user_id = p_actor_id
      and member_kind = 'team' and status = 'active';
  if not found then
    raise exception 'Current team membership is required.' using errcode = '42501';
  end if;
  select * into conversation from public.department_chat_conversations
    where id = p_conversation_id and organization_id = p_organization_id
      and owner_id = p_actor_id;
  if not found or conversation.context_kind is null
    or conversation.context_kind not in ('organization', 'project_team', 'department_private') then
    raise exception 'Owned private conversation is required.' using errcode = '42501';
  end if;
  if conversation.context_kind = 'project_team' and not exists (
    select 1 from public.projects project
      where project.id = conversation.project_id
        and project.organization_id = p_organization_id
        and project.archived_at is null
  ) then
    raise exception 'Active project access is required.' using errcode = '42501';
  end if;
  if conversation.context_kind = 'department_private'
    and membership.role not in ('system_owner', 'operations_admin', 'executive')
    and membership.department_id is distinct from conversation.department_id
    and not exists (
      select 1 from public.organization_department_memberships department
        where department.organization_id = p_organization_id
          and department.user_id = p_actor_id
          and department.department_id = conversation.department_id
          and department.status = 'active'
    ) then
    raise exception 'Private Workshop department access is required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_context_chat_owner_scope(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.assert_context_chat_ai_run_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.context_chat_conversation_id is null then return new; end if;
  if not exists (
    select 1 from public.department_chat_conversations conversation
    join public.context_chat_organization_models configuration
      on configuration.id = new.context_chat_model_configuration_id
     and configuration.organization_id = conversation.organization_id
    join public.integration_connections connection
      on connection.id = configuration.connector_connection_id
     and connection.organization_id = configuration.organization_id
    where conversation.id = new.context_chat_conversation_id
      and conversation.organization_id = new.organization_id
      and conversation.owner_id = new.user_id
      and conversation.context_kind in ('organization', 'project_team', 'department_private')
      and configuration.model_id = new.model
      and connection.provider = new.provider
  ) then
    raise exception 'Private conversation AI audit scope or model identity mismatch.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.assert_context_chat_ai_run_message()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.context_chat_message_id is null then return new; end if;
  if not exists (
    select 1 from public.department_chat_messages message
    join public.department_chat_conversations conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
     and conversation.owner_id = message.owner_id
    where message.id = new.context_chat_message_id
      and message.organization_id = new.organization_id
      and message.owner_id = new.user_id
      and message.author_id = new.user_id
      and message.role = 'user' and message.status = 'completed'
      and conversation.id = new.context_chat_conversation_id
      and conversation.context_kind in ('organization', 'project_team', 'department_private')
  ) then
    raise exception 'Private AI run must bind its completed owner message.' using errcode = '23514';
  end if;
  return new;
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
  if organization_total + unlinked_total + p_max_cost_microusd > budget.monthly_limit_microusd then
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

create or replace function public.claim_context_chat_dispatch(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reservation private.ai_execution_step_budget_reservations;
  existing private.context_chat_dispatch_claims;
  new_id uuid;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null
    or p_dispatch_request_id is null
    or p_prompt_sha256 !~ '^[0-9a-f]{64}$' or p_prompt_sha256 is null then
    raise exception 'Scoped dispatch identity and prompt hash are required.' using errcode = '22023';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id
    for update;
  if not found or reservation.actor_id <> p_actor_id
    or reservation.context_chat_conversation_id is null
    or reservation.context_chat_model_configuration_id is null then
    raise exception 'Owned conversation reservation is required.' using errcode = '42501';
  end if;
  select * into existing from private.context_chat_dispatch_claims
    where reservation_id = reservation.id;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'Conversation turn already has another dispatch claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'already_claimed', 'must_not_submit', true,
      'claim_id', existing.id);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Only an unused reservation may be claimed.' using errcode = '55000';
  end if;
  perform public.assert_context_chat_organization_model(
    reservation.context_chat_model_configuration_id, p_organization_id, p_actor_id
  );
  perform 1 from public.department_chat_conversations conversation
    join public.department_chat_messages message
      on message.conversation_id = conversation.id
     and message.organization_id = conversation.organization_id
     and message.owner_id = conversation.owner_id
    where conversation.id = reservation.context_chat_conversation_id
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
  perform private.assert_context_chat_owner_scope(p_organization_id, reservation.context_chat_conversation_id, p_actor_id);
  insert into private.context_chat_dispatch_claims (
    organization_id, reservation_id, conversation_id, message_id,
    model_configuration_id, actor_id, dispatch_request_id, prompt_sha256
  ) values (
    p_organization_id, reservation.id, reservation.context_chat_conversation_id,
    p_message_id, reservation.context_chat_model_configuration_id, p_actor_id,
    p_dispatch_request_id, p_prompt_sha256
  ) returning id into new_id;
  return jsonb_build_object('status', 'claimed', 'must_not_submit', false,
    'claim_id', new_id, 'model_configuration_id',
    reservation.context_chat_model_configuration_id);
end;
$$;

create or replace function public.append_context_chat_audited_reply(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid
) returns public.department_chat_messages
language plpgsql security definer set search_path = '' as $$
declare
  conversation public.department_chat_conversations;
  source public.department_chat_messages;
  reservation private.ai_execution_step_budget_reservations;
  claim private.context_chat_dispatch_claims;
  run public.ai_runs;
  existing public.department_chat_messages;
  reply public.department_chat_messages;
  output_body text;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null then
    raise exception 'Exact private reply scope is required.' using errcode = '22023';
  end if;
  select * into source from public.department_chat_messages
    where id = p_message_id and organization_id = p_organization_id
      and owner_id = p_actor_id and author_id = p_actor_id
      and role = 'user' and status = 'completed';
  if not found then raise exception 'Completed owner-authored turn is required.' using errcode = '42501'; end if;
  select * into conversation from public.department_chat_conversations
    where id = source.conversation_id and organization_id = p_organization_id
      and owner_id = p_actor_id and context_kind in ('organization', 'project_team', 'department_private')
    for update;
  if not found then raise exception 'Private conversation is unavailable.' using errcode = '42501'; end if;
  perform private.assert_context_chat_owner_scope(p_organization_id, conversation.id, p_actor_id);
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = source.id
      and context_chat_conversation_id = conversation.id
      and actor_id = p_actor_id and status = 'settled';
  if not found or reservation.ai_run_id is null then
    raise exception 'Settled conversation reservation is required.' using errcode = '55000';
  end if;
  select * into claim from private.context_chat_dispatch_claims
    where reservation_id = reservation.id and organization_id = p_organization_id
      and message_id = source.id and actor_id = p_actor_id
      and conversation_id = conversation.id
      and model_configuration_id = reservation.context_chat_model_configuration_id;
  if not found then raise exception 'Exact single-use claim is required.' using errcode = '55000'; end if;
  select * into run from public.ai_runs
    where id = reservation.ai_run_id and organization_id = p_organization_id
      and user_id = p_actor_id and status = 'completed'
      and capability = 'context_chat_answer'
      and context_chat_message_id = source.id
      and context_chat_conversation_id = conversation.id
      and context_chat_model_configuration_id = claim.model_configuration_id;
  if not found then raise exception 'Matching completed AI audit is required.' using errcode = '55000'; end if;
  output_body := btrim(coalesce(run.output_text, ''));
  if length(output_body) not between 1 and 80000 then
    raise exception 'Audited reply body is invalid.' using errcode = '22023';
  end if;
  select * into existing from public.department_chat_messages
    where organization_id = p_organization_id and in_reply_to_message_id = source.id;
  if found then
    if existing.conversation_id <> conversation.id or existing.owner_id <> p_actor_id
      or existing.ai_run_id is distinct from run.id
      or existing.client_request_id <> claim.id or existing.body <> output_body
      or existing.status <> 'completed' then
      raise exception 'A different reply already exists for this turn.' using errcode = '23505';
    end if;
    return existing;
  end if;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, ai_run_id,
    client_request_id, sequence, finished_at, in_reply_to_message_id
  ) values (
    conversation.id, conversation.organization_id, conversation.project_id,
    conversation.engagement_id, conversation.department_id, conversation.owner_id,
    null, 'assistant', output_body, 'completed', run.id,
    claim.id, conversation.next_sequence, clock_timestamp(), source.id
  ) returning * into reply;
  update public.department_chat_conversations
    set next_sequence = next_sequence + 1,
      last_activity_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = conversation.id;
  return reply;
end;
$$;

create or replace function public.recover_context_chat_completed_run(
  p_organization_id uuid, p_message_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reservation private.ai_execution_step_budget_reservations;
  claim private.context_chat_dispatch_claims;
  run public.ai_runs;
  evidence text;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null then
    raise exception 'Exact private reply scope is required.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = p_actor_id and membership.member_kind = 'team'
      and membership.status = 'active';
  if not found then
    raise exception 'Current private conversation membership is required.' using errcode = '42501';
  end if;
  perform 1 from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then return jsonb_build_object('status', 'no_run'); end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id
      and actor_id = p_actor_id for update;
  if not found then return jsonb_build_object('status', 'no_run'); end if;
  perform private.assert_context_chat_owner_scope(p_organization_id, reservation.context_chat_conversation_id, p_actor_id);
  select * into claim from private.context_chat_dispatch_claims
    where reservation_id = reservation.id and organization_id = p_organization_id
      and message_id = p_message_id and actor_id = p_actor_id
      and conversation_id = reservation.context_chat_conversation_id
      and model_configuration_id = reservation.context_chat_model_configuration_id;
  if not found then return jsonb_build_object('status', 'no_run'); end if;
  select * into run from public.ai_runs
    where organization_id = p_organization_id and context_chat_message_id = p_message_id
      and user_id = p_actor_id and capability = 'context_chat_answer'
      and status = 'completed'
      and context_chat_conversation_id = claim.conversation_id
      and context_chat_model_configuration_id = claim.model_configuration_id
    for share;
  if not found then
    if reservation.status = 'settled' and reservation.ai_run_id is null then
      return jsonb_build_object('status', 'charged_without_reply');
    end if;
    return jsonb_build_object('status', 'no_run');
  end if;
  if run.context_manifest ->> 'dispatch_claim_id' is distinct from claim.id::text
    or run.context_manifest ->> 'prompt_sha256' is distinct from claim.prompt_sha256
    or length(btrim(coalesce(run.context_manifest ->> 'provider_response_id', ''))) = 0
    or length(btrim(coalesce(run.output_text, ''))) not between 1 and 80000
    or run.estimated_cost_microusd is null or run.estimated_cost_microusd < 0
    or run.estimated_cost_microusd > reservation.max_cost_microusd then
    raise exception 'Audited provider result does not match the private claim.' using errcode = '23514';
  end if;
  if reservation.status = 'settled' then
    if reservation.ai_run_id is distinct from run.id
      or reservation.actual_cost_microusd is distinct from run.estimated_cost_microusd then
      raise exception 'A different result settled this private claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('status', 'settled', 'ai_run_id', run.id,
      'idempotent_replay', true);
  end if;
  if reservation.status not in ('reserved', 'uncertain')
    or reservation.ai_run_id is not null then
    raise exception 'Private claim has a conflicting terminal outcome.' using errcode = '55000';
  end if;
  evidence := 'Recovered audited provider response ' ||
    left(run.context_manifest ->> 'provider_response_id', 900);
  perform public.reconcile_context_chat_budget(
    p_organization_id, p_message_id, 'settled',
    run.estimated_cost_microusd, run.id, evidence
  );
  return jsonb_build_object('status', 'settled', 'ai_run_id', run.id,
    'idempotent_replay', false);
end;
$$;

commit;
