-- Step-local reservation ledger. There is no cap seed, provider dispatch, or public grant.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Retire the legacy entry point: it does not count step reservations toward the shared cap.
-- Existing reservations remain readable and reconcilable.
revoke execute on function public.reserve_pipeline_ai_budget(uuid, uuid, uuid, bigint)
  from service_role;

alter table public.ai_execution_configured_steps
  add constraint ai_execution_configured_steps_id_job_org
  unique (id, job_id, organization_id);

create table private.ai_execution_step_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references private.ai_execution_budget_limits(organization_id) on delete restrict,
  job_id uuid not null,
  configured_step_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  cycle_month date not null,
  max_cost_microusd bigint not null check (max_cost_microusd > 0),
  status text not null check (status in ('reserved', 'uncertain', 'settled', 'released')),
  actual_cost_microusd bigint check (actual_cost_microusd is null or actual_cost_microusd >= 0),
  ai_run_id uuid unique references public.ai_runs(id) on delete restrict,
  outcome_evidence text not null default '' check (length(outcome_evidence) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  reconciled_at timestamptz,
  foreign key (configured_step_id, job_id, organization_id)
    references public.ai_execution_configured_steps(id, job_id, organization_id) on delete restrict,
  unique (organization_id, configured_step_id),
  check (
    (status in ('reserved', 'uncertain') and actual_cost_microusd is null and ai_run_id is null)
    or (status = 'settled' and actual_cost_microusd is not null)
    or (status = 'released' and actual_cost_microusd is null and ai_run_id is null)
  ),
  check (
    (status = 'reserved' and reconciled_at is null and outcome_evidence = '')
    or (status <> 'reserved' and reconciled_at is not null and length(outcome_evidence) > 0)
  )
);
create index ai_execution_step_budget_reservations_cycle
  on private.ai_execution_step_budget_reservations(organization_id, cycle_month, status);
create index ai_execution_step_budget_reservations_job
  on private.ai_execution_step_budget_reservations(organization_id, job_id);
alter table private.ai_execution_step_budget_reservations enable row level security;
revoke all on private.ai_execution_step_budget_reservations
  from public, anon, authenticated, service_role;

create table private.ai_execution_step_budget_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references private.ai_execution_step_budget_reservations(id) on delete restrict,
  organization_id uuid not null,
  transition text not null check (transition in ('reserved', 'uncertain', 'settled', 'released')),
  actual_cost_microusd bigint,
  evidence text not null default '',
  occurred_at timestamptz not null default clock_timestamp()
);
create index ai_execution_step_budget_events_reservation
  on private.ai_execution_step_budget_events(reservation_id, occurred_at);
alter table private.ai_execution_step_budget_events enable row level security;
revoke all on private.ai_execution_step_budget_events
  from public, anon, authenticated, service_role;

create function private.n6_reserve_step_budget(
  p_organization_id uuid, p_job_id uuid, p_step_id uuid,
  p_actor_id uuid, p_max_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  job public.ai_execution_jobs;
  step public.ai_execution_configured_steps;
  intent public.pipeline_run_intents;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  existing private.ai_execution_step_budget_reservations;
  preflight jsonb;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  local_total numeric;
  organization_total numeric;
  unlinked_total numeric;
  unknown_completed bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_step_id is null
    or p_actor_id is null or p_max_cost_microusd is null
    or p_max_cost_microusd <= 0 then
    raise exception 'A scoped positive step maximum is required.' using errcode = '22023';
  end if;
  -- The same organization row serializes legacy and step-level reservations.
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'Positive organization budget is not configured.' using errcode = '42501';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = p_step_id and job_id = p_job_id
      and organization_id = p_organization_id;
  if job.id is null or step.id is null or job.requested_by <> p_actor_id
    or job.status <> 'blocked_configuration'
    or (step.definition_step ->> 'kind') not in ('ai_assisted', 'automatic') then
    raise exception 'Actor-owned blocked AI step is required.' using errcode = '42501';
  end if;
  select * into existing from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and configured_step_id = step.id;
  if found then
    if existing.actor_id <> p_actor_id or existing.max_cost_microusd <> p_max_cost_microusd
      or existing.job_id <> job.id then
      raise exception 'Step already has a different reservation.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', existing.id, 'status', existing.status,
      'max_cost_microusd', existing.max_cost_microusd, 'idempotent_replay', true);
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  if intent.id is null or activation.id is null or configuration.id is null
    or step.project_activation_id <> activation.id
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or configuration.max_ai_cost_microusd <= 0 then
    raise exception 'Current pinned project limit is required.' using errcode = '42501';
  end if;
  preflight := public.preflight_pipeline_ai_job(p_organization_id, job.id, p_actor_id);
  if preflight ->> 'configuration_ready' is distinct from 'true'
    or preflight ->> 'project_activation_id' is distinct from activation.id::text then
    raise exception 'Current configured job preflight is not ready.' using errcode = '42501';
  end if;
  select coalesce(sum(case when reservation.status = 'settled'
      then reservation.actual_cost_microusd else reservation.max_cost_microusd end), 0)
    into local_total from private.ai_execution_step_budget_reservations reservation
    where reservation.organization_id = p_organization_id and reservation.job_id = job.id
      and reservation.status in ('reserved', 'uncertain', 'settled');
  if local_total + p_max_cost_microusd > configuration.max_ai_cost_microusd then
    raise exception 'Step reservation would exceed the project-local AI limit.' using errcode = '22003';
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
      and not exists (
        select 1 from private.ai_execution_budget_reservations legacy
        where legacy.ai_run_id = run.id
      )
      and not exists (
        select 1 from private.ai_execution_step_budget_reservations reservation
        where reservation.ai_run_id = run.id
      );
  if unknown_completed > 0 then
    raise exception 'Unmeasured AI cost requires reconciliation first.' using errcode = '55000';
  end if;
  if exists (
    select 1 from private.ai_execution_budget_reservations legacy
    where legacy.organization_id = p_organization_id
      and legacy.cycle_month <> cycle and legacy.status in ('reserved', 'uncertain')
  ) or exists (
    select 1 from private.ai_execution_step_budget_reservations pending
    where pending.organization_id = p_organization_id
      and pending.cycle_month <> cycle and pending.status in ('reserved', 'uncertain')
  ) then
    raise exception 'Prior-cycle unresolved reservations require reconciliation.' using errcode = '55000';
  end if;
  if organization_total + unlinked_total + p_max_cost_microusd > budget.monthly_limit_microusd then
    raise exception 'Step reservation would exceed the organization monthly cap.' using errcode = '22003';
  end if;
  insert into private.ai_execution_step_budget_reservations(
    organization_id, job_id, configured_step_id, actor_id, cycle_month,
    max_cost_microusd, status
  ) values (
    p_organization_id, job.id, step.id, p_actor_id, cycle,
    p_max_cost_microusd, 'reserved'
  ) returning id into new_id;
  insert into private.ai_execution_step_budget_events(
    reservation_id, organization_id, transition
  ) values(new_id, p_organization_id, 'reserved');
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$$;
revoke all on function private.n6_reserve_step_budget(uuid, uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;

create function private.n6_reconcile_step_budget(
  p_organization_id uuid, p_step_id uuid, p_outcome text,
  p_actual_cost_microusd bigint, p_ai_run_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  reservation private.ai_execution_step_budget_reservations;
  outcome text := trim(coalesce(p_outcome, ''));
  evidence text := trim(coalesce(p_evidence, ''));
begin
  if p_organization_id is null or p_step_id is null
    or outcome not in ('uncertain', 'settled', 'released')
    or length(evidence) not between 1 and 1000
    or (outcome = 'settled' and (p_actual_cost_microusd is null or p_actual_cost_microusd < 0 or p_ai_run_id is null))
    or (outcome <> 'settled' and (p_actual_cost_microusd is not null or p_ai_run_id is not null)) then
    raise exception 'A valid step outcome and evidence are required.' using errcode = '22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then raise exception 'Organization budget is not configured.' using errcode = '42501'; end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where organization_id = p_organization_id and configured_step_id = p_step_id for update;
  if not found then raise exception 'Step reservation not found.' using errcode = 'P0002'; end if;
  if reservation.status = outcome then
    if reservation.actual_cost_microusd is distinct from p_actual_cost_microusd
      or reservation.ai_run_id is distinct from p_ai_run_id
      or reservation.outcome_evidence <> evidence then
      raise exception 'Conflicting step reconciliation retry.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', reservation.id, 'status', outcome,
      'idempotent_replay', true);
  end if;
  if reservation.status in ('settled', 'released') then
    raise exception 'Terminal step reservation cannot change.' using errcode = '55000';
  end if;
  if p_ai_run_id is not null and not exists (
    select 1 from public.ai_runs run
    where run.id = p_ai_run_id and run.organization_id = p_organization_id
  ) then
    raise exception 'AI run belongs to another organization.' using errcode = '42501';
  end if;
  if p_ai_run_id is not null and exists (
    select 1 from private.ai_execution_budget_reservations legacy
    where legacy.ai_run_id = p_ai_run_id
  ) then
    raise exception 'AI run is already reconciled to a legacy reservation.' using errcode = '23505';
  end if;
  update private.ai_execution_step_budget_reservations
    set status = outcome, actual_cost_microusd = p_actual_cost_microusd,
      ai_run_id = p_ai_run_id, outcome_evidence = evidence,
      reconciled_at = clock_timestamp()
    where id = reservation.id;
  insert into private.ai_execution_step_budget_events(
    reservation_id, organization_id, transition, actual_cost_microusd, evidence
  ) values (
    reservation.id, p_organization_id, outcome, p_actual_cost_microusd, evidence
  );
  return jsonb_build_object('reservation_id', reservation.id, 'status', outcome,
    'actual_cost_microusd', p_actual_cost_microusd, 'idempotent_replay', false);
end;
$$;
revoke all on function private.n6_reconcile_step_budget(uuid, uuid, text, bigint, uuid, text)
  from public, anon, authenticated, service_role;
create function private.n6_prevent_cross_ledger_ai_run()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ai_run_id is null then return new; end if;
  if tg_table_name = 'ai_execution_budget_reservations' then
    if exists (
      select 1 from private.ai_execution_step_budget_reservations step
      where step.ai_run_id = new.ai_run_id
    ) then
      raise exception 'AI run is already reconciled to a step reservation.' using errcode = '23505';
    end if;
  elsif tg_table_name = 'ai_execution_step_budget_reservations' then
    if exists (
      select 1 from private.ai_execution_budget_reservations legacy
      where legacy.ai_run_id = new.ai_run_id
    ) then
      raise exception 'AI run is already reconciled to a legacy reservation.' using errcode = '23505';
    end if;
  else
    raise exception 'Unexpected budget ledger.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.n6_prevent_cross_ledger_ai_run()
  from public, anon, authenticated, service_role;
create trigger n6_legacy_unique_ai_run
  before insert or update of ai_run_id on private.ai_execution_budget_reservations
  for each row execute function private.n6_prevent_cross_ledger_ai_run();
create trigger n6_step_unique_ai_run
  before insert or update of ai_run_id on private.ai_execution_step_budget_reservations
  for each row execute function private.n6_prevent_cross_ledger_ai_run();

comment on table private.ai_execution_step_budget_reservations is
  'Dormant per-step budget ledger. No role has direct access and no provider dispatch is enabled.';
commit;
