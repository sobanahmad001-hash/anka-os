-- Supplement to N1's synthetic parent fixture; no hosted schema/auth claims.
alter table public.departments add column name text;
update public.departments set name = id;
alter table public.projects add column name text;
update public.projects set name = id::text;
create table public.profiles(id uuid primary key, full_name text not null);
insert into public.organization_memberships
select pg_temp.id('member-'||name),pg_temp.id(org),pg_temp.id(name),role,null,'team',status
from (values ('owner','org-a','system_owner','active'),('ops','org-a','operations_admin','active'),
  ('other-owner','org-b','system_owner','active'),('suspended-owner','org-inactive','system_owner','active'),
  ('revoked-admin','org-a','operations_admin','revoked')) seed(name,org,role,status);
insert into public.profiles select user_id,user_id::text from public.organization_memberships;
insert into public.projects(id,organization_id,name) values(pg_temp.id('foreign-project'),pg_temp.id('org-b'),'Foreign project');
create table private.n1b_parent_memberships as table public.organization_memberships;
create table private.n1b_parent_projects as table public.projects;
create table private.n1b_parent_profiles as table public.profiles;
create table private.n1b_prior_policies as select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies;
create table private.n1b_prior_acl as select oid,relacl from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace);
