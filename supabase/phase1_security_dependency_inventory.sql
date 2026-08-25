-- Anka Sphere OS - Phase 1 security and dependency inventory
-- Target project ref: fhoxaogfjszftoqtnbav
--
-- READ-ONLY: returns grants, function safety metadata, event triggers, storage
-- policy metadata, aggregate object counts, and migration-ledger metadata.
-- It does not return row contents, identities, credentials, tokens, files, or
-- function source bodies.

with function_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', namespace.nspname,
        'name', procedure.proname,
        'identity_arguments', pg_get_function_identity_arguments(procedure.oid),
        'owner', owner_role.rolname,
        'language', language.lanname,
        'security_definer', procedure.prosecdef,
        'configuration', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb),
        'acl', coalesce(to_jsonb(procedure.proacl), '[]'::jsonb),
        'source_hash', md5(procedure.prosrc)
      ) order by procedure.proname, pg_get_function_identity_arguments(procedure.oid)
    ),
    '[]'::jsonb
  ) as value
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  join pg_roles owner_role on owner_role.oid = procedure.proowner
  join pg_language language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
),
event_trigger_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', event_trigger.evtname,
        'event', event_trigger.evtevent,
        'enabled', event_trigger.evtenabled,
        'function', procedure.proname,
        'function_owner', owner_role.rolname
      ) order by event_trigger.evtname
    ),
    '[]'::jsonb
  ) as value
  from pg_event_trigger event_trigger
  join pg_proc procedure on procedure.oid = event_trigger.evtfoid
  join pg_roles owner_role on owner_role.oid = procedure.proowner
),
table_grant_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schema', grant_row.table_schema,
        'table', grant_row.table_name,
        'grantee', grant_row.grantee,
        'privilege', grant_row.privilege_type,
        'grantable', grant_row.is_grantable
      ) order by grant_row.table_name, grant_row.grantee, grant_row.privilege_type
    ),
    '[]'::jsonb
  ) as value
  from information_schema.role_table_grants grant_row
  where grant_row.table_schema = 'public'
    and grant_row.grantee in ('anon', 'authenticated', 'service_role')
),
storage_policy_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table', policy.tablename,
        'name', policy.policyname,
        'command', policy.cmd,
        'roles', policy.roles,
        'using', policy.qual,
        'with_check', policy.with_check
      ) order by policy.tablename, policy.policyname
    ),
    '[]'::jsonb
  ) as value
  from pg_policies policy
  where policy.schemaname = 'storage'
),
storage_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket', bucket.id,
        'public', bucket.public,
        'object_count', (
          select count(*)
          from storage.objects object
          where object.bucket_id = bucket.id
        )
      ) order by bucket.id
    ),
    '[]'::jsonb
  ) as value
  from storage.buckets bucket
),
migration_ledger_inventory as (
  select jsonb_build_object(
    'table_exists', to_regclass('supabase_migrations.schema_migrations') is not null,
    'columns', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', column_name,
          'type', data_type,
          'nullable', is_nullable
        ) order by ordinal_position
      )
      from information_schema.columns
      where table_schema = 'supabase_migrations'
        and table_name = 'schema_migrations'
    ), '[]'::jsonb),
    'recorded_versions', coalesce((
      select jsonb_agg(version order by version)
      from supabase_migrations.schema_migrations
    ), '[]'::jsonb)
  ) as value
)
select jsonb_pretty(
  jsonb_build_object(
    'inventory_version', 'phase1-security-dependencies-v1',
    'project_ref', 'fhoxaogfjszftoqtnbav',
    'generated_at', now(),
    'public_functions', (select value from function_inventory),
    'event_triggers', (select value from event_trigger_inventory),
    'role_table_grants', (select value from table_grant_inventory),
    'storage_policies', (select value from storage_policy_inventory),
    'storage', (select value from storage_inventory),
    'migration_ledger', (select value from migration_ledger_inventory)
  )
) as phase_1_security_dependency_inventory;
