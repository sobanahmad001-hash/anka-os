-- Service-only reconciliation of prepared N6 attempts. This does not call a provider.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_step_outputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  configured_step_id uuid not null,
  attempt_id uuid not null unique
    references private.ai_execution_step_attempts(id) on delete restrict,
  ai_run_id uuid not null unique references public.ai_runs(id) on delete restrict,
  provider text not null check (length(provider) between 1 and 80),
  model_id text not null check (length(model_id) between 1 and 160),
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  job_input_sha256 text not null check (job_input_sha256 ~ '^[0-9a-f]{64}$'),
  measured_cost_microusd bigint not null check (measured_cost_microusd >= 0),
  review_status text not null default 'pending' check (review_status = 'pending'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (configured_step_id, job_id, organization_id)
    references public.ai_execution_configured_steps(id, job_id, organization_id) on delete restrict,
  unique (organization_id, configured_step_id)
);
create index ai_execution_step_outputs_job
  on public.ai_execution_step_outputs(organization_id, job_id, created_at);
create trigger protect_ai_execution_step_outputs before update or delete
  on public.ai_execution_step_outputs for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_step_outputs enable row level security;
revoke all on public.ai_execution_step_outputs from public, anon, authenticated, service_role;
grant select on public.ai_execution_step_outputs to authenticated, service_role;
create policy "Current team reads N6 output lineage"
  on public.ai_execution_step_outputs for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function public.reconcile_pipeline_ai_step_attempt(
  p_organization_id uuid, p_attempt_id uuid, p_outcome text,
  p_measured_cost_microusd bigint, p_ai_run_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  run public.ai_runs;
  current_output public.ai_execution_step_outputs;
  reconciliation jsonb;
  evidence text := trim(coalesce(p_evidence, ''));
begin
  if p_organization_id is null or p_attempt_id is null
    or p_outcome is null or p_outcome not in ('uncertain', 'settled', 'released')
    or length(evidence) not between 1 and 1000
    or (p_outcome = 'settled' and (p_ai_run_id is null
      or p_measured_cost_microusd is null or p_measured_cost_microusd < 0))
    or (p_outcome <> 'settled' and (p_ai_run_id is not null
      or p_measured_cost_microusd is not null)) then
    raise exception 'Exact AI outcome and provider evidence are required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id for share;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  select * into job from public.ai_execution_jobs
    where id = attempt.job_id and organization_id = p_organization_id;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  if job.id is null or intent.id is null
    or job.input_sha256 <> attempt.job_input_sha256 then
    raise exception 'Pinned attempt lineage has changed.' using errcode = '55000';
  end if;
  if p_outcome = 'settled' then
    select * into run from public.ai_runs
      where id = p_ai_run_id and organization_id = p_organization_id;
    if run.id is null or run.status <> 'completed'
      or run.user_id <> attempt.actor_id
      or run.engagement_id is distinct from intent.engagement_id
      or run.redacted_at is not null or length(run.output_text) = 0
      or run.context_manifest ->> 'attempt_id' is distinct from attempt.id::text
      or run.context_manifest ->> 'job_id' is distinct from job.id::text
      or run.context_manifest ->> 'configured_step_id' is distinct from attempt.configured_step_id::text
      or run.context_manifest ->> 'job_input_sha256' is distinct from attempt.job_input_sha256
      or not exists (
        select 1 from jsonb_array_elements(attempt.route_snapshot) eligible(value)
        where eligible.value ->> 'provider' = run.provider
          and eligible.value ->> 'model_id' = run.model
          and eligible.value ->> 'connection_id' =
            run.context_manifest ->> 'connector_connection_id'
      ) then
      raise exception 'Measured, exact-source AI run on a pinned route is required.' using errcode = '42501';
    end if;
  end if;
  reconciliation := private.n6_reconcile_step_budget(
    p_organization_id, attempt.configured_step_id, p_outcome,
    p_measured_cost_microusd, p_ai_run_id, evidence);
  if p_outcome = 'settled' then
    select * into current_output from public.ai_execution_step_outputs
      where attempt_id = attempt.id or ai_run_id = run.id;
    if found then
      if current_output.attempt_id <> attempt.id or current_output.ai_run_id <> run.id
        or current_output.measured_cost_microusd <> p_measured_cost_microusd then
        raise exception 'AI output is already linked to another attempt.' using errcode = '23505';
      end if;
    else
      insert into public.ai_execution_step_outputs(
        organization_id, job_id, configured_step_id, attempt_id, ai_run_id,
        provider, model_id, output_sha256, job_input_sha256,
        measured_cost_microusd
      ) values (
        p_organization_id, job.id, attempt.configured_step_id, attempt.id, run.id,
        run.provider, run.model,
        encode(extensions.digest(convert_to(run.output_text, 'UTF8'), 'sha256'), 'hex'),
        attempt.job_input_sha256, p_measured_cost_microusd
      );
    end if;
  end if;
  return jsonb_build_object('attempt_id', attempt.id, 'outcome', p_outcome,
    'reservation_id', reconciliation ->> 'reservation_id',
    'idempotent_replay', reconciliation -> 'idempotent_replay');
end;
$$;
revoke all on function public.reconcile_pipeline_ai_step_attempt(uuid, uuid, text, bigint, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_pipeline_ai_step_attempt(uuid, uuid, text, bigint, uuid, text)
  to service_role;
comment on table public.ai_execution_step_outputs is
  'Immutable pending-review lineage for settled, measured N6 AI output. No publication or provider dispatch.';
commit;