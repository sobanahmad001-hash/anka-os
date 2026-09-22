-- Durable, provider-free handoff for one configured AI step.
-- Preparing an attempt reserves a cap; it does not submit a provider request.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.ai_execution_step_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  configured_step_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reservation_id uuid not null unique
    references private.ai_execution_step_budget_reservations(id) on delete restrict,
  job_input_sha256 text not null check (job_input_sha256 ~ '^[0-9a-f]{64}$'),
  route_snapshot jsonb not null check (jsonb_typeof(route_snapshot) = 'array'
    and jsonb_array_length(route_snapshot) between 1 and 3),
  max_cost_microusd bigint not null check (max_cost_microusd > 0),
  status text not null default 'prepared' check (status = 'prepared'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (configured_step_id, job_id, organization_id)
    references public.ai_execution_configured_steps(id, job_id, organization_id) on delete restrict,
  unique (organization_id, request_id),
  unique (organization_id, configured_step_id)
);
create index ai_execution_step_attempts_job
  on private.ai_execution_step_attempts(organization_id, job_id, created_at);
alter table private.ai_execution_step_attempts enable row level security;
revoke all on private.ai_execution_step_attempts from public, anon, authenticated, service_role;
create trigger protect_ai_execution_step_attempts before update or delete
  on private.ai_execution_step_attempts for each row
  execute function private.reject_pipeline_template_mutation();

create function public.prepare_pipeline_ai_step(
  p_organization_id uuid, p_job_id uuid, p_step_id uuid,
  p_actor_id uuid, p_request_id uuid, p_max_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.ai_execution_jobs;
  step public.ai_execution_configured_steps;
  progress public.ai_execution_step_progress;
  existing private.ai_execution_step_attempts;
  readiness jsonb;
  routes jsonb;
  reservation jsonb;
  dependency text;
  new_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_step_id is null
    or p_actor_id is null or p_request_id is null or p_max_cost_microusd is null
    or p_max_cost_microusd <= 0 then
    raise exception 'Exact scoped AI attempt and positive maximum are required.' using errcode = '22023';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id for share;
  select * into step from public.ai_execution_configured_steps
    where id = p_step_id and job_id = p_job_id and organization_id = p_organization_id;
  if job.id is null or step.id is null or job.requested_by <> p_actor_id
    or job.status <> 'blocked_configuration'
    or (step.definition_step ->> 'kind') not in ('ai_assisted', 'automatic') then
    raise exception 'Actor-owned pinned AI step is required.' using errcode = '42501';
  end if;
  select * into progress from public.ai_execution_step_progress
    where configured_step_id = step.id and organization_id = p_organization_id for update;
  if not found or progress.status <> 'waiting' then
    raise exception 'AI step is not waiting for a first attempt.' using errcode = '55000';
  end if;
  select * into existing from private.ai_execution_step_attempts
    where organization_id = p_organization_id
      and (configured_step_id = step.id or request_id = p_request_id);
  if found then
    if existing.configured_step_id <> step.id or existing.request_id <> p_request_id
      or existing.actor_id <> p_actor_id or existing.max_cost_microusd <> p_max_cost_microusd
      or existing.job_input_sha256 <> job.input_sha256 then
      raise exception 'Step or request ID already has another attempt.' using errcode = '23505';
    end if;
    return jsonb_build_object('attempt_id', existing.id,
      'reservation_id', existing.reservation_id, 'status', existing.status,
      'idempotent_replay', true);
  end if;
  for dependency in select value from jsonb_array_elements_text(
    coalesce(step.definition_step -> 'depends_on', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.ai_execution_configured_steps required
      where required.job_id = job.id and required.organization_id = p_organization_id
        and required.step_key = dependency
    ) or exists (
      select 1 from public.ai_execution_configured_steps required
      join public.ai_execution_step_progress required_progress
        on required_progress.configured_step_id = required.id
      where required.job_id = job.id and required.organization_id = p_organization_id
        and required.step_key = dependency
        and required_progress.status <> 'completed'
    ) then
      raise exception 'A pinned dependency is not complete.' using errcode = '55000';
    end if;
  end loop;
  readiness := public.preflight_pipeline_ai_job(p_organization_id, job.id, p_actor_id);
  if readiness ->> 'configuration_ready' is distinct from 'true' then
    raise exception 'Configured AI preflight is not ready.' using errcode = '42501';
  end if;
  routes := public.get_pipeline_ai_text_routes(p_organization_id, job.id,
    step.definition_step ->> 'department_id', p_actor_id);
  if jsonb_typeof(routes) is distinct from 'array'
    or jsonb_array_length(routes) not between 1 and 3 then
    raise exception 'An ordered verified text route is required.' using errcode = '42501';
  end if;
  reservation := private.n6_reserve_step_budget(
    p_organization_id, job.id, step.id, p_actor_id, p_max_cost_microusd);
  insert into private.ai_execution_step_attempts(
    organization_id, job_id, configured_step_id, request_id, actor_id,
    reservation_id, job_input_sha256, route_snapshot, max_cost_microusd
  ) values (
    p_organization_id, job.id, step.id, p_request_id, p_actor_id,
    (reservation ->> 'reservation_id')::uuid, job.input_sha256, routes, p_max_cost_microusd
  ) returning id into new_id;
  return jsonb_build_object('attempt_id', new_id,
    'reservation_id', reservation ->> 'reservation_id',
    'status', 'prepared', 'idempotent_replay', false);
end;
$$;
revoke all on function public.prepare_pipeline_ai_step(uuid, uuid, uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_pipeline_ai_step(uuid, uuid, uuid, uuid, uuid, bigint)
  to service_role;
comment on table private.ai_execution_step_attempts is
  'Immutable provider-free preparation. Dispatch, retries, outputs and spend settlement are separate gates.';
commit;