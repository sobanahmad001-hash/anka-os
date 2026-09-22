-- Human and approval-gate progress for pinned N6 jobs. AI execution remains blocked.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_step_progress (
  configured_step_id uuid primary key,
  organization_id uuid not null,
  job_id uuid not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'in_progress', 'paused', 'completed')),
  state_version bigint not null default 1 check (state_version > 0),
  started_by uuid references auth.users(id) on delete restrict,
  started_at timestamptz,
  completed_by uuid references auth.users(id) on delete restrict,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (configured_step_id, job_id, organization_id)
    references public.ai_execution_configured_steps(id, job_id, organization_id) on delete restrict,
  check ((status = 'waiting' and started_at is null and completed_at is null)
    or (status in ('in_progress', 'paused') and started_at is not null and completed_at is null)
    or (status = 'completed' and completed_at is not null))
);
create index ai_execution_step_progress_job
  on public.ai_execution_step_progress(organization_id, job_id, status);
alter table public.ai_execution_step_progress enable row level security;
revoke all on public.ai_execution_step_progress from public, anon, authenticated, service_role;
grant select on public.ai_execution_step_progress to authenticated, service_role;
create policy "Current team reads N6 step progress"
  on public.ai_execution_step_progress for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create table public.ai_execution_step_action_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  configured_step_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('start', 'complete', 'approve', 'pause', 'resume')),
  prior_version bigint not null check (prior_version > 0),
  resulting_version bigint not null check (resulting_version = prior_version + 1),
  evidence text not null default '' check (length(evidence) <= 1000),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (configured_step_id, job_id, organization_id)
    references public.ai_execution_configured_steps(id, job_id, organization_id) on delete restrict,
  unique (organization_id, request_id),
  unique (configured_step_id, resulting_version)
);
create index ai_execution_step_action_events_step
  on public.ai_execution_step_action_events(configured_step_id, occurred_at);
create trigger protect_ai_execution_step_action_events before update or delete
  on public.ai_execution_step_action_events for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_step_action_events enable row level security;
revoke all on public.ai_execution_step_action_events from public, anon, authenticated, service_role;
grant select on public.ai_execution_step_action_events to authenticated, service_role;
create policy "Current team reads N6 step action events"
  on public.ai_execution_step_action_events for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function private.n6_initialize_step_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_execution_step_progress(configured_step_id, organization_id, job_id)
    values(new.id, new.organization_id, new.job_id);
  return new;
end;
$$;
revoke all on function private.n6_initialize_step_progress()
  from public, anon, authenticated, service_role;
create trigger n6_initialize_step_progress after insert on public.ai_execution_configured_steps
  for each row execute function private.n6_initialize_step_progress();
insert into public.ai_execution_step_progress(configured_step_id, organization_id, job_id)
select step.id, step.organization_id, step.job_id
from public.ai_execution_configured_steps step
on conflict (configured_step_id) do nothing;

create function public.advance_pipeline_manual_step(
  p_organization_id uuid, p_job_id uuid, p_step_id uuid,
  p_request_id uuid, p_expected_version bigint, p_action text, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  plan public.pipeline_run_plans;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  step public.ai_execution_configured_steps;
  progress public.ai_execution_step_progress;
  prior_event public.ai_execution_step_action_events;
  engagement public.engagements;
  approval public.ai_execution_input_approvals;
  dependency text;
  evidence text := trim(coalesce(p_evidence, ''));
  step_kind text;
begin
  if actor is null or p_organization_id is null or p_job_id is null
    or p_step_id is null or p_request_id is null or p_expected_version is null
    or p_expected_version <= 0 or p_action is null or p_action not in ('start', 'complete', 'approve', 'pause', 'resume')
    or length(evidence) > 1000
    or (p_action in ('complete', 'approve') and length(evidence) = 0) then
    raise exception 'Exact manual action, version and completion evidence are required.' using errcode = '22023';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id for share;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id for share;
  select * into plan from public.pipeline_run_plans
    where id = job.run_plan_id and organization_id = p_organization_id
      and run_intent_id = job.run_intent_id for share;
  select * into engagement from public.engagements
    where id = intent.engagement_id and organization_id = p_organization_id for share;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id for share;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id for share;
  if job.id is null or intent.id is null or plan.id is null or engagement.id is null or activation.id is null or configuration.id is null
    or job.status <> 'blocked_configuration'
    or engagement.status not in ('planning', 'active')
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
      <> intent.selected_steps_sha256
    or exists (select 1 from public.project_pipeline_activations newer
      where newer.organization_id = p_organization_id
        and newer.engagement_id = engagement.id
        and newer.activation_number > activation.activation_number) then
    raise exception 'Current pinned manual run is required.' using errcode = '55000';
  end if;
  select * into step from public.ai_execution_configured_steps
    where id = p_step_id and job_id = job.id and organization_id = p_organization_id
      and project_activation_id = activation.id;
  step_kind := step.definition_step ->> 'kind';
  if step.id is null or step_kind not in ('human', 'approval_gate') then
    raise exception 'Only a pinned human or approval step may be advanced here.' using errcode = '42501';
  end if;
  if not (private.n6_project_configuration_authorized(
      p_organization_id, engagement.project_id, actor)
    or private.n1e_department_head(p_organization_id, engagement.project_id,
      step.definition_step ->> 'department_id', actor)) then
    raise exception 'Current exact-project or department authority is required.' using errcode = '42501';
  end if;
  select * into approval from public.ai_execution_input_approvals
    where job_id = job.id and organization_id = p_organization_id;
  if approval.id is null or approval.job_input_sha256 <> job.input_sha256
    or approval.work_sha256 <> plan.work_sha256 then
    raise exception 'Exact pinned input acknowledgement is required.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(intent.input_manifest::text, 'UTF8'), 'sha256'), 'hex') <> intent.input_sha256
    or encode(extensions.digest(convert_to(plan.work_manifest::text, 'UTF8'), 'sha256'), 'hex') <> plan.work_sha256
    or encode(extensions.digest(convert_to(job.input_manifest::text, 'UTF8'), 'sha256'), 'hex') <> job.input_sha256
    or job.input_manifest ->> 'input_sha256' is distinct from intent.input_sha256
    or job.input_manifest ->> 'work_sha256' is distinct from plan.work_sha256 then
    raise exception 'Pinned input integrity failed.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service
      on service.id = (selected.value ->> 'id')::uuid
      and service.organization_id = p_organization_id
      and service.engagement_id = intent.engagement_id
      and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'A pinned service is no longer available.' using errcode = '55000';
  end if;
  if (select count(*) from public.ai_execution_job_steps linked where linked.job_id = job.id)
       <> jsonb_array_length(plan.work_manifest)
    or exists (
      select 1 from public.ai_execution_job_steps linked
      left join public.work_items item
        on item.id = linked.work_item_id and item.organization_id = linked.organization_id
          and item.engagement_id = intent.engagement_id and item.deleted_at is null
      where linked.job_id = job.id and (
        item.id is null or item.row_version <> linked.source_row_version
        or item.status = 'done'
        or item.department_id is distinct from linked.department_id
      )
    ) then
    raise exception 'Pinned work has changed; start a new run request.' using errcode = '55000';
  end if;
  select * into progress from public.ai_execution_step_progress
    where configured_step_id = step.id and organization_id = p_organization_id for update;
  if not found then raise exception 'Step progress is missing.' using errcode = '55000'; end if;
  select * into prior_event from public.ai_execution_step_action_events
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if prior_event.job_id <> job.id or prior_event.configured_step_id <> step.id
      or prior_event.actor_id <> actor or prior_event.action <> p_action
      or prior_event.prior_version <> p_expected_version
      or prior_event.evidence <> evidence then
      raise exception 'Request ID has a different manual action.' using errcode = '23505';
    end if;
    return jsonb_build_object('step_id', step.id, 'status', case when prior_event.action in ('complete', 'approve') then 'completed'
        when prior_event.action = 'pause' then 'paused' else 'in_progress' end,
      'state_version', prior_event.resulting_version, 'idempotent_replay', true);
  end if;
  if progress.state_version <> p_expected_version then
    raise exception 'Step version changed; refresh the run.' using errcode = '40001';
  end if;
  if p_action in ('start', 'approve') then
    for dependency in select value from jsonb_array_elements_text(step.definition_step -> 'depends_on') loop
      if exists (select 1 from public.ai_execution_configured_steps required
        join public.ai_execution_step_progress required_progress
          on required_progress.configured_step_id = required.id
        where required.job_id = job.id and required.organization_id = p_organization_id
          and required.step_key = dependency and required_progress.status <> 'completed') then
        raise exception 'A pinned dependency is not complete.' using errcode = '55000';
      end if;
    end loop;
  end if;
  if (p_action = 'start' and (step_kind <> 'human' or progress.status <> 'waiting'))
    or (p_action = 'complete' and (step_kind <> 'human' or progress.status <> 'in_progress'))
    or (p_action = 'approve' and (step_kind <> 'approval_gate' or progress.status <> 'waiting'
      or actor = job.requested_by))
    or (p_action = 'pause' and (step_kind <> 'human' or progress.status <> 'in_progress'))
    or (p_action = 'resume' and (step_kind <> 'human' or progress.status <> 'paused')) then
    raise exception 'Manual step transition is not permitted.' using errcode = '55000';
  end if;
  update public.ai_execution_step_progress
    set status = case p_action
      when 'start' then 'in_progress' when 'complete' then 'completed'
      when 'approve' then 'completed' when 'pause' then 'paused'
      else 'in_progress' end,
      state_version = state_version + 1,
      started_by = case when p_action = 'start' then actor else started_by end,
      started_at = case when p_action = 'start' then clock_timestamp() else started_at end,
      completed_by = case when p_action in ('complete', 'approve') then actor else completed_by end,
      completed_at = case when p_action in ('complete', 'approve') then clock_timestamp() else completed_at end,
      updated_at = clock_timestamp()
    where configured_step_id = step.id;
  insert into public.ai_execution_step_action_events(
    organization_id, job_id, configured_step_id, request_id, actor_id,
    action, prior_version, resulting_version, evidence
  ) values (
    p_organization_id, job.id, step.id, p_request_id, actor,
    p_action, p_expected_version, p_expected_version + 1, evidence
  );
  return jsonb_build_object('step_id', step.id,
    'status', case when p_action in ('complete', 'approve') then 'completed'
      when p_action = 'pause' then 'paused' else 'in_progress' end,
    'state_version', p_expected_version + 1, 'idempotent_replay', false);
end;
$$;
revoke all on function public.advance_pipeline_manual_step(uuid, uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.advance_pipeline_manual_step(uuid, uuid, uuid, uuid, bigint, text, text)
  to authenticated;
commit;