-- Direct human approved Anka Sphere Project Chat-only usage accounting policy.
-- Other scopes keep their existing financial gates; no historical charge is changed.
begin;
do $guard$ begin
 if md5(pg_get_functiondef('private.assert_context_chat_owner_scope(uuid,uuid,uuid)'::regprocedure)) is distinct from 'ee924b6c07ec0ee68a90e0616610746d' then raise exception 'Preimage changed: assert_context_chat_owner_scope';end if;
 if md5(pg_get_functiondef('public.assert_context_chat_organization_model(uuid,uuid,uuid)'::regprocedure)) is distinct from '627e5abcd9dea62d4bb250a1d98c3ec9' then raise exception 'Preimage changed: assert_context_chat_organization_model';end if;
 if md5(pg_get_functiondef('public.claim_context_chat_dispatch(uuid,uuid,uuid,uuid,text)'::regprocedure)) is distinct from 'a39ec9f5a837d0c4b2f2127c242b50f2' then raise exception 'Preimage changed: claim_context_chat_dispatch';end if;
 if md5(pg_get_functiondef('public.get_ai_spend_guard_readiness(uuid,uuid)'::regprocedure)) is distinct from '535c4ec75cf38f8387b53f43b456ee4d' then raise exception 'Preimage changed: get_ai_spend_guard_readiness';end if;
 if md5(pg_get_functiondef('public.reconcile_context_chat_budget(uuid,uuid,text,bigint,uuid,text)'::regprocedure)) is distinct from '6aeb6ca8dad2e600374dbe10017d059a' then raise exception 'Preimage changed: reconcile_context_chat_budget';end if;
 if md5(pg_get_functiondef('public.reserve_context_chat_budget(uuid,uuid,uuid,uuid,uuid,bigint)'::regprocedure)) is distinct from '8eca1c1cfbc2f9b884769f84a62c3420' then raise exception 'Preimage changed: reserve_context_chat_budget';end if;
 if to_regprocedure('private.project_chat_usage_only_context(uuid,uuid,uuid,uuid)') is not null
  or to_regprocedure('public.read_project_chat_spend_policy(uuid,uuid,uuid,uuid,uuid)') is not null then
  raise exception 'Project Chat usage policy namespace already exists';
 end if;
end;$guard$;
alter table private.ai_execution_budget_limits add column project_chat_spend_mode text not null default 'guarded'
 check(project_chat_spend_mode in ('guarded','usage_only'));
do $scope$ declare target uuid;matches bigint;begin
 select count(*),min(id::text)::uuid into matches,target from public.organizations where name='Anka Sphere' and status='active';
 if matches<>1 or target is distinct from '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid then raise exception 'Exact existing active Anka Sphere organization required';end if;
 perform 1 from public.organizations where id=target and name='Anka Sphere' and status='active' for share;
 if not found then raise exception 'Anka Sphere organization changed';end if;
 update private.ai_execution_budget_limits set project_chat_spend_mode='usage_only' where organization_id=target;
 if not found then raise exception 'Existing Anka Sphere spend configuration required';end if;
end;$scope$;

create function private.project_chat_usage_only_context(p_org uuid,p_actor uuid,p_project uuid,p_model uuid)
returns boolean language plpgsql set search_path='' as $function$
declare mode text;
begin
 select project_chat_spend_mode into mode from private.ai_execution_budget_limits
   where organization_id=p_org for update;
 if not found then return false;end if;
 perform public.assert_context_chat_organization_model(p_model,p_org,p_actor);
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for share;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 return mode='usage_only';
end;
$function$;
revoke all on function private.project_chat_usage_only_context(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.read_project_chat_spend_policy(p_org uuid,p_actor uuid,p_model uuid,p_conversation uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare selected_project uuid; kind text; state text;
begin
 perform 1 from private.ai_execution_budget_limits where organization_id=p_org for update;
 if not found then return jsonb_build_object('mode','guarded');end if;
 perform public.assert_context_chat_organization_model(p_model,p_org,p_actor);
 if p_conversation is not null then
  perform private.assert_context_chat_owner_scope(p_org,p_conversation,p_actor);
  select c.project_id,c.context_kind,c.state into selected_project,kind,state
    from public.department_chat_conversations c where c.id=p_conversation and c.organization_id=p_org and c.owner_id=p_actor;
  if state is distinct from 'active' then raise exception 'Active conversation required' using errcode='42501';end if;
  if kind is distinct from 'project_team' then return jsonb_build_object('mode','guarded');end if;
  if p_project is not null and p_project is distinct from selected_project then
    raise exception 'Project differs from conversation' using errcode='42501';
  end if;
 else selected_project:=p_project;
 end if;
 if selected_project is null then return jsonb_build_object('mode','guarded');end if;
 return jsonb_build_object('mode',case when private.project_chat_usage_only_context(p_org,p_actor,selected_project,p_model)
   then 'usage_only' else 'guarded' end);
end;
$function$;
revoke all on function public.read_project_chat_spend_policy(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_project_chat_spend_policy(uuid,uuid,uuid,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.reserve_context_chat_budget(p_organization_id uuid, p_conversation_id uuid, p_message_id uuid, p_model_configuration_id uuid, p_actor_id uuid, p_max_cost_microusd bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  budget private.ai_execution_budget_limits;
  existing private.ai_execution_step_budget_reservations;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  organization_total numeric;
  unlinked_total numeric;
  unknown_completed bigint;
  new_id uuid;
  allowance jsonb;
  usage_only boolean := false;
  selected_project uuid;
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
  select project_id into selected_project from public.department_chat_conversations
    where id=p_conversation_id and organization_id=p_organization_id and owner_id=p_actor_id
      and context_kind='project_team' and state='active';
  if found then
    usage_only:=private.project_chat_usage_only_context(p_organization_id,p_actor_id,selected_project,p_model_configuration_id);
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
  if not usage_only and unknown_completed > 0 then
    raise exception 'Unmeasured AI cost requires reconciliation first.' using errcode = '55000';
  end if;
  if not usage_only and (exists (select 1 from private.ai_execution_budget_reservations legacy
    where legacy.organization_id = p_organization_id
      and legacy.cycle_month <> cycle and legacy.status in ('reserved', 'uncertain'))
    or exists (select 1 from private.ai_execution_step_budget_reservations pending
    where pending.organization_id = p_organization_id
      and pending.cycle_month <> cycle and pending.status in ('reserved', 'uncertain'))) then
    select project_id into selected_project from public.department_chat_conversations
      where id=p_conversation_id and organization_id=p_organization_id and owner_id=p_actor_id
        and context_kind='project_team' and state='active';
    allowance:=private.project_chat_allowance_context(p_organization_id,p_actor_id,selected_project,p_model_configuration_id,p_max_cost_microusd);
    if allowance->>'status' is distinct from 'available' then
      raise exception 'Prior-cycle unresolved reservations require reconciliation or an available separately approved Project Chat allowance.' using errcode='55000';
    end if;
  end if;
  if not usage_only and budget.spend_guard_mode = 'local_monthly_cap'
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
  insert into private.ai_execution_step_budget_events(reservation_id, organization_id, transition,evidence)
    values(new_id, p_organization_id, 'reserved',case when usage_only then 'project_chat_usage_only' when allowance->>'status'='available'
      then 'project_chat_allowance:'||(allowance->>'policy_id') else '' end);
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_context_chat_dispatch(p_organization_id uuid, p_message_id uuid, p_actor_id uuid, p_dispatch_request_id uuid, p_prompt_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  reservation private.ai_execution_step_budget_reservations;
  existing private.context_chat_dispatch_claims;
  new_id uuid;
  allowance jsonb;
  selected_project uuid;
  policy_marker text;
begin
  if p_organization_id is null or p_message_id is null or p_actor_id is null
    or p_dispatch_request_id is null
    or p_prompt_sha256 !~ '^[0-9a-f]{64}$' or p_prompt_sha256 is null then
    raise exception 'Scoped dispatch identity and prompt hash are required.' using errcode = '22023';
  end if;
  perform 1 from private.ai_execution_budget_limits where organization_id=p_organization_id for update;
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
  select e.evidence into policy_marker from private.ai_execution_step_budget_events e
    where e.reservation_id=reservation.id and e.organization_id=p_organization_id and e.transition='reserved'
      and e.evidence like 'project_chat_allowance:%';
  if found then
    select project_id into selected_project from public.department_chat_conversations
      where id=reservation.context_chat_conversation_id and organization_id=p_organization_id
       and owner_id=p_actor_id and context_kind='project_team' and state='active';
    allowance:=private.project_chat_allowance_context(p_organization_id,p_actor_id,selected_project,
      reservation.context_chat_model_configuration_id,0);
    if allowance->>'status' is distinct from 'available'
      or policy_marker is distinct from 'project_chat_allowance:'||(allowance->>'policy_id') then
      raise exception 'Prospective Project Chat allowance changed before dispatch' using errcode='55000';
    end if;
  end if;
  if exists(select 1 from private.ai_execution_step_budget_events e
    where e.reservation_id=reservation.id and e.organization_id=p_organization_id
      and e.transition='reserved' and e.evidence='project_chat_usage_only') then
    select project_id into selected_project from public.department_chat_conversations
      where id=reservation.context_chat_conversation_id and organization_id=p_organization_id
        and owner_id=p_actor_id and context_kind='project_team' and state='active';
    if not found or not private.project_chat_usage_only_context(p_organization_id,p_actor_id,selected_project,
        reservation.context_chat_model_configuration_id) then
      raise exception 'Project Chat spending policy changed before dispatch' using errcode='55000';
    end if;
  end if;
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
$function$
;
commit;
