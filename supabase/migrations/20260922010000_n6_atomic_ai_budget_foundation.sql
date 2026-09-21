-- N6 foundation: service-only budget reservation. No limit row is seeded;
-- no provider submission is enabled by this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.ai_execution_budget_limits (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  monthly_limit_microusd bigint not null check (monthly_limit_microusd > 0),
  configured_at timestamptz not null default clock_timestamp()
);
alter table private.ai_execution_budget_limits enable row level security;
revoke all on private.ai_execution_budget_limits from public, anon, authenticated, service_role;

create table private.ai_execution_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references private.ai_execution_budget_limits(organization_id) on delete restrict,
  run_plan_id uuid not null references public.pipeline_run_plans(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  cycle_month date not null,
  max_cost_microusd bigint not null check (max_cost_microusd > 0),
  status text not null check (status in ('reserved', 'uncertain', 'settled', 'released')),
  actual_cost_microusd bigint check (actual_cost_microusd is null or actual_cost_microusd >= 0),
  ai_run_id uuid unique references public.ai_runs(id) on delete restrict,
  outcome_evidence text not null default '' check (length(outcome_evidence) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  reconciled_at timestamptz,
  unique (organization_id, run_plan_id),
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
create index ai_execution_budget_reservations_cycle
  on private.ai_execution_budget_reservations(organization_id, cycle_month, status);
alter table private.ai_execution_budget_reservations enable row level security;
revoke all on private.ai_execution_budget_reservations from public, anon, authenticated, service_role;

create table private.ai_execution_budget_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references private.ai_execution_budget_reservations(id) on delete restrict,
  organization_id uuid not null,
  transition text not null check (transition in ('reserved', 'uncertain', 'settled', 'released')),
  actual_cost_microusd bigint,
  evidence text not null default '',
  occurred_at timestamptz not null default clock_timestamp()
);
create index ai_execution_budget_events_reservation
  on private.ai_execution_budget_events(reservation_id, occurred_at);
alter table private.ai_execution_budget_events enable row level security;
revoke all on private.ai_execution_budget_events from public, anon, authenticated, service_role;

create function public.reserve_pipeline_ai_budget(
  p_organization_id uuid, p_run_plan_id uuid, p_actor_id uuid,
  p_max_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  existing private.ai_execution_budget_reservations;
  planned public.pipeline_run_plans;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  reserved_total numeric;
  completed_total numeric;
  unknown_completed bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_run_plan_id is null or p_actor_id is null
    or p_max_cost_microusd is null or p_max_cost_microusd <= 0 then
    raise exception 'A positive, scoped maximum cost is required.' using errcode = '22023';
  end if;
  -- A single organization row serializes concurrent staff and project reservations.
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'AI execution budget is not configured; provider dispatch remains blocked.' using errcode = '42501';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = p_actor_id and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for share of organization, membership;
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into planned from public.pipeline_run_plans
    where id = p_run_plan_id and organization_id = p_organization_id for share;
  if not found or planned.planned_by <> p_actor_id then
    raise exception 'A same-organization, actor-owned run plan is required.' using errcode = '42501';
  end if;
  select * into existing from private.ai_execution_budget_reservations
    where organization_id = p_organization_id and run_plan_id = p_run_plan_id;
  if found then
    if existing.actor_id <> p_actor_id or existing.max_cost_microusd <> p_max_cost_microusd then
      raise exception 'Run plan already has a different reservation.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', existing.id, 'status', existing.status,
      'cycle_month', existing.cycle_month, 'max_cost_microusd', existing.max_cost_microusd,
      'idempotent_replay', true);
  end if;
  select coalesce(sum(case when reservation.status = 'settled'
    then reservation.actual_cost_microusd else reservation.max_cost_microusd end), 0)
    into reserved_total from private.ai_execution_budget_reservations reservation
    where reservation.organization_id = p_organization_id and reservation.cycle_month = cycle
      and reservation.status in ('reserved', 'uncertain', 'settled');
  select count(*) filter (where run.estimated_cost_microusd is null),
    coalesce(sum(run.estimated_cost_microusd), 0)
    into unknown_completed, completed_total
    from public.ai_runs run
    where run.organization_id = p_organization_id
      and run.created_at >= timezone('UTC', cycle::timestamp)
      and run.created_at < timezone('UTC', cycle::timestamp + interval '1 month')
      and run.status = 'completed'
      and not exists (
        select 1 from private.ai_execution_budget_reservations reservation
        where reservation.ai_run_id = run.id
      );
  if unknown_completed > 0 then
    raise exception 'Unmeasured AI cost requires reconciliation before new paid execution.' using errcode = '55000';
  end if;
  if reserved_total + completed_total + p_max_cost_microusd > budget.monthly_limit_microusd then
    raise exception 'AI execution would exceed the monthly organization cap.' using errcode = '22003';
  end if;
  insert into private.ai_execution_budget_reservations(
    organization_id, run_plan_id, actor_id, cycle_month, max_cost_microusd, status
  ) values (
    p_organization_id, p_run_plan_id, p_actor_id, cycle, p_max_cost_microusd, 'reserved'
  ) returning id into new_id;
  insert into private.ai_execution_budget_events(reservation_id, organization_id, transition)
    values(new_id, p_organization_id, 'reserved');
  return jsonb_build_object('reservation_id', new_id, 'status', 'reserved',
    'cycle_month', cycle, 'max_cost_microusd', p_max_cost_microusd,
    'idempotent_replay', false);
end;
$$;
revoke all on function public.reserve_pipeline_ai_budget(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_pipeline_ai_budget(uuid, uuid, uuid, bigint)
  to service_role;

create function public.reconcile_pipeline_ai_budget(
  p_organization_id uuid, p_run_plan_id uuid, p_outcome text,
  p_actual_cost_microusd bigint, p_ai_run_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  reservation private.ai_execution_budget_reservations;
  outcome text := trim(coalesce(p_outcome, ''));
  evidence text := trim(coalesce(p_evidence, ''));
begin
  if p_organization_id is null or p_run_plan_id is null
    or outcome not in ('uncertain', 'settled', 'released')
    or length(evidence) not between 1 and 1000
    or (outcome = 'settled' and (p_actual_cost_microusd is null or p_actual_cost_microusd < 0))
    or (outcome <> 'settled' and (p_actual_cost_microusd is not null or p_ai_run_id is not null)) then
    raise exception 'A valid outcome and reconciliation evidence are required.' using errcode = '22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id = p_organization_id for update;
  if not found then
    raise exception 'AI execution budget is not configured.' using errcode = '42501';
  end if;
  select * into reservation from private.ai_execution_budget_reservations
    where organization_id = p_organization_id and run_plan_id = p_run_plan_id for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'P0002';
  end if;
  if reservation.status = outcome then
    if reservation.actual_cost_microusd is distinct from p_actual_cost_microusd
      or reservation.ai_run_id is distinct from p_ai_run_id
      or reservation.outcome_evidence <> evidence then
      raise exception 'Conflicting reconciliation retry.' using errcode = '23505';
    end if;
    return jsonb_build_object('reservation_id', reservation.id, 'status', reservation.status,
      'actual_cost_microusd', reservation.actual_cost_microusd,
      'idempotent_replay', true);
  end if;
  if reservation.status in ('settled', 'released')
    or (reservation.status = 'uncertain' and outcome = 'uncertain') then
    raise exception 'Terminal or conflicting reservation transition.' using errcode = '55000';
  end if;
  if p_ai_run_id is not null and not exists (
    select 1 from public.ai_runs run
    where run.id = p_ai_run_id and run.organization_id = p_organization_id
  ) then
    raise exception 'AI run belongs to another organization.' using errcode = '42501';
  end if;
  update private.ai_execution_budget_reservations
    set status = outcome,
      actual_cost_microusd = p_actual_cost_microusd,
      ai_run_id = p_ai_run_id,
      outcome_evidence = evidence,
      reconciled_at = clock_timestamp()
    where id = reservation.id;
  insert into private.ai_execution_budget_events(
    reservation_id, organization_id, transition, actual_cost_microusd, evidence
  ) values (
    reservation.id, p_organization_id, outcome, p_actual_cost_microusd, evidence
  );
  return jsonb_build_object('reservation_id', reservation.id, 'status', outcome,
    'actual_cost_microusd', p_actual_cost_microusd, 'idempotent_replay', false);
end;
$$;
revoke all on function public.reconcile_pipeline_ai_budget(uuid, uuid, text, bigint, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_pipeline_ai_budget(uuid, uuid, text, bigint, uuid, text)
  to service_role;

comment on table private.ai_execution_budget_limits is
  'No rows are seeded. A positive organization cap requires a separate explicit authorization before paid execution.';
comment on table private.ai_execution_budget_reservations is
  'Service-only atomic N6 reservations. Unknown outcomes retain the full maximum until reconciled.';
commit;
