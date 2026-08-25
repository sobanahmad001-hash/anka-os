-- Anka Sphere OS - Phase 1 live Supabase inventory
-- Target project ref: fhoxaogfjszftoqtnbav
--
-- READ-ONLY: this query does not create, update, or delete anything.
-- Run the complete file in the Supabase SQL Editor, then download or copy the
-- single JSON result and return it to the implementation team.
--
-- Privacy boundary: only schema metadata and aggregate record counts are read.
-- No row content, auth identities, credentials, tokens, or stored files are read.

with public_tables as (
  select
    c.oid,
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced,
    coalesce(s.n_live_tup, 0)::bigint as estimated_row_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
table_inventory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table', t.table_name,
        'rls_enabled', t.rls_enabled,
        'rls_forced', t.rls_forced,
        'estimated_row_count', t.estimated_row_count,
        'columns', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', a.attname,
              'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
              'nullable', not a.attnotnull,
              'default', pg_get_expr(d.adbin, d.adrelid)
            ) order by a.attnum
          )
          from pg_attribute a
          left join pg_attrdef d
            on d.adrelid = a.attrelid
           and d.adnum = a.attnum
          where a.attrelid = t.oid
            and a.attnum > 0
            and not a.attisdropped
        ), '[]'::jsonb),
        'constraints', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', con.conname,
              'type', case con.contype
                when 'p' then 'primary_key'
                when 'f' then 'foreign_key'
                when 'u' then 'unique'
                when 'c' then 'check'
                when 'x' then 'exclusion'
                else con.contype::text
              end,
              'definition', pg_get_constraintdef(con.oid, true)
            ) order by con.conname
          )
          from pg_constraint con
          where con.conrelid = t.oid
        ), '[]'::jsonb),
        'indexes', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', i.indexname,
              'definition', i.indexdef
            ) order by i.indexname
          )
          from pg_indexes i
          where i.schemaname = 'public'
            and i.tablename = t.table_name
        ), '[]'::jsonb),
        'policies', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', p.policyname,
              'command', p.cmd,
              'permissive', p.permissive,
              'roles', p.roles,
              'using', p.qual,
              'with_check', p.with_check
            ) order by p.policyname
          )
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = t.table_name
        ), '[]'::jsonb)
      ) order by t.table_name
    ),
    '[]'::jsonb
  ) as value
  from public_tables t
),
public_functions as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', p.proname,
        'identity_arguments', pg_get_function_identity_arguments(p.oid),
        'return_type', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef
      ) order by p.proname, pg_get_function_identity_arguments(p.oid)
    ),
    '[]'::jsonb
  ) as value
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
public_triggers as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table', event_object_table,
        'name', trigger_name,
        'timing', action_timing,
        'events', event_manipulation,
        'statement', action_statement
      ) order by event_object_table, trigger_name, event_manipulation
    ),
    '[]'::jsonb
  ) as value
  from information_schema.triggers
  where trigger_schema = 'public'
),
installed_extensions as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', extname, 'version', extversion)
      order by extname
    ),
    '[]'::jsonb
  ) as value
  from pg_extension
),
migration_inventory as (
  select jsonb_build_object(
    'migration_table_exists', to_regclass('supabase_migrations.schema_migrations') is not null,
    'migration_count', case
      when to_regclass('supabase_migrations.schema_migrations') is null then null
      else (
        select count(*)
        from supabase_migrations.schema_migrations
      )
    end,
    'versions', case
      when to_regclass('supabase_migrations.schema_migrations') is null then '[]'::jsonb
      else (
        select coalesce(jsonb_agg(version order by version), '[]'::jsonb)
        from supabase_migrations.schema_migrations
      )
    end
  ) as value
),
platform_inventory as (
  select jsonb_build_object(
    'auth_user_count', (select count(*) from auth.users),
    'storage_buckets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', name,
          'public', public,
          'file_size_limit', file_size_limit,
          'allowed_mime_types', allowed_mime_types
        ) order by name
      )
      from storage.buckets
    ), '[]'::jsonb)
  ) as value
)
select jsonb_pretty(
  jsonb_build_object(
    'inventory_version', 'phase1-v1',
    'project_ref', 'fhoxaogfjszftoqtnbav',
    'generated_at', now(),
    'database_version', current_setting('server_version'),
    'public_tables', (select value from table_inventory),
    'public_functions', (select value from public_functions),
    'public_triggers', (select value from public_triggers),
    'installed_extensions', (select value from installed_extensions),
    'migrations', (select value from migration_inventory),
    'platform', (select value from platform_inventory)
  )
) as phase_1_inventory;
