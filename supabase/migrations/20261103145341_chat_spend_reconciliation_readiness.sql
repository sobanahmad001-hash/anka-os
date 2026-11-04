-- Read-only availability and original-request recovery; no reservation reconciliation or paid dispatch.
begin;
do $guard$ begin
 if md5(pg_get_functiondef('get_ai_spend_guard_readiness(uuid,uuid)'::regprocedure)) is distinct from '62ab79f7248f1441e2786ad07246f0a2' then raise exception 'Chat recovery preimage changed: get_ai_spend_guard_readiness';end if;
 if md5(pg_get_functiondef('recover_context_chat_completed_run(uuid,uuid,uuid)'::regprocedure)) is distinct from '931d8fef3c09562ac40c2919bfa7d1c0' then raise exception 'Chat recovery preimage changed: recover_context_chat_completed_run';end if;
 if md5(pg_get_functiondef('private.assert_context_chat_owner_scope(uuid,uuid,uuid)'::regprocedure)) is distinct from 'ee924b6c07ec0ee68a90e0616610746d' then raise exception 'Chat owner scope preimage changed';end if;
end;$guard$;

CREATE OR REPLACE FUNCTION public.get_ai_spend_guard_readiness(p_organization_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mode text;
 cycle date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date;
 sources jsonb;unmeasured boolean;readiness text;
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
  select coalesce(jsonb_agg(distinct source order by source),'[]'::jsonb) into sources from (
    select case when r.design_media_job_id is not null then 'design_media'
      when r.design_video_job_id is not null then 'design_video'
      when r.run_plan_id is not null then 'pipeline' else 'other' end as source
    from private.ai_execution_budget_reservations r
    where r.organization_id=p_organization_id and r.cycle_month<>cycle and r.status in ('reserved','uncertain')
    union all
    select case when r.context_chat_message_id is not null then 'context_chat'
      when r.workshop_chat_message_id is not null then 'workshop_chat' else 'pipeline' end
    from private.ai_execution_step_budget_reservations r
    where r.organization_id=p_organization_id and r.cycle_month<>cycle and r.status in ('reserved','uncertain')
  ) pending;
  select exists(select 1 from public.ai_runs run
    where run.organization_id=p_organization_id and run.created_at>=timezone('UTC',cycle::timestamp)
      and run.created_at<timezone('UTC',cycle::timestamp+interval '1 month')
      and run.status='completed' and run.estimated_cost_microusd is null
      and not exists(select 1 from private.ai_execution_budget_reservations r where r.ai_run_id=run.id)
      and not exists(select 1 from private.ai_execution_step_budget_reservations r where r.ai_run_id=run.id)) into unmeasured;
  readiness:=case when mode is null then 'spend_tracking_unconfigured'
    when jsonb_array_length(sources)>0 then 'prior_cycle_reconciliation_required'
    when unmeasured then 'unmeasured_cost_reconciliation_required' else 'ready' end;
  return jsonb_build_object('spend_guard_mode',mode,
    'spend_tracking_configured',mode is not null,
    'local_monthly_cap_configured',coalesce(mode='local_monthly_cap',false),
    'external_provider_limit_verified',false,
    'spend_readiness_status',readiness,'budget_cycle',cycle,
    'reconciliation_sources',sources);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recover_context_chat_completed_run(p_organization_id uuid, p_message_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  reservation private.ai_execution_step_budget_reservations;
  claim private.context_chat_dispatch_claims;
  run public.ai_runs;
  evidence text;
  source_conversation uuid;
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
  select m.conversation_id into source_conversation
    from public.department_chat_messages m join public.department_chat_conversations c
      on c.id=m.conversation_id and c.organization_id=m.organization_id
    where m.id=p_message_id and m.organization_id=p_organization_id
      and m.owner_id=p_actor_id and m.author_id=p_actor_id and m.role='user' and m.status='completed'
      and c.owner_id=p_actor_id;
  if not found then raise exception 'Exact owned completed source turn is required' using errcode='42501';end if;
  perform private.assert_context_chat_owner_scope(p_organization_id,source_conversation,p_actor_id);
  perform 1 from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then return jsonb_build_object('status', 'no_run'); end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id
      and actor_id = p_actor_id for update;
  if not found then
    return jsonb_build_object('status','no_run','submission_status',
      case when not exists(select 1 from private.context_chat_dispatch_claims c
        where c.organization_id=p_organization_id and c.message_id=p_message_id)
      and not exists(select 1 from public.ai_runs a
        where a.organization_id=p_organization_id and a.context_chat_message_id=p_message_id)
      then 'no_submission_recorded' else 'unverified' end);
  end if;
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
$function$
;
commit;
