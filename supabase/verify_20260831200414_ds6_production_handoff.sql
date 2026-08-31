begin;

create temporary table ds6_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into ds6_runtime_checks values
  ('handoff_table_exists', to_regclass('public.production_handoff_packages') is not null),
  ('handoff_rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.production_handoff_packages'::regclass
  )),
  ('handoff_team_read_policy_exists', exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'production_handoff_packages'
      and policyname = 'Team can read organization production handoffs'
      and qual like '%is_team_organization_member(organization_id)%'
  )),
  ('handoff_browser_is_read_only', (
    has_table_privilege('authenticated', 'public.production_handoff_packages', 'select')
    and not has_table_privilege(
      'authenticated', 'public.production_handoff_packages', 'insert, update, delete'
    )
    and not has_table_privilege(
      'anon', 'public.production_handoff_packages', 'select, insert, update, delete'
    )
  )),
  ('handoff_service_role_is_least_privilege', (
    has_table_privilege(
      'service_role', 'public.production_handoff_packages', 'select, insert, update'
    )
    and not has_table_privilege(
      'service_role', 'public.production_handoff_packages', 'delete, truncate, references, trigger'
    )
  )),
  ('handoff_release_fk_is_composite', exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.production_handoff_packages'::regclass
      and constraint_record.contype = 'f'
      and pg_get_constraintdef(constraint_record.oid)
        like '%FOREIGN KEY (design_direction_release_id, organization_id)%design_direction_releases(id, organization_id)%'
  )),
  ('handoff_ready_requires_storage', exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.production_handoff_packages'::regclass
      and constraint_record.conname = 'production_handoff_packages_ready_storage'
  )),
  ('handoff_storage_path_is_scoped', exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.production_handoff_packages'::regclass
      and constraint_record.conname = 'production_handoff_packages_storage_scope'
  )),
  ('handoff_terminal_transition_trigger_exists', exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.production_handoff_packages'::regclass
      and tgname = 'trg_production_handoff_package_transition'
      and not tgisinternal
  )),
  ('handoff_private_transition_function_not_browser_callable', (
    not has_function_privilege(
      'authenticated', 'private.enforce_production_handoff_package_transition()', 'execute'
    )
    and not has_function_privilege(
      'anon', 'private.enforce_production_handoff_package_transition()', 'execute'
    )
  )),
  ('handoff_release_index_exists', to_regclass(
    'public.idx_production_handoff_packages_release'
  ) is not null),
  ('handoff_requester_index_exists', to_regclass(
    'public.idx_production_handoff_packages_requested_by'
  ) is not null),
  ('handoff_bucket_remains_private', exists (
    select 1
    from storage.buckets
    where id = 'design-generated-media'
      and public = false
  )),
  ('handoff_bucket_accepts_zip', exists (
    select 1
    from storage.buckets
    where id = 'design-generated-media'
      and 'application/zip' = any(allowed_mime_types)
      and file_size_limit >= 52428800
  ));

do $$
declare
  v_user_id uuid;
begin
  select membership.user_id
  into v_user_id
  from public.organization_memberships membership
  where membership.organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
    and membership.member_kind = 'team'
    and membership.status = 'active'
  limit 1;

  if v_user_id is null then
    insert into ds6_runtime_checks values ('non_release_package_rejected', false);
    return;
  end if;

  begin
    insert into public.production_handoff_packages (
      organization_id, design_direction_release_id, requested_by
    ) values (
      '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25',
      gen_random_uuid(),
      v_user_id
    );
    insert into ds6_runtime_checks values ('non_release_package_rejected', false);
  exception
    when foreign_key_violation then
      insert into ds6_runtime_checks values ('non_release_package_rejected', true);
  end;
end;
$$;

select check_name, passed
from ds6_runtime_checks
order by check_name;

rollback;
