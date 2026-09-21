-- Project-local N6 configuration versions and reviewed activation.
-- Existing service presets and earlier run requests remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.project_pipeline_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  project_id uuid not null,
  definition_publication_id uuid not null references public.pipeline_execution_publications(id) on delete restrict,
  revision integer not null check (revision > 0),
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  selected_steps jsonb not null check (jsonb_typeof(selected_steps) = 'array' and jsonb_array_length(selected_steps) between 1 and 50),
  selected_steps_sha256 text not null check (selected_steps_sha256 ~ '^[0-9a-f]{64}$'),
  max_ai_cost_microusd bigint not null check (max_ai_cost_microusd >= 0),
  configured_by uuid not null references auth.users(id) on delete restrict,
  configured_at timestamptz not null default clock_timestamp(),
  foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id) on delete restrict,
  unique (organization_id, request_id),
  unique (engagement_id, revision),
  unique (id, engagement_id, organization_id)
);
create index project_pipeline_configurations_org_engagement
  on public.project_pipeline_configurations(organization_id, engagement_id, revision desc);
create trigger protect_project_pipeline_configurations before update or delete
  on public.project_pipeline_configurations for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.project_pipeline_configurations enable row level security;
revoke all on public.project_pipeline_configurations from public, anon, authenticated, service_role;
grant select on public.project_pipeline_configurations to authenticated, service_role;
create policy "Current team reads project pipeline configurations"
  on public.project_pipeline_configurations for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create table public.project_pipeline_activations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  configuration_id uuid not null unique,
  activation_number integer not null check (activation_number > 0),
  request_id uuid not null,
  impact_token_sha256 text not null check (impact_token_sha256 ~ '^[0-9a-f]{64}$'),
  activated_by uuid not null references auth.users(id) on delete restrict,
  activated_at timestamptz not null default clock_timestamp(),
  foreign key (configuration_id, engagement_id, organization_id)
    references public.project_pipeline_configurations(id, engagement_id, organization_id) on delete restrict,
  unique (engagement_id, activation_number),
  unique (organization_id, request_id)
);
create index project_pipeline_activations_current
  on public.project_pipeline_activations(organization_id, engagement_id, activation_number desc);
create trigger protect_project_pipeline_activations before update or delete
  on public.project_pipeline_activations for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.project_pipeline_activations enable row level security;
revoke all on public.project_pipeline_activations from public, anon, authenticated, service_role;
grant select on public.project_pipeline_activations to authenticated, service_role;
create policy "Current team reads project pipeline activations"
  on public.project_pipeline_activations for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function private.n6_project_configuration_authorized(
  p_organization_id uuid, p_project_id uuid, p_actor_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare member_role text;
begin
  select membership.role into member_role
    from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    join public.projects project
      on project.id = p_project_id and project.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and project.archived_at is null and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
    for share of organization, membership, project;
  if not found then return false; end if;
  if member_role in ('system_owner', 'operations_admin') then return true; end if;
  return private.n1e_exact_project_manager(p_organization_id, p_project_id, p_actor_id);
end;
$$;
revoke all on function private.n6_project_configuration_authorized(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.create_project_pipeline_configuration(
  p_organization_id uuid, p_engagement_id uuid, p_definition_publication_id uuid,
  p_request_id uuid, p_selected_steps jsonb, p_max_ai_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  definition_publication public.pipeline_execution_publications;
  definition public.pipeline_execution_definitions;
  existing public.project_pipeline_configurations;
  selected jsonb;
  selected_key text;
  selected_quantity integer;
  definition_step jsonb;
  selected_keys text[] := '{}'::text[];
  total_quantity integer := 0;
  has_paid_step boolean := false;
  next_revision integer;
  request_sha text;
  selected_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_engagement_id is null
    or p_definition_publication_id is null or p_request_id is null
    or p_max_ai_cost_microusd is null or p_max_ai_cost_microusd < 0 then
    raise exception 'A complete scoped project configuration is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_selected_steps) is distinct from 'array' then
    raise exception 'Selected steps must be an ordered array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_selected_steps) not between 1 and 50
    or pg_catalog.octet_length(p_selected_steps::text) > 8192 then
    raise exception 'Choose 1–50 bounded steps.' using errcode = '22023';
  end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for update;
  if not found or engagement.status not in ('planning', 'active') then
    raise exception 'Current project engagement is required.' using errcode = '42501';
  end if;
  if not private.n6_project_configuration_authorized(p_organization_id, engagement.project_id, actor) then
    raise exception 'Current exact-project manager authority is required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id,
    'definition_publication_id', p_definition_publication_id,
    'selected_steps', p_selected_steps,
    'max_ai_cost_microusd', p_max_ai_cost_microusd
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing from public.project_pipeline_configurations
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.configured_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request ID belongs to another project configuration.' using errcode = '23505';
    end if;
    return jsonb_build_object('configuration_id', existing.id,
      'revision', existing.revision, 'idempotent_replay', true);
  end if;
  select * into origin from public.engagement_pipeline_origins
    where engagement_id = engagement.id and organization_id = p_organization_id;
  select * into definition_publication from public.pipeline_execution_publications
    where id = p_definition_publication_id and organization_id = p_organization_id;
  select * into definition from public.pipeline_execution_definitions
    where id = definition_publication.definition_id and organization_id = p_organization_id;
  if origin.engagement_id is null or definition.id is null or not exists (
    select 1 from public.pipeline_template_publications preset
    where preset.id = definition.preset_publication_id
      and preset.organization_id = p_organization_id
      and preset.pipeline_template_version_id = origin.pipeline_template_version_id
  ) then
    raise exception 'Published execution definition must match this project preset.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256 then
    raise exception 'Execution definition integrity failed.' using errcode = '55000';
  end if;
  for selected in select value from jsonb_array_elements(p_selected_steps)
  loop
    if jsonb_typeof(selected) is distinct from 'object'
      or selected - 'key' - 'quantity' <> '{}'::jsonb then
      raise exception 'Each selected step requires only a key and quantity.' using errcode = '22023';
    end if;
    selected_key := selected ->> 'key';
    if selected_key is null or selected_key = any(selected_keys)
      or jsonb_typeof(selected -> 'quantity') is distinct from 'number'
      or coalesce((selected ->> 'quantity') ~ '^[0-9]{1,2}$', false) is false then
      raise exception 'Step keys must be distinct with a bounded quantity.' using errcode = '22023';
    end if;
    selected_quantity := (selected ->> 'quantity')::integer;
    if selected_quantity not between 1 and 50 then
      raise exception 'Each step quantity must be 1–50.' using errcode = '22023';
    end if;
    select value into definition_step from jsonb_array_elements(definition.steps)
      where value ->> 'key' = selected_key;
    if not found then
      raise exception 'Selected step is absent from the published definition.' using errcode = '42501';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(definition_step -> 'depends_on') dependency(value)
      where dependency.value <> all(selected_keys)
    ) then
      raise exception 'Selected steps must include earlier dependencies in order.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.engagement_services service
      where service.engagement_id = engagement.id
        and service.organization_id = p_organization_id
        and service.service_id = (definition_step ->> 'service_id')::uuid
        and service.status in ('planned', 'active')
    ) then
      raise exception 'A selected step service is not current in this project.' using errcode = '55000';
    end if;
    if not exists (
      select 1 from public.project_department_participation participation
      where participation.project_id = engagement.project_id
        and participation.organization_id = p_organization_id
        and participation.department_id = (definition_step ->> 'department_id')
        and participation.status = 'active'
    ) then
      raise exception 'Selected step department is not active on this project.' using errcode = '55000';
    end if;
    has_paid_step := has_paid_step or ((definition_step ->> 'kind') in ('ai_assisted', 'automatic'));
    total_quantity := total_quantity + selected_quantity;
    if total_quantity > 50 then
      raise exception 'Total selected quantity exceeds 50.' using errcode = '22023';
    end if;
    selected_keys := array_append(selected_keys, selected_key);
  end loop;
  if (has_paid_step and p_max_ai_cost_microusd = 0)
    or (not has_paid_step and p_max_ai_cost_microusd <> 0) then
    raise exception 'AI-capable steps require a positive local limit; human-only plans use zero.'
      using errcode = '22023';
  end if;
  select coalesce(max(revision), 0) + 1 into next_revision
    from public.project_pipeline_configurations
    where engagement_id = engagement.id;
  selected_sha := encode(extensions.digest(convert_to(p_selected_steps::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.project_pipeline_configurations(
    organization_id, engagement_id, project_id, definition_publication_id,
    revision, request_id, request_sha256, selected_steps, selected_steps_sha256,
    max_ai_cost_microusd, configured_by
  ) values (
    p_organization_id, engagement.id, engagement.project_id,
    definition_publication.id, next_revision, p_request_id, request_sha,
    p_selected_steps, selected_sha, p_max_ai_cost_microusd, actor
  ) returning id into new_id;
  return jsonb_build_object('configuration_id', new_id,
    'revision', next_revision, 'selected_steps_sha256', selected_sha,
    'idempotent_replay', false);
end;
$$;
revoke all on function public.create_project_pipeline_configuration(uuid, uuid, uuid, uuid, jsonb, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.create_project_pipeline_configuration(uuid, uuid, uuid, uuid, jsonb, bigint)
  to authenticated;
commit;