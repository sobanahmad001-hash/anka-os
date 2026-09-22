-- A prepared step has one irreversible dispatch claim. A crashed worker leaves
-- its budget reserved until an operator reconciles the provider outcome.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.ai_execution_dispatch_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  attempt_id uuid not null unique
    references private.ai_execution_step_attempts(id) on delete restrict,
  dispatch_request_id uuid not null,
  route jsonb not null check (jsonb_typeof(route) = 'object'),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  unique (organization_id, dispatch_request_id)
);
create index ai_execution_dispatch_claims_org
  on private.ai_execution_dispatch_claims(organization_id, claimed_at);
alter table private.ai_execution_dispatch_claims enable row level security;
revoke all on private.ai_execution_dispatch_claims from public, anon, authenticated, service_role;
create trigger protect_ai_execution_dispatch_claims before update or delete
  on private.ai_execution_dispatch_claims for each row
  execute function private.reject_pipeline_template_mutation();

create function public.claim_pipeline_ai_step_dispatch(
  p_organization_id uuid, p_attempt_id uuid,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  existing private.ai_execution_dispatch_claims;
  reservation private.ai_execution_step_budget_reservations;
  step public.ai_execution_configured_steps;
  current_routes jsonb;
  selected_route jsonb;
  new_id uuid;
begin
  if p_organization_id is null or p_attempt_id is null
    or p_dispatch_request_id is null
    or p_prompt_sha256 is null or p_prompt_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact scoped dispatch identity and prompt digest are required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id for share;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  -- Serialize concurrent workers. Matching replay is never permission to call a provider again.
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into existing from private.ai_execution_dispatch_claims
    where attempt_id = attempt.id;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'AI step already has another dispatch claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('claim_id', existing.id, 'status', 'already_claimed',
      'must_not_submit', true);
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = attempt.configured_step_id and organization_id = p_organization_id;
  if reservation.id is null or reservation.status <> 'reserved'
    or step.id is null or not exists (
      select 1 from public.ai_execution_step_progress progress
      where progress.configured_step_id = attempt.configured_step_id
        and progress.organization_id = p_organization_id
        and progress.status = 'waiting'
    ) then
    raise exception 'Only a waiting, reserved AI step can be dispatched.' using errcode = '55000';
  end if;
  current_routes := public.get_pipeline_ai_text_routes(p_organization_id,
    attempt.job_id, step.definition_step ->> 'department_id', attempt.actor_id);
  if public.preflight_pipeline_ai_job(p_organization_id, attempt.job_id, attempt.actor_id) ->> 'configuration_ready' is distinct from 'true' then
    raise exception 'Configured AI preflight changed after preparation.' using errcode = '55000';
  end if;
  if current_routes is distinct from attempt.route_snapshot then
    raise exception 'Verified route changed after preparation.' using errcode = '55000';
  end if;
  selected_route := attempt.route_snapshot -> 0;
  if selected_route is null or selected_route ->> 'provider' <> 'openai'
    or selected_route ->> 'connection_id' is null
    or selected_route ->> 'model_id' is null then
    raise exception 'A verified OpenAI route is required.' using errcode = '42501';
  end if;
  insert into private.ai_execution_dispatch_claims(
    organization_id, attempt_id, dispatch_request_id, route, prompt_sha256
  ) values (
    p_organization_id, attempt.id, p_dispatch_request_id,
    selected_route, p_prompt_sha256
  ) returning id into new_id;
  return jsonb_build_object('claim_id', new_id, 'status', 'claimed',
    'must_not_submit', false, 'route', selected_route);
end;
$$;
revoke all on function public.claim_pipeline_ai_step_dispatch(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_pipeline_ai_step_dispatch(uuid, uuid, uuid, text)
  to service_role;
create function private.n6_guard_claimed_budget_release()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'released' and new.status = 'released'
    and exists (
      select 1 from private.ai_execution_dispatch_claims claim
      where claim.attempt_id in (
        select attempt.id from private.ai_execution_step_attempts attempt
        where attempt.reservation_id = old.id
      )
    ) then
    raise exception 'Claimed provider dispatch cannot be released without outcome reconciliation.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.n6_guard_claimed_budget_release()
  from public, anon, authenticated, service_role;
create trigger n6_guard_claimed_budget_release
  before update of status on private.ai_execution_step_budget_reservations
  for each row execute function private.n6_guard_claimed_budget_release();

comment on table private.ai_execution_dispatch_claims is
  'Single-use immutable claim before provider submission. Replay must never submit again; uncertain outcomes keep the reservation held.';
commit;
