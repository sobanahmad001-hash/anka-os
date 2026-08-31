-- Read-only structural verification for RP1.

with brand_brief_columns as (
  select array_agg(column_name::text order by ordinal_position) as names
  from information_schema.columns
  where table_schema = 'public' and table_name = 'brand_briefs'
), browser_writes as (
  select 1
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'brand_briefs'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), brief_immutability_triggers as (
  select 1
  from information_schema.triggers
  where event_object_schema = 'public' and event_object_table = 'brand_briefs'
    and action_timing = 'BEFORE' and event_manipulation in ('UPDATE', 'DELETE')
), brand_foreign_key as (
  select pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.brand_briefs'::regclass and contype = 'f'
    and pg_get_constraintdef(oid) ilike '%(brand_id, organization_id)%brands%'
), brand_unique as (
  select pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.brand_briefs'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (brand_id)'
)
select jsonb_build_object(
  'exact_brand_brief_columns', (select names from brand_brief_columns) = array[
    'id', 'organization_id', 'brand_id', 'target_market', 'price_tier',
    'operating_principles', 'competitor_references', 'raw_brief', 'created_by',
    'created_at', 'updated_at'
  ]::text[],
  'one_brief_per_brand', exists (select 1 from brand_unique),
  'brand_org_fk_present', exists (select 1 from brand_foreign_key),
  'rls_enabled', (select relrowsecurity from pg_class where oid = 'public.brand_briefs'::regclass),
  'authenticated_can_read', has_table_privilege('authenticated', 'public.brand_briefs', 'SELECT'),
  'browser_cannot_write', not exists (select 1 from browser_writes),
  'brief_remains_mutable', not exists (select 1 from brief_immutability_triggers),
  'brand_statement_uses_artifacts', (
    select pg_get_constraintdef(oid) ilike '%brand_statement%'
    from pg_constraint
    where conrelid = 'public.artifacts'::regclass
      and conname = 'artifacts_artifact_type_check'
  ),
  'no_parallel_statement_table', to_regclass('public.brand_statements') is null,
  'artifact_versions_still_immutable', exists (
    select 1 from information_schema.triggers
    where trigger_schema = 'public' and event_object_table = 'artifact_versions'
      and trigger_name = 'trg_artifact_versions_immutable'
  )
);
