-- A second current owner can close an entirely refused provider attempt.
-- The existing trigger requires confirmed rejection for every claimed route.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.ai_execution_confirmed_release_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  attempt_id uuid not null unique
    references private.ai_execution_step_attempts(id) on delete restrict,
  reservation_id uuid not null unique
    references private.ai_execution_step_budget_reservations(id) on delete restrict,
  request_id uuid not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  evidence text not null check (length(evidence) between 1 and 1000),
  reviewed_at timestamptz not null default clock_timestamp(),
  unique (organization_id, request_id)
);
alter table private.ai_execution_confirmed_release_reviews enable row level security;
revoke all on private.ai_execution_confirmed_release_reviews
  from public, anon, authenticated, service_role;
create trigger protect_ai_execution_confirmed_release_reviews before update or delete
  on private.ai_execution_confirmed_release_reviews for each row
  execute function private.reject_pipeline_template_mutation();

create function public.release_pipeline_ai_confirmed_refusal(
  p_organization_id uuid, p_attempt_id uuid, p_request_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  attempt private.ai_execution_step_attempts;
  reservation private.ai_execution_step_budget_reservations;
  previous private.ai_execution_confirmed_release_reviews;
  evidence text := trim(coalesce(p_evidence,''));
  result jsonb;
  review_id uuid;
begin
  if actor is null or p_organization_id is null or p_attempt_id is null
    or p_request_id is null or length(evidence) not between 1 and 1000 then
    raise exception 'Authenticated exact release request and evidence are required.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner','operations_admin');
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  if actor = attempt.actor_id then
    raise exception 'The requester cannot release their own provider reservation.' using errcode = '42501';
  end if;
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into previous from private.ai_execution_confirmed_release_reviews
    where organization_id = p_organization_id
      and (attempt_id = attempt.id or request_id = p_request_id);
  if found then
    if previous.attempt_id <> attempt.id or previous.request_id <> p_request_id
      or previous.reviewed_by <> actor or previous.evidence <> evidence then
      raise exception 'Release request already belongs to another decision.' using errcode = '23505';
    end if;
    return jsonb_build_object('release_review_id', previous.id,
      'status', 'released', 'idempotent_replay', true);
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  if reservation.id is null or reservation.status not in ('reserved','uncertain') then
    raise exception 'Only an unresolved reserved attempt can be released.' using errcode = '55000';
  end if;
  result := private.n6_reconcile_step_budget(
    p_organization_id, attempt.configured_step_id, 'released',
    null, null, evidence);
  insert into private.ai_execution_confirmed_release_reviews(
    organization_id, attempt_id, reservation_id, request_id, reviewed_by, evidence
  ) values(
    p_organization_id, attempt.id, attempt.reservation_id,
    p_request_id, actor, evidence
  ) returning id into review_id;
  return jsonb_build_object('release_review_id', review_id,
    'status', result ->> 'status', 'idempotent_replay', false);
end;
$$;
revoke all on function public.release_pipeline_ai_confirmed_refusal(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_pipeline_ai_confirmed_refusal(uuid,uuid,uuid,text)
  to authenticated;
commit;
