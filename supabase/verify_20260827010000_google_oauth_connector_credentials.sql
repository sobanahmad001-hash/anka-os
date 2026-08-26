-- Verification: Google OAuth connector credentials

do $$
begin
  if to_regclass('public.integration_oauth_sessions') is null then
    raise exception 'integration_oauth_sessions is missing';
  end if;
  if to_regclass('public.integration_oauth_credentials') is null then
    raise exception 'integration_oauth_credentials is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.integration_oauth_sessions'::regclass) then
    raise exception 'integration_oauth_sessions RLS is disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.integration_oauth_credentials'::regclass) then
    raise exception 'integration_oauth_credentials RLS is disabled';
  end if;
  if has_table_privilege('authenticated', 'public.integration_oauth_sessions', 'select') then
    raise exception 'authenticated can read integration_oauth_sessions';
  end if;
  if has_table_privilege('authenticated', 'public.integration_oauth_credentials', 'select') then
    raise exception 'authenticated can read integration_oauth_credentials';
  end if;
  if not has_table_privilege('service_role', 'public.integration_oauth_sessions', 'select')
    or not has_table_privilege('service_role', 'public.integration_oauth_sessions', 'insert')
    or not has_table_privilege('service_role', 'public.integration_oauth_sessions', 'update')
    or not has_table_privilege('service_role', 'public.integration_oauth_sessions', 'delete') then
    raise exception 'service_role cannot manage integration_oauth_sessions';
  end if;
  if not has_table_privilege('service_role', 'public.integration_oauth_credentials', 'select')
    or not has_table_privilege('service_role', 'public.integration_oauth_credentials', 'insert')
    or not has_table_privilege('service_role', 'public.integration_oauth_credentials', 'update')
    or not has_table_privilege('service_role', 'public.integration_oauth_credentials', 'delete') then
    raise exception 'service_role cannot manage integration_oauth_credentials';
  end if;
end
$$;
