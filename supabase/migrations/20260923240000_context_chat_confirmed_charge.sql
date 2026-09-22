-- Independently account for a confirmed provider charge when no audited reply exists.
-- The single-use claim remains consumed; this does not authorize redispatch.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.context_chat_confirmed_charge_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  claim_id uuid not null unique references private.context_chat_dispatch_claims(id) on delete restrict,
  reservation_id uuid not null unique
    references private.ai_execution_step_budget_reservations(id) on delete restrict,
  request_id uuid not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  provider_reference text not null check (length(provider_reference) between 8 and 160),
  provider_checked_at timestamptz not null,
  actual_cost_microusd bigint not null check (actual_cost_microusd > 0),
  evidence text not null check (length(evidence) between 20 and 1000),
  reviewed_at timestamptz not null default clock_timestamp(),
  unique (organization_id, request_id)
);
alter table private.context_chat_confirmed_charge_reviews enable row level security;
revoke all on private.context_chat_confirmed_charge_reviews
  from public, anon, authenticated, service_role;
create trigger protect_context_chat_confirmed_charge_reviews before update or delete
  on private.context_chat_confirmed_charge_reviews for each row
  execute function private.reject_pipeline_template_mutation();

create function public.settle_context_chat_confirmed_charge(
  p_organization_id uuid, p_message_id uuid, p_request_id uuid,
  p_provider_reference text, p_provider_checked_at timestamptz,
  p_actual_cost_microusd bigint, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reviewer uuid := (select auth.uid());
  reservation private.ai_execution_step_budget_reservations;
  claim private.context_chat_dispatch_claims;
  previous private.context_chat_confirmed_charge_reviews;
  provider_reference text := btrim(coalesce(p_provider_reference, ''));
  evidence text := btrim(coalesce(p_evidence, ''));
  review_id uuid;
begin
  if reviewer is null or p_organization_id is null or p_message_id is null
    or p_request_id is null or length(provider_reference) not between 8 and 160
    or length(evidence) not between 20 and 1000
    or p_actual_cost_microusd is null or p_actual_cost_microusd <= 0
    or p_provider_checked_at is null or p_provider_checked_at > clock_timestamp() then
    raise exception 'Exact independent provider charge evidence is required.'
      using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = reviewer and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin');
  if not found then
    raise exception 'Current owner or operations review authority is required.' using errcode = '42501';
  end if;
  perform 1 from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then raise exception 'Organization budget is unavailable.' using errcode = '42501'; end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and context_chat_message_id = p_message_id
    for update;
  if not found or reservation.actor_id = reviewer then
    raise exception 'A different requester-owned reservation is required.' using errcode = '42501';
  end if;
  select * into claim from private.context_chat_dispatch_claims
    where reservation_id = reservation.id and organization_id = p_organization_id
      and message_id = p_message_id and actor_id = reservation.actor_id
      and conversation_id = reservation.context_chat_conversation_id
      and model_configuration_id = reservation.context_chat_model_configuration_id
    for share;
  if not found or p_provider_checked_at < claim.claimed_at then
    raise exception 'Provider evidence must follow the exact dispatch claim.' using errcode = '23514';
  end if;
  select * into previous from private.context_chat_confirmed_charge_reviews
    where organization_id = p_organization_id
      and (claim_id = claim.id or request_id = p_request_id);
  if found then
    if previous.claim_id <> claim.id or previous.request_id <> p_request_id
      or previous.reviewed_by <> reviewer
      or previous.provider_reference <> provider_reference
      or previous.provider_checked_at <> p_provider_checked_at
      or previous.actual_cost_microusd <> p_actual_cost_microusd
      or previous.evidence <> evidence or reservation.status <> 'settled'
      or reservation.ai_run_id is not null
      or reservation.actual_cost_microusd <> p_actual_cost_microusd then
      raise exception 'Charge review identity is already used for another decision.'
        using errcode = '23505';
    end if;
    return jsonb_build_object('charge_review_id', previous.id,
      'status', 'settled_without_reply', 'actual_cost_microusd', p_actual_cost_microusd,
      'idempotent_replay', true);
  end if;
  if reservation.status not in ('reserved', 'uncertain')
    or reservation.ai_run_id is not null
    or p_actual_cost_microusd > reservation.max_cost_microusd
    or exists (select 1 from public.ai_runs run
      where run.organization_id = p_organization_id
        and run.context_chat_message_id = p_message_id
        and run.capability = 'context_chat_answer') then
    raise exception 'Only an unresolved claim without an audited run can settle a charge.'
      using errcode = '55000';
  end if;
  insert into private.context_chat_confirmed_charge_reviews (
    organization_id, claim_id, reservation_id, request_id, reviewed_by,
    provider_reference, provider_checked_at, actual_cost_microusd, evidence
  ) values (
    p_organization_id, claim.id, reservation.id, p_request_id, reviewer,
    provider_reference, p_provider_checked_at, p_actual_cost_microusd, evidence
  ) returning id into review_id;
  update private.ai_execution_step_budget_reservations
    set status = 'settled', actual_cost_microusd = p_actual_cost_microusd,
      outcome_evidence = evidence, reconciled_at = clock_timestamp()
    where id = reservation.id;
  insert into private.ai_execution_step_budget_events (
    reservation_id, organization_id, transition, actual_cost_microusd, evidence
  ) values (
    reservation.id, p_organization_id, 'settled', p_actual_cost_microusd, evidence
  );
  return jsonb_build_object('charge_review_id', review_id,
    'status', 'settled_without_reply', 'actual_cost_microusd', p_actual_cost_microusd,
    'idempotent_replay', false);
end;
$$;
revoke all on function public.settle_context_chat_confirmed_charge(
  uuid,uuid,uuid,text,timestamptz,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_context_chat_confirmed_charge(
  uuid,uuid,uuid,text,timestamptz,bigint,text)
  to authenticated;
comment on table private.context_chat_confirmed_charge_reviews is
  'Immutable second-person billing attestations for claimed private replies charged without an audited answer.';
commit;
