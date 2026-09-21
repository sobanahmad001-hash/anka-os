-- Route lookup follows the pinned configured AI steps, not unrelated work-item departments.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.get_pipeline_ai_text_routes(
  p_organization_id uuid, p_job_id uuid, p_department_id text, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  current_set private.pipeline_ai_text_route_sets;
  routes jsonb;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_department_id is null or p_department_id not in ('content', 'design', 'marketing') then
    raise exception 'Scoped text-route request is required.' using errcode = '22023';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  if not found or job.status <> 'blocked_configuration'
    or job.requested_by <> p_actor_id then
    raise exception 'The blocked, actor-owned execution job is unavailable.' using errcode = '42501';
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  if not found or not exists (
    select 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active')
  ) then
    raise exception 'Current engagement scope is unavailable.' using errcode = '42501';
  end if;
  perform 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin');
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  if intent.project_activation_id is null
    or job.input_manifest ->> 'project_activation_id' is distinct from intent.project_activation_id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or exists (
      select 1 from public.project_pipeline_activations current_activation
      join public.project_pipeline_activations newer
        on newer.organization_id = current_activation.organization_id
       and newer.engagement_id = current_activation.engagement_id
       and newer.activation_number > current_activation.activation_number
      where current_activation.id = intent.project_activation_id
        and current_activation.organization_id = p_organization_id
    )
    or not exists (
      select 1 from public.ai_execution_configured_steps step
      where step.job_id = job.id and step.organization_id = p_organization_id
        and step.project_activation_id = intent.project_activation_id
        and step.definition_step ->> 'department_id' = p_department_id
        and (step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')
    ) then
    raise exception 'Current pinned AI step is required for this department.' using errcode = '42501';
  end if;
  select * into current_set from private.pipeline_ai_text_route_sets
    where organization_id = p_organization_id and department_id = p_department_id
    order by revision desc limit 1;
  if not found then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'priority', entry.priority, 'provider', connection.provider,
    'connection_id', connection.id, 'model_id', configuration.model_id,
    'model_configuration_id', configuration.id
  ) order by entry.priority), '[]'::jsonb) into routes
  from private.pipeline_ai_text_route_entries entry
  join public.department_chat_model_configurations configuration
    on configuration.id = entry.model_configuration_id
   and configuration.organization_id = entry.organization_id
   and configuration.department_id = entry.department_id
   and configuration.revoked_at is null
  join public.integration_connections connection
    on connection.id = configuration.connector_connection_id
   and connection.organization_id = configuration.organization_id
   and connection.provider = 'openai' and connection.status = 'verified'
   and connection.archived_at is null
  join public.integration_connection_departments department
    on department.connection_id = connection.id
   and department.organization_id = connection.organization_id
   and department.department_id = entry.department_id
  join public.integration_connection_engagements engagement
    on engagement.connection_id = connection.id
   and engagement.organization_id = connection.organization_id
   and engagement.department_id = entry.department_id
   and engagement.engagement_id = intent.engagement_id
  where entry.route_set_id = current_set.id
    and (
      connection.public_config ->> 'model_id' = configuration.model_id
      or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb)
        ? configuration.model_id
    );
  return routes;
end;
$$;
revoke all on function public.get_pipeline_ai_text_routes(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_pipeline_ai_text_routes(uuid, uuid, text, uuid)
  to service_role;
commit;
