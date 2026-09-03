-- OAF2a rollback-safe verification.
-- Run only after 20260903060726_oaf2a_cover_composite_fks.sql is applied.

begin;

create temporary table oaf2a_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into oaf2a_checks values
  ('artifacts_composite_fk_has_exact_covering_index', coalesce((
    select index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_row.indkey) with ordinality key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_row.indnkeyatts
      ) = array['engagement_id', 'project_id', 'organization_id']::name[]
    from pg_index index_row
    where index_row.indexrelid = to_regclass('public.idx_artifacts_engagement_project_organization')
      and index_row.indrelid = 'public.artifacts'::regclass
  ), false)),
  ('work_items_composite_fk_has_exact_covering_index', coalesce((
    select index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_row.indkey) with ordinality key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_row.indnkeyatts
      ) = array['engagement_id', 'project_id', 'organization_id']::name[]
    from pg_index index_row
    where index_row.indexrelid = to_regclass('public.idx_work_items_engagement_project_organization')
      and index_row.indrelid = 'public.work_items'::regclass
  ), false)),
  ('ai_runs_composite_fk_has_exact_covering_index', coalesce((
    select index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_row.indkey) with ordinality key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_row.indnkeyatts
      ) = array['engagement_id', 'project_id', 'organization_id']::name[]
    from pg_index index_row
    where index_row.indexrelid = to_regclass('public.idx_ai_runs_engagement_project_organization')
      and index_row.indrelid = 'public.ai_runs'::regclass
  ), false)),
  ('superseded_ai_partial_index_is_removed',
    to_regclass('public.idx_ai_runs_engagement_project') is null),
  ('complementary_oaf2_indexes_are_preserved',
    to_regclass('public.idx_artifacts_project') is not null
    and to_regclass('public.idx_work_items_project_active') is not null
    and to_regclass('public.idx_work_items_engagement_fk') is not null
    and to_regclass('public.idx_ai_runs_engagement_created') is not null),
  ('oaf2_composite_foreign_keys_are_preserved', (
    select count(*) = 3
    from pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.conname = any(array[
        'artifacts_engagement_project_organization_fkey',
        'work_items_engagement_project_organization_fkey',
        'ai_runs_engagement_project_organization_fkey'
      ])
      and constraint_row.conrelid = any(array[
        'public.artifacts'::regclass,
        'public.work_items'::regclass,
        'public.ai_runs'::regclass
      ])
  ));

select jsonb_object_agg(check_name, passed order by check_name)
  as oaf2a_composite_fk_index_verification
from oaf2a_checks;

rollback;
