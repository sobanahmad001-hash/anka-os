begin;

create temporary table ds6_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

create temporary table ds6_expected_handoff_constraints (
  id uuid not null,
  organization_id uuid not null,
  design_direction_release_id uuid not null,
  status text not null,
  package_storage_path text,
  failure_reason text not null,
  created_at timestamptz not null,
  completed_at timestamptz,
  constraint ds6_expected_ready_storage check (
    (status = 'ready' and package_storage_path is not null and completed_at is not null and failure_reason = '')
    or
    (status = 'failed' and package_storage_path is null and completed_at is not null and length(trim(failure_reason)) > 0)
    or
    (status = 'preparing' and package_storage_path is null and completed_at is null and failure_reason = '')
  ),
  constraint ds6_expected_storage_scope check (
    package_storage_path is null
    or package_storage_path like organization_id::text || '/' || design_direction_release_id::text || '/handoffs/' || id::text || '.zip'
  )
) on commit drop;

create index ds6_expected_handoff_preparing
  on ds6_expected_handoff_constraints(organization_id, created_at)
  where status = 'preparing';

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
      and permissive = 'PERMISSIVE'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual = 'is_team_organization_member(organization_id)'
      and with_check is null
  )),
  ('handoff_browser_is_read_only', (
    has_table_privilege('authenticated', 'public.production_handoff_packages', 'select')
    and not has_table_privilege(
      'authenticated', 'public.production_handoff_packages', 'select with grant option'
    )
    and not has_table_privilege(
      'authenticated', 'public.production_handoff_packages',
      'insert, update, delete, truncate, references, trigger'
    )
    and not has_any_column_privilege(
      'authenticated', 'public.production_handoff_packages',
      'insert, update, references'
    )
    and not has_any_column_privilege(
      'authenticated', 'public.production_handoff_packages',
      'select with grant option'
    )
    and not has_table_privilege(
      'anon', 'public.production_handoff_packages',
      'select, insert, update, delete, truncate, references, trigger'
    )
    and not has_any_column_privilege(
      'anon', 'public.production_handoff_packages',
      'select, insert, update, references'
    )
  )),
  ('handoff_service_role_is_least_privilege', (
    has_table_privilege('service_role', 'public.production_handoff_packages', 'select')
    and has_table_privilege('service_role', 'public.production_handoff_packages', 'insert')
    and has_table_privilege('service_role', 'public.production_handoff_packages', 'update')
    and not has_table_privilege(
      'service_role', 'public.production_handoff_packages', 'delete, truncate, references, trigger'
    )
    and not has_any_column_privilege(
      'service_role', 'public.production_handoff_packages', 'references'
    )
    and not has_table_privilege(
      'service_role', 'public.production_handoff_packages',
      'select with grant option, insert with grant option, update with grant option'
    )
    and not has_any_column_privilege(
      'service_role', 'public.production_handoff_packages',
      'select with grant option, insert with grant option, update with grant option'
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
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid, false) = (
        select pg_get_constraintdef(expected_record.oid, false)
        from pg_constraint expected_record
        where expected_record.conrelid =
            'pg_temp.ds6_expected_handoff_constraints'::regclass
          and expected_record.conname = 'ds6_expected_ready_storage'
      )
  )),
  ('handoff_storage_path_is_scoped', exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.production_handoff_packages'::regclass
      and constraint_record.conname = 'production_handoff_packages_storage_scope'
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid, false) = (
        select pg_get_constraintdef(expected_record.oid, false)
        from pg_constraint expected_record
        where expected_record.conrelid =
            'pg_temp.ds6_expected_handoff_constraints'::regclass
          and expected_record.conname = 'ds6_expected_storage_scope'
      )
  )),
  ('handoff_terminal_transition_trigger_exists', exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.production_handoff_packages'::regclass
      and trigger_record.tgname = 'trg_production_handoff_package_transition'
      and trigger_record.tgfoid =
        'private.enforce_production_handoff_package_transition()'::regprocedure
      and trigger_record.tgtype = 19
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgattr = ''::int2vector
      and trigger_record.tgqual is null
      and trigger_record.tgnargs = 0
      and not trigger_record.tgisinternal
  )),
  ('handoff_private_transition_function_not_browser_callable', (
    not has_function_privilege(
      'authenticated', 'private.enforce_production_handoff_package_transition()', 'execute'
    )
    and not has_function_privilege(
      'anon', 'private.enforce_production_handoff_package_transition()', 'execute'
    )
    and has_function_privilege(
      'service_role', 'private.enforce_production_handoff_package_transition()', 'execute'
    )
  )),
  ('handoff_release_index_exists', to_regclass(
    'public.idx_production_handoff_packages_release'
  ) is not null),
  ('handoff_requester_index_exists', to_regclass(
    'public.idx_production_handoff_packages_requested_by'
  ) is not null),
  ('handoff_preparing_partial_index_exists', exists (
    select 1
    from pg_index index_record
    join pg_class index_class on index_class.oid = index_record.indexrelid
    join pg_am index_method on index_method.oid = index_class.relam
    where index_record.indexrelid =
        'public.idx_production_handoff_packages_preparing'::regclass
      and index_record.indrelid = 'public.production_handoff_packages'::regclass
      and index_record.indisvalid
      and index_record.indisready
      and index_record.indislive
      and not index_record.indisunique
      and not index_record.indisprimary
      and not index_record.indisexclusion
      and index_record.indimmediate
      and index_record.indnkeyatts = 2
      and index_record.indnatts = 2
      and index_record.indexprs is null
      and index_method.amname = 'btree'
      and pg_get_indexdef(index_record.indexrelid, 1, false) = 'organization_id'
      and pg_get_indexdef(index_record.indexrelid, 2, false) = 'created_at'
      and index_record.indpred is not null
      and pg_get_expr(index_record.indpred, index_record.indrelid, false) = (
        select pg_get_expr(expected_index.indpred, expected_index.indrelid, false)
        from pg_index expected_index
        where expected_index.indexrelid =
            'pg_temp.ds6_expected_handoff_preparing'::regclass
      )
  )),
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
      and file_size_limit >= 33554432
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
