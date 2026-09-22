-- Shared N6 organization cap for future private organization conversation replies.
-- Reuses the active step ledger so pipeline and conversation reservations are
-- serialized on one budget row and counted by the existing N6 step preflight.
-- No budget row, provider dispatch, or browser write is introduced.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ai_runs
  add column context_chat_message_id uuid,
  add constraint ai_runs_context_chat_message_fkey
    foreign key (context_chat_message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  add constraint ai_runs_context_chat_message_scope_check check (
    (capability = 'context_chat_answer' and context_chat_message_id is not null)
    or (capability <> 'context_chat_answer' and context_chat_message_id is null)
  );
create function private.assert_context_chat_ai_run_message()
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
      and conversation.context_kind = 'organization'
  ) then
    raise exception 'Private AI run must bind its completed owner message.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_context_chat_ai_run_message
  before insert or update of context_chat_message_id, context_chat_conversation_id,
    organization_id, user_id on public.ai_runs
  for each row execute function private.assert_context_chat_ai_run_message();
revoke all on function private.assert_context_chat_ai_run_message()
  from public, anon, authenticated;

alter table private.ai_execution_step_budget_reservations
  alter column job_id drop not null,
  alter column configured_step_id drop not null,
  add column context_chat_message_id uuid,
  add column context_chat_conversation_id uuid,
  add column context_chat_model_configuration_id uuid,
  add constraint ai_execution_step_budget_reservations_source_check check (
    (job_id is not null and configured_step_id is not null
      and context_chat_message_id is null and context_chat_conversation_id is null
      and context_chat_model_configuration_id is null)
    or (job_id is null and configured_step_id is null
      and context_chat_message_id is not null and context_chat_conversation_id is not null
      and context_chat_model_configuration_id is not null)
  ),
  add constraint ai_execution_step_budget_context_message_fkey
    foreign key (context_chat_message_id, organization_id)
    references public.department_chat_messages(id, organization_id) on delete restrict,
  add constraint ai_execution_step_budget_context_conversation_fkey
    foreign key (context_chat_conversation_id, organization_id, actor_id)
    references public.department_chat_conversations(id, organization_id, owner_id) on delete restrict,
  add constraint ai_execution_step_budget_context_model_fkey
    foreign key (context_chat_model_configuration_id, organization_id)
    references public.context_chat_organization_models(id, organization_id) on delete restrict;
create unique index ai_execution_step_budget_context_message_unique
  on private.ai_execution_step_budget_reservations(organization_id, context_chat_message_id)
  where context_chat_message_id is not null;
create index ai_execution_step_budget_context_conversation
  on private.ai_execution_step_budget_reservations(organization_id, context_chat_conversation_id, created_at desc)
  where context_chat_conversation_id is not null;

create function public.reserve_context_chat_budget(
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
      and conversation.context_kind = 'organization'
      and conversation.state = 'active'
      and message.id = p_message_id
      and message.author_id = p_actor_id
      and message.role = 'user' and message.status = 'completed'
    for share of conversation, message;
  if not found then
    raise exception 'Current owner-controlled human turn is required.' using errcode = '42501';
  end if;
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
revoke all on function public.reserve_context_chat_budget(uuid,uuid,uuid,uuid,uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_context_chat_budget(uuid,uuid,uuid,uuid,uuid,bigint)
  to service_role;

create function public.reconcile_context_chat_budget(
  p_organization_id uuid, p_message_id uuid, p_outcome text,
  p_actual_cost_microusd bigint, p_ai_run_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  reservation private.ai_execution_step_budget_reservations;
  outcome text := btrim(coalesce(p_outcome, ''));
  evidence text := btrim(coalesce(p_evidence, ''));
begin
  if p_organization_id is null or p_message_id is null
    or outcome not in ('uncertain', 'settled', 'released')
    or length(evidence) not between 1 and 1000
    or (outcome = 'settled' and (p_actual_cost_microusd is null
      or p_actual_cost_microusd < 0 or p_ai_run_id is null))
    or (outcome <> 'settled' and (p_actual_cost_microusd is not null or p_ai_run_id is not null)) then
    raise exception 'A valid conversation outcome and evidence are required.' using errcode = '22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then raise exception 'Organization budget is not configured.' using errcode = '42501'; end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id for update;
  if not found then raise exception 'Conversation reservation not found.' using errcode = 'P0002'; end if;
  if outcome = 'settled' and p_actual_cost_microusd > reservation.max_cost_microusd then
    raise exception 'Measured cost exceeds the reserved maximum.' using errcode = '22003';
  end if;
  if reservation.status = outcome then
    if reservation.actual_cost_microusd is distinct from p_actual_cost_microusd
      or reservation.ai_run_id is distinct from p_ai_run_id
      or reservation.outcome_evidence <> evidence then
      raise exception 'Conflicting conversation reconciliation retry.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', reservation.id, 'status', outcome,
      'actual_cost_microusd', reservation.actual_cost_microusd, 'idempotent_replay', true);
  end if;
  if reservation.status in ('settled', 'released') then
    raise exception 'Terminal conversation reservation cannot change.' using errcode = '55000';
  end if;
  if outcome = 'settled' and not exists (
    select 1 from public.ai_runs run
    where run.id = p_ai_run_id and run.organization_id = p_organization_id
      and run.user_id = reservation.actor_id and run.status = 'completed'
      and run.capability = 'context_chat_answer'
      and run.context_chat_conversation_id = reservation.context_chat_conversation_id
      and run.context_chat_message_id = reservation.context_chat_message_id
      and run.context_chat_model_configuration_id = reservation.context_chat_model_configuration_id
      and run.estimated_cost_microusd = p_actual_cost_microusd
  ) then
    raise exception 'Completed AI run does not match the reserved conversation turn.' using errcode = '23514';
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
revoke all on function public.reconcile_context_chat_budget(uuid,uuid,text,bigint,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_context_chat_budget(uuid,uuid,text,bigint,uuid,text)
  to service_role;
comment on table private.ai_execution_step_budget_reservations is
  'Shared N6 step and organization-private conversation reservations under one atomic organization cap.';
commit;
