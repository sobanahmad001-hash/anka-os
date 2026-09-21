-- N6 text-route configuration. No routes are seeded and no provider dispatch is enabled.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.pipeline_ai_text_route_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  department_id text not null references public.departments(id) on delete restrict,
  revision bigint not null check (revision > 0),
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  configured_by uuid not null references auth.users(id) on delete restrict,
  configured_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, revision),
  unique (organization_id, request_id),
  unique (id, organization_id, department_id)
);
create index pipeline_ai_text_route_sets_current
  on private.pipeline_ai_text_route_sets(organization_id, department_id, revision desc);
alter table private.pipeline_ai_text_route_sets enable row level security;
revoke all on private.pipeline_ai_text_route_sets from public, anon, authenticated, service_role;
create trigger protect_pipeline_ai_text_route_sets before update or delete
  on private.pipeline_ai_text_route_sets for each row
  execute function private.reject_pipeline_template_mutation();

create table private.pipeline_ai_text_route_entries (
  route_set_id uuid not null,
  organization_id uuid not null,
  department_id text not null,
  priority smallint not null check (priority between 1 and 3),
  model_configuration_id uuid not null,
  primary key (route_set_id, priority),
  unique (route_set_id, model_configuration_id),
  foreign key (route_set_id, organization_id, department_id)
    references private.pipeline_ai_text_route_sets(id, organization_id, department_id) on delete restrict,
  foreign key (model_configuration_id, organization_id)
    references public.department_chat_model_configurations(id, organization_id) on delete restrict
);
create index pipeline_ai_text_route_entries_configuration
  on private.pipeline_ai_text_route_entries(model_configuration_id);
alter table private.pipeline_ai_text_route_entries enable row level security;
revoke all on private.pipeline_ai_text_route_entries from public, anon, authenticated, service_role;
create trigger protect_pipeline_ai_text_route_entries before update or delete
  on private.pipeline_ai_text_route_entries for each row
  execute function private.reject_pipeline_template_mutation();

create function public.configure_pipeline_ai_text_routes(
  p_organization_id uuid, p_department_id text, p_request_id uuid,
  p_model_configuration_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  request_sha text;
  existing private.pipeline_ai_text_route_sets;
  next_revision bigint;
  route_set_id uuid;
  model_id uuid;
  position integer;
begin
  if actor is null or p_organization_id is null or p_request_id is null
    or p_department_id is null or p_department_id not in ('content', 'design', 'marketing')
    or p_model_configuration_ids is null
    or cardinality(p_model_configuration_ids) > 3
    or array_position(p_model_configuration_ids, null) is not null
    or (select count(distinct id) from unnest(p_model_configuration_ids) as chosen(id)) <> cardinality(p_model_configuration_ids)
  then
    raise exception 'An organization, department, request and up to three distinct models are required.'
      using errcode = '22023';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'department_id', p_department_id,
    'model_configuration_ids', p_model_configuration_ids
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for update of organization;
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into existing from private.pipeline_ai_text_route_sets
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.configured_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Route request ID belongs to a different configuration.' using errcode = '23505';
    end if;
    return jsonb_build_object('route_set_id', existing.id, 'revision', existing.revision,
      'route_count', cardinality(p_model_configuration_ids), 'idempotent_replay', true);
  end if;
  for model_id, position in
    select chosen.id, chosen.position from unnest(p_model_configuration_ids)
      with ordinality chosen(id, position)
  loop
    perform 1 from public.department_chat_model_configurations configuration
      join public.integration_connections connection
        on connection.id = configuration.connector_connection_id
       and connection.organization_id = configuration.organization_id
      join public.integration_connection_departments department
        on department.connection_id = connection.id
       and department.organization_id = connection.organization_id
       and department.department_id = configuration.department_id
      where configuration.id = model_id
        and configuration.organization_id = p_organization_id
        and configuration.department_id = p_department_id
        and configuration.revoked_at is null
        and connection.provider = 'openai' and connection.status = 'verified'
        and connection.archived_at is null
        and (
          connection.public_config ->> 'model_id' = configuration.model_id
          or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb)
            ? configuration.model_id
        )
      for share of configuration, connection, department;
    if not found then
      raise exception 'Every text route requires a current, connector-verified model in this department.'
        using errcode = '42501';
    end if;
  end loop;
  select coalesce(max(revision), 0) + 1 into next_revision
    from private.pipeline_ai_text_route_sets
    where organization_id = p_organization_id and department_id = p_department_id;
  insert into private.pipeline_ai_text_route_sets(
    organization_id, department_id, revision, request_id, request_sha256, configured_by
  ) values (
    p_organization_id, p_department_id, next_revision, p_request_id, request_sha, actor
  ) returning id into route_set_id;
  insert into private.pipeline_ai_text_route_entries(
    route_set_id, organization_id, department_id, priority, model_configuration_id
  )
  select route_set_id, p_organization_id, p_department_id, chosen.position, chosen.id
    from unnest(p_model_configuration_ids) with ordinality chosen(id, position);
  return jsonb_build_object('route_set_id', route_set_id, 'revision', next_revision,
    'route_count', cardinality(p_model_configuration_ids), 'idempotent_replay', false);
end;
$$;
revoke all on function public.configure_pipeline_ai_text_routes(uuid, text, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.configure_pipeline_ai_text_routes(uuid, text, uuid, uuid[])
  to authenticated;

-- Service-only selection. A route is eligible only in the job's current
-- engagement and only while the exact connector/model/mappings still hold.
create function public.get_pipeline_ai_text_routes(
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
  if not exists (
    select 1 from public.pipeline_run_plans plan,
      jsonb_array_elements(plan.work_manifest) item
    where plan.id = job.run_plan_id and plan.organization_id = p_organization_id
      and item ->> 'department_id' = p_department_id
  ) then
    raise exception 'Department is not present in the pinned work plan.' using errcode = '42501';
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
comment on function public.get_pipeline_ai_text_routes(uuid, uuid, text, uuid) is
  'Returns current eligible text routes only. It does not reserve budget or authorize provider submission.';
commit;