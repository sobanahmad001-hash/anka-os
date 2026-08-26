-- Run after migration 20260826135713.

select provider, count(*) as connections
from public.integration_connections
where archived_at is null
group by provider
order by provider;

select
  connection.provider,
  connection.display_name,
  mapping.department_id
from public.integration_connections connection
join public.integration_connection_departments mapping
  on mapping.connection_id = connection.id
where connection.archived_at is null
order by mapping.department_id, connection.provider, connection.display_name;

select
  relname,
  relrowsecurity
from pg_class
where oid = 'public.integration_connection_departments'::regclass;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'integration_connection_departments'
order by grantee, privilege_type;
