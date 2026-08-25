select jsonb_build_object(
  'migration', '20260825100000_secure_integration_gateway',
  'tables', jsonb_build_object(
    'integration_connections', to_regclass('public.integration_connections') is not null,
    'integration_events', to_regclass('public.integration_events') is not null
  ),
  'rls', (
    select jsonb_object_agg(relname, relrowsecurity)
    from pg_class
    where oid in (
      'public.integration_connections'::regclass,
      'public.integration_events'::regclass
    )
  ),
  'anon_grants', (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name in ('integration_connections', 'integration_events')
  ),
  'authenticated_write_grants', (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and table_schema = 'public'
      and table_name in ('integration_connections', 'integration_events')
  ),
  'connection_count', (select count(*) from public.integration_connections),
  'event_count', (select count(*) from public.integration_events)
);
