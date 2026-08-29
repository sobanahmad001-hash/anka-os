-- Read-only verification for D1 exact-version proofing.

select jsonb_build_object(
  'table_exists', to_regclass('public.artifact_version_comments') is not null,
  'rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.artifact_version_comments'::regclass
  ),
  'exactly_one_target_check', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.artifact_version_comments'::regclass
      and conname = 'artifact_version_comments_exactly_one_target'
      and contype = 'c'
  ),
  'both_targets_are_organization_consistent', (
    select count(*) = 2
    from pg_constraint
    where conrelid = 'public.artifact_version_comments'::regclass
      and contype = 'f'
      and array_length(conkey, 1) = 2
      and confrelid in (
        'public.artifact_versions'::regclass,
        'public.design_direction_versions'::regclass
      )
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.artifact_version_comments', 'select')
    and not has_table_privilege('authenticated', 'public.artifact_version_comments', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_version_comments', 'select, insert, update, delete'),
  'append_only_trigger_exists', exists (
    select 1
    from information_schema.triggers
    where trigger_schema = 'public'
      and event_object_table = 'artifact_version_comments'
      and trigger_name = 'trg_artifact_version_comments_append_only'
  ),
  'approval_schema_untouched', (
    select count(*) = 9
    from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_approvals'
  )
);
