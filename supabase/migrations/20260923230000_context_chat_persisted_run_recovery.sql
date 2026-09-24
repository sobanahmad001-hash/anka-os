-- Complete an already audited private AI reply without another provider dispatch.
-- Serialize run insertion and human billing review on the organization budget row.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create unique index ai_runs_context_chat_one_run_per_message
  on public.ai_runs(organization_id, context_chat_message_id)
  where context_chat_message_id is not null;

create function private.guard_context_chat_ai_run_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reservation private.ai_execution_step_budget_reservations;
  claim private.context_chat_dispatch_claims;
begin
  if new.context_chat_message_id is null then return new; end if;
  perform 1 from private.ai_execution_budget_limits
    where organization_id = new.organization_id for update;
  if not found then
    raise exception 'Private AI run requires an organization budget.' using errcode = '42501';
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = new.organization_id
      and context_chat_message_id = new.context_chat_message_id for update;
  if not found or reservation.status not in ('reserved', 'uncertain')
    or reservation.actor_id <> new.user_id
    or reservation.context_chat_conversation_id <> new.context_chat_conversation_id
    or reservation.context_chat_model_configuration_id <> new.context_chat_model_configuration_id
    or new.capability <> 'context_chat_answer' or new.status <> 'completed'
    or new.estimated_cost_microusd is null
    or new.estimated_cost_microusd < 0
    or new.estimated_cost_microusd > reservation.max_cost_microusd
    or length(btrim(coalesce(new.output_text, ''))) not between 1 and 80000 then
    raise exception 'Exact unresolved private AI reservation is required.' using errcode = '23514';
  end if;
  select * into claim from private.context_chat_dispatch_claims
    where reservation_id = reservation.id
      and organization_id = new.organization_id
      and message_id = new.context_chat_message_id
      and conversation_id = new.context_chat_conversation_id
      and model_configuration_id = new.context_chat_model_configuration_id
      and actor_id = new.user_id;
  if not found or new.context_manifest ->> 'dispatch_claim_id' is distinct from claim.id::text
    or new.context_manifest ->> 'prompt_sha256' is distinct from claim.prompt_sha256
    or length(btrim(coalesce(new.context_manifest ->> 'provider_response_id', ''))) = 0 then
    raise exception 'Private AI run must match the immutable provider claim.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_guard_context_chat_ai_run_insert
  before insert on public.ai_runs for each row
  execute function private.guard_context_chat_ai_run_insert();
revoke all on function private.guard_context_chat_ai_run_insert()
  from public, anon, authenticated, service_role;

create function public.recover_context_chat_completed_run(
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
revoke all on function public.recover_context_chat_completed_run(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.recover_context_chat_completed_run(uuid,uuid,uuid)
  to service_role;

create or replace function private.prevent_claimed_context_budget_release()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.context_chat_message_id is not null and new.status = 'released'
    and old.status <> 'released'
    and exists (select 1 from private.context_chat_dispatch_claims claim
      where claim.reservation_id = old.id) then
    if exists (select 1 from public.ai_runs run
      where run.organization_id = old.organization_id
        and run.context_chat_message_id = old.context_chat_message_id
        and run.capability = 'context_chat_answer') then
      raise exception 'An audited private AI run cannot be released as no charge.'
        using errcode = '55000';
    end if;
    if not exists (select 1 from private.context_chat_confirmed_release_reviews review
      where review.reservation_id = old.id
        and review.organization_id = old.organization_id
        and review.confirmed_no_charge) then
      raise exception 'Claimed conversation cost requires an independent confirmed no-charge review.'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_claimed_context_budget_release()
  from public, anon, authenticated, service_role;
commit;
