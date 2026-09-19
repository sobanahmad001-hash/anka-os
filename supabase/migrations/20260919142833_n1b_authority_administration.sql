-- N1-B pre-cutover administration. No effective authorization or legacy writer changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.n1b_authority_requests (
  organization_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, actor_id, request_id)
);
alter table private.n1b_authority_requests enable row level security;
revoke all on private.n1b_authority_requests from public, anon, authenticated, service_role;
create function private.n1b_preserve_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Administration receipts are immutable.' using errcode = '42501'; end; $$;
revoke all on function private.n1b_preserve_receipt() from public, anon, authenticated, service_role;
create trigger n1b_immutable_receipt before update or delete on private.n1b_authority_requests
for each row execute function private.n1b_preserve_receipt();

-- Internal invoker helpers: never directly executable by API roles.
create function private.n1b_require_admin(p_org uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  -- Serialize the low-volume admin lane before taking membership locks. No global lock.
  perform pg_advisory_xact_lock(hashtextextended('n1b-admin:' || p_org::text, 0));
  perform 1 from public.organizations where id = p_org and status = 'active' for share;
  if not found then raise exception 'Active organization admin required.' using errcode = '42501'; end if;
  perform 1 from public.organization_memberships where organization_id = p_org and user_id = actor
    and status = 'active' and member_kind = 'team' and role in ('system_owner', 'operations_admin') for share;
  if not found then raise exception 'Active organization admin required.' using errcode = '42501'; end if;
  return actor;
end; $$;

create function private.n1b_snapshot(p_org uuid, p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('user_id', m.user_id, 'organization_id', m.organization_id,
    'legacy_role', m.role, 'legacy_department_id', m.department_id, 'status', m.status,
    'department_memberships', coalesce((select jsonb_agg(to_jsonb(d) order by d.id)
      from public.organization_department_memberships d where d.organization_id = p_org and d.user_id = p_user), '[]'::jsonb),
    'contributor_designations', coalesce((select jsonb_agg(to_jsonb(d) order by d.id)
      from public.organization_contributor_designations d where d.organization_id = p_org and d.user_id = p_user), '[]'::jsonb),
    'project_manager_bindings', coalesce((select jsonb_agg(to_jsonb(d) order by d.id)
      from public.project_manager_bindings d where d.organization_id = p_org and d.user_id = p_user), '[]'::jsonb))
  from public.organization_memberships m where m.organization_id = p_org and m.user_id = p_user and m.member_kind = 'team';
$$;
revoke all on function private.n1b_require_admin(uuid), private.n1b_snapshot(uuid,uuid) from public, anon, authenticated, service_role;

-- These two private entry points are the intentional privilege boundary. Both
-- recheck caller database membership, including replay; no supplied actor claims.
create function private.n1b_read_admin(p_org uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; snapshot jsonb;
begin
  actor := private.n1b_require_admin(p_org);
  if p_user is not null then
    perform 1 from public.organization_memberships where organization_id = p_org and user_id = p_user and member_kind = 'team' for share;
    if not found then raise exception 'Same-organization team target required.' using errcode = '42501'; end if;
    snapshot := private.n1b_snapshot(p_org, p_user);
  end if;
  return jsonb_build_object('schema_version', 1, 'compatibility_only', true, 'organization_id', p_org,
    'actor_id', actor, 'snapshot', snapshot, 'token', case when snapshot is not null then md5(snapshot::text) end,
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id,
      'organization_id', m.organization_id, 'name', coalesce(p.full_name, m.user_id::text), 'role', m.role, 'status', m.status) order by m.user_id)
      from public.organization_memberships m left join public.profiles p on p.id = m.user_id
      where m.organization_id = p_org and m.member_kind = 'team'), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'organization_id', d.organization_id) order by d.id)
      from public.departments d where d.organization_id = p_org), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'organization_id', p.organization_id) order by p.id)
      from public.projects p where p.organization_id = p_org and p.archived_at is null), '[]'::jsonb));
end; $$;

create function private.n1b_mutate_admin(p_org uuid, p_user uuid, p_action text, p_value text, p_token text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid; target public.organization_memberships; snapshot jsonb; payload jsonb;
  receipt private.n1b_authority_requests; result jsonb; record_id uuid; prior_id uuid; details jsonb;
begin
  actor := private.n1b_require_admin(p_org);
  if p_user is null or p_request is null or p_token is null or p_action is null
     or p_action not in ('add_department','revoke_department','set_designation','add_project_manager','revoke_project_manager') then
    raise exception 'Complete recognized command required.' using errcode = '22023';
  end if;
  select * into target from public.organization_memberships
    where organization_id = p_org and user_id = p_user and member_kind = 'team' for update;
  if not found then raise exception 'Same-organization team target required.' using errcode = '42501'; end if;
  payload := jsonb_build_object('user_id', p_user, 'action', p_action, 'value', p_value, 'token', p_token);
  select * into receipt from private.n1b_authority_requests
    where organization_id = p_org and actor_id = actor and request_id = p_request;
  if found then
    if receipt.request_payload is distinct from payload then
      raise exception 'Request ID already used for another command.' using errcode = '23505';
    end if;
    return receipt.result || jsonb_build_object('replayed', true);
  end if;
  snapshot := private.n1b_snapshot(p_org, p_user);
  if md5(snapshot::text) is distinct from p_token then
    raise exception 'Compatibility records changed. Reload before editing.' using errcode = '40001';
  end if;
  if (p_action in ('add_department','add_project_manager') or (p_action = 'set_designation' and p_value is not null))
    and target.status <> 'active' then
    raise exception 'Active team target required for additions.' using errcode = '42501';
  end if;
  details := jsonb_build_object('actor_id', actor, 'request_id', p_request, 'administration', 'n1b');
  if p_action = 'add_department' then
    perform 1 from public.departments where id = p_value and organization_id = p_org for share;
    if not found then raise exception 'Same-organization department required.' using errcode = '42501'; end if;
    insert into public.organization_department_memberships(organization_id,user_id,department_id,source,source_details)
      values(p_org,p_user,p_value,'explicit',details) returning id into record_id;
  elsif p_action = 'revoke_department' then
    update public.organization_department_memberships set status = 'revoked', revoked_at = clock_timestamp()
      where id = p_value::uuid and organization_id = p_org and user_id = p_user and status = 'active' returning id into record_id;
    if not found then raise exception 'Active target department record required.' using errcode = '42501'; end if;
  elsif p_action = 'set_designation' then
    if p_value is not null and (p_value not in ('intern','executive') or target.role <> 'contributor') then
      raise exception 'Intern/Executive designation requires a contributor.' using errcode = '42501';
    end if;
    select id into prior_id from public.organization_contributor_designations
      where organization_id = p_org and user_id = p_user and status = 'active' and designation is not distinct from p_value;
    if prior_id is not null then
      record_id := prior_id; -- Explicit same-value command is harmless and receipted.
    else
      update public.organization_contributor_designations set status = 'revoked', revoked_at = clock_timestamp()
        where organization_id = p_org and user_id = p_user and status = 'active' returning id into prior_id;
      if p_value is not null then
        insert into public.organization_contributor_designations(organization_id,user_id,designation,source_details)
          values(p_org,p_user,p_value,details) returning id into record_id;
      end if;
    end if;
  elsif p_action = 'add_project_manager' then
    perform 1 from public.projects where id = p_value::uuid and organization_id = p_org and archived_at is null for share;
    if not found then raise exception 'Same-organization non-archived project required.' using errcode = '42501'; end if;
    insert into public.project_manager_bindings(organization_id,user_id,project_id,source,source_details)
      values(p_org,p_user,p_value::uuid,'explicit',details) returning id into record_id;
  elsif p_action = 'revoke_project_manager' then
    update public.project_manager_bindings set status = 'revoked', revoked_at = clock_timestamp()
      where id = p_value::uuid and organization_id = p_org and user_id = p_user and status = 'active' returning id into record_id;
    if not found then raise exception 'Active target project-manager record required.' using errcode = '42501'; end if;
  end if;
  result := jsonb_build_object('schema_version', 1, 'compatibility_only', true, 'organization_id', p_org,
    'user_id', p_user, 'request_id', p_request, 'record_id', record_id, 'prior_id', prior_id, 'replayed', false);
  insert into private.n1b_authority_requests(organization_id,actor_id,request_id,request_payload,result)
    values(p_org,actor,p_request,payload,result);
  return result;
end; $$;

create function public.get_authority_administration(p_organization_id uuid, p_user_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.n1b_read_admin(p_organization_id, p_user_id);
$$;
create function public.change_authority_compatibility(p_organization_id uuid, p_user_id uuid,
  p_action text, p_value text, p_expected_token text, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.n1b_mutate_admin(p_organization_id, p_user_id, p_action, p_value, p_expected_token, p_request_id);
$$;
revoke all on function private.n1b_read_admin(uuid,uuid),
  private.n1b_mutate_admin(uuid,uuid,text,text,text,uuid),
  public.get_authority_administration(uuid,uuid),
  public.change_authority_compatibility(uuid,uuid,text,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function private.n1b_read_admin(uuid,uuid),
  private.n1b_mutate_admin(uuid,uuid,text,text,text,uuid),
  public.get_authority_administration(uuid,uuid),
  public.change_authority_compatibility(uuid,uuid,text,text,text,uuid) to authenticated;
comment on function public.change_authority_compatibility(uuid,uuid,text,text,text,uuid) is
  'Pre-cutover shadow records only. Existing active organization owner/admin required. Removal does not revoke legacy access.';
commit;
