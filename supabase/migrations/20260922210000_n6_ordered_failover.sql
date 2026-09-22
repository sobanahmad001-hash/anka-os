-- Move through pinned routes only after an explicit provider rejection that
-- proves no response was accepted. An ambiguous result never creates a fallback.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.ai_execution_route_rejections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  claim_id uuid not null references private.ai_execution_dispatch_claims(id) on delete restrict,
  priority smallint not null check (priority between 1 and 3),
  provider_http_status integer not null check (provider_http_status in (429, 503)),
  provider_error_code text not null check (
    provider_error_code in ('rate_limit_exceeded', 'slow_down', 'rate_limit_error', 'server_is_overloaded')
  ),
  provider_request_id text not null default '' check (length(provider_request_id) <= 120),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (claim_id, priority)
);
alter table private.ai_execution_route_rejections enable row level security;
revoke all on private.ai_execution_route_rejections from public, anon, authenticated, service_role;
create trigger protect_ai_execution_route_rejections before update or delete
  on private.ai_execution_route_rejections for each row
  execute function private.reject_pipeline_template_mutation();

create table private.ai_execution_fallback_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  claim_id uuid not null references private.ai_execution_dispatch_claims(id) on delete restrict,
  priority smallint not null check (priority between 2 and 3),
  dispatch_request_id uuid not null,
  route jsonb not null check (jsonb_typeof(route) = 'object'),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  unique (claim_id, priority),
  unique (organization_id, dispatch_request_id)
);
alter table private.ai_execution_fallback_claims enable row level security;
revoke all on private.ai_execution_fallback_claims from public, anon, authenticated, service_role;
create trigger protect_ai_execution_fallback_claims before update or delete
  on private.ai_execution_fallback_claims for each row
  execute function private.reject_pipeline_template_mutation();

create function public.record_pipeline_ai_retryable_rejection(
  p_organization_id uuid, p_attempt_id uuid, p_priority integer,
  p_http_status integer, p_error_code text, p_provider_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  claim private.ai_execution_dispatch_claims;
  reservation private.ai_execution_step_budget_reservations;
  prior private.ai_execution_route_rejections;
  rejection_id uuid;
begin
  if p_organization_id is null or p_attempt_id is null
    or p_priority is null or p_priority not between 1 and 3
    or p_http_status is null or p_error_code is null
    or not ((p_http_status = 429 and p_error_code in
      ('rate_limit_exceeded','slow_down','rate_limit_error'))
      or (p_http_status = 503 and p_error_code = 'server_is_overloaded'))
    or length(coalesce(p_provider_request_id,'')) > 120 then
    raise exception 'Confirmed retryable provider rejection is required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into claim from private.ai_execution_dispatch_claims
    where attempt_id = attempt.id and organization_id = p_organization_id;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  if claim.id is null or reservation.id is null or reservation.status <> 'reserved'
    or p_priority > jsonb_array_length(attempt.route_snapshot)
    or (p_priority > 1 and not exists (
      select 1 from private.ai_execution_fallback_claims fallback
      where fallback.claim_id = claim.id and fallback.priority = p_priority
    )) or exists (
      select 1 from public.ai_execution_step_outputs output
      where output.attempt_id = attempt.id
    ) then
    raise exception 'Only an outstanding claimed route can record rejection.' using errcode = '55000';
  end if;
  select * into prior from private.ai_execution_route_rejections
    where claim_id = claim.id and priority = p_priority;
  if found then
    if prior.provider_http_status <> p_http_status
      or prior.provider_error_code <> p_error_code
      or prior.provider_request_id <> coalesce(p_provider_request_id,'') then
      raise exception 'Route already has another rejection.' using errcode = '23505';
    end if;
    return jsonb_build_object('rejection_id', prior.id, 'idempotent_replay', true);
  end if;
  insert into private.ai_execution_route_rejections(
    organization_id, claim_id, priority, provider_http_status,
    provider_error_code, provider_request_id
  ) values (
    p_organization_id, claim.id, p_priority, p_http_status,
    p_error_code, coalesce(p_provider_request_id,'')
  ) returning id into rejection_id;
  return jsonb_build_object('rejection_id', rejection_id, 'idempotent_replay', false);
end;
$$;
revoke all on function public.record_pipeline_ai_retryable_rejection(uuid, uuid, integer, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_pipeline_ai_retryable_rejection(uuid, uuid, integer, integer, text, text)
  to service_role;

create function public.claim_pipeline_ai_fallback(
  p_organization_id uuid, p_attempt_id uuid, p_priority integer,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  claim private.ai_execution_dispatch_claims;
  reservation private.ai_execution_step_budget_reservations;
  step public.ai_execution_configured_steps;
  existing private.ai_execution_fallback_claims;
  current_routes jsonb;
  route jsonb;
  fallback_id uuid;
begin
  if p_organization_id is null or p_attempt_id is null
    or p_priority is null or p_priority not between 2 and 3
    or p_dispatch_request_id is null or p_prompt_sha256 is null or p_prompt_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact scoped fallback claim is required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into claim from private.ai_execution_dispatch_claims
    where attempt_id = attempt.id and organization_id = p_organization_id;
  select * into existing from private.ai_execution_fallback_claims
    where claim_id = claim.id and priority = p_priority;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'Fallback route already has another claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('fallback_claim_id', existing.id,
      'status', 'already_claimed', 'must_not_submit', true);
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = attempt.configured_step_id and organization_id = p_organization_id;
  if claim.id is null or reservation.id is null or reservation.status <> 'reserved'
    or step.id is null or claim.prompt_sha256 <> p_prompt_sha256
    or p_priority > jsonb_array_length(attempt.route_snapshot)
    or not exists (
      select 1 from private.ai_execution_route_rejections rejection
      where rejection.claim_id = claim.id and rejection.priority = p_priority - 1
    ) or exists (
      select 1 from public.ai_execution_step_outputs output
      where output.attempt_id = attempt.id
    ) or not exists (
      select 1 from public.ai_execution_step_progress progress
      where progress.configured_step_id = attempt.configured_step_id
        and progress.organization_id = p_organization_id
        and progress.status = 'waiting'
    ) then
    raise exception 'Prior confirmed rejection and waiting reservation are required.' using errcode = '55000';
  end if;
  current_routes := public.get_pipeline_ai_text_routes(p_organization_id,
    attempt.job_id, step.definition_step ->> 'department_id', attempt.actor_id);
  if current_routes is distinct from attempt.route_snapshot
    or public.preflight_pipeline_ai_job(p_organization_id, attempt.job_id, attempt.actor_id)
      ->> 'configuration_ready' is distinct from 'true' then
    raise exception 'Pinned route or configured preflight changed.' using errcode = '55000';
  end if;
  route := attempt.route_snapshot -> (p_priority - 1);
  if route ->> 'provider' <> 'openai'
    or route ->> 'priority' is distinct from p_priority::text
    or route ->> 'connection_id' is null
    or route ->> 'model_id' is null then
    raise exception 'Ordered verified OpenAI fallback route is required.' using errcode = '42501';
  end if;
  insert into private.ai_execution_fallback_claims(
    organization_id, claim_id, priority, dispatch_request_id, route, prompt_sha256
  ) values (
    p_organization_id, claim.id, p_priority, p_dispatch_request_id, route, p_prompt_sha256
  ) returning id into fallback_id;
  return jsonb_build_object('fallback_claim_id', fallback_id, 'status', 'claimed',
    'must_not_submit', false, 'route', route);
end;
$$;
revoke all on function public.claim_pipeline_ai_fallback(uuid, uuid, integer, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_pipeline_ai_fallback(uuid, uuid, integer, uuid, text)
  to service_role;
create or replace function private.n6_guard_claimed_budget_release()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_attempt_id uuid;
  v_claim_id uuid;
begin
  if old.status = 'released' or new.status <> 'released' then return new; end if;
  select attempt.id, claim.id into v_attempt_id, v_claim_id
    from private.ai_execution_step_attempts attempt
    join private.ai_execution_dispatch_claims claim on claim.attempt_id = attempt.id
    where attempt.reservation_id = old.id;
  if v_claim_id is null then return new; end if;
  if not exists (
    select 1 from private.ai_execution_route_rejections rejection
    where rejection.claim_id = v_claim_id and rejection.priority = 1
  ) or exists (
    select 1 from private.ai_execution_fallback_claims fallback
    where fallback.claim_id = v_claim_id
      and not exists (
        select 1 from private.ai_execution_route_rejections rejection
        where rejection.claim_id = v_claim_id and rejection.priority = fallback.priority
      )
  ) or exists (
    select 1 from public.ai_execution_step_outputs output
    where output.attempt_id = v_attempt_id
  ) then
    raise exception 'Every claimed route requires a confirmed no-charge rejection before release.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.n6_guard_claimed_budget_release()
  from public, anon, authenticated, service_role;
comment on table private.ai_execution_fallback_claims is
  'Each ordered backup is a single-use submission after a confirmed 429 rate rejection or 503 overload. Unknown outcomes do not permit fallback.';
commit;
