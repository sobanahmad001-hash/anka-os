-- Cover N2 foreign-key lookups used by project deletion checks and scope joins.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create index n2_commands_project_org on private.n2_project_commands(project_id,organization_id);
create index n2_requests_converted_project_org on private.n2_project_requests(converted_project_id,organization_id);
create index n2_requests_requester_org on private.n2_project_requests(organization_id,requester_id);
create index n2_scope_events_scope on private.n2_service_scope_events(scope_id);
create index n2_scopes_created_by on public.project_service_scopes(created_by);
create index n2_scopes_engagement_service_org on public.project_service_scopes(engagement_service_id,organization_id);
create index n2_scopes_owner on public.project_service_scopes(owner_id);
create index n2_scopes_project_org on public.project_service_scopes(project_id,organization_id);
create index n2_scopes_service_org on public.project_service_scopes(service_id,organization_id);
commit;
