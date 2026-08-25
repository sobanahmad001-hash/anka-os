-- Anka Sphere OS - Phase 1 exact row counts
-- Target project ref: fhoxaogfjszftoqtnbav
--
-- READ-ONLY: this query returns one aggregate count per public table.
-- It does not return row contents or modify the database.

with public_tables as (
  select
    n.nspname as schema_name,
    c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
exact_counts as (
  select
    table_name,
    (
      (xpath(
        '/row/row_count/text()',
        query_to_xml(
          format(
            'select count(*) as row_count from %I.%I',
            schema_name,
            table_name
          ),
          false,
          true,
          ''
        )
      ))[1]::text
    )::bigint as row_count
  from public_tables
)
select jsonb_pretty(
  jsonb_build_object(
    'inventory_version', 'phase1-exact-counts-v1',
    'project_ref', 'fhoxaogfjszftoqtnbav',
    'generated_at', now(),
    'total_public_rows', coalesce(sum(row_count), 0),
    'non_empty_tables', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', table_name,
          'row_count', row_count
        ) order by table_name
      ) filter (where row_count > 0),
      '[]'::jsonb
    ),
    'all_table_counts', coalesce(
      jsonb_object_agg(table_name, row_count order by table_name),
      '{}'::jsonb
    )
  )
) as phase_1_exact_row_counts
from exact_counts;

