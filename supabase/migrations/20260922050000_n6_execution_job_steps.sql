-- One immutable execution step per pinned work item. No provider dispatch or spend.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_job_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  run_plan_id uuid not null references public.pipeline_run_plans(id) on delete restrict,
  work_item_id uuid not null,
  ordinal smallint not null check (ordinal between 1 and 50),
  department_id text references public.departments(id) on delete restrict,
  source_row_version bigint not null check (source_row_version >= 0),
  work_snapshot jsonb not null check (jsonb_typeof(work_snapshot) = 'object'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'blocked_configuration'
    check (status = 'blocked_configuration'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, organization_id)
    references public.ai_execution_jobs(id, organization_id) on delete restrict,
  foreign key (work_item_id, organization_id)
    references public.work_items(id, organization_id) on delete restrict,
  unique (job_id, ordinal),
  unique (job_id, work_item_id),
  unique (id, organization_id)
);
create index ai_execution_job_steps_org_job
  on public.ai_execution_job_steps(organization_id, job_id, ordinal);
create trigger protect_ai_execution_job_steps before update or delete
  on public.ai_execution_job_steps for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_job_steps enable row level security;
revoke all on public.ai_execution_job_steps from public, anon, authenticated, service_role;
grant select on public.ai_execution_job_steps to authenticated, service_role;
create policy "Current team can read AI execution steps"
  on public.ai_execution_job_steps for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function private.n6_create_execution_steps()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  plan public.pipeline_run_plans;
begin
  select * into plan from public.pipeline_run_plans
    where id = new.run_plan_id and organization_id = new.organization_id
      and run_intent_id = new.run_intent_id;
  if not found or jsonb_typeof(plan.work_manifest) <> 'array'
    or jsonb_array_length(plan.work_manifest) not between 1 and 50 then
    raise exception 'A bounded same-organization work plan is required.' using errcode = '23514';
  end if;
  insert into public.ai_execution_job_steps(
    organization_id, job_id, run_plan_id, work_item_id, ordinal,
    department_id, source_row_version, work_snapshot, input_sha256
  )
  select new.organization_id, new.id, plan.id,
    (selected.value ->> 'id')::uuid, selected.position::smallint,
    selected.value ->> 'department_id',
    (selected.value ->> 'row_version')::bigint,
    selected.value,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'job_input_sha256', new.input_sha256,
      'ordinal', selected.position,
      'work_snapshot', selected.value
    )::text, 'UTF8'), 'sha256'), 'hex')
  from jsonb_array_elements(plan.work_manifest) with ordinality selected(value, position);
  if not found then
    raise exception 'No execution steps were created.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.n6_create_execution_steps()
  from public, anon, authenticated, service_role;
create trigger n6_create_execution_steps after insert on public.ai_execution_jobs
  for each row execute function private.n6_create_execution_steps();

-- Existing immutable jobs receive the same pinned steps without changing them.
insert into public.ai_execution_job_steps(
  organization_id, job_id, run_plan_id, work_item_id, ordinal,
  department_id, source_row_version, work_snapshot, input_sha256
)
select job.organization_id, job.id, plan.id,
  (selected.value ->> 'id')::uuid, selected.position::smallint,
  selected.value ->> 'department_id',
  (selected.value ->> 'row_version')::bigint,
  selected.value,
  encode(extensions.digest(convert_to(jsonb_build_object(
    'job_input_sha256', job.input_sha256,
    'ordinal', selected.position,
    'work_snapshot', selected.value
  )::text, 'UTF8'), 'sha256'), 'hex')
from public.ai_execution_jobs job
join public.pipeline_run_plans plan
  on plan.id = job.run_plan_id and plan.organization_id = job.organization_id
cross join lateral jsonb_array_elements(plan.work_manifest)
  with ordinality selected(value, position)
where not exists (
  select 1 from public.ai_execution_job_steps step where step.job_id = job.id
);
comment on table public.ai_execution_job_steps is
  'One immutable pinned work step per N6 job. No provider request or task mutation is enabled here.';
commit;