-- N6 executable step definitions are separate from PLN service-selection presets.
-- No existing preset is reclassified as executable; no provider call is enabled.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.pipeline_execution_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  preset_publication_id uuid not null references public.pipeline_template_publications(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  request_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 50),
  steps_sha256 text not null check (steps_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (preset_publication_id, version_number),
  unique (organization_id, request_id),
  unique (id, organization_id)
);
create index pipeline_execution_definitions_org_preset
  on public.pipeline_execution_definitions(organization_id, preset_publication_id, version_number desc);
create trigger protect_pipeline_execution_definitions before update or delete
  on public.pipeline_execution_definitions for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.pipeline_execution_definitions enable row level security;
revoke all on public.pipeline_execution_definitions from public, anon, authenticated, service_role;
grant select on public.pipeline_execution_definitions to authenticated, service_role;
create policy "Current team reads execution definitions"
  on public.pipeline_execution_definitions for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create table public.pipeline_execution_definition_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  definition_id uuid not null,
  department_id text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  foreign key (definition_id, organization_id)
    references public.pipeline_execution_definitions(id, organization_id) on delete restrict,
  foreign key (department_id, organization_id)
    references public.departments(id, organization_id) on delete restrict,
  unique (definition_id, department_id, approved_by)
);
create index pipeline_execution_definition_approvals_definition
  on public.pipeline_execution_definition_approvals(definition_id, department_id);
create trigger protect_pipeline_execution_definition_approvals before update or delete
  on public.pipeline_execution_definition_approvals for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.pipeline_execution_definition_approvals enable row level security;
revoke all on public.pipeline_execution_definition_approvals from public, anon, authenticated, service_role;
grant select on public.pipeline_execution_definition_approvals to authenticated, service_role;
create policy "Current team reads execution definition approvals"
  on public.pipeline_execution_definition_approvals for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create table public.pipeline_execution_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  definition_id uuid not null unique,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default clock_timestamp(),
  foreign key (definition_id, organization_id)
    references public.pipeline_execution_definitions(id, organization_id) on delete restrict
);
create index pipeline_execution_publications_org
  on public.pipeline_execution_publications(organization_id, published_at desc);
create trigger protect_pipeline_execution_publications before update or delete
  on public.pipeline_execution_publications for each row
  execute function private.reject_pipeline_template_mutation();
alter table public.pipeline_execution_publications enable row level security;
revoke all on public.pipeline_execution_publications from public, anon, authenticated, service_role;
grant select on public.pipeline_execution_publications to authenticated, service_role;
create policy "Current team reads execution publications"
  on public.pipeline_execution_publications for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

create function public.create_pipeline_execution_definition(
  p_organization_id uuid, p_preset_publication_id uuid, p_request_id uuid,
  p_name text, p_steps jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  preset public.pipeline_template_publications;
  existing public.pipeline_execution_definitions;
  selected jsonb;
  step_key text;
  step_label text;
  step_kind text;
  step_department text;
  step_service uuid;
  dependency text;
  prior_keys text[] := '{}'::text[];
  next_version integer;
  request_sha text;
  steps_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_preset_publication_id is null
    or p_request_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception 'Authenticated preset, request and name are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception 'Execution steps must be an ordered array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_steps) not between 1 and 50
    or pg_catalog.octet_length(p_steps::text) > 32768 then
    raise exception 'Choose 1–50 bounded execution steps.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin', 'department_manager')
    for update of organization;
  if not found then
    raise exception 'Current template author authority is required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'preset_publication_id', p_preset_publication_id,
    'name', trim(p_name), 'steps', p_steps
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing from public.pipeline_execution_definitions
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.created_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request ID belongs to another execution definition.' using errcode = '23505';
    end if;
    return jsonb_build_object('definition_id', existing.id,
      'version_number', existing.version_number, 'idempotent_replay', true);
  end if;
  select * into preset from public.pipeline_template_publications
    where id = p_preset_publication_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Published same-organization service preset is required.' using errcode = '42501';
  end if;
  for selected in select value from jsonb_array_elements(p_steps)
  loop
    if jsonb_typeof(selected) is distinct from 'object'
      or selected - 'key' - 'label' - 'kind' - 'department_id' - 'service_id' - 'depends_on' <> '{}'::jsonb then
      raise exception 'Each step requires only supported execution fields.' using errcode = '22023';
    end if;
    step_key := selected ->> 'key';
    step_label := selected ->> 'label';
    step_kind := selected ->> 'kind';
    step_department := selected ->> 'department_id';
    if coalesce(step_key ~ '^[a-z][a-z0-9_]{0,63}$', false) is false
      or step_key = any(prior_keys)
      or length(trim(coalesce(step_label, ''))) not between 1 and 160
      or coalesce(step_kind in ('human', 'ai_assisted', 'automatic', 'approval_gate'), false) is false
      or jsonb_typeof(selected -> 'depends_on') is distinct from 'array' then
      raise exception 'Step key, label, kind or dependencies are invalid.' using errcode = '22023';
    end if;
    if step_department is null or selected ->> 'service_id' is null then
      raise exception 'Each step needs a service and accountable department.' using errcode = '22023';
    end if;
    step_service := (selected ->> 'service_id')::uuid;
    if not exists (
      select 1 from public.pipeline_template_version_services version_service
      join public.service_catalog service
        on service.id = version_service.service_id
       and service.organization_id = version_service.organization_id
      where version_service.pipeline_template_version_id = preset.pipeline_template_version_id
        and version_service.organization_id = p_organization_id
        and version_service.service_id = step_service
        and service.department_id = step_department and service.is_active
    ) then
      raise exception 'Step service must belong to the published preset and department.' using errcode = '42501';
    end if;
    if jsonb_array_length(selected -> 'depends_on') > 10
      or (select count(*) from jsonb_array_elements_text(selected -> 'depends_on')) <>
         (select count(distinct value) from jsonb_array_elements_text(selected -> 'depends_on')) then
      raise exception 'Step dependencies must be distinct and bounded.' using errcode = '22023';
    end if;
    for dependency in select value from jsonb_array_elements_text(selected -> 'depends_on')
    loop
      if dependency is null or dependency <> all(prior_keys) then
        raise exception 'A step may depend only on an earlier step.' using errcode = '22023';
      end if;
    end loop;
    prior_keys := array_append(prior_keys, step_key);
  end loop;
  select coalesce(max(version_number), 0) + 1 into next_version
    from public.pipeline_execution_definitions
    where preset_publication_id = p_preset_publication_id;
  steps_sha := encode(extensions.digest(convert_to(p_steps::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_execution_definitions(
    organization_id, preset_publication_id, version_number, request_id,
    request_sha256, name, steps, steps_sha256, created_by
  ) values (
    p_organization_id, p_preset_publication_id, next_version, p_request_id,
    request_sha, trim(p_name), p_steps, steps_sha, actor
  ) returning id into new_id;
  return jsonb_build_object('definition_id', new_id,
    'version_number', next_version, 'steps_sha256', steps_sha,
    'idempotent_replay', false);
end;
$$;
revoke all on function public.create_pipeline_execution_definition(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_pipeline_execution_definition(uuid, uuid, uuid, text, jsonb)
  to authenticated;

create function public.approve_pipeline_execution_definition(
  p_definition_id uuid, p_department_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  definition public.pipeline_execution_definitions;
  approval_id uuid;
begin
  if actor is null or p_definition_id is null or p_department_id is null then
    raise exception 'Authenticated definition and department are required.' using errcode = '22023';
  end if;
  select * into definition from public.pipeline_execution_definitions
    where id = p_definition_id for update;
  if not found then
    raise exception 'Execution definition is unavailable.' using errcode = 'P0002';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = definition.organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active' and membership.role = 'department_manager'
      and membership.department_id = p_department_id
    for share of organization, membership;
  if not found then
    raise exception 'Current affected department-head authority is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(definition.steps) step(value)
    where step.value ->> 'department_id' = p_department_id
  ) then
    raise exception 'Department has no step in this definition.' using errcode = '22023';
  end if;
  select id into approval_id from public.pipeline_execution_definition_approvals
    where definition_id = definition.id and department_id = p_department_id
      and approved_by = actor;
  if found then
    return jsonb_build_object('approval_id', approval_id, 'idempotent_replay', true);
  end if;
  if exists (select 1 from public.pipeline_execution_publications
    where definition_id = definition.id) then
    raise exception 'Published definition cannot receive another approval.' using errcode = '55000';
  end if;
  insert into public.pipeline_execution_definition_approvals(
    organization_id, definition_id, department_id, approved_by
  ) values (definition.organization_id, definition.id, p_department_id, actor)
  returning id into approval_id;
  return jsonb_build_object('approval_id', approval_id,
    'idempotent_replay', false);
end;
$$;
revoke all on function public.approve_pipeline_execution_definition(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_pipeline_execution_definition(uuid, text)
  to authenticated;

create function public.publish_pipeline_execution_definition(p_definition_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  definition public.pipeline_execution_definitions;
  existing public.pipeline_execution_publications;
  affected_department text;
  new_id uuid;
begin
  if actor is null or p_definition_id is null then
    raise exception 'Authenticated definition is required.' using errcode = '22023';
  end if;
  select * into definition from public.pipeline_execution_definitions
    where id = p_definition_id for update;
  if not found then
    raise exception 'Execution definition is unavailable.' using errcode = 'P0002';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = definition.organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for share of organization, membership;
  if not found then
    raise exception 'Current owner or operations publication authority is required.' using errcode = '42501';
  end if;
  select * into existing from public.pipeline_execution_publications
    where definition_id = definition.id;
  if found then
    return jsonb_build_object('publication_id', existing.id,
      'idempotent_replay', true);
  end if;
  if exists (
    select 1 from jsonb_array_elements(definition.steps) step(value)
    left join public.pipeline_template_publications preset
      on preset.id = definition.preset_publication_id
     and preset.organization_id = definition.organization_id
    left join public.pipeline_template_version_services selection
      on selection.pipeline_template_version_id = preset.pipeline_template_version_id
     and selection.organization_id = definition.organization_id
     and selection.service_id = (step.value ->> 'service_id')::uuid
    left join public.service_catalog service
      on service.id = selection.service_id
     and service.organization_id = definition.organization_id
     and service.department_id = (step.value ->> 'department_id')
     and service.is_active
    where service.id is null
  ) then
    raise exception 'A definition service is no longer available.' using errcode = '55000';
  end if;
  if encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256 then
    raise exception 'Execution definition integrity failed.' using errcode = '55000';
  end if;
  for affected_department in
    select distinct step.value ->> 'department_id'
      from jsonb_array_elements(definition.steps) step(value)
  loop
    perform 1 from public.pipeline_execution_definition_approvals approval
      join public.organization_memberships membership
        on membership.organization_id = approval.organization_id
       and membership.user_id = approval.approved_by
      where approval.definition_id = definition.id
        and approval.department_id = affected_department
        and membership.member_kind = 'team' and membership.status = 'active'
        and membership.role = 'department_manager'
        and membership.department_id = affected_department
      for share of membership;
    if not found then
      raise exception 'Every affected department needs a current head approval.'
        using errcode = '42501';
    end if;
  end loop;
  insert into public.pipeline_execution_publications(
    organization_id, definition_id, published_by
  ) values (definition.organization_id, definition.id, actor)
  returning id into new_id;
  return jsonb_build_object('publication_id', new_id,
    'steps_sha256', definition.steps_sha256, 'idempotent_replay', false);
end;
$$;
revoke all on function public.publish_pipeline_execution_definition(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_pipeline_execution_definition(uuid)
  to authenticated;
comment on table public.pipeline_execution_definitions is
  'Immutable ordered Human, AI-assisted, Automatic or Approval steps for a published service preset. Publication and project activation are separate.';
commit;