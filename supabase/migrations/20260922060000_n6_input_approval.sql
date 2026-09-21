-- Exact-job human AI-use acknowledgement for text-only, asset-free N6 inputs.
-- This does not reserve budget or dispatch a provider request.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_input_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  job_input_sha256 text not null check (job_input_sha256 ~ '^[0-9a-f]{64}$'),
  work_sha256 text not null check (work_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  approved_scope text not null default 'configured_text_ai'
    check (approved_scope = 'configured_text_ai'),
  foreign key (job_id, organization_id)
    references public.ai_execution_jobs(id, organization_id) on delete restrict,
  unique (job_id),
  unique (organization_id, request_id)
);
create index ai_execution_input_approvals_org_job
  on public.ai_execution_input_approvals(organization_id, job_id);
create trigger protect_ai_execution_input_approvals before update or delete
  on public.ai_execution_input_approvals for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_input_approvals enable row level security;
revoke all on public.ai_execution_input_approvals from public, anon, authenticated, service_role;
grant select on public.ai_execution_input_approvals to authenticated, service_role;
create policy "Current team can read AI input approvals"
  on public.ai_execution_input_approvals for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function public.approve_pipeline_ai_job_inputs(
  p_organization_id uuid, p_job_id uuid, p_request_id uuid, p_acknowledged boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  plan public.pipeline_run_plans;
  review public.pipeline_run_intent_reviews;
  existing public.ai_execution_input_approvals;
  request_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_job_id is null
    or p_request_id is null or p_acknowledged is distinct from true then
    raise exception 'An authenticated, acknowledged job request is required.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for share of organization, membership;
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id for share;
  if not found or job.requested_by <> actor or job.status <> 'blocked_configuration' then
    raise exception 'The actor-owned blocked job is unavailable.' using errcode = '42501';
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id for share;
  select * into plan from public.pipeline_run_plans
    where id = job.run_plan_id and organization_id = p_organization_id
      and run_intent_id = job.run_intent_id for share;
  select * into review from public.pipeline_run_intent_reviews
    where run_intent_id = job.run_intent_id and organization_id = p_organization_id for share;
  if intent.id is null or plan.id is null or review.id is null
    or review.decision <> 'accepted_for_planning' or review.reviewed_by = actor
    or plan.planned_by <> actor then
    raise exception 'A distinct accepted review and actor-owned plan are required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'job_id', job.id, 'actor_id', actor,
    'job_input_sha256', job.input_sha256, 'work_sha256', plan.work_sha256,
    'approved_scope', 'configured_text_ai'
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing from public.ai_execution_input_approvals
    where job_id = job.id or (organization_id = p_organization_id and request_id = p_request_id);
  if found then
    if existing.job_id <> job.id or existing.request_id <> p_request_id
      or existing.approved_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Job or request ID already has a different approval.' using errcode = '23505';
    end if;
    return jsonb_build_object('approval_id', existing.id, 'idempotent_replay', true);
  end if;
  if not exists (
    select 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active')
  ) then
    raise exception 'The engagement is not current.' using errcode = '55000';
  end if;
  if jsonb_typeof(intent.input_manifest -> 'assets') is distinct from 'array'
    or coalesce(jsonb_array_length(intent.input_manifest -> 'assets'), -1) <> 0 then
    raise exception 'Selected assets need separate AI-use classification and consent.'
      using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(intent.input_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.input_sha256
    or encode(extensions.digest(convert_to(plan.work_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> plan.work_sha256
    or encode(extensions.digest(convert_to(job.input_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> job.input_sha256
    or job.input_manifest ->> 'input_sha256' is distinct from intent.input_sha256
    or job.input_manifest ->> 'work_sha256' is distinct from plan.work_sha256 then
    raise exception 'Pinned input integrity failed.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service
      on service.id = (selected.value ->> 'id')::uuid
     and service.engagement_id = intent.engagement_id
     and service.organization_id = p_organization_id
     and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'A pinned service is no longer available.' using errcode = '55000';
  end if;
  if (select count(*) from public.ai_execution_job_steps step where step.job_id = job.id)
       <> jsonb_array_length(plan.work_manifest)
    or exists (
      select 1 from public.ai_execution_job_steps step
      left join public.work_items item
        on item.id = step.work_item_id and item.organization_id = step.organization_id
       and item.engagement_id = intent.engagement_id and item.deleted_at is null
      where step.job_id = job.id and (
        item.id is null or item.row_version <> step.source_row_version
        or item.status = 'done'
        or item.department_id is distinct from step.department_id
      )
    ) then
    raise exception 'Pinned work has changed; start a new run request.' using errcode = '55000';
  end if;
  insert into public.ai_execution_input_approvals(
    organization_id, job_id, request_id, request_sha256,
    job_input_sha256, work_sha256, approved_by
  ) values (
    p_organization_id, job.id, p_request_id, request_sha,
    job.input_sha256, plan.work_sha256, actor
  ) returning id into new_id;
  return jsonb_build_object('approval_id', new_id, 'idempotent_replay', false);
end;
$$;
revoke all on function public.approve_pipeline_ai_job_inputs(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_pipeline_ai_job_inputs(uuid, uuid, uuid, boolean)
  to authenticated;
comment on table public.ai_execution_input_approvals is
  'Exact-job acknowledgement for asset-free text inputs only; no budget, execution, or provider consent beyond configured text AI.';
commit;