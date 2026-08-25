-- Verification for 20260825020000_security_boundary_hardening.sql
-- READ-ONLY: run after Migration 2 and return the single JSON result.

with anon_table_grants as (
  select count(*) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon'
),
authenticated_elevated_grants as (
  select count(*) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'authenticated'
    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
),
function_checks as (
  select jsonb_agg(
    jsonb_build_object(
      'name', procedure.proname,
      'arguments', pg_get_function_identity_arguments(procedure.oid),
      'search_path', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb),
      'anon_can_execute', has_function_privilege(
        'anon',
        procedure.oid,
        'EXECUTE'
      ),
      'authenticated_can_execute', has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
    ) order by procedure.proname
  ) as value
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'can_access_task',
      'handle_new_user',
      'has_organization_role',
      'is_organization_member',
      'is_team_organization_member',
      'rls_auto_enable',
      'update_project_progress'
    )
),
deliverable_policy_checks as (
  select jsonb_build_object(
    'old_public_read_policy_exists', exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'public read deliverables'
    ),
    'old_open_upload_policy_exists', exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'authenticated users can upload'
    ),
    'team_policy_count', (
      select count(*)
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname in (
          'Team can read sphere deliverables',
          'Team can upload sphere deliverables',
          'Team can update sphere deliverables',
          'Team can delete sphere deliverables'
        )
    )
  ) as value
),
storage_checks as (
  select jsonb_build_object(
    'bucket_public', bucket.public,
    'object_count', (
      select count(*)
      from storage.objects object
      where object.bucket_id = bucket.id
    )
  ) as value
  from storage.buckets bucket
  where bucket.id = 'sphere-deliverables'
)
select jsonb_pretty(
  jsonb_build_object(
    'migration', '20260825020000_security_boundary_hardening',
    'anon_public_table_grant_count', (select value from anon_table_grants),
    'authenticated_elevated_table_grant_count', (
      select value from authenticated_elevated_grants
    ),
    'functions', (select value from function_checks),
    'deliverable_policies', (select value from deliverable_policy_checks),
    'storage', (select value from storage_checks),
    'migration_ledger_versions', (
      select jsonb_agg(version order by version)
      from supabase_migrations.schema_migrations
    )
  )
) as migration_2_verification;
