-- Activation is an explicit, impact-reviewed event. Old configurations, jobs
-- and work stay intact. Neither preview nor activation dispatches AI.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.n6_project_pipeline_impact(p_configuration_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  configuration public.project_pipeline_configurations;
  current_activation public.project_pipeline_activations;
  previous public.project_pipeline_configurations;
  new_keys jsonb;
  removed_keys jsonb;
  existing_jobs integer;
  job_ids text;
  token text;
begin
  select * into configuration from public.project_pipeline_configurations
    where id = p_configuration_id;
  if not found then raise exception 'Configuration is unavailable.' using errcode = 'P0002'; end if;
  select * into current_activation from public.project_pipeline_activations
    where engagement_id = configuration.engagement_id
      and organization_id = configuration.organization_id
    order by activation_number desc limit 1;
  if current_activation.id is not null then
    select * into previous from public.project_pipeline_configurations
      where id = current_activation.configuration_id
        and organization_id = configuration.organization_id;
  end if;
  select coalesce(jsonb_agg(selected.value ->> 'key' order by selected.position), '[]'::jsonb)
    into new_keys
    from jsonb_array_elements(configuration.selected_steps)
      with ordinality selected(value, position)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(previous.selected_steps, '[]'::jsonb)) old(value)
      where old.value ->> 'key' = selected.value ->> 'key'
    );
  select coalesce(jsonb_agg(old.value ->> 'key' order by old.position), '[]'::jsonb)
    into removed_keys
    from jsonb_array_elements(coalesce(previous.selected_steps, '[]'::jsonb))
      with ordinality old(value, position)
    where not exists (
      select 1 from jsonb_array_elements(configuration.selected_steps) selected(value)
      where selected.value ->> 'key' = old.value ->> 'key'
    );
  select count(*), coalesce(string_agg(job.id::text, ',' order by job.id), '')
    into existing_jobs, job_ids
    from public.pipeline_run_intents intent
    join public.ai_execution_jobs job
      on job.run_intent_id = intent.id and job.organization_id = intent.organization_id
    where intent.engagement_id = configuration.engagement_id
      and intent.organization_id = configuration.organization_id;
  token := encode(extensions.digest(convert_to(jsonb_build_object(
    'configuration_id', configuration.id,
    'selected_steps_sha256', configuration.selected_steps_sha256,
    'previous_activation_id', current_activation.id,
    'previous_configuration_id', previous.id,
    'existing_job_ids', job_ids
  )::text, 'UTF8'), 'sha256'), 'hex');
  return jsonb_build_object(
    'configuration_id', configuration.id,
    'previous_activation_id', current_activation.id,
    'previous_configuration_id', previous.id,
    'added_step_keys', new_keys,
    'removed_step_keys', removed_keys,
    'previous_selected_steps', coalesce(previous.selected_steps, '[]'::jsonb),
    'new_selected_steps', configuration.selected_steps,
    'previous_max_ai_cost_microusd', previous.max_ai_cost_microusd,
    'existing_jobs_preserved', existing_jobs,
    'new_step_count', jsonb_array_length(configuration.selected_steps),
    'new_max_ai_cost_microusd', configuration.max_ai_cost_microusd,
    'impact_token_sha256', token
  );
end;
$$;
revoke all on function private.n6_project_pipeline_impact(uuid)
  from public, anon, authenticated, service_role;

create function public.preview_project_pipeline_activation(
  p_organization_id uuid, p_configuration_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  configuration public.project_pipeline_configurations;
begin
  if actor is null or p_organization_id is null or p_configuration_id is null then
    raise exception 'Authenticated project configuration is required.' using errcode = '22023';
  end if;
  select * into configuration from public.project_pipeline_configurations
    where id = p_configuration_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Configuration is unavailable.' using errcode = 'P0002';
  end if;
  if not private.n6_project_configuration_authorized(
    p_organization_id, configuration.project_id, actor
  ) then
    raise exception 'Current exact-project manager authority is required.' using errcode = '42501';
  end if;
  return private.n6_project_pipeline_impact(configuration.id);
end;
$$;
revoke all on function public.preview_project_pipeline_activation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_project_pipeline_activation(uuid, uuid)
  to authenticated;

create function public.activate_project_pipeline_configuration(
  p_organization_id uuid, p_configuration_id uuid, p_request_id uuid,
  p_impact_token_sha256 text, p_impact_acknowledged boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  configuration public.project_pipeline_configurations;
  engagement public.engagements;
  existing public.project_pipeline_activations;
  impact jsonb;
  selected jsonb;
  definition public.pipeline_execution_definitions;
  activation_number integer;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_configuration_id is null
    or p_request_id is null or p_impact_acknowledged is distinct from true
    or p_impact_token_sha256 is null
    or p_impact_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact impact review and acknowledgement are required.' using errcode = '22023';
  end if;
  select * into configuration from public.project_pipeline_configurations
    where id = p_configuration_id and organization_id = p_organization_id;
  if not found then raise exception 'Configuration is unavailable.' using errcode = 'P0002'; end if;
  select * into engagement from public.engagements
    where id = configuration.engagement_id and organization_id = p_organization_id
    for update;
  if not found or engagement.project_id <> configuration.project_id then
    raise exception 'Project context has changed.' using errcode = '55000';
  end if;
  if not private.n6_project_configuration_authorized(
    p_organization_id, engagement.project_id, actor
  ) then
    raise exception 'Current exact-project manager authority is required.' using errcode = '42501';
  end if;
  select * into existing from public.project_pipeline_activations
    where organization_id = p_organization_id
      and (configuration_id = configuration.id or request_id = p_request_id);
  if found then
    if existing.configuration_id <> configuration.id or existing.request_id <> p_request_id
      or existing.activated_by <> actor
      or existing.impact_token_sha256 <> p_impact_token_sha256 then
      raise exception 'Request or configuration has a different activation.' using errcode = '23505';
    end if;
    return jsonb_build_object('activation_id', existing.id,
      'activation_number', existing.activation_number, 'idempotent_replay', true);
  end if;
  if engagement.status not in ('planning', 'active') then
    raise exception 'Project is not current for a new activation.' using errcode = '55000';
  end if;
  if encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
       <> configuration.selected_steps_sha256 then
    raise exception 'Configuration integrity failed.' using errcode = '55000';
  end if;
  select source_definition.* into definition
    from public.pipeline_execution_publications publication
    join public.pipeline_execution_definitions source_definition
      on source_definition.id = publication.definition_id
     and source_definition.organization_id = publication.organization_id
    where publication.id = configuration.definition_publication_id
      and publication.organization_id = p_organization_id;
  if not found or encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256 then
    raise exception 'Published execution definition is unavailable or changed.' using errcode = '55000';
  end if;
  for selected in select value from jsonb_array_elements(configuration.selected_steps)
  loop
    if not exists (
      select 1 from jsonb_array_elements(definition.steps) step(value)
      join public.engagement_services service
        on service.service_id = (step.value ->> 'service_id')::uuid
       and service.organization_id = p_organization_id
       and service.engagement_id = engagement.id
       and service.status in ('planned', 'active')
      join public.project_department_participation participation
        on participation.project_id = engagement.project_id
       and participation.organization_id = p_organization_id
       and participation.department_id = (step.value ->> 'department_id')
       and participation.status = 'active'
      where (step.value ->> 'key') = (selected ->> 'key')
    ) then
      raise exception 'A configured service or department is no longer current.' using errcode = '55000';
    end if;
  end loop;
  impact := private.n6_project_pipeline_impact(configuration.id);
  if impact ->> 'impact_token_sha256' <> p_impact_token_sha256 then
    raise exception 'Project pipeline impact changed; preview again.' using errcode = '40001';
  end if;
  select coalesce(max(activation_number), 0) + 1 into activation_number
    from public.project_pipeline_activations
    where engagement_id = engagement.id;
  insert into public.project_pipeline_activations(
    organization_id, engagement_id, configuration_id,
    activation_number, request_id, impact_token_sha256, activated_by
  ) values (
    p_organization_id, engagement.id, configuration.id,
    activation_number, p_request_id, p_impact_token_sha256, actor
  ) returning id into new_id;
  return jsonb_build_object('activation_id', new_id,
    'activation_number', activation_number, 'idempotent_replay', false);
end;
$$;
revoke all on function public.activate_project_pipeline_configuration(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_project_pipeline_configuration(uuid, uuid, uuid, text, boolean)
  to authenticated;
comment on table public.project_pipeline_activations is
  'Explicit manager-reviewed project configuration activation; earlier configurations, work and jobs are preserved.';
commit;