-- Read-only verification for Migration 4.
-- Expected: every boolean true and every unsafe count zero.

with expected_tables(table_name) as (
  values
    ('workflow_templates'),
    ('workflow_stages'),
    ('project_workflow_templates'),
    ('task_dependencies'),
    ('milestones'),
    ('deliverables'),
    ('files'),
    ('deliverable_versions'),
    ('approvals'),
    ('requests'),
    ('research_records'),
    ('activity_events'),
    ('living_project_documents'),
    ('living_project_document_snapshots'),
    ('client_project_projections'),
    ('client_portal_items')
),
table_state as (
  select
    expected.table_name,
    class.oid is not null as exists,
    coalesce(class.relrowsecurity, false) as rls_enabled
  from expected_tables expected
  left join pg_class class
    on class.relname = expected.table_name
   and class.relnamespace = 'public'::regnamespace
   and class.relkind = 'r'
),
legacy_dependencies as (
  select count(*)::integer as count
  from pg_constraint constraint_row
  join pg_class source_table on source_table.oid = constraint_row.conrelid
  join pg_class target_table on target_table.oid = constraint_row.confrelid
  join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
  where constraint_row.contype = 'f'
    and source_schema.nspname = 'public'
    and source_table.relname in (select table_name from expected_tables)
    and target_table.relname like 'as\_%' escape '\'
),
legacy_policies as (
  select count(*)::integer as count
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'Users can read department projects',
      'Leads can create projects',
      'Authorized users can update projects',
      'Admins can delete projects',
      'Users can manage own tasks',
      'Admin full access to tasks',
      'Head manages department tasks',
      'Users can read own and assigned tasks',
      'Users can create own tasks',
      'Users can update own and assigned tasks',
      'Users can delete own tasks',
      'Authenticated users can read comments'
    )
),
anonymous_grants as (
  select count(*)::integer as count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon'
),
elevated_authenticated_grants as (
  select count(*)::integer as count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'authenticated'
    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
),
trigger_state as (
  select
    count(*) filter (where trigger.tgname = 'trg_enforce_task_status_transition') = 1
      as task_transition_trigger,
    count(*) filter (where trigger.tgname = 'trg_enforce_deliverable_version_transition') = 1
      as deliverable_transition_trigger,
    count(*) filter (where trigger.tgname = 'trg_create_living_project_document') = 1
      as living_record_trigger
  from pg_trigger trigger
  where not trigger.tgisinternal
),
client_approval_policies as (
  select count(*)::integer as count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'approvals'
    and roles @> array['authenticated']::name[]
    and cmd = 'INSERT'
    and coalesce(with_check, '') ilike '%client_approval%'
    and coalesce(with_check, '') not ilike '%<>%client_approval%'
),
living_record_state as (
  select
    (select count(*) from public.projects) as project_count,
    (select count(*) from public.living_project_documents) as document_count,
    not exists (
      select 1
      from public.projects project
      left join public.living_project_documents document
        on document.project_id = project.id
      where document.id is null
    ) as every_project_has_document
)
select jsonb_pretty(jsonb_build_object(
  'migration', '20260825040000_canonical_delivery_core',
  'all_tables_present', not exists (
    select 1 from table_state where exists = false
  ),
  'all_tables_have_rls', not exists (
    select 1 from table_state where rls_enabled = false
  ),
  'table_state', (
    select jsonb_agg(to_jsonb(table_state) order by table_name)
    from table_state
  ),
  'anon_public_table_grant_count', (select count from anonymous_grants),
  'authenticated_elevated_table_grant_count',
    (select count from elevated_authenticated_grants),
  'canonical_to_legacy_fk_count', (select count from legacy_dependencies),
  'legacy_broad_policy_count', (select count from legacy_policies),
  'client_approval_insert_policy_count', (select count from client_approval_policies),
  'triggers', (select to_jsonb(trigger_state) from trigger_state),
  'living_records', (select to_jsonb(living_record_state) from living_record_state),
  'client_approvals_enabled', coalesce((
    select (settings ->> 'client_approvals_enabled')::boolean
    from public.organizations
    where slug = 'anka-sphere'
  ), false)
)) as verification_result;
