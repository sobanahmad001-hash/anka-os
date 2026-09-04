-- P3: one authenticated, atomic setup path for canonical Internal Work.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.internal_project_setup_requests (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  normalized_payload_sha256 text not null check (normalized_payload_sha256 ~ '^[0-9a-f]{64}$'),
  project_id uuid not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  constraint internal_project_setup_requests_pkey primary key (organization_id, requested_by, request_id),
  constraint internal_project_setup_requests_project_unique unique (project_id, organization_id),
  constraint internal_project_setup_requests_project_fkey foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict
);

alter table private.internal_project_setup_requests enable row level security;

create policy "Creators read own Internal Work setup requests"
on private.internal_project_setup_requests for select to authenticated using (
  requested_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id
    where membership.organization_id = internal_project_setup_requests.organization_id
      and membership.user_id = (select auth.uid())
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and organization.status = 'active'
  )
);

create policy "Creators record own Internal Work setup requests"
on private.internal_project_setup_requests for insert to authenticated with check (
  requested_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id
    where membership.organization_id = internal_project_setup_requests.organization_id
      and membership.user_id = (select auth.uid())
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and organization.status = 'active'
  )
);

revoke all on table private.internal_project_setup_requests from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant select, insert on table private.internal_project_setup_requests to authenticated;

create function public.create_internal_project_setup(
  p_organization_id uuid,
  p_request_id uuid,
  p_name text,
  p_description text,
  p_owner_id uuid,
  p_start_date date,
  p_due_date date,
  p_scope_statement text,
  p_exclusions text,
  p_workstreams jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_existing private.internal_project_setup_requests%rowtype;
  v_department_ids text[];
  v_workstream_owner_ids uuid[];
  v_normalized_workstreams jsonb;
  v_payload jsonb;
  v_payload_sha256 text;
  v_project_id uuid := gen_random_uuid();
  v_created_workstreams jsonb;
  v_result jsonb;
  v_position integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_organization_id is null or p_request_id is null or p_owner_id is null then
    raise exception 'Organization, request, and project owner are required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Project name is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_workstreams, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_workstreams) = 0 then
    raise exception 'Select at least one initial workstream.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_workstreams) > 4 then
    raise exception 'Internal Work supports only the four canonical departments.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_workstreams) entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or entry.value - array['department_id', 'owner_id'] <> '{}'::jsonb
      or nullif(trim(entry.value ->> 'department_id'), '') is null
      or nullif(trim(entry.value ->> 'owner_id'), '') is null
  ) then
    raise exception 'Each workstream requires only a department and owner.' using errcode = '22023';
  end if;

  select
    array_agg(trim(entry.value ->> 'department_id') order by trim(entry.value ->> 'department_id')),
    array_agg((entry.value ->> 'owner_id')::uuid order by trim(entry.value ->> 'department_id'))
  into v_department_ids, v_workstream_owner_ids
  from jsonb_array_elements(p_workstreams) entry(value);

  if exists (select 1 from unnest(v_department_ids) department_id where department_id not in ('content', 'design', 'development', 'marketing'))
    or (select count(distinct department_id) from unnest(v_department_ids) department_id) <> cardinality(v_department_ids) then
    raise exception 'Workstream departments must be distinct canonical departments.' using errcode = '22023';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = p_organization_id and organization.status = 'active'
  for share;
  if not found then
    raise exception 'Active selected organization required.' using errcode = '42501';
  end if;

  perform 1
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor_id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  for share;
  if not found then
    raise exception 'Active team membership required.' using errcode = '42501';
  end if;

  perform 1
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_owner_id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  for share;
  if not found then
    raise exception 'Project owner must be an active team member in the selected organization.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(v_department_ids) selected(department_id)
    left join public.departments department
      on department.id = selected.department_id
     and department.organization_id = p_organization_id
    where department.id is null
  ) then
    raise exception 'Every workstream department must belong to the selected organization.' using errcode = '42501';
  end if;

  perform 1
  from public.departments department
  where department.organization_id = p_organization_id
    and department.id = any(v_department_ids)
  order by department.id
  for share;

  for v_position in 1..cardinality(v_department_ids) loop
    perform 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = v_workstream_owner_ids[v_position]
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.department_id = v_department_ids[v_position]
    for share;
    if not found then
      raise exception 'Each workstream owner must be an active team member of that department in the selected organization.' using errcode = '42501';
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object(
    'department_id', selected.department_id,
    'owner_id', selected.owner_id
  ) order by selected.department_id)
  into v_normalized_workstreams
  from unnest(v_department_ids, v_workstream_owner_ids) selected(department_id, owner_id);

  v_payload := jsonb_build_object(
    'organization_id', p_organization_id,
    'name', trim(p_name),
    'description', trim(coalesce(p_description, '')),
    'owner_id', p_owner_id,
    'start_date', p_start_date,
    'due_date', p_due_date,
    'scope_statement', trim(coalesce(p_scope_statement, '')),
    'exclusions', trim(coalesce(p_exclusions, '')),
    'workstreams', v_normalized_workstreams
  );
  v_payload_sha256 := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || v_actor_id::text || ':' || p_request_id::text, 0)
  );

  select request.* into v_existing
  from private.internal_project_setup_requests request
  where request.organization_id = p_organization_id
    and request.requested_by = v_actor_id
    and request.request_id = p_request_id;

  if found then
    if v_existing.normalized_payload_sha256 <> v_payload_sha256 then
      raise exception 'Request id was already used with different inputs.' using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  insert into public.projects (
    id, organization_id, client_id, name, description, department_id,
    engagement_type, status, priority, owner_id, start_date, due_date,
    scope_statement, exclusions, portal_visible
  ) values (
    v_project_id, p_organization_id, null, trim(p_name), trim(coalesce(p_description, '')), null,
    'internal', 'active', 'medium', p_owner_id, p_start_date, p_due_date,
    trim(coalesce(p_scope_statement, '')), trim(coalesce(p_exclusions, '')), false
  );

  with inserted as (
    insert into public.workstreams (
      organization_id, project_id, department_id, name, status,
      owner_id, client_visible, started_at
    )
    select
      p_organization_id, v_project_id, selected.department_id, department.name, 'active',
      selected.owner_id, false, now()
    from unnest(v_department_ids, v_workstream_owner_ids) selected(department_id, owner_id)
    join public.departments department
      on department.id = selected.department_id
     and department.organization_id = p_organization_id
    order by selected.department_id
    returning id, department_id, owner_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', inserted.id,
    'department_id', inserted.department_id,
    'owner_id', inserted.owner_id
  ) order by inserted.department_id), '[]'::jsonb)
  into v_created_workstreams
  from inserted;

  v_result := jsonb_build_object(
    'project_id', v_project_id,
    'workstreams', v_created_workstreams,
    'idempotent_replay', false
  );

  insert into private.internal_project_setup_requests (
    organization_id, requested_by, request_id, normalized_payload_sha256, project_id, result
  ) values (
    p_organization_id, v_actor_id, p_request_id, v_payload_sha256, v_project_id, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.create_internal_project_setup(
  uuid, uuid, text, text, uuid, date, date, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_internal_project_setup(
  uuid, uuid, text, text, uuid, date, date, text, text, jsonb
) to authenticated;

comment on function public.create_internal_project_setup(
  uuid, uuid, text, text, uuid, date, date, text, text, jsonb
) is 'Atomically creates one canonical Internal Work project and its explicitly selected initial workstreams for an active team member.';

commit;
