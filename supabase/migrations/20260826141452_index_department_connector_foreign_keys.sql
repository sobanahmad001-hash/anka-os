-- Cover the department connector registry foreign keys used by cascading
-- deletes, department joins, and actor audit lookups.

begin;

create index idx_integration_connection_departments_connection_org
  on public.integration_connection_departments(connection_id, organization_id);

create index idx_integration_connection_departments_department
  on public.integration_connection_departments(department_id);

create index idx_integration_connection_departments_created_by
  on public.integration_connection_departments(created_by);

commit;
