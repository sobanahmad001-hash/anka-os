-- Read-only verification for Artifacts and Design Workshop.

with required_tables(table_name) as (
  values ('artifacts'), ('artifact_versions'), ('artifact_approvals'),
    ('design_model_registry'), ('design_workshop_sessions'),
    ('design_workshop_context_versions'), ('design_workshop_model_selections'),
    ('design_generation_runs'), ('design_directions'), ('design_direction_versions'),
    ('design_direction_selections'), ('design_direction_releases')
), table_state as (
  select required.table_name, relation.relrowsecurity
  from required_tables required
  left join pg_class relation on relation.relname = required.table_name
    and relation.relnamespace = 'public'::regnamespace
), browser_writes as (
  select table_name, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and table_name in (select table_name from required_tables)
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), immutable_triggers as (
  select trigger_name from information_schema.triggers
  where trigger_schema = 'public' and trigger_name in (
    'trg_artifact_versions_immutable', 'trg_artifact_approvals_immutable',
    'trg_design_context_immutable', 'trg_design_direction_versions_immutable',
    'trg_design_selections_immutable', 'trg_design_releases_immutable'
  )
)
select jsonb_build_object(
  'all_tables_exist', not exists (select 1 from table_state where relrowsecurity is null),
  'all_tables_use_rls', not exists (select 1 from table_state where relrowsecurity is distinct from true),
  'browser_roles_are_read_only', not exists (select 1 from browser_writes),
  'six_immutable_history_triggers', (select count(distinct trigger_name) = 6 from immutable_triggers),
  'three_artifact_types', (
    select pg_get_constraintdef(constraint_record.oid) ilike all(array['%discovery%', '%vision%', '%audience%'])
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.artifacts'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%artifact_type%'
  ),
  'two_initial_models_per_organization', not exists (
    select organization.id from public.organizations organization
    where (select count(*) from public.design_model_registry model
      where model.organization_id = organization.id and model.is_active) < 2
  ),
  'context_requires_exact_types', exists (
    select 1 from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.design_workshop_context_versions'::regclass
      and constraint_record.contype = 'p'
      and pg_get_constraintdef(constraint_record.oid) ilike '%session_id%artifact_type%'
  ),
  'release_is_exact_version', exists (
    select 1 from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.design_direction_releases'::regclass
      and constraint_record.contype = 'f'
      and pg_get_constraintdef(constraint_record.oid) ilike '%direction_version_id%design_direction_versions%'
  )
);
