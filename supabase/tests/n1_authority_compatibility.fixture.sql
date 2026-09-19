-- Isolated local fixture only. Never run against a linked/shared database.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
grant usage on schema public, auth, private to authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function pg_temp.id(text) returns uuid language sql immutable as $$ select md5($1)::uuid $$;
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'N1 assertion failed: %', label; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'Expected %, got %: %', expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'Expected error %, but statement succeeded: %', expected_state, statement;
end $$;

create table public.organizations(id uuid primary key, status text not null);
create table public.departments(id text primary key, organization_id uuid not null references public.organizations);
create table public.organization_memberships(
  id uuid primary key, organization_id uuid not null references public.organizations,
  user_id uuid not null, role text not null, department_id text references public.departments,
  member_kind text not null, status text not null, unique(organization_id,user_id)
);
create table public.projects(
  id uuid primary key, organization_id uuid not null references public.organizations,
  owner_id uuid, archived_at timestamptz, unique(id,organization_id)
);
create table public.engagements(id uuid primary key, project_id uuid unique references public.projects,
  organization_id uuid not null references public.organizations, lead_owner_id uuid);

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
create policy fixture_own_membership on public.organization_memberships for select to authenticated using(user_id=auth.uid());
create policy fixture_own_organization on public.organizations for select to authenticated using(exists(
  select 1 from public.organization_memberships m where m.organization_id=organizations.id and m.user_id=auth.uid()
));
grant select on public.organizations,public.organization_memberships to authenticated;
grant all on all tables in schema public to service_role;

insert into public.organizations values(pg_temp.id('org-a'),'active'),(pg_temp.id('org-b'),'active'),(pg_temp.id('org-inactive'),'suspended');
insert into public.departments values('design',pg_temp.id('org-a')),('content',pg_temp.id('org-a')),('foreign',pg_temp.id('org-b'));
insert into public.organization_memberships
select pg_temp.id('member-'||name),pg_temp.id(org),pg_temp.id(name),role,department,kind,status
from (values
  ('alice','org-a','contributor','design','team','active'),
  ('bob','org-a','contributor','content','team','active'),
  ('elevated','org-a','executive','design','team','active'),
  ('title-only','org-a','project_owner','design','team','active'),
  ('revoked','org-a','contributor','design','team','revoked'),
  ('client','org-a','client_viewer',null,'client','active'),
  ('foreign','org-b','contributor','foreign','team','active'),
  ('bad-dept','org-a','department_manager','foreign','team','active'),
  ('inactive-org','org-inactive','contributor',null,'team','active')
) seed(name,org,role,department,kind,status);
insert into public.projects
select pg_temp.id(name),pg_temp.id('org-a'),case when owner is null then null else pg_temp.id(owner) end,
  case when archived then now() else null end
from (values ('verified','alice',false),('verified-2','elevated',false),('conflict','alice',false),
  ('revoked-owner','revoked',false),('foreign-owner','foreign',false),('no-owner',null,false),('archived','alice',true)) seed(name,owner,archived);
insert into public.engagements values
  (pg_temp.id('eng-1'),pg_temp.id('verified'),pg_temp.id('org-a'),pg_temp.id('alice')),
  (pg_temp.id('eng-2'),pg_temp.id('conflict'),pg_temp.id('org-a'),pg_temp.id('bob'));

create table private.fixture_legacy_memberships as table public.organization_memberships;
create table private.fixture_legacy_projects as table public.projects;
create table private.fixture_legacy_policies as select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public';
create table private.fixture_legacy_grants as select oid,relacl from pg_class where oid in (
  'public.organizations'::regclass,'public.organization_memberships'::regclass,'public.projects'::regclass,'public.departments'::regclass
);
