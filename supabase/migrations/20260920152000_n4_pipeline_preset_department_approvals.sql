-- N4: one current canonical head per affected department approves an exact
-- cross-department immutable preset version before owner/admin publication.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.pipeline_template_department_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_template_id uuid not null,
  pipeline_template_version_id uuid not null,
  department_id text not null,
  approved_by uuid not null,
  approved_at timestamptz not null default clock_timestamp(),
  foreign key (pipeline_template_version_id, pipeline_template_id, organization_id)
    references public.pipeline_template_versions(id, pipeline_template_id, organization_id) on delete restrict,
  foreign key (department_id, organization_id)
    references public.departments(id, organization_id) on delete restrict,
  foreign key (organization_id, approved_by)
    references public.organization_memberships(organization_id, user_id) on delete restrict,
  unique (pipeline_template_version_id, department_id, approved_by)
);
create index idx_pipeline_template_department_approvals_version
  on public.pipeline_template_department_approvals(pipeline_template_version_id, pipeline_template_id, organization_id, department_id);
create index idx_pipeline_template_department_approvals_department_org
  on public.pipeline_template_department_approvals(department_id, organization_id);
create index idx_pipeline_template_department_approvals_actor
  on public.pipeline_template_department_approvals(organization_id, approved_by);
create trigger protect_pipeline_template_department_approvals
  before update or delete on public.pipeline_template_department_approvals
  for each row execute function private.reject_pipeline_template_mutation();
create function private.can_read_pipeline_template_approval(
  p_pipeline_template_version_id uuid,
  p_organization_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_active_pipeline_template_role(
    p_organization_id, array['system_owner', 'operations_admin', 'department_manager']
  ) and private.can_read_pipeline_template_version(
    p_pipeline_template_version_id, p_organization_id
  );
$$;
revoke all on function private.can_read_pipeline_template_approval(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_pipeline_template_approval(uuid, uuid)
  to authenticated, service_role;
alter table public.pipeline_template_department_approvals enable row level security;
create policy "Authorized team can read pipeline preset approvals"
  on public.pipeline_template_department_approvals for select to authenticated
  using (private.can_read_pipeline_template_approval(pipeline_template_version_id, organization_id));
revoke all on public.pipeline_template_department_approvals from public, anon, authenticated, service_role;
grant select on public.pipeline_template_department_approvals to authenticated, service_role;

create function public.approve_pipeline_template_version_department(
  p_pipeline_template_version_id uuid,
  p_department_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_version public.pipeline_template_versions;
  v_approval public.pipeline_template_department_approvals;
  v_department_count integer;
  v_inserted boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_version from public.pipeline_template_versions
    where id = p_pipeline_template_version_id;
  if not found then
    raise exception 'Pipeline template version not found.' using errcode = 'P0002';
  end if;
  -- Serialize approval against publication of the same template.
  perform 1 from public.pipeline_templates
    where id = v_version.pipeline_template_id and organization_id = v_version.organization_id
    for share;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = v_version.organization_id
      and organization.status = 'active'
      and membership.user_id = v_actor
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role = 'department_manager'
      and membership.department_id = p_department_id
    for share of organization, membership;
  if not found then
    raise exception 'Current department-head authority is required.' using errcode = '42501';
  end if;
  select count(distinct service.department_id) into v_department_count
    from public.pipeline_template_version_services item
    join public.service_catalog service
      on service.id = item.service_id and service.organization_id = item.organization_id
    where item.pipeline_template_version_id = v_version.id;
  if v_department_count < 2 or not exists (
    select 1 from public.pipeline_template_version_services item
    join public.service_catalog service
      on service.id = item.service_id and service.organization_id = item.organization_id
    where item.pipeline_template_version_id = v_version.id
      and service.department_id = p_department_id
  ) then
    raise exception 'An affected department in a cross-department version is required.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.pipeline_template_publications
    where pipeline_template_version_id = v_version.id
  ) then
    raise exception 'Published versions cannot receive a new department approval.'
      using errcode = '55000';
  end if;
  insert into public.pipeline_template_department_approvals (
    organization_id, pipeline_template_id, pipeline_template_version_id,
    department_id, approved_by
  ) values (
    v_version.organization_id, v_version.pipeline_template_id, v_version.id,
    p_department_id, v_actor
  ) on conflict (pipeline_template_version_id, department_id, approved_by) do nothing
    returning * into v_approval;
  v_inserted := found;
  if not v_inserted then
    select * into v_approval from public.pipeline_template_department_approvals
      where pipeline_template_version_id = v_version.id
        and department_id = p_department_id and approved_by = v_actor;
  end if;
  return jsonb_build_object(
    'approval_id', v_approval.id,
    'pipeline_template_version_id', v_version.id,
    'department_id', p_department_id,
    'idempotent_replay', not v_inserted
  );
end;
$$;
revoke all on function public.approve_pipeline_template_version_department(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_pipeline_template_version_department(uuid, text)
  to authenticated;

-- Publication function is replaced below with the unchanged PLN2 behavior plus
-- an exact-version current-head gate for multi-department selections.
create or replace function public.publish_pipeline_template_version(
  p_pipeline_template_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_version public.pipeline_template_versions;
  v_publication public.pipeline_template_publications;
  v_service_ids uuid[];
  v_manifest jsonb;
  v_rule_sha256 text;
  v_publication_number integer;
  v_departments text[];
  v_department text;
  v_selected_service uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_version
  from public.pipeline_template_versions version
  where version.id = p_pipeline_template_version_id;
  if not found then
    raise exception 'Pipeline template version not found.' using errcode = 'P0002';
  end if;
  if not private.has_active_pipeline_template_role(
    v_version.organization_id,
    array['system_owner', 'operations_admin']
  ) then
    raise exception 'Only a System Owner or Operations Admin can publish pipeline templates.'
      using errcode = '42501';
  end if;

  perform 1 from public.pipeline_templates template
  where template.id = v_version.pipeline_template_id
    and template.organization_id = v_version.organization_id
  for update;

  -- Hold current publisher authority through publication and replay. This
  -- also serializes a concurrent membership revocation after the template lock.
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = v_version.organization_id
      and organization.status = 'active'
      and membership.user_id = v_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for share of organization, membership;
  if not found then
    raise exception 'Current System Owner or Operations Admin authority is required.'
      using errcode = '42501';
  end if;

  -- An existing publication remains replay-safe after current authority is
  -- rechecked; concurrent publishers serialize on the template row.
  select * into v_publication
  from public.pipeline_template_publications publication
  where publication.pipeline_template_version_id = v_version.id;
  if found then
    return jsonb_build_object(
      'pipeline_template_publication_id', v_publication.id,
      'pipeline_template_version_id', v_version.id,
      'publication_number', v_publication.publication_number,
      'published_rule_sha256', v_publication.published_rule_sha256,
      'idempotent_replay', true
    );
  end if;

  select array_agg(item.service_id order by item.position)
    into v_service_ids
  from public.pipeline_template_version_services item
  where item.pipeline_template_version_id = v_version.id;
  if coalesce(cardinality(v_service_ids), 0) = 0 then
    raise exception 'Pipeline template version has no services.' using errcode = '22023';
  end if;
  -- Lock every selected catalogue row in deterministic ID order before
  -- availability, affected-department, and manifest reads. A concurrent
  -- reassignment or retirement must finish first and be revalidated, or wait
  -- until this publication transaction commits with its validated snapshot.
  for v_selected_service in
    select item.service_id from public.pipeline_template_version_services item
    where item.pipeline_template_version_id = v_version.id
    order by item.service_id
  loop
    perform 1 from public.service_catalog service
      where service.id = v_selected_service
        and service.organization_id = v_version.organization_id
      for share;
    if not found then
      raise exception 'Pipeline template contains an unavailable service.'
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1 from unnest(v_service_ids) selected(service_id)
    left join public.service_catalog service
      on service.id = selected.service_id
     and service.organization_id = v_version.organization_id
     and service.is_active
    where service.id is null
  ) then
    raise exception 'Pipeline template contains an unavailable service.' using errcode = '22023';
  end if;

  -- Only cross-department versions need head approvals. A recorded vote counts
  -- only while its actor still holds the active canonical head role for that
  -- exact affected department; project PM bindings and affiliation are ignored.
  select array_agg(distinct service.department_id order by service.department_id)
    into v_departments
  from public.pipeline_template_version_services item
  join public.service_catalog service
    on service.id = item.service_id and service.organization_id = item.organization_id
  where item.pipeline_template_version_id = v_version.id;
  if coalesce(cardinality(v_departments), 0) > 1 then
    foreach v_department in array v_departments loop
      perform 1
      from public.pipeline_template_department_approvals approval
      join public.organization_memberships membership
        on membership.organization_id = approval.organization_id
       and membership.user_id = approval.approved_by
      where approval.organization_id = v_version.organization_id
        and approval.pipeline_template_version_id = v_version.id
        and approval.department_id = v_department
        and membership.member_kind = 'team'
        and membership.status = 'active'
        and membership.role = 'department_manager'
        and membership.department_id = v_department
      for share of membership;
      if not found then
        raise exception 'Current approval from a head of department % is required for this exact preset version.', v_department
          using errcode = '42501';
      end if;
    end loop;
  end if;
  v_manifest := private.pipeline_rule_manifest(v_version.organization_id, v_service_ids);
  v_rule_sha256 := encode(extensions.digest(
    convert_to(v_manifest::text, 'UTF8'), 'sha256'
  ), 'hex');

  select coalesce(max(publication.publication_number), 0) + 1
    into v_publication_number
  from public.pipeline_template_publications publication
  where publication.pipeline_template_id = v_version.pipeline_template_id;

  insert into public.pipeline_template_publications (
    organization_id, pipeline_template_id, pipeline_template_version_id,
    publication_number, published_rule_manifest, published_rule_sha256,
    published_by
  ) values (
    v_version.organization_id, v_version.pipeline_template_id, v_version.id,
    v_publication_number, v_manifest, v_rule_sha256, v_actor_id
  ) returning * into v_publication;

  return jsonb_build_object(
    'pipeline_template_publication_id', v_publication.id,
    'pipeline_template_version_id', v_version.id,
    'publication_number', v_publication.publication_number,
    'published_rule_sha256', v_publication.published_rule_sha256,
    'idempotent_replay', false
  );
end;
$$;


comment on table public.pipeline_template_department_approvals is
  'Append-only exact-version department-head approvals; publication rechecks current canonical head authority.';
comment on function public.approve_pipeline_template_version_department(uuid, text) is
  'Records one active canonical head approval for one affected department of an exact unpublished cross-department preset version.';
commit;
