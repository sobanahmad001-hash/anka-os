-- Anka Sphere OS - Cover Google OAuth composite foreign keys

begin;

drop index if exists public.idx_integration_oauth_sessions_connection;

create index idx_integration_oauth_sessions_connection_org
  on public.integration_oauth_sessions(connection_id, organization_id);

create index idx_integration_oauth_credentials_connection_org
  on public.integration_oauth_credentials(connection_id, organization_id);

commit;
