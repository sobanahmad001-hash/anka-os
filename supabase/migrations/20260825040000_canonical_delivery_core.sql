-- Anka Sphere OS - Phase 1 / Migration 4 (20260825040000)
-- Canonical delivery core for the Team OS and sanitized Client Portal.
--
-- Run after:
--   20260825010000_organization_access_foundation.sql
--   20260825020000_security_boundary_hardening.sql
--   20260825030000_guarded_test_data_reset.sql
--
-- Canonical choices:
--   * projects is the engagement table (project, retainer, internal initiative)
--   * tasks is the only task table
--   * workstreams owns department-specific execution
--   * as_* tables remain legacy and receive no new dependencies
--   * clients read sanitized projection rows, never internal delivery tables
--   * reviewed deliverable versions, approvals, snapshots, and audit events
--     are append-only

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Private authorization helpers used by RLS
-- ---------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects project
      where project.id = target_project_id
        and (
          public.is_team_organization_member(project.organization_id)
          or (
            project.portal_visible = true
            and exists (
              select 1
              from public.project_client_access access
              join public.client_contacts contact
                on contact.id = access.client_contact_id
              where access.project_id = project.id
                and access.status = 'active'
                and contact.auth_user_id = (select auth.uid())
                and contact.status = 'active'
            )
          )
        )
    );
$$;

create or replace function private.is_project_client(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects project
      join public.project_client_access access
        on access.project_id = project.id
       and access.status = 'active'
      join public.client_contacts contact
        on contact.id = access.client_contact_id
       and contact.status = 'active'
      where project.id = target_project_id
        and project.portal_visible = true
        and contact.auth_user_id = (select auth.uid())
    );
$$;

revoke all on function private.can_access_project(uuid) from public, anon;
revoke all on function private.is_project_client(uuid) from public, anon;
grant execute on function private.can_access_project(uuid)
  to authenticated, service_role;
grant execute on function private.is_project_client(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Canonical engagement and task strengthening
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists scope_statement text not null default '',
  add column if not exists exclusions text not null default '',
  add column if not exists health text not null default 'unknown',
  add column if not exists archived_at timestamptz;

alter table public.projects
  alter column department_id drop not null,
  drop constraint if exists projects_health_check;

alter table public.projects
  add constraint projects_health_check
  check (health in ('unknown', 'on_track', 'at_risk', 'blocked', 'completed'));

alter table public.tasks
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict,
  add column if not exists workstream_id uuid
    references public.workstreams(id) on delete set null,
  add column if not exists department_id text
    references public.departments(id) on delete set null,
  add column if not exists created_by uuid
    references auth.users(id) on delete set null,
  add column if not exists assigned_by uuid
    references auth.users(id) on delete set null,
  add column if not exists acceptance_criteria text not null default '',
  add column if not exists completion_evidence text not null default '',
  add column if not exists visibility text not null default 'internal_only',
  add column if not exists ready_for_review_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.tasks
  alter column organization_id set default
    '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid;

update public.tasks
set organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
where organization_id is null;

update public.tasks
set created_by = user_id
where created_by is null;

update public.tasks
set department_id = department
where department_id is null
  and department in ('content', 'design', 'development', 'marketing');

alter table public.tasks
  drop constraint if exists tasks_status_check;

update public.tasks
set status = case status
  when 'todo' then 'backlog'
  when 'in_progress' then 'in_progress'
  when 'done' then 'done'
  else 'backlog'
end;

alter table public.tasks
  alter column organization_id set not null,
  drop constraint if exists tasks_department_check,
  drop constraint if exists tasks_visibility_check;

alter table public.tasks
  add constraint tasks_status_check
  check (status in (
    'backlog',
    'ready',
    'in_progress',
    'blocked',
    'ready_for_review',
    'changes_required',
    'done',
    'cancelled'
  )),
  add constraint tasks_department_check
  check (
    department is null
    or department in ('content', 'design', 'development', 'marketing')
  ),
  add constraint tasks_visibility_check
  check (visibility in ('internal_only', 'client_visible', 'client_restricted'));

create index if not exists idx_tasks_organization_status
  on public.tasks(organization_id, status, due_date);
create index if not exists idx_tasks_workstream_status
  on public.tasks(workstream_id, status, due_date)
  where workstream_id is not null;
create index if not exists idx_tasks_assignee_status
  on public.tasks(assigned_to, status, due_date)
  where assigned_to is not null;

-- ---------------------------------------------------------------------------
-- 3. Reusable workflows and activated stages
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  name text not null,
  slug text not null,
  description text not null default '',
  template_kind text not null default 'general'
    check (template_kind in (
      'general', 'branding', 'website_delivery', 'content', 'design', 'marketing'
    )),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, slug, version)
);

create table if not exists public.workflow_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  workflow_template_id uuid not null
    references public.workflow_templates(id) on delete cascade,
  department_id text references public.departments(id) on delete set null,
  name text not null,
  stage_key text not null,
  position integer not null check (position >= 0),
  instructions text not null default '',
  entry_criteria jsonb not null default '[]'::jsonb,
  exit_criteria jsonb not null default '[]'::jsonb,
  requires_internal_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_template_id, stage_key),
  unique (workflow_template_id, position)
);

create table if not exists public.project_workflow_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  workstream_id uuid references public.workstreams(id) on delete cascade,
  workflow_template_id uuid not null
    references public.workflow_templates(id) on delete restrict,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, workstream_id, workflow_template_id)
);

alter table public.tasks
  add column if not exists workflow_stage_id uuid
    references public.workflow_stages(id) on delete set null;

create index if not exists idx_workflow_templates_organization
  on public.workflow_templates(organization_id, is_active, template_kind);
create index if not exists idx_workflow_stages_template
  on public.workflow_stages(workflow_template_id, position);
create index if not exists idx_project_workflow_templates_project
  on public.project_workflow_templates(project_id, workstream_id);

-- ---------------------------------------------------------------------------
-- 4. Dependencies and milestones
-- ---------------------------------------------------------------------------

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  dependency_type text not null default 'finish_to_start'
    check (dependency_type in (
      'finish_to_start', 'start_to_start', 'approval', 'external_blocker'
    )),
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id, dependency_type),
  check (task_id <> depends_on_task_id)
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'at_risk', 'completed', 'cancelled')),
  visibility text not null default 'internal_only'
    check (visibility in ('internal_only', 'client_visible', 'client_restricted')),
  owner_id uuid references auth.users(id) on delete set null,
  target_date date,
  completed_at timestamptz,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists idx_task_dependencies_task
  on public.task_dependencies(task_id);
create index if not exists idx_task_dependencies_upstream
  on public.task_dependencies(depends_on_task_id);
create index if not exists idx_milestones_project
  on public.milestones(project_id, status, target_date);

-- ---------------------------------------------------------------------------
-- 5. Deliverables, immutable versions, and human approvals
-- ---------------------------------------------------------------------------

create table if not exists public.deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete restrict,
  milestone_id uuid references public.milestones(id) on delete set null,
  title text not null,
  description text not null default '',
  deliverable_type text not null default 'general',
  status text not null default 'in_production'
    check (status in (
      'in_production', 'in_review', 'client_reviewing', 'revision_requested',
      'client_approved', 'delivered_published', 'withdrawn', 'archived'
    )),
  visibility text not null default 'internal_only'
    check (visibility in ('internal_only', 'client_visible', 'client_restricted')),
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum text,
  visibility text not null default 'internal_only'
    check (visibility in ('internal_only', 'client_visible', 'client_restricted')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (storage_bucket, storage_path)
);

create table if not exists public.deliverable_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  deliverable_id uuid not null references public.deliverables(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  title text not null,
  change_summary text not null default '',
  file_id uuid references public.files(id) on delete restrict,
  preview_metadata jsonb not null default '{}'::jsonb,
  review_status text not null default 'in_production'
    check (review_status in (
      'in_production',
      'ready_for_internal_review',
      'changes_required',
      'ready_for_client_review',
      'client_reviewing',
      'revision_requested',
      'client_approved',
      'delivered_published',
      'superseded'
    )),
  created_by uuid references auth.users(id) on delete set null,
  internal_reviewer_id uuid references auth.users(id) on delete set null,
  internal_reviewed_at timestamptz,
  client_released_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deliverable_id, version_number)
);

alter table public.deliverables
  add column if not exists current_version_id uuid,
  add column if not exists client_released_version_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deliverables_current_version_id_fkey'
      and conrelid = 'public.deliverables'::regclass
  ) then
    alter table public.deliverables
      add constraint deliverables_current_version_id_fkey
      foreign key (current_version_id)
      references public.deliverable_versions(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'deliverables_client_released_version_id_fkey'
      and conrelid = 'public.deliverables'::regclass
  ) then
    alter table public.deliverables
      add constraint deliverables_client_released_version_id_fkey
      foreign key (client_released_version_id)
      references public.deliverable_versions(id)
      on delete restrict;
  end if;
end
$$;

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  deliverable_id uuid not null references public.deliverables(id) on delete restrict,
  deliverable_version_id uuid not null
    references public.deliverable_versions(id) on delete restrict,
  approval_type text not null
    check (approval_type in ('internal_quality', 'client_approval', 'release', 'withdrawal')),
  decision text not null
    check (decision in ('approved', 'changes_required', 'withdrawn')),
  rationale text not null default '',
  checklist_result jsonb not null default '{}'::jsonb,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);

create index if not exists idx_deliverables_project
  on public.deliverables(project_id, status, due_date);
create index if not exists idx_deliverables_workstream
  on public.deliverables(workstream_id, status);
create index if not exists idx_deliverable_versions_deliverable
  on public.deliverable_versions(deliverable_id, version_number desc);
create index if not exists idx_files_project
  on public.files(project_id, created_at desc);
create index if not exists idx_approvals_version
  on public.approvals(deliverable_version_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- 6. Requests, revisions, research, and contextual comments
-- ---------------------------------------------------------------------------

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  requesting_workstream_id uuid references public.workstreams(id) on delete set null,
  receiving_workstream_id uuid references public.workstreams(id) on delete set null,
  request_type text not null
    check (request_type in (
      'internal_handoff', 'client_input', 'client_work', 'revision', 'change'
    )),
  request_origin text not null
    check (request_origin in ('team', 'client')),
  title text not null,
  requested_output text not null,
  acceptance_criteria text not null default '',
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'submitted'
    check (status in (
      'draft', 'submitted', 'triaged', 'accepted', 'in_progress',
      'blocked', 'ready_for_review', 'completed', 'declined', 'withdrawn'
    )),
  visibility text not null default 'internal_only'
    check (visibility in ('internal_only', 'client_visible', 'client_restricted')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete set null,
  target_deliverable_version_id uuid
    references public.deliverable_versions(id) on delete restrict,
  required_by date,
  triage_classification text
    check (triage_classification is null or triage_classification in (
      'clarification', 'included_revision', 'defect_correction', 'scope_change'
    )),
  resolution text not null default '',
  completion_evidence text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz
);

create table if not exists public.research_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  workstream_id uuid references public.workstreams(id) on delete set null,
  research_type text not null,
  title text not null,
  question text not null default '',
  findings text not null default '',
  recommendation text not null default '',
  sources jsonb not null default '[]'::jsonb,
  confidence text not null default 'unrated'
    check (confidence in ('unrated', 'low', 'medium', 'high')),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'superseded', 'archived')),
  visibility text not null default 'internal_only'
    check (visibility in ('internal_only', 'client_visible', 'client_restricted')),
  owner_id uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.comments
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict,
  add column if not exists project_id uuid
    references public.projects(id) on delete cascade,
  add column if not exists visibility text not null default 'internal_only',
  add column if not exists parent_comment_id uuid
    references public.comments(id) on delete set null,
  add column if not exists client_contact_id uuid
    references public.client_contacts(id) on delete set null;

alter table public.comments
  alter column organization_id set default
    '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid;

update public.comments
set organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
where organization_id is null;

alter table public.comments
  alter column organization_id set not null,
  drop constraint if exists comments_entity_type_check,
  drop constraint if exists comments_visibility_check;

alter table public.comments
  add constraint comments_entity_type_check
  check (entity_type in (
    'project', 'task', 'request', 'deliverable', 'deliverable_version',
    'research_record', 'milestone', 'campaign', 'content_item'
  )),
  add constraint comments_visibility_check
  check (visibility in ('internal_only', 'client_shared'));

create index if not exists idx_requests_project
  on public.requests(project_id, status, required_by);
create index if not exists idx_requests_owner
  on public.requests(owner_id, status, required_by)
  where owner_id is not null;
create index if not exists idx_requests_target_version
  on public.requests(target_deliverable_version_id)
  where target_deliverable_version_id is not null;
create index if not exists idx_research_records_project
  on public.research_records(project_id, status, research_type);
create index if not exists idx_research_records_workstream
  on public.research_records(workstream_id, status)
  where workstream_id is not null;
create index if not exists idx_comments_project
  on public.comments(project_id, created_at desc)
  where project_id is not null;

-- ---------------------------------------------------------------------------
-- 7. Immutable activity and automatic Living Project Record
-- ---------------------------------------------------------------------------

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  visibility text not null default 'internal_only'
    check (visibility in ('internal_only', 'client_visible', 'client_restricted')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.living_project_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  internal_projection jsonb not null default '{}'::jsonb,
  client_projection jsonb not null default '{}'::jsonb,
  source_version bigint not null default 1 check (source_version > 0),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.living_project_document_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  living_project_document_id uuid not null
    references public.living_project_documents(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  projection_kind text not null
    check (projection_kind in ('internal', 'client')),
  source_version bigint not null check (source_version > 0),
  snapshot jsonb not null,
  reason text not null,
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (living_project_document_id, projection_kind, source_version)
);

create index if not exists idx_activity_events_project
  on public.activity_events(project_id, occurred_at desc)
  where project_id is not null;
create index if not exists idx_living_project_snapshots_project
  on public.living_project_document_snapshots(project_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- 8. Sanitized client portal read models
-- ---------------------------------------------------------------------------

create table if not exists public.client_project_projections (
  project_id uuid primary key references public.projects(id) on delete cascade,
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_name text not null,
  engagement_type text not null
    check (engagement_type in ('project', 'retainer', 'internal')),
  summary text not null default '',
  health text not null default 'unknown'
    check (health in ('unknown', 'on_track', 'at_risk', 'blocked', 'completed')),
  status text not null,
  start_date date,
  due_date date,
  next_action text not null default '',
  released_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table if not exists public.client_portal_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null
    check (source_type in (
      'workstream', 'milestone', 'deliverable_version', 'report',
      'activity_event', 'living_project_document'
    )),
  source_id uuid not null,
  item_type text not null,
  title text not null,
  summary text not null default '',
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  released_by uuid not null references auth.users(id) on delete restrict,
  released_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  check (not (payload ?| array[
    'internal_notes', 'ai_prompt', 'provider_prompt', 'cost', 'storage_path'
  ])),
  unique (project_id, source_type, source_id)
);

create index if not exists idx_client_project_projections_client
  on public.client_project_projections(client_id, status)
  where withdrawn_at is null;
create index if not exists idx_client_portal_items_project
  on public.client_portal_items(project_id, item_type, released_at desc)
  where withdrawn_at is null;

-- ---------------------------------------------------------------------------
-- 9. Server-enforced state transitions and immutability
-- ---------------------------------------------------------------------------

create or replace function private.enforce_task_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'backlog' and new.status in ('ready', 'cancelled'))
    or (old.status = 'ready' and new.status in ('backlog', 'in_progress', 'blocked', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('backlog', 'blocked', 'ready_for_review', 'cancelled'))
    or (old.status = 'blocked' and new.status in ('ready', 'in_progress', 'cancelled'))
    or (old.status = 'ready_for_review' and new.status in ('in_progress', 'changes_required', 'done'))
    or (old.status = 'changes_required' and new.status in ('in_progress', 'ready_for_review', 'cancelled'))
    or (old.status = 'done' and new.status = 'in_progress')
    or (old.status = 'cancelled' and new.status = 'backlog')
  ) then
    raise exception 'Invalid task status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'ready_for_review' and old.status <> 'ready_for_review' then
    new.ready_for_review_at = now();
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at = now();
  elsif old.status = 'done' and new.status <> 'done' then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

create or replace function private.enforce_deliverable_version_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  client_approvals_enabled boolean;
begin
  if old.review_status <> 'in_production' and (
    new.version_number is distinct from old.version_number
    or new.title is distinct from old.title
    or new.change_summary is distinct from old.change_summary
    or new.file_id is distinct from old.file_id
    or new.preview_metadata is distinct from old.preview_metadata
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'Reviewed deliverable versions are immutable; create a new version.'
      using errcode = 'check_violation';
  end if;

  if new.review_status = old.review_status then
    return new;
  end if;

  if not (
    (old.review_status = 'in_production' and new.review_status = 'ready_for_internal_review')
    or (old.review_status = 'ready_for_internal_review' and new.review_status in ('changes_required', 'ready_for_client_review'))
    or (old.review_status = 'changes_required' and new.review_status = 'in_production')
    or (old.review_status = 'ready_for_client_review' and new.review_status = 'client_reviewing')
    or (old.review_status = 'client_reviewing' and new.review_status in ('revision_requested', 'client_approved', 'superseded'))
    or (old.review_status = 'revision_requested' and new.review_status = 'superseded')
    or (old.review_status = 'client_approved' and new.review_status in ('delivered_published', 'superseded'))
    or (old.review_status = 'delivered_published' and new.review_status = 'superseded')
  ) then
    raise exception 'Invalid deliverable version transition: % -> %',
      old.review_status, new.review_status
      using errcode = 'check_violation';
  end if;

  if new.review_status = 'client_approved' then
    select coalesce(
      (organization.settings ->> 'client_approvals_enabled')::boolean,
      false
    )
    into client_approvals_enabled
    from public.organizations organization
    where organization.id = new.organization_id;

    if client_approvals_enabled is not true then
      raise exception 'Client approvals are disabled for this organization.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.review_status = 'ready_for_client_review' then
    if not exists (
      select 1
      from public.approvals approval
      where approval.deliverable_version_id = new.id
        and approval.approval_type = 'internal_quality'
        and approval.decision = 'approved'
    ) then
      raise exception 'An approved internal quality decision is required for this exact version.'
        using errcode = 'check_violation';
    end if;

    select approval.decided_by, approval.decided_at
    into new.internal_reviewer_id, new.internal_reviewed_at
    from public.approvals approval
    where approval.deliverable_version_id = new.id
      and approval.approval_type = 'internal_quality'
      and approval.decision = 'approved'
    order by approval.decided_at desc
    limit 1;
  elsif new.review_status = 'client_reviewing' then
    if new.internal_reviewed_at is null then
      raise exception 'Internal review must pass before client release.'
        using errcode = 'check_violation';
    end if;

    if not exists (
      select 1
      from public.client_portal_items portal_item
      where portal_item.project_id = new.project_id
        and portal_item.source_type = 'deliverable_version'
        and portal_item.source_id = new.id
        and portal_item.withdrawn_at is null
    ) then
      raise exception 'The exact version must be released to the sanitized portal projection first.'
        using errcode = 'check_violation';
    end if;

    new.client_released_at = coalesce(new.client_released_at, now());
  end if;

  return new;
end;
$$;

create or replace function private.create_living_project_document()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.living_project_documents (
    organization_id,
    project_id,
    internal_projection,
    client_projection
  ) values (
    new.organization_id,
    new.id,
    jsonb_build_object(
      'identity', jsonb_build_object(
        'project_id', new.id,
        'name', new.name,
        'engagement_type', new.engagement_type
      )
    ),
    '{}'::jsonb
  )
  on conflict (project_id) do nothing;

  return new;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.enforce_task_status_transition()
  from public, anon, authenticated;
revoke all on function private.enforce_deliverable_version_transition()
  from public, anon, authenticated;
revoke all on function private.create_living_project_document()
  from public, anon, authenticated;
revoke all on function private.touch_updated_at()
  from public, anon, authenticated;
grant execute on function private.enforce_task_status_transition()
  to service_role;
grant execute on function private.enforce_deliverable_version_transition()
  to service_role;
grant execute on function private.create_living_project_document()
  to service_role;
grant execute on function private.touch_updated_at()
  to service_role;

drop trigger if exists trg_enforce_task_status_transition on public.tasks;
create trigger trg_enforce_task_status_transition
before update of status on public.tasks
for each row execute function private.enforce_task_status_transition();

drop trigger if exists trg_enforce_deliverable_version_transition
  on public.deliverable_versions;
create trigger trg_enforce_deliverable_version_transition
before update on public.deliverable_versions
for each row execute function private.enforce_deliverable_version_transition();

drop trigger if exists trg_create_living_project_document on public.projects;
create trigger trg_create_living_project_document
after insert on public.projects
for each row execute function private.create_living_project_document();

drop trigger if exists trg_touch_workflow_templates on public.workflow_templates;
create trigger trg_touch_workflow_templates
before update on public.workflow_templates
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_workflow_stages on public.workflow_stages;
create trigger trg_touch_workflow_stages
before update on public.workflow_stages
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_milestones on public.milestones;
create trigger trg_touch_milestones
before update on public.milestones
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_deliverables on public.deliverables;
create trigger trg_touch_deliverables
before update on public.deliverables
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_requests on public.requests;
create trigger trg_touch_requests
before update on public.requests
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_research_records on public.research_records;
create trigger trg_touch_research_records
before update on public.research_records
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_living_project_documents
  on public.living_project_documents;
create trigger trg_touch_living_project_documents
before update on public.living_project_documents
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_client_project_projections
  on public.client_project_projections;
create trigger trg_touch_client_project_projections
before update on public.client_project_projections
for each row execute function private.touch_updated_at();

drop trigger if exists trg_touch_client_portal_items
  on public.client_portal_items;
create trigger trg_touch_client_portal_items
before update on public.client_portal_items
for each row execute function private.touch_updated_at();

insert into public.living_project_documents (
  organization_id,
  project_id,
  internal_projection,
  client_projection
)
select
  project.organization_id,
  project.id,
  jsonb_build_object(
    'identity', jsonb_build_object(
      'project_id', project.id,
      'name', project.name,
      'engagement_type', project.engagement_type
    )
  ),
  '{}'::jsonb
from public.projects project
on conflict (project_id) do nothing;

-- ---------------------------------------------------------------------------
-- 10. RLS: internal delivery tables are team-only
-- ---------------------------------------------------------------------------

alter table public.workflow_templates enable row level security;
alter table public.workflow_stages enable row level security;
alter table public.project_workflow_templates enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.milestones enable row level security;
alter table public.deliverables enable row level security;
alter table public.files enable row level security;
alter table public.deliverable_versions enable row level security;
alter table public.approvals enable row level security;
alter table public.requests enable row level security;
alter table public.research_records enable row level security;
alter table public.activity_events enable row level security;
alter table public.living_project_documents enable row level security;
alter table public.living_project_document_snapshots enable row level security;
alter table public.client_project_projections enable row level security;
alter table public.client_portal_items enable row level security;

-- Replace broad legacy policies on canonical roots.
drop policy if exists "Users can read department projects" on public.projects;
drop policy if exists "Leads can create projects" on public.projects;
drop policy if exists "Authorized users can update projects" on public.projects;
drop policy if exists "Admins can delete projects" on public.projects;

create policy "Team can read projects"
  on public.projects for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can create projects"
  on public.projects for insert to authenticated
  with check (public.is_team_organization_member(organization_id));
create policy "Team can update projects"
  on public.projects for update to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
drop policy if exists "Users can manage own tasks" on public.tasks;
drop policy if exists "Admin full access to tasks" on public.tasks;
drop policy if exists "Head manages department tasks" on public.tasks;
drop policy if exists "Users can read own and assigned tasks" on public.tasks;
drop policy if exists "Users can create own tasks" on public.tasks;
drop policy if exists "Users can update own and assigned tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;

create policy "Team can read tasks"
  on public.tasks for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can create tasks"
  on public.tasks for insert to authenticated
  with check (public.is_team_organization_member(organization_id));
create policy "Team can update tasks"
  on public.tasks for update to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
drop policy if exists "Authenticated users can read clients" on public.clients;
drop policy if exists "Leads can manage clients" on public.clients;
create policy "Team can read clients"
  on public.clients for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can manage clients"
  on public.clients for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));

drop policy if exists "Authorized clients can read released workstreams"
  on public.workstreams;

-- Reusable team-only policy pattern on new canonical tables.
create policy "Team can manage workflow templates"
  on public.workflow_templates for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage workflow stages"
  on public.workflow_stages for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage project workflows"
  on public.project_workflow_templates for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage task dependencies"
  on public.task_dependencies for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage milestones"
  on public.milestones for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage deliverables"
  on public.deliverables for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage files"
  on public.files for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage deliverable versions"
  on public.deliverable_versions for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can read approvals"
  on public.approvals for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can record approvals"
  on public.approvals for insert to authenticated
  with check (
    public.is_team_organization_member(organization_id)
    and decided_by = (select auth.uid())
    and approval_type <> 'client_approval'
    and public.has_organization_role(
      organization_id,
      array[
        'system_owner',
        'operations_admin',
        'executive',
        'department_manager',
        'project_owner'
      ]
    )
  );
create policy "Team can manage research"
  on public.research_records for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can read activity events"
  on public.activity_events for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can record activity events"
  on public.activity_events for insert to authenticated
  with check (
    public.is_team_organization_member(organization_id)
    and (actor_id is null or actor_id = (select auth.uid()))
  );
create policy "Team can manage living project documents"
  on public.living_project_documents for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can read living project snapshots"
  on public.living_project_document_snapshots for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can create living project snapshots"
  on public.living_project_document_snapshots for insert to authenticated
  with check (public.is_team_organization_member(organization_id));

-- Requests are intentionally safe collaboration records. Clients may create a
-- revision only against an exact version already released in their portal.
create policy "Team can manage requests"
  on public.requests for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Clients can read shared requests"
  on public.requests for select to authenticated
  using (
    visibility in ('client_visible', 'client_restricted')
    and private.is_project_client(project_id)
  );
create policy "Clients can submit revision requests"
  on public.requests for insert to authenticated
  with check (
    request_origin = 'client'
    and request_type in ('revision', 'client_work')
    and requested_by = (select auth.uid())
    and visibility = 'client_visible'
    and private.is_project_client(project_id)
    and target_deliverable_version_id is not null
    and exists (
      select 1
      from public.client_portal_items portal_item
      where portal_item.project_id = requests.project_id
        and portal_item.source_type = 'deliverable_version'
        and portal_item.source_id = requests.target_deliverable_version_id
        and portal_item.withdrawn_at is null
    )
  );

-- Contextual comments replace broad authenticated access on the legacy table.
drop policy if exists "Authenticated users can read comments" on public.comments;
drop policy if exists "Users can create comments" on public.comments;
drop policy if exists "Owner can update own comments" on public.comments;
drop policy if exists "Owner can delete own comments" on public.comments;
create policy "Team can manage comments"
  on public.comments for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Clients can read shared comments"
  on public.comments for select to authenticated
  using (
    visibility = 'client_shared'
    and project_id is not null
    and private.is_project_client(project_id)
  );
create policy "Clients can create shared comments"
  on public.comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and visibility = 'client_shared'
    and project_id is not null
    and private.is_project_client(project_id)
  );
create policy "Clients can edit own shared comments"
  on public.comments for update to authenticated
  using (
    user_id = (select auth.uid())
    and visibility = 'client_shared'
    and project_id is not null
    and private.is_project_client(project_id)
  )
  with check (
    user_id = (select auth.uid())
    and visibility = 'client_shared'
    and project_id is not null
    and private.is_project_client(project_id)
  );

-- Only sanitized read models are directly readable by clients.
create policy "Team can manage client project projections"
  on public.client_project_projections for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Clients can read project projections"
  on public.client_project_projections for select to authenticated
  using (
    withdrawn_at is null
    and private.is_project_client(project_id)
  );
create policy "Team can manage client portal items"
  on public.client_portal_items for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (
    public.is_team_organization_member(organization_id)
    and (
      source_type <> 'deliverable_version'
      or exists (
        select 1
        from public.deliverable_versions version
        where version.id = client_portal_items.source_id
          and version.project_id = client_portal_items.project_id
          and version.review_status in (
            'ready_for_client_review',
            'client_reviewing',
            'client_approved',
            'delivered_published'
          )
          and exists (
            select 1
            from public.approvals approval
            where approval.deliverable_version_id = version.id
              and approval.approval_type = 'internal_quality'
              and approval.decision = 'approved'
          )
      )
    )
  );
create policy "Clients can read released portal items"
  on public.client_portal_items for select to authenticated
  using (
    withdrawn_at is null
    and private.is_project_client(project_id)
  );

-- ---------------------------------------------------------------------------
-- 11. Explicit Data API grants (RLS remains the row-level authority)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

revoke delete on
  public.projects,
  public.clients,
  public.tasks,
  public.workstreams,
  public.workflow_templates,
  public.workflow_stages,
  public.project_workflow_templates,
  public.task_dependencies,
  public.milestones,
  public.deliverables,
  public.files,
  public.deliverable_versions,
  public.requests,
  public.research_records,
  public.comments,
  public.living_project_documents,
  public.client_project_projections,
  public.client_portal_items
from authenticated;

grant select, insert, update on
  public.projects,
  public.clients,
  public.tasks,
  public.workstreams,
  public.workflow_templates,
  public.workflow_stages,
  public.project_workflow_templates,
  public.milestones,
  public.deliverables,
  public.files,
  public.deliverable_versions,
  public.requests,
  public.research_records,
  public.comments,
  public.living_project_documents,
  public.client_project_projections,
  public.client_portal_items
to authenticated;

grant select, insert, delete on public.task_dependencies to authenticated;

grant select, insert on
  public.approvals,
  public.activity_events,
  public.living_project_document_snapshots
to authenticated;

grant all on
  public.workflow_templates,
  public.workflow_stages,
  public.project_workflow_templates,
  public.task_dependencies,
  public.milestones,
  public.deliverables,
  public.files,
  public.deliverable_versions,
  public.approvals,
  public.requests,
  public.research_records,
  public.activity_events,
  public.living_project_documents,
  public.living_project_document_snapshots,
  public.client_project_projections,
  public.client_portal_items
to service_role;

commit;
