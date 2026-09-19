-- Synthetic remaining parents for the real N1-E migration. P7 review/event/request
-- and artifact multi-approver table definitions are loaded from their migrations.
-- Never use this fixture against a shared or linked database.
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users(id uuid primary key);
alter table public.organizations add column settings jsonb not null default '{}'::jsonb;
insert into public.organization_memberships(id,organization_id,user_id,role,department_id,member_kind,status)
values (md5('member-head')::uuid,md5('org-a')::uuid,md5('head')::uuid,'department_manager','design','team','active');
insert into auth.users select distinct user_id from public.organization_memberships;
insert into public.profiles(id,full_name) values(md5('head')::uuid,'head');
insert into public.project_department_participation(organization_id,project_id,department_id,created_by)
values(md5('org-a')::uuid,md5('verified')::uuid,'design',md5('owner')::uuid);

alter table public.projects add column client_id uuid, add column engagement_type text default 'project',
  add column description text default '', add column health text default 'on_track',
  add column status text default 'active', add column start_date date, add column due_date date;
create table public.clients(id uuid primary key,organization_id uuid not null,unique(id,organization_id));
insert into public.clients values(md5('client-a')::uuid,md5('org-a')::uuid);
update public.projects set client_id=md5('client-a')::uuid where id=md5('verified')::uuid;
create table public.workstreams(id uuid primary key,organization_id uuid not null,project_id uuid not null,
  department_id text not null,unique(id,project_id,organization_id));
insert into public.workstreams values(md5('workstream')::uuid,md5('org-a')::uuid,md5('verified')::uuid,'design');
create table public.deliverables(id uuid primary key,organization_id uuid not null,project_id uuid not null,
  workstream_id uuid not null,owner_id uuid not null,status text default 'in_review',
  client_released_version_id uuid,visibility text default 'internal',
  unique(id,project_id,workstream_id,organization_id));
insert into public.deliverables values(md5('deliverable')::uuid,md5('org-a')::uuid,md5('verified')::uuid,
  md5('workstream')::uuid,md5('bob')::uuid,'in_review',null,'internal');
create table public.deliverable_versions(id uuid primary key,organization_id uuid not null,project_id uuid not null,
  deliverable_id uuid not null,version_number integer not null,title text not null,
  change_summary text not null default '',file_id uuid,preview_metadata jsonb not null default '{}',
  review_status text not null,created_by uuid not null,internal_reviewer_id uuid,
  internal_reviewed_at timestamptz,client_released_at timestamptz,
  client_approval_required boolean not null default false,state_version bigint not null default 1,
  unique(id,deliverable_id,project_id,organization_id));
insert into public.deliverable_versions(id,organization_id,project_id,deliverable_id,version_number,title,
  review_status,created_by,internal_reviewer_id,state_version)
values(md5('version')::uuid,md5('org-a')::uuid,md5('verified')::uuid,md5('deliverable')::uuid,
  1,'Approved design','ready_for_client_review',md5('bob')::uuid,md5('owner')::uuid,2);
create table public.approvals(id uuid primary key default gen_random_uuid(),organization_id uuid,
  project_id uuid,deliverable_id uuid,deliverable_version_id uuid,approval_type text,decision text,
  rationale text,checklist_result jsonb,decided_by uuid);
insert into public.approvals(organization_id,project_id,deliverable_id,deliverable_version_id,
  approval_type,decision,decided_by) values(md5('org-a')::uuid,md5('verified')::uuid,
  md5('deliverable')::uuid,md5('version')::uuid,'internal_quality','approved',md5('owner')::uuid);
create table public.client_project_projections(id uuid primary key default gen_random_uuid(),
  organization_id uuid,project_id uuid unique,client_id uuid,project_name text,engagement_type text,
  summary text,health text,status text,start_date date,due_date date,next_action text,withdrawn_at timestamptz);
create table public.client_portal_items(id uuid primary key default gen_random_uuid(),
  organization_id uuid,project_id uuid,source_type text,source_id uuid,item_type text,title text,
  summary text,status text,payload jsonb,released_by uuid,withdrawn_at timestamptz,
  released_at timestamptz default now(),unique(project_id,source_type,source_id));
create table public.client_contacts(id uuid primary key,organization_id uuid,client_id uuid,
  auth_user_id uuid,status text,portal_role text);
create table public.project_client_access(id uuid primary key,organization_id uuid,project_id uuid,
  client_contact_id uuid,status text,access_role text);

-- N1-C's original task fixture has deliberately skeletal artifact tables.
-- Add only the post-OAF2 fields that the real N1-E artifact functions read.
alter table public.artifacts add primary key(id),add constraint n1e_artifact_org unique(id,organization_id),
  add column project_id uuid,add column artifact_type text,add column created_by uuid;
alter table public.artifact_versions add primary key(id),add constraint n1e_artifact_version_org unique(id,organization_id),
  add column created_by uuid;
create table public.artifact_approvals(id uuid primary key default gen_random_uuid(),organization_id uuid,
  artifact_id uuid,artifact_version_id uuid unique,engagement_id uuid,approved_by uuid);
create table public.artifact_version_comments(id uuid primary key default gen_random_uuid(),
  organization_id uuid,artifact_version_id uuid,author_id uuid,body text,
  approval_request_id uuid,request_change_key uuid,comment_position jsonb,
  unique(approval_request_id,author_id,request_change_key));
insert into public.artifacts(id,organization_id,engagement_id,project_id,artifact_type,created_by)
values(md5('artifact')::uuid,md5('org-a')::uuid,md5('eng-1')::uuid,md5('verified')::uuid,
  'design_system',md5('bob')::uuid);
insert into public.artifact_versions(id,organization_id,artifact_id,created_by)
values(md5('artifact-version')::uuid,md5('org-a')::uuid,md5('artifact')::uuid,md5('bob')::uuid);
-- A second approver distinct from the author and designated PM.
insert into public.organization_memberships(id,organization_id,user_id,role,department_id,member_kind,status)
values(md5('member-reviewer')::uuid,md5('org-a')::uuid,md5('reviewer')::uuid,
  'department_manager','design','team','active');
insert into auth.users values(md5('reviewer')::uuid);
insert into public.profiles(id,full_name) values(md5('reviewer')::uuid,'reviewer');
