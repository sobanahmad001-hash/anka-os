-- Materialize immutable configured step identities on blocked N6 jobs.
-- Existing work-item snapshots remain separate; this creates no provider path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_execution_configured_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  project_activation_id uuid not null,
  ordinal smallint not null check (ordinal between 1 and 50),
  step_key text not null check (step_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  instance_number smallint not null check (instance_number between 1 and 50),
  definition_step jsonb not null check (jsonb_typeof(definition_step) = 'object'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'blocked_configuration'
    check (status = 'blocked_configuration'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, organization_id)
    references public.ai_execution_jobs(id, organization_id) on delete restrict,
  foreign key (project_activation_id, organization_id)
    references public.project_pipeline_activations(id, organization_id) on delete restrict,
  unique (job_id, ordinal),
  unique (job_id, step_key, instance_number)
);
create index ai_execution_configured_steps_org_job
  on public.ai_execution_configured_steps(organization_id, job_id, ordinal);
create trigger protect_ai_execution_configured_steps before update or delete
  on public.ai_execution_configured_steps for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.ai_execution_configured_steps enable row level security;
revoke all on public.ai_execution_configured_steps from public, anon, authenticated, service_role;
grant select on public.ai_execution_configured_steps to authenticated, service_role;
create policy "Current team reads configured execution steps"
  on public.ai_execution_configured_steps for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function private.n6_materialize_configured_steps(p_job_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  definition public.pipeline_execution_definitions;
  selected jsonb;
  source_step jsonb;
  quantity integer;
  instance_index integer;
  ordinal_index integer := 0;
  persisted_count integer;
  step_manifest jsonb;
begin
  select * into job from public.ai_execution_jobs where id = p_job_id;
  if not found then raise exception 'Execution job is unavailable.' using errcode = 'P0002'; end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = job.organization_id;
  if not found then raise exception 'Pinned run intent is unavailable.' using errcode = '55000'; end if;
  if intent.project_activation_id is null then return 0; end if;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id
      and organization_id = job.organization_id
      and engagement_id = intent.engagement_id;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id
      and organization_id = job.organization_id
      and engagement_id = intent.engagement_id;
  select source_definition.* into definition
    from public.pipeline_execution_publications publication
    join public.pipeline_execution_definitions source_definition
      on source_definition.id = publication.definition_id
     and source_definition.organization_id = publication.organization_id
    where publication.id = configuration.definition_publication_id
      and publication.organization_id = job.organization_id;
  if activation.id is null or configuration.id is null or definition.id is null
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256 then
    raise exception 'Configured execution lineage or integrity has changed.' using errcode = '55000';
  end if;
  for selected in select value from jsonb_array_elements(configuration.selected_steps)
  loop
    select value into source_step from jsonb_array_elements(definition.steps)
      where value ->> 'key' = selected ->> 'key';
    if not found then
      raise exception 'Configured step is absent from its published definition.' using errcode = '55000';
    end if;
    quantity := (selected ->> 'quantity')::integer;
    if quantity not between 1 and 50 then
      raise exception 'Configured quantity is invalid.' using errcode = '55000';
    end if;
    for instance_index in 1..quantity loop
      ordinal_index := ordinal_index + 1;
      if ordinal_index > 50 then
        raise exception 'Configured step count exceeds 50.' using errcode = '55000';
      end if;
      step_manifest := jsonb_build_object(
        'job_input_sha256', job.input_sha256,
        'project_activation_id', activation.id,
        'selected_steps_sha256', intent.selected_steps_sha256,
        'definition_step', source_step,
        'instance_number', instance_index,
        'ordinal', ordinal_index
      );
      insert into public.ai_execution_configured_steps(
        organization_id, job_id, project_activation_id, ordinal,
        step_key, instance_number, definition_step, input_sha256
      ) values (
        job.organization_id, job.id, activation.id, ordinal_index,
        selected ->> 'key', instance_index, source_step,
        encode(extensions.digest(convert_to(step_manifest::text, 'UTF8'), 'sha256'), 'hex')
      )
      on conflict (job_id, step_key, instance_number) do nothing;
    end loop;
  end loop;
  select count(*) into persisted_count from public.ai_execution_configured_steps
    where job_id = job.id and organization_id = job.organization_id
      and project_activation_id = activation.id;
  if persisted_count <> ordinal_index then
    raise exception 'Configured step materialization is incomplete.' using errcode = '55000';
  end if;
  return persisted_count;
end;
$$;
revoke all on function private.n6_materialize_configured_steps(uuid)
  from public, anon, authenticated, service_role;

create function private.n6_create_configured_steps()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.n6_materialize_configured_steps(new.id);
  return new;
end;
$$;
revoke all on function private.n6_create_configured_steps()
  from public, anon, authenticated, service_role;
create trigger n6_create_configured_steps after insert on public.ai_execution_jobs
  for each row execute function private.n6_create_configured_steps();

-- Cover a run planned between the preceding pin migration and this migration.
select private.n6_materialize_configured_steps(job.id)
from public.ai_execution_jobs job
join public.pipeline_run_intents intent
  on intent.id = job.run_intent_id and intent.organization_id = job.organization_id
where intent.project_activation_id is not null;

comment on table public.ai_execution_configured_steps is
  'Immutable, bounded instances of activated project-definition steps for blocked execution jobs. No provider dispatch or spend.';
commit;
