begin;

create temporary table mk6b_checks (
  check_name text primary key,
  passed boolean not null
);

insert into mk6b_checks values
  ('mk6b_tables_exist', (
    select count(*) = 3
    from unnest(array[
      'public.meta_connections',
      'public.meta_performance_snapshots',
      'public.meta_oauth_sessions'
    ]) relation_name
    where to_regclass(relation_name) is not null
  )),
  ('mk6b_registry_accepts_meta', exists (
    select 1 from pg_constraint
    where conrelid = 'public.integration_connections'::regclass
      and conname = 'integration_connections_provider_check'
      and pg_get_constraintdef(oid) like '%meta%'
  )),
  ('mk6b_rls_enabled', (
    select count(*) = 3 and bool_and(relrowsecurity)
    from pg_class
    where oid = any(array[
      'public.meta_connections'::regclass,
      'public.meta_performance_snapshots'::regclass,
      'public.meta_oauth_sessions'::regclass
    ])
  )),
  ('mk6b_team_read_policies', (
    select count(*) = 2
    from pg_policies
    where schemaname = 'public'
      and tablename in ('meta_connections', 'meta_performance_snapshots')
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%is_team_organization_member(organization_id)%'
  )),
  ('mk6b_connection_metadata_readable',
    has_column_privilege('authenticated', 'public.meta_connections', 'facebook_page_id', 'select')
    and has_column_privilege('authenticated', 'public.meta_connections', 'instagram_account_id', 'select')
  ),
  ('mk6b_credentials_not_browser_readable',
    not has_column_privilege('authenticated', 'public.meta_connections', 'access_token_ciphertext', 'select')
    and not has_column_privilege('authenticated', 'public.meta_connections', 'access_token_iv', 'select')
  ),
  ('mk6b_snapshots_browser_read_only',
    has_table_privilege('authenticated', 'public.meta_performance_snapshots', 'select')
    and not has_table_privilege('authenticated', 'public.meta_performance_snapshots', 'insert, update, delete')
  ),
  ('mk6b_oauth_sessions_server_only',
    not has_table_privilege('authenticated', 'public.meta_oauth_sessions', 'select, insert, update, delete')
  ),
  ('mk6b_service_role_can_manage', (
    select bool_and(
      has_table_privilege('service_role', relation_name, 'select')
      and has_table_privilege('service_role', relation_name, 'insert')
      and has_table_privilege('service_role', relation_name, 'update')
      and has_table_privilege('service_role', relation_name, 'delete')
    )
    from unnest(array[
      'public.meta_connections',
      'public.meta_performance_snapshots',
      'public.meta_oauth_sessions'
    ]) relation_name
  )),
  ('mk6b_token_columns_match_google_pattern', (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_connections'
      and column_name in ('access_token_ciphertext', 'access_token_iv')
      and is_nullable = 'NO'
  )),
  ('mk6b_no_combined_token_envelope', not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_connections'
      and column_name = 'access_token_encrypted'
  )),
  ('mk6b_organic_metrics_schema', (
    select count(*) = 4
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_performance_snapshots'
      and column_name in ('reach', 'impressions', 'engagement', 'spend')
  )),
  ('mk6b_snapshot_idempotency', exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_performance_snapshots'::regclass
      and conname = 'meta_performance_snapshots_daily_unique'
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (meta_connection_id, snapshot_date, platform)'
  )),
  ('mk6b_composite_foreign_keys', (
    select count(*) = 4
    from pg_constraint
    where conname in (
      'meta_connections_brand_fk',
      'meta_connections_registry_fk',
      'meta_performance_snapshots_connection_fk',
      'meta_oauth_sessions_registry_fk'
    ) and contype = 'f'
  ));

select check_name, passed from mk6b_checks order by check_name;

do $$
begin
  if exists (select 1 from mk6b_checks where not passed) then
    raise exception 'One or more MK6b verification checks failed';
  end if;
end
$$;

rollback;
