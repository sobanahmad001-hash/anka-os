-- Rollback-safe verification for 20260903170702_w7_active_organization_client_rpc_post_qts4.sql.

begin;

create temporary table w7_active_org_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

create temporary table w7_active_org_context (
  actor_id uuid not null,
  organization_a_id uuid not null,
  organization_b_id uuid not null,
  organization_c_id uuid not null,
  revoked_organization_id uuid not null,
  suspended_organization_id uuid not null
) on commit drop;

insert into w7_active_org_checks values
  ('explicit_organization_rpc_exists', to_regprocedure('public.create_commercial_client(uuid,text,text,text,text,text,text,text,text)') is not null),
  ('ambiguous_oldest_membership_rpc_removed', to_regprocedure('public.create_commercial_client(text,text,text,text,text,text,text,text)') is null),
  ('explicit_organization_rpc_is_invoker', coalesce((
    select not procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = to_regprocedure('public.create_commercial_client(uuid,text,text,text,text,text,text,text,text)')
  ), false)),
  ('explicit_organization_rpc_acl_is_narrow',
    not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid = to_regprocedure('public.create_commercial_client(uuid,text,text,text,text,text,text,text,text)')
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    and not has_function_privilege('anon', 'public.create_commercial_client(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.create_commercial_client(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_commercial_client(uuid,text,text,text,text,text,text,text,text)', 'EXECUTE')
  ),
  ('valid_organization_b_write', false),
  ('canonical_ownership_stays_in_organization_b', false),
  ('non_member_organization_c_rejected', false),
  ('revoked_membership_rejected', false),
  ('suspended_organization_rejected', false),
  ('failed_scope_writes_are_atomic', false);

do $$
declare
  v_membership public.organization_memberships;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_organization_b_id uuid := gen_random_uuid();
  v_organization_c_id uuid := gen_random_uuid();
  v_revoked_organization_id uuid := gen_random_uuid();
  v_suspended_organization_id uuid := gen_random_uuid();
begin
  select membership.*
  into v_membership
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  where membership.member_kind = 'team'
    and membership.status = 'active'
    and organization.status = 'active'
  order by membership.created_at, membership.id
  limit 1;

  if not found then
    return;
  end if;

  insert into public.organizations (id, name, slug, status) values
    (v_organization_b_id, 'W7 organization B', 'w7-b-' || v_suffix, 'active'),
    (v_organization_c_id, 'W7 organization C', 'w7-c-' || v_suffix, 'active'),
    (v_revoked_organization_id, 'W7 revoked organization', 'w7-revoked-' || v_suffix, 'active'),
    (v_suspended_organization_id, 'W7 suspended organization', 'w7-suspended-' || v_suffix, 'suspended');

  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, status
  ) values
    (v_organization_b_id, v_membership.user_id, 'team', 'contributor', 'active'),
    (v_revoked_organization_id, v_membership.user_id, 'team', 'contributor', 'revoked'),
    (v_suspended_organization_id, v_membership.user_id, 'team', 'contributor', 'active');

  insert into w7_active_org_context values (
    v_membership.user_id,
    v_membership.organization_id,
    v_organization_b_id,
    v_organization_c_id,
    v_revoked_organization_id,
    v_suspended_organization_id
  );
end;
$$;

grant select on w7_active_org_context to authenticated;
grant select, update on w7_active_org_checks to authenticated;

select set_config(
  'request.jwt.claim.sub',
  coalesce((select actor_id::text from w7_active_org_context limit 1), ''),
  true
);

set local role authenticated;
do $$
declare
  v_context w7_active_org_context;
  v_result jsonb;
  v_client_name text := 'W7 selected B client ' || replace(gen_random_uuid()::text, '-', '');
  v_brand_name text := 'W7 selected B brand ' || replace(gen_random_uuid()::text, '-', '');
  v_canonical_client_id uuid;
  v_agency_client_id uuid;
  v_brand_id uuid;
begin
  select * into v_context from w7_active_org_context limit 1;
  if not found then
    return;
  end if;

  v_result := public.create_commercial_client(
    p_organization_id => v_context.organization_b_id,
    p_name => v_client_name,
    p_brand_name => v_brand_name
  );
  v_canonical_client_id := (v_result -> 'canonical_client' ->> 'id')::uuid;
  v_agency_client_id := (v_result -> 'client' ->> 'id')::uuid;
  v_brand_id := (v_result -> 'brand' ->> 'id')::uuid;

  update w7_active_org_checks
  set passed = (
    (select count(*) from public.clients where id = v_canonical_client_id and organization_id = v_context.organization_b_id) = 1
    and (select count(*) from public.clients where id = v_canonical_client_id and organization_id = v_context.organization_a_id) = 0
  )
  where check_name = 'valid_organization_b_write';

  update w7_active_org_checks
  set passed = (
    (select count(*) from public.agency_clients
      where id = v_agency_client_id
        and organization_id = v_context.organization_b_id
        and canonical_client_id = v_canonical_client_id
        and legacy_client_id = v_canonical_client_id) = 1
    and (select count(*) from public.brands
      where id = v_brand_id
        and organization_id = v_context.organization_b_id
        and client_id = v_agency_client_id
        and is_default) = 1
  )
  where check_name = 'canonical_ownership_stays_in_organization_b';

  begin
    perform public.create_commercial_client(v_context.organization_c_id, 'W7 forbidden C client', 'W7 forbidden C brand');
  exception when insufficient_privilege then
    update w7_active_org_checks set passed = true where check_name = 'non_member_organization_c_rejected';
  end;

  begin
    perform public.create_commercial_client(v_context.revoked_organization_id, 'W7 revoked client', 'W7 revoked brand');
  exception when insufficient_privilege then
    update w7_active_org_checks set passed = true where check_name = 'revoked_membership_rejected';
  end;

  begin
    perform public.create_commercial_client(v_context.suspended_organization_id, 'W7 suspended client', 'W7 suspended brand');
  exception when insufficient_privilege then
    update w7_active_org_checks set passed = true where check_name = 'suspended_organization_rejected';
  end;

  update w7_active_org_checks
  set passed = not exists (
    select 1 from public.clients
    where name in ('W7 forbidden C client', 'W7 revoked client', 'W7 suspended client')
  ) and not exists (
    select 1 from public.agency_clients
    where name in ('W7 forbidden C client', 'W7 revoked client', 'W7 suspended client')
  ) and not exists (
    select 1 from public.brands
    where name in ('W7 forbidden C brand', 'W7 revoked brand', 'W7 suspended brand')
  )
  where check_name = 'failed_scope_writes_are_atomic';
end;
$$;
reset role;

select jsonb_object_agg(check_name, passed order by check_name)
  as w7_active_organization_verification
from w7_active_org_checks;

do $$
declare
  v_failed_checks text;
begin
  select string_agg(check_name, ', ' order by check_name)
  into v_failed_checks
  from w7_active_org_checks
  where not passed;

  if v_failed_checks is not null then
    raise exception 'W7 active-organization verification failed: %', v_failed_checks;
  end if;
end;
$$;

rollback;
