-- N1-C synthetic parent contract only. Not a full historical replay.
alter table public.profiles add column role text not null default 'member';
alter table public.profiles add column department text;
alter table public.engagements add column brand_id uuid not null default gen_random_uuid();
create table public.tasks(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null default md5('org-a')::uuid,
  project_id uuid not null, workstream_id uuid, department_id text, user_id uuid, created_by uuid,
  assigned_to uuid, assigned_by uuid, title text not null default 'Task', description text not null default '',
  acceptance_criteria text not null default '', completion_evidence text not null default '',
  status text not null default 'backlog', priority text not null default 'medium', due_date date,
  ready_for_review_at timestamptz, completed_at timestamptz, archived_at timestamptz,
  row_version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_items(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid,
  engagement_id uuid not null, brand_id uuid not null, department_id text, title text not null,
  description text not null default '', work_item_type text not null default 'task', priority text not null default 'medium',
  status text not null default 'not_started', assignee_id uuid, created_by uuid not null,
  linked_artifact_id uuid, linked_artifact_version_id uuid, linked_engagement_stage_instance_id uuid,
  start_date date,due_date date,position integer not null default 0,parent_work_item_id uuid,
  created_via text not null default 'manual',deleted_at timestamptz,
  automation_flagged_at timestamptz,automation_flagged_by_rule_id uuid,
  recurring_occurrence_id uuid,recurring_plan_id uuid,recurring_plan_version_id uuid,recurring_template_key text,
  row_version bigint not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.engagement_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid,engagement_id uuid,event_type text,actor_id uuid,
  payload jsonb not null default '{}',occurred_at timestamptz default now()
);
create table public.artifacts(id uuid,organization_id uuid,engagement_id uuid);
create table public.artifact_versions(id uuid,artifact_id uuid,organization_id uuid);
create table public.engagement_stage_instances(id uuid,organization_id uuid,engagement_id uuid);
create table public.automation_rules(id uuid primary key default gen_random_uuid(),organization_id uuid,created_by uuid,
  trigger_type text,enabled boolean,created_at timestamptz default now(),action_type text,action_target_status text);
create table public.design_direction_versions(id uuid,direction_id uuid,organization_id uuid);
create table public.design_directions(id uuid,session_id uuid,organization_id uuid);
create table public.design_workshop_context_versions(session_id uuid,organization_id uuid,artifact_version_id uuid);
alter table public.tasks enable row level security;
create policy fixture_task_read on public.tasks for select to authenticated using(
  exists(select 1 from public.organization_memberships where organization_id=tasks.organization_id and user_id=auth.uid() and status='active' and member_kind='team'));
create policy fixture_task_insert on public.tasks for insert to authenticated with check(
  exists(select 1 from public.organization_memberships where organization_id=tasks.organization_id and user_id=auth.uid() and status='active' and member_kind='team'));
create policy fixture_task_update on public.tasks for update to authenticated using(
  exists(select 1 from public.organization_memberships where organization_id=tasks.organization_id and user_id=auth.uid() and status='active' and member_kind='team'));
alter table public.work_items enable row level security;
create policy fixture_work_item_read on public.work_items for select to authenticated using(
  exists(select 1 from public.organization_memberships where organization_id=work_items.organization_id and user_id=auth.uid() and status='active' and member_kind='team'));
grant select,insert,update on public.tasks to authenticated;
grant select on public.work_items to authenticated;
grant select,insert,update on public.tasks,public.work_items,public.engagement_events to service_role;
grant select on public.profiles,public.artifacts,public.artifact_versions,public.engagement_stage_instances,
  public.automation_rules,public.design_direction_versions,public.design_directions,public.design_workshop_context_versions to service_role;
-- FOR SHARE needs SELECT plus UPDATE privilege on at least one column. These
-- minimal synthetic parent lock privileges are installed-ACL assumptions, not
-- production grants. P5 already locks engagements; N1-C additionally locks scope.
grant update(status) on public.organizations,public.organization_memberships to service_role;
grant update(archived_at) on public.projects to service_role;
grant update(lead_owner_id) on public.engagements to service_role;
-- Clearly synthetic active members: Bob has no PM binding; Alice is the verified
-- N1 PM of project 'verified'. Give Bob a non-authorizing Executive designation.
insert into public.organization_contributor_designations(organization_id,user_id,designation)
values(pg_temp.id('org-a'),pg_temp.id('bob'),'executive');
