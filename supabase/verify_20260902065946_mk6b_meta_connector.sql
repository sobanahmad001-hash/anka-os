begin;

create temporary table mk6b_checks (check_name text primary key, passed boolean not null);
grant select, insert on mk6b_checks to authenticated;

insert into mk6b_checks values
  ('mk6b_tables_exist', (select count(*) = 3 from unnest(array['public.meta_connections', 'public.meta_performance_snapshots', 'public.meta_oauth_sessions']) name where to_regclass(name) is not null)),
  ('mk6b_rls_enabled', (select bool_and(relrowsecurity) from pg_class where oid = any(array['public.meta_connections'::regclass, 'public.meta_performance_snapshots'::regclass, 'public.meta_oauth_sessions'::regclass))),
  ('mk6b_team_read_policy', (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename in ('meta_connections', 'meta_performance_snapshots') and cmd = 'SELECT' and qual like '%is_team_organization_member(organization_id)%')),
  ('mk6b_credentials_not_browser_readable', not has_table_privilege('authenticated', 'public.meta_connections', 'select')),
  ('mk6b_snapshots_browser_read_only', has_table_privilege('authenticated', 'public.meta_performance_snapshots', 'select') and not has_table_privilege('authenticated', 'public.meta_performance_snapshots', 'insert, update, delete')),
  ('mk6b_token_columns_match_google_pattern', (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'meta_connections' and column_name in ('access_token_ciphertext', 'access_token_iv') and is_nullable = 'NO')),
  ('mk6b_no_combined_token_envelope', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meta_connections' and column_name = 'access_token_encrypted')),
  ('mk6b_organic_metrics_schema', (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'meta_performance_snapshots' and column_name in ('reach', 'impressions', 'engagement', 'spend')),
  ('mk6b_spend_nullable', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meta_performance_snapshots' and column_name = 'spend' and is_nullable = 'YES')),
  ('mk6b_snapshot_idempotency', exists (select 1 from pg_constraint where conrelid = 'public.meta_performance_snapshots'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (meta_connection_id, snapshot_date, platform)'));

select check_name, passed from mk6b_checks order by check_name;
do $$ begin if exists (select 1 from mk6b_checks where not passed) then raise exception 'One or more MK6b verification checks failed'; end if; end $$;
rollback;
