-- LOCAL DRAFT: no policy is seeded or activated by this migration.
-- Prospective text exposure is separate from unresolved historical media charges.
begin;
set local lock_timeout='5s';

alter table private.ai_execution_budget_limits add column project_chat_allowance_actions jsonb;

create function private.preserve_project_chat_allowance_actions() returns trigger
language plpgsql security invoker set search_path='' as $$
declare old_count integer;new_count integer;
begin
 if tg_op='TRUNCATE' then
  if exists(select 1 from private.ai_execution_budget_limits where project_chat_allowance_actions is not null) then
   raise exception 'Project Chat policy history cannot be truncated' using errcode='55000';
  end if;
  return null;
 end if;
 if tg_op='DELETE' then
  if old.project_chat_allowance_actions is not null then raise exception 'Project Chat policy history cannot be deleted' using errcode='55000';end if;
  return old;
 end if;
 if new.project_chat_allowance_actions is not distinct from old.project_chat_allowance_actions then return new;end if;
 if new.project_chat_allowance_actions is null or jsonb_typeof(new.project_chat_allowance_actions)<>'array' then
  raise exception 'Append-only Project Chat policy actions required' using errcode='55000';
 end if;
 old_count:=jsonb_array_length(coalesce(old.project_chat_allowance_actions,'[]'::jsonb));
 new_count:=jsonb_array_length(new.project_chat_allowance_actions);
 if new_count<>old_count+1 or new_count>64 or new.project_chat_allowance_actions->old_count is null
  or (new.project_chat_allowance_actions-old_count)<>coalesce(old.project_chat_allowance_actions,'[]'::jsonb) then
  raise exception 'Project Chat policy history must retain its exact prefix' using errcode='55000';
 end if;
 return new;
end;$$;
revoke all on function private.preserve_project_chat_allowance_actions() from public,anon,authenticated,service_role;
create trigger preserve_project_chat_allowance_actions before update or delete on private.ai_execution_budget_limits
 for each row execute function private.preserve_project_chat_allowance_actions();
create trigger preserve_project_chat_allowance_actions_truncate before truncate on private.ai_execution_budget_limits
 for each statement execute function private.preserve_project_chat_allowance_actions();

-- All callers first serialize on the existing organization budget row. This
-- returns metadata/digests, never old quoted amounts as a financial bound.
create function private.project_chat_prior_cost_snapshot(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r record;j private.design_media_generation_jobs;q private.design_media_quotes;
 d private.design_media_test_debits;b private.design_media_test_budgets;
 items jsonb:='[]'::jsonb;cycle date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date;
begin
 if exists(select 1 from private.ai_execution_step_budget_reservations
   where organization_id=p_org and cycle_month<>cycle and status in ('reserved','uncertain')) then
  return jsonb_build_object('eligible',false,'reason','unrelated_prior_hold');
 end if;
 select * into b from private.design_media_test_budgets where organization_id=p_org for share;
 for r in select * from private.ai_execution_budget_reservations
  where organization_id=p_org and cycle_month<>cycle and status in ('reserved','uncertain') order by id for share
 loop
  if jsonb_array_length(items)>=50 or r.status<>'uncertain' or r.actor_id<>p_actor
   or r.actual_cost_microusd is not null or r.ai_run_id is not null
   or r.design_media_job_id is null or r.run_plan_id is not null or r.design_video_job_id is not null then
   return jsonb_build_object('eligible',false,'reason','unrelated_prior_hold');
  end if;
  select * into j from private.design_media_generation_jobs where id=r.design_media_job_id and organization_id=p_org for share;
  if not found or j.actor_id<>p_actor or j.status<>'ready' or j.request->>'provider' is distinct from 'higgsfield'
   or j.provider_receipt->>'state' is distinct from 'provider_completed'
   or nullif(j.provider_receipt->>'requestId','') is null then
   return jsonb_build_object('eligible',false,'reason','unverified_prior_source');
  end if;
  select * into q from private.design_media_quotes where id=j.quote_id and organization_id=p_org and actor_id=p_actor for share;
  if not found or q.price_basis is distinct from 'estimated' then
   return jsonb_build_object('eligible',false,'reason','unverified_prior_source');
  end if;
  select * into d from private.design_media_test_debits where reservation_id=r.id and job_id=j.id and organization_id=p_org and actor_id=p_actor for share;
  if not found or b.organization_id is null or b.estimated_risk_accepted_by is distinct from p_actor
   or b.estimated_risk_accepted_at is null or b.estimated_risk_accepted_at>j.created_at
   or b.estimated_valid_until is null or b.estimated_valid_until<j.created_at then
   return jsonb_build_object('eligible',false,'reason','unverified_prior_source');
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('reservation',r.id,'actor',r.actor_id,'cycle',r.cycle_month,
   'status',r.status,'original_reserved_estimate',r.max_cost_microusd,'job',j.id,'claim',j.claim_id,
   'quote',q.id,'request_checksum',q.request_checksum,'provider_request',j.provider_receipt->>'requestId',
   'debit',to_jsonb(d),'risk_actor',b.estimated_risk_accepted_by,'risk_at',b.estimated_risk_accepted_at,
   'risk_until',b.estimated_valid_until));
 end loop;
 return jsonb_build_object('eligible',jsonb_array_length(items)>0,'count',jsonb_array_length(items),
  'source_hash',encode(sha256(convert_to(items::text,'UTF8')),'hex'));
end;$$;
revoke all on function private.project_chat_prior_cost_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

-- This shared predicate is intended for both scoped preflight and the atomic
-- reserve/claim paths. Callers retain the normal current model/actor guards.
create function private.project_chat_allowance_context(p_org uuid,p_actor uuid,p_project uuid,p_model uuid,p_cost bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b private.ai_execution_budget_limits;a jsonb;s jsonb;used numeric;cycle date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date;
begin
 select * into b from private.ai_execution_budget_limits where organization_id=p_org;
 if not found or b.spend_guard_mode<>'provider_managed' then return jsonb_build_object('status','unavailable');end if;
 if p_cost is null or p_cost<0 then raise exception 'Nonnegative prospective exposure required' using errcode='22023';end if;
 a:=b.project_chat_allowance_actions->-1;
 if a is null or a->>'action'<>'activate' or a->>'actor_id' is distinct from p_actor::text
  or a->>'project_id' is distinct from p_project::text or a->>'model_configuration_id' is distinct from p_model::text
  or (a->>'expires_at')::timestamptz<=clock_timestamp() then return jsonb_build_object('status','inactive');end if;
 -- Setup authority must remain current, and the canonical project must remain active.
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=p_actor and status='active'
  and member_kind='team' and role='system_owner' for share;
 if not found then return jsonb_build_object('status','authority_changed');end if;
 perform 1 from public.projects where organization_id=p_org and id=p_project and archived_at is null for share;
 if not found then return jsonb_build_object('status','scope_changed');end if;
 s:=private.project_chat_prior_cost_snapshot(p_org,p_actor);
 if s->>'eligible' is distinct from 'true' or s->>'source_hash' is distinct from a->>'source_hash' then
  return jsonb_build_object('status','source_changed');
 end if;
 if exists(select 1 from public.ai_runs run where run.organization_id=p_org and run.status='completed'
  and run.created_at>=timezone('UTC',cycle::timestamp) and run.estimated_cost_microusd is null
  and not exists(select 1 from private.ai_execution_budget_reservations r where r.ai_run_id=run.id)
  and not exists(select 1 from private.ai_execution_step_budget_reservations r where r.ai_run_id=run.id)) then
  return jsonb_build_object('status','unmeasured_current_cost');
 end if;
 if exists(select 1 from private.ai_execution_budget_reservations r where r.organization_id=p_org
  and r.cycle_month=cycle and r.status in ('reserved','uncertain'))
 or exists(select 1 from private.ai_execution_step_budget_reservations r where r.organization_id=p_org
  and r.cycle_month=cycle and r.status in ('reserved','uncertain') and not exists(select 1 from private.ai_execution_step_budget_events e
   where e.reservation_id=r.id and e.organization_id=p_org and e.transition='reserved'
   and e.evidence='project_chat_allowance:'||(a->>'policy_id'))) then
  return jsonb_build_object('status','unrelated_current_hold');
 end if;
 select coalesce(sum(case when r.status='settled' then r.actual_cost_microusd
  when r.status in ('reserved','uncertain') then r.max_cost_microusd else 0 end),0) into used
 from private.ai_execution_step_budget_reservations r
 where r.organization_id=p_org and exists(select 1 from private.ai_execution_step_budget_events e
  where e.reservation_id=r.id and e.organization_id=p_org and e.transition='reserved'
  and e.evidence='project_chat_allowance:'||(a->>'policy_id'));
 if exists(select 1 from private.ai_execution_step_budget_reservations r
  where r.organization_id=p_org and r.status='settled' and r.actual_cost_microusd is null
  and exists(select 1 from private.ai_execution_step_budget_events e where e.reservation_id=r.id
   and e.organization_id=p_org and e.transition='reserved' and e.evidence='project_chat_allowance:'||(a->>'policy_id'))) then
  return jsonb_build_object('status','unmeasured_current_cost');
 end if;
 return jsonb_build_object('status',case when used+p_cost<=(a->>'cap_microusd')::bigint then 'available' else 'exhausted' end,
  'policy_id',a->>'policy_id','cap_microusd',(a->>'cap_microusd')::bigint,
  'remaining_microusd',greatest(0,(a->>'cap_microusd')::bigint-used),'expires_at',a->>'expires_at',
  'historical_costs_unresolved',true);
end;$$;
revoke all on function private.project_chat_allowance_context(uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;

create function public.preview_project_chat_allowance(p_org uuid,p_project uuid,p_model uuid,p_cap bigint,p_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();b private.ai_execution_budget_limits;s jsonb;review jsonb;
begin
 if actor is null then raise exception 'Authenticated owner required' using errcode='42501';end if;
 if p_cap is null or p_cap not between 1 and 1000000 or p_seconds is null or p_seconds not between 60 and 86400 then
  raise exception 'Explicit bounded text allowance and duration required' using errcode='22023';end if;
 select * into b from private.ai_execution_budget_limits where organization_id=p_org for update;
 if not found or b.spend_guard_mode<>'provider_managed' then raise exception 'Existing provider-managed tracking required' using errcode='42501';end if;
 perform public.assert_context_chat_organization_model(p_model,p_org,actor);
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=actor and status='active'
  and member_kind='team' and role='system_owner' for share;
 if not found then raise exception 'Current organization owner required' using errcode='42501';end if;
 perform 1 from public.projects where organization_id=p_org and id=p_project and archived_at is null for share;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 s:=private.project_chat_prior_cost_snapshot(p_org,actor);
 if s->>'eligible' is distinct from 'true' then raise exception 'Prior sources are not eligible for this separate policy' using errcode='55000';end if;
 if jsonb_array_length(coalesce(b.project_chat_allowance_actions,'[]'::jsonb))>=63 then
  raise exception 'Policy history cannot accept another activation; revocation remains available' using errcode='54000';end if;
 if b.project_chat_allowance_actions->-1->>'action'='activate'
  and (b.project_chat_allowance_actions->-1->>'expires_at')::timestamptz>clock_timestamp() then
  raise exception 'Revoke the existing policy before another activation' using errcode='55000';end if;
 review:=jsonb_build_object('organization_id',p_org,'actor_id',actor,'project_id',p_project,'model_configuration_id',p_model,
  'cap_microusd',p_cap,'duration_seconds',p_seconds,'source_hash',s->>'source_hash',
  'prior_action_count',jsonb_array_length(coalesce(b.project_chat_allowance_actions,'[]'::jsonb)),
  'prior_action',b.project_chat_allowance_actions->-1);
 return review||jsonb_build_object('review_hash',encode(sha256(convert_to(review::text,'UTF8')),'hex'),
  'historical_costs_unresolved',true,'historical_charge_may_exceed_estimate',true,'eligible_prior_count',s->'count');
end;$$;
revoke all on function public.preview_project_chat_allowance(uuid,uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_chat_allowance(uuid,uuid,uuid,bigint,integer) to authenticated;

create function public.apply_project_chat_allowance(p_org uuid,p_request uuid,p_action text,p_project uuid,p_model uuid,p_cap bigint,p_seconds integer,p_review_hash text,p_policy uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();b private.ai_execution_budget_limits;review jsonb;entry jsonb;prior jsonb;intent jsonb;intent_hash text;at_time timestamptz;
begin
 if actor is null or p_request is null or p_action is null or p_action not in ('activate','revoke') then
  raise exception 'Authenticated explicit policy action required' using errcode='42501';end if;
 select * into b from private.ai_execution_budget_limits where organization_id=p_org for update;
 if not found then raise exception 'Existing budget tracking required' using errcode='42501';end if;
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Active organization required' using errcode='42501';end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=actor and status='active'
  and member_kind='team' and role='system_owner' for share;
 if not found then raise exception 'Current organization owner required' using errcode='42501';end if;
 intent:=jsonb_build_object('actor',actor,'action',p_action,'project',p_project,'model',p_model,
  'cap',p_cap,'seconds',p_seconds,'review_hash',p_review_hash,'policy',p_policy);
 intent_hash:=encode(sha256(convert_to(intent::text,'UTF8')),'hex');
 select value into prior from jsonb_array_elements(coalesce(b.project_chat_allowance_actions,'[]'::jsonb))
  where value->>'request_id'=p_request::text;
 if found then
  if prior->>'intent_hash' is distinct from intent_hash then raise exception 'Policy request already has another payload' using errcode='23505';end if;
  return jsonb_build_object('action',prior,'idempotent_replay',true,'must_not_dispatch',true);
 end if;
 if p_action='activate' then
  if p_policy is not null then raise exception 'A new activation cannot select a prior policy' using errcode='22023';end if;
  review:=public.preview_project_chat_allowance(p_org,p_project,p_model,p_cap,p_seconds);
  if p_review_hash is null or p_review_hash is distinct from review->>'review_hash' then
   raise exception 'Exact current policy review required' using errcode='40001';end if;
  at_time:=clock_timestamp();
  entry:=jsonb_build_object('action','activate','policy_id',gen_random_uuid(),'request_id',p_request,'intent_hash',intent_hash,
   'actor_id',actor,'project_id',p_project,'model_configuration_id',p_model,'cap_microusd',p_cap,
   'source_hash',review->>'source_hash','review_hash',p_review_hash,'activated_at',at_time,
   'expires_at',at_time+make_interval(secs=>p_seconds),'duration_seconds',p_seconds);
 else
  prior:=b.project_chat_allowance_actions->-1;
  if p_policy is null or prior->>'action' is distinct from 'activate' or prior->>'policy_id' is distinct from p_policy::text
   or prior->>'actor_id' is distinct from actor::text then
   raise exception 'Exact owned active policy required for revocation' using errcode='42501';end if;
  if p_project is not null or p_model is not null or p_cap is not null or p_seconds is not null or p_review_hash is not null then
   raise exception 'Revocation cannot alter scope or allowance' using errcode='22023';end if;
  entry:=jsonb_build_object('action','revoke','policy_id',p_policy,'request_id',p_request,'intent_hash',intent_hash,
   'actor_id',actor,'revoked_at',clock_timestamp());
 end if;
 update private.ai_execution_budget_limits set project_chat_allowance_actions=coalesce(project_chat_allowance_actions,'[]'::jsonb)||jsonb_build_array(entry)
  where organization_id=p_org;
 return jsonb_build_object('action',entry,'idempotent_replay',false,'must_not_dispatch',true);
end;$$;
revoke all on function public.apply_project_chat_allowance(uuid,uuid,text,uuid,uuid,bigint,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.apply_project_chat_allowance(uuid,uuid,text,uuid,uuid,bigint,integer,text,uuid) to authenticated;

create function public.read_owned_project_chat_allowance(p_org uuid,p_project uuid,p_model uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();b private.ai_execution_budget_limits;a jsonb;last_action jsonb;
begin
 if actor is null then raise exception 'Authenticated owner required' using errcode='42501';end if;
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Current organization required' using errcode='42501';end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=actor and status='active'
  and member_kind='team' and role='system_owner' for share;
 if not found then raise exception 'Current organization owner required' using errcode='42501';end if;
 select * into b from private.ai_execution_budget_limits where organization_id=p_org;
 select value into a from jsonb_array_elements(coalesce(b.project_chat_allowance_actions,'[]'::jsonb)) with ordinality
  where value->>'action'='activate' and value->>'actor_id'=actor::text
   and value->>'project_id'=p_project::text and value->>'model_configuration_id'=p_model::text
  order by ordinality desc limit 1;
 if not found then return jsonb_build_object('status','none');end if;
 last_action:=b.project_chat_allowance_actions->-1;
 return jsonb_build_object('status',case when last_action->>'policy_id' is distinct from a->>'policy_id'
  or last_action->>'action'<>'activate' then 'revoked' when (a->>'expires_at')::timestamptz<=clock_timestamp() then 'expired' else 'active' end,
  'policy_id',a->>'policy_id','cap_microusd',(a->>'cap_microusd')::bigint,'expires_at',a->>'expires_at',
  'activated_at',a->>'activated_at','historical_costs_unresolved',true);
end;$$;
revoke all on function public.read_owned_project_chat_allowance(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_owned_project_chat_allowance(uuid,uuid,uuid) to authenticated;

create function public.read_project_chat_allowance(p_org uuid,p_actor uuid,p_conversation uuid,p_model uuid,p_cost bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project uuid;
begin
 perform 1 from private.ai_execution_budget_limits where organization_id=p_org for update;
 if not found then return jsonb_build_object('status','unavailable');end if;
 perform public.assert_context_chat_organization_model(p_model,p_org,p_actor);
 perform private.assert_context_chat_owner_scope(p_org,p_conversation,p_actor);
 select project_id into project from public.department_chat_conversations where id=p_conversation and organization_id=p_org
  and owner_id=p_actor and state='active' and context_kind='project_team';
 if not found then return jsonb_build_object('status','scope_unavailable');end if;
 if not exists(select 1 from private.ai_execution_budget_reservations where organization_id=p_org
   and cycle_month<>date_trunc('month',timezone('UTC',clock_timestamp()))::date and status in ('reserved','uncertain'))
  and not exists(select 1 from private.ai_execution_step_budget_reservations where organization_id=p_org
   and cycle_month<>date_trunc('month',timezone('UTC',clock_timestamp()))::date and status in ('reserved','uncertain')) then
  return jsonb_build_object('status','not_required');
 end if;
 return private.project_chat_allowance_context(p_org,p_actor,project,p_model,p_cost);
end;$$;
revoke all on function public.read_project_chat_allowance(uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.read_project_chat_allowance(uuid,uuid,uuid,uuid,bigint) to service_role;

do $guard$ begin
if md5(pg_get_functiondef('public.assert_context_chat_organization_model(uuid,uuid,uuid)'::regprocedure))<>'627e5abcd9dea62d4bb250a1d98c3ec9' then raise exception 'Current model authority preimage changed';end if;
if not (select relrowsecurity from pg_class where oid='private.ai_execution_budget_limits'::regclass)
 or has_table_privilege('anon','private.ai_execution_budget_limits','INSERT,UPDATE,DELETE')
 or has_table_privilege('authenticated','private.ai_execution_budget_limits','INSERT,UPDATE,DELETE')
 or has_table_privilege('service_role','private.ai_execution_budget_limits','INSERT,UPDATE,DELETE') then
 raise exception 'Existing closed budget policy table rights required';end if;
if md5(pg_get_functiondef('public.claim_context_chat_dispatch(uuid,uuid,uuid,uuid,text)'::regprocedure))<> 'ad615f22b703ac907745a6bb3a36f02b' then raise exception 'Current text budget preimage changed';end if;
if md5(pg_get_functiondef('public.reserve_context_chat_budget(uuid,uuid,uuid,uuid,uuid,bigint)'::regprocedure))<> '53b01bbbf2a4ae183bf2384cb774f26f' then raise exception 'Current text budget preimage changed';end if;
end;$guard$;
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
$function$;

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
    select project_id into selected_project from public.department_chat_conversations
      where id=p_conversation_id and organization_id=p_organization_id and owner_id=p_actor_id
        and context_kind='project_team' and state='active';
    allowance:=private.project_chat_allowance_context(p_organization_id,p_actor_id,selected_project,p_model_configuration_id,p_max_cost_microusd);
    if allowance->>'status' is distinct from 'available' then
      raise exception 'Prior-cycle unresolved reservations require reconciliation or an available separately approved Project Chat allowance.' using errcode='55000';
    end if;
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
  insert into private.ai_execution_step_budget_events(reservation_id, organization_id, transition,evidence)
    values(new_id, p_organization_id, 'reserved',case when allowance->>'status'='available'
      then 'project_chat_allowance:'||(allowance->>'policy_id') else '' end);
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$function$;

commit;
