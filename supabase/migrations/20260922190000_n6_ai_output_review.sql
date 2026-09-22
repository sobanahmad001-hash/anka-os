-- Human review of measured N6 output. Acceptance unblocks dependencies but never publishes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_step_output_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  configured_step_id uuid not null,
  output_id uuid not null unique references public.ai_execution_step_outputs(id) on delete restrict,
  request_id uuid not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('accepted', 'rejected')),
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  expected_progress_version bigint not null check (expected_progress_version > 0),
  evidence text not null check (length(trim(evidence)) between 1 and 1000),
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (configured_step_id, job_id, organization_id)
    references public.ai_execution_configured_steps(id, job_id, organization_id) on delete restrict,
  unique (organization_id, request_id)
);
create index ai_execution_step_output_reviews_job
  on public.ai_execution_step_output_reviews(organization_id, job_id, reviewed_at);
create trigger protect_ai_execution_step_output_reviews before update or delete
  on public.ai_execution_step_output_reviews for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_step_output_reviews enable row level security;
revoke all on public.ai_execution_step_output_reviews from public, anon, authenticated, service_role;
grant select on public.ai_execution_step_output_reviews to authenticated, service_role;
create policy "Current team reads N6 output reviews"
  on public.ai_execution_step_output_reviews for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function private.n6_require_output_reviewer(
  p_organization_id uuid, p_output_id uuid, p_actor_id uuid
) returns public.ai_execution_step_outputs language plpgsql security definer set search_path = '' as $$
declare
  output public.ai_execution_step_outputs;
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  engagement public.engagements;
  step public.ai_execution_configured_steps;
  attempt private.ai_execution_step_attempts;
begin
  if p_organization_id is null or p_output_id is null or p_actor_id is null then
    raise exception 'Exact output and authenticated actor are required.' using errcode = '22023';
  end if;
  select * into output from public.ai_execution_step_outputs
    where id = p_output_id and organization_id = p_organization_id;
  select * into job from public.ai_execution_jobs
    where id = output.job_id and organization_id = p_organization_id;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  select * into engagement from public.engagements
    where id = intent.engagement_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = output.configured_step_id and job_id = job.id
      and organization_id = p_organization_id;
  select * into attempt from private.ai_execution_step_attempts
    where id = output.attempt_id and organization_id = p_organization_id;
  if output.id is null or job.id is null or intent.id is null
    or engagement.id is null or step.id is null or attempt.id is null
    or output.job_input_sha256 <> job.input_sha256
    or attempt.job_input_sha256 <> job.input_sha256
    or step.project_activation_id is distinct from intent.project_activation_id
    or engagement.status not in ('planning', 'active')
    or exists (
      select 1 from public.project_pipeline_activations current_activation
      join public.project_pipeline_activations newer
        on newer.organization_id = current_activation.organization_id
        and newer.engagement_id = current_activation.engagement_id
        and newer.activation_number > current_activation.activation_number
      where current_activation.id = intent.project_activation_id
        and current_activation.organization_id = p_organization_id
    ) then
    raise exception 'Current pinned output is unavailable.' using errcode = '55000';
  end if;
  if not (private.n1e_org_authority(p_organization_id, engagement.project_id, p_actor_id)
    or private.n1e_department_head(p_organization_id, engagement.project_id,
      step.definition_step ->> 'department_id', p_actor_id)) then
    raise exception 'Current scoped specialist review authority is required.' using errcode = '42501';
  end if;
  return output;
end;
$$;
revoke all on function private.n6_require_output_reviewer(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.get_pipeline_ai_step_output_for_review(
  p_organization_id uuid, p_output_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  output public.ai_execution_step_outputs;
  run public.ai_runs;
begin
  output := private.n6_require_output_reviewer(p_organization_id, p_output_id, actor);
  select * into run from public.ai_runs
    where id = output.ai_run_id and organization_id = p_organization_id;
  if run.id is null or run.redacted_at is not null or run.status <> 'completed'
    or run.provider is distinct from output.provider
    or run.model is distinct from output.model_id
    or run.context_manifest ->> 'attempt_id' is distinct from output.attempt_id::text
    or run.context_manifest ->> 'job_id' is distinct from output.job_id::text
    or run.context_manifest ->> 'configured_step_id' is distinct from output.configured_step_id::text
    or run.context_manifest ->> 'job_input_sha256' is distinct from output.job_input_sha256
    or encode(extensions.digest(convert_to(run.output_text, 'UTF8'), 'sha256'), 'hex')
      <> output.output_sha256 then
    raise exception 'Output version is unavailable or has changed.' using errcode = '55000';
  end if;
  return jsonb_build_object('output_id', output.id, 'job_id', output.job_id,
    'configured_step_id', output.configured_step_id,
    'output_sha256', output.output_sha256, 'provider', output.provider,
    'model_id', output.model_id, 'measured_cost_microusd', output.measured_cost_microusd,
    'content', run.output_text);
end;
$$;
revoke all on function public.get_pipeline_ai_step_output_for_review(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_pipeline_ai_step_output_for_review(uuid, uuid)
  to authenticated;

create function public.review_pipeline_ai_step_output(
  p_organization_id uuid, p_output_id uuid, p_request_id uuid,
  p_expected_progress_version bigint, p_decision text, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  output public.ai_execution_step_outputs;
  attempt private.ai_execution_step_attempts;
  progress public.ai_execution_step_progress;
  prior public.ai_execution_step_output_reviews;
  run public.ai_runs;
  evidence text := trim(coalesce(p_evidence, ''));
  new_id uuid;
begin
  if p_request_id is null or p_expected_progress_version is null
    or p_expected_progress_version <= 0 or p_decision is null
    or p_decision not in ('accepted', 'rejected')
    or length(evidence) not between 1 and 1000 then
    raise exception 'Exact output review, version and evidence are required.' using errcode = '22023';
  end if;
  output := private.n6_require_output_reviewer(p_organization_id, p_output_id, actor);
  select * into attempt from private.ai_execution_step_attempts
    where id = output.attempt_id and organization_id = p_organization_id;
  if actor = attempt.actor_id then
    raise exception 'The AI requester cannot approve their own output.' using errcode = '42501';
  end if;
  select * into run from public.ai_runs
    where id = output.ai_run_id and organization_id = p_organization_id;
  if run.id is null or run.redacted_at is not null or run.status <> 'completed'
    or run.provider is distinct from output.provider
    or run.model is distinct from output.model_id
    or run.context_manifest ->> 'attempt_id' is distinct from output.attempt_id::text
    or run.context_manifest ->> 'job_id' is distinct from output.job_id::text
    or run.context_manifest ->> 'configured_step_id' is distinct from output.configured_step_id::text
    or run.context_manifest ->> 'job_input_sha256' is distinct from output.job_input_sha256
    or encode(extensions.digest(convert_to(run.output_text, 'UTF8'), 'sha256'), 'hex')
      <> output.output_sha256 then
    raise exception 'Output version is unavailable or has changed.' using errcode = '55000';
  end if;
  select * into progress from public.ai_execution_step_progress
    where configured_step_id = output.configured_step_id
      and organization_id = p_organization_id for update;
  if not found then raise exception 'Step progress is unavailable.' using errcode = '55000'; end if;
  select * into prior from public.ai_execution_step_output_reviews
    where organization_id = p_organization_id
      and (output_id = output.id or request_id = p_request_id);
  if found then
    if prior.output_id <> output.id or prior.request_id <> p_request_id
      or prior.reviewed_by <> actor or prior.decision <> p_decision
      or prior.evidence <> evidence or prior.expected_progress_version <> p_expected_progress_version then
      raise exception 'Output or request ID already has another review.' using errcode = '23505';
    end if;
    return jsonb_build_object('review_id', prior.id, 'decision', prior.decision,
      'state_version', prior.expected_progress_version + 1,
      'idempotent_replay', true);
  end if;
  if progress.status <> 'waiting' or progress.state_version <> p_expected_progress_version then
    raise exception 'Output step version changed; refresh the run.' using errcode = '40001';
  end if;
  insert into public.ai_execution_step_output_reviews(
    organization_id, job_id, configured_step_id, output_id, request_id,
    reviewed_by, decision, output_sha256, expected_progress_version, evidence
  ) values (
    p_organization_id, output.job_id, output.configured_step_id, output.id, p_request_id,
    actor, p_decision, output.output_sha256, p_expected_progress_version, evidence
  ) returning id into new_id;
  update public.ai_execution_step_progress
    set status = case when p_decision = 'accepted' then 'completed' else 'paused' end,
      state_version = state_version + 1,
      started_by = attempt.actor_id,
      started_at = attempt.created_at,
      completed_by = case when p_decision = 'accepted' then actor else null end,
      completed_at = case when p_decision = 'accepted' then clock_timestamp() else null end,
      updated_at = clock_timestamp()
    where configured_step_id = output.configured_step_id;
  return jsonb_build_object('review_id', new_id, 'decision', p_decision,
    'state_version', p_expected_progress_version + 1,
    'idempotent_replay', false);
end;
$$;
revoke all on function public.review_pipeline_ai_step_output(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_pipeline_ai_step_output(uuid, uuid, uuid, bigint, text, text)
  to authenticated;
commit;