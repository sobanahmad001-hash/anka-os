-- Standalone integration fixture for a disposable PostgreSQL database.
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql as
$$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create table projects(id uuid primary key, organization_id uuid, owner_id uuid, archived_at timestamptz);
create table engagements(id int primary key, organization_id uuid, project_id uuid);
create table service_catalog(id int primary key, organization_id uuid, department_id text, slug text);
create table engagement_services(id uuid primary key, organization_id uuid, engagement_id int, service_id int, status text);
create table workstreams(id uuid default gen_random_uuid(), organization_id uuid, project_id uuid, department_id text,
 name text, status text, owner_id uuid, client_visible boolean, started_at timestamptz, created_at timestamptz default now(),
 unique(project_id, department_id, name));
create function public.is_team_organization_member(uuid) returns boolean language sql as
$$ select current_setting('test.member', true) = 'yes' $$;
grant usage on schema auth to authenticated;
grant select on all tables in schema public to authenticated;
grant insert on workstreams to authenticated;
insert into projects values(md5('project')::uuid,md5('org')::uuid,md5('owner')::uuid,null);
insert into engagements values(1,md5('org')::uuid,md5('project')::uuid);
insert into service_catalog values(1,md5('org')::uuid,'design','brand_visual_identity');
insert into engagement_services values(md5('service')::uuid,md5('org')::uuid,1,1,'active');
