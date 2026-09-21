-- N6 durable execution identity. Every reviewed work plan gets one blocked job;
-- there is no provider dispatch or spend transition in this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_intent_id uuid not null references public.pipeline_run_intents(id) on delete restrict,
  run_plan_id uuid not null unique references public.pipeline_run_plans(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  input_manifest jsonb not null check (jsonb_typeof(input_manifest) = 'object'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'blocked_configuration'
    check (status = 'blocked_configuration'),
  blocked_reason text not null default 'Provider routing and a positive budget cap are not active.'
    check (blocked_reason = 'Provider routing and a positive budget cap are not active.'),
  provider text,
  model_id text,
  provider_request_id text,
  ai_run_id uuid references public.ai_runs(id) on delete restrict,
  estimated_cost_microusd bigint,
  actual_cost_microusd bigint,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  unique (run_intent_id),
  check (
    provider is null and model_id is null and provider_request_id is null
    and ai_run_id is null and estimated_cost_microusd is null
    and actual_cost_microusd is null and started_at is null and completed_at is null
  )
);
create index ai_execution_jobs_org_requested
  on public.ai_execution_jobs(organization_id, requested_by, created_at desc);
create index ai_execution_jobs_org_intent
  on public.ai_execution_jobs(organization_id, run_intent_id);
create trigger protect_ai_execution_jobs before update or delete
  on public.ai_execution_jobs for each row execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_jobs enable row level security;
revoke all on public.ai_execution_jobs from public, anon, authenticated, service_role;
grant select on public.ai_execution_jobs to authenticated, service_role;
create policy "Current team can read blocked AI execution jobs"
  on public.ai_execution_jobs for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function private.n6_blocked_execution_manifest(
  p_intent public.pipeline_run_intents, p_plan public.pipeline_run_plans
) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'source_kind', 'pipeline_run',
    'organization_id', p_plan.organization_id,
    'run_intent_id', p_intent.id,
    'run_plan_id', p_plan.id,
    'preset_version_id', p_intent.pipeline_template_version_id,
    'input_sha256', p_intent.input_sha256,
    'work_sha256', p_plan.work_sha256
  );
$$;
revoke all on function private.n6_blocked_execution_manifest(public.pipeline_run_intents, public.pipeline_run_plans)
  from public, anon, authenticated, service_role;

create function private.n6_create_blocked_execution_job()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  intent public.pipeline_run_intents;
  manifest jsonb;
begin
  select * into intent from public.pipeline_run_intents
    where id = new.run_intent_id and organization_id = new.organization_id;
  if not found then
    raise exception 'Same-organization run intent is required.' using errcode = '42501';
  end if;
  manifest := private.n6_blocked_execution_manifest(intent, new);
  insert into public.ai_execution_jobs(
    organization_id, run_intent_id, run_plan_id, requested_by, input_manifest, input_sha256
  ) values (
    new.organization_id, intent.id, new.id, intent.requested_by,
    manifest, encode(extensions.digest(convert_to(manifest::text, 'UTF8'), 'sha256'), 'hex')
  );
  return new;
end;
$$;
revoke all on function private.n6_create_blocked_execution_job()
  from public, anon, authenticated, service_role;
create trigger n6_create_blocked_execution_job
  after insert on public.pipeline_run_plans
  for each row execute function private.n6_create_blocked_execution_job();

-- Preserve any already-created plans by assigning the same blocked identity.
insert into public.ai_execution_jobs(
  organization_id, run_intent_id, run_plan_id, requested_by, input_manifest, input_sha256
)
select plan.organization_id, intent.id, plan.id, intent.requested_by,
  manifest.value,
  encode(extensions.digest(convert_to(manifest.value::text, 'UTF8'), 'sha256'), 'hex')
from public.pipeline_run_plans plan
join public.pipeline_run_intents intent
  on intent.id = plan.run_intent_id and intent.organization_id = plan.organization_id
cross join lateral (
  select private.n6_blocked_execution_manifest(intent, plan) as value
) manifest
where not exists (
  select 1 from public.ai_execution_jobs job where job.run_plan_id = plan.id
);

comment on table public.ai_execution_jobs is
  'Durable one-per-plan identity, blocked by construction until verified routing, budget, reconciliation, and output transitions are released.';
commit;
