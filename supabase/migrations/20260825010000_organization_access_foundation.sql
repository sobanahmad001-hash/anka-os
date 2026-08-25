-- Anka Sphere OS - Phase 1 / Migration 1 (20260825010000)
-- Organization, membership, workstream, and client-visibility foundation.
--
-- Safety properties:
--   * additive; no table or row is deleted
--   * existing generic and as_* records remain in place
--   * current application identifiers remain compatible
--   * formal client approval remains disabled at the database boundary
--   * unreleased legacy work becomes internal-only by default

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Single-tenant organization root
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organizations (id, name, slug)
values (
  '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid,
  'Anka Sphere',
  'anka-sphere'
)
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug;

-- ---------------------------------------------------------------------------
-- 2. Approved operational environments
-- ---------------------------------------------------------------------------

alter table public.departments
  add column if not exists organization_id uuid;

update public.departments
set organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
where organization_id is null;

alter table public.departments
  alter column organization_id set default
    '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid;

alter table public.departments
  alter column organization_id set not null;

alter table public.departments
  drop constraint if exists departments_id_check;

alter table public.departments
  add constraint departments_id_check
  check (id in ('content', 'design', 'development', 'marketing'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'departments_organization_id_fkey'
      and conrelid = 'public.departments'::regclass
  ) then
    alter table public.departments
      add constraint departments_organization_id_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete restrict;
  end if;
end
$$;

insert into public.departments (
  id,
  name,
  description,
  color,
  icon,
  organization_id
)
values (
  'content',
  'Content',
  'Content strategy, research, writing, editing, and publishing handoff.',
  '#d97706',
  'C',
  '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
)
on conflict (id) do update
set organization_id = excluded.organization_id;

update public.departments
set name = 'Delivery & Development'
where id = 'development';

-- ---------------------------------------------------------------------------
-- 3. Organization memberships and authorization helpers
-- ---------------------------------------------------------------------------

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  member_kind text not null default 'team'
    check (member_kind in ('team', 'client')),
  role text not null default 'contributor'
    check (role in (
      'system_owner',
      'operations_admin',
      'executive',
      'department_manager',
      'project_owner',
      'contributor',
      'client_admin',
      'client_approver',
      'client_collaborator',
      'client_viewer'
    )),
  department_id text references public.departments(id) on delete set null,
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

with ranked_profiles as (
  select
    p.id,
    p.department,
    p.role,
    row_number() over (
      order by (p.role = 'admin') desc, p.created_at, p.id
    ) as authority_rank
  from public.profiles p
)
insert into public.organization_memberships (
  organization_id,
  user_id,
  member_kind,
  role,
  department_id,
  status
)
select
  '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid,
  rp.id,
  'team',
  case
    when rp.authority_rank = 1 then 'system_owner'
    when rp.role = 'admin' then 'operations_admin'
    when rp.role = 'executive' then 'executive'
    when rp.role = 'department_head' then 'department_manager'
    else 'contributor'
  end,
  case
    when rp.department in ('content', 'design', 'development', 'marketing')
      then rp.department
    else null
  end,
  'active'
from ranked_profiles rp
on conflict (organization_id, user_id) do nothing;

create index if not exists idx_organization_memberships_user
  on public.organization_memberships(user_id, status);

create index if not exists idx_organization_memberships_department
  on public.organization_memberships(organization_id, department_id, status);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function public.is_team_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.member_kind = 'team'
      and membership.status = 'active'
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.is_team_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, text[]) from public;

grant execute on function public.is_organization_member(uuid)
  to authenticated, service_role;
grant execute on function public.is_team_organization_member(uuid)
  to authenticated, service_role;
grant execute on function public.has_organization_role(uuid, text[])
  to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

drop policy if exists "Organization members can read organization" on public.organizations;
create policy "Organization members can read organization"
  on public.organizations
  for select
  to authenticated
  using (public.is_organization_member(id));

drop policy if exists "Organization owners can manage organization" on public.organizations;
create policy "Organization owners can manage organization"
  on public.organizations
  for all
  to authenticated
  using (public.has_organization_role(id, array['system_owner', 'operations_admin']))
  with check (public.has_organization_role(id, array['system_owner', 'operations_admin']));

drop policy if exists "Members can read permitted memberships" on public.organization_memberships;
create policy "Members can read permitted memberships"
  on public.organization_memberships
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.has_organization_role(
      organization_id,
      array['system_owner', 'operations_admin', 'executive', 'department_manager']
    )
  );

drop policy if exists "Organization owners can manage memberships" on public.organization_memberships;
create policy "Organization owners can manage memberships"
  on public.organization_memberships
  for all
  to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['system_owner', 'operations_admin']
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['system_owner', 'operations_admin']
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Canonical organization links on existing generic records
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

alter table public.clients
  alter column organization_id set default
    '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid;

update public.clients
set organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
where organization_id is null;

alter table public.clients
  alter column organization_id set not null;

alter table public.projects
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict,
  add column if not exists client_id uuid
    references public.clients(id) on delete set null,
  add column if not exists engagement_type text not null default 'project'
    check (engagement_type in ('project', 'retainer', 'internal')),
  add column if not exists client_summary text not null default '',
  add column if not exists portal_visible boolean not null default false;

alter table public.projects
  alter column organization_id set default
    '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid;

update public.projects
set organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
where organization_id is null;

alter table public.projects
  alter column organization_id set not null;

create index if not exists idx_clients_organization
  on public.clients(organization_id, status);

create index if not exists idx_projects_organization
  on public.projects(organization_id, status);

create index if not exists idx_projects_client
  on public.projects(client_id, status);

-- ---------------------------------------------------------------------------
-- 5. Client contacts, project access, and department workstreams
-- ---------------------------------------------------------------------------

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  client_id uuid not null
    references public.clients(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  portal_role text not null default 'viewer'
    check (portal_role in ('admin', 'approver', 'collaborator', 'viewer')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, auth_user_id)
);

create table if not exists public.workstreams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  department_id text not null
    references public.departments(id) on delete restrict,
  name text not null,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  owner_id uuid references auth.users(id) on delete set null,
  client_visible boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, department_id, name)
);

create table if not exists public.project_client_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  client_contact_id uuid not null
    references public.client_contacts(id) on delete cascade,
  access_role text not null default 'viewer'
    check (access_role in ('admin', 'approver', 'collaborator', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  unique (project_id, client_contact_id)
);

create index if not exists idx_client_contacts_client
  on public.client_contacts(client_id, status);

create index if not exists idx_client_contacts_auth_user
  on public.client_contacts(auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_workstreams_project
  on public.workstreams(project_id, status);

create index if not exists idx_workstreams_department
  on public.workstreams(organization_id, department_id, status);

create index if not exists idx_project_client_access_contact
  on public.project_client_access(client_contact_id, status);

alter table public.client_contacts enable row level security;
alter table public.workstreams enable row level security;
alter table public.project_client_access enable row level security;

drop policy if exists "Team can manage client contacts" on public.client_contacts;
create policy "Team can manage client contacts"
  on public.client_contacts
  for all
  to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));

drop policy if exists "Clients can read own contact" on public.client_contacts;
create policy "Clients can read own contact"
  on public.client_contacts
  for select
  to authenticated
  using (auth_user_id = auth.uid() and status = 'active');

drop policy if exists "Team can manage workstreams" on public.workstreams;
create policy "Team can manage workstreams"
  on public.workstreams
  for all
  to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));

drop policy if exists "Authorized clients can read released workstreams" on public.workstreams;
create policy "Authorized clients can read released workstreams"
  on public.workstreams
  for select
  to authenticated
  using (
    client_visible = true
    and exists (
      select 1
      from public.project_client_access access
      join public.client_contacts contact
        on contact.id = access.client_contact_id
      where access.project_id = workstreams.project_id
        and access.status = 'active'
        and contact.auth_user_id = auth.uid()
        and contact.status = 'active'
    )
  );

drop policy if exists "Team can manage project client access" on public.project_client_access;
create policy "Team can manage project client access"
  on public.project_client_access
  for all
  to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));

drop policy if exists "Clients can read own project access" on public.project_client_access;
create policy "Clients can read own project access"
  on public.project_client_access
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.client_contacts contact
      where contact.id = project_client_access.client_contact_id
        and contact.auth_user_id = auth.uid()
        and contact.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Legacy client-visibility safety gates
-- ---------------------------------------------------------------------------

alter table public.as_projects
  add column if not exists portal_visible boolean not null default false;

drop policy if exists "client_own_as_projects" on public.as_projects;
create policy "client_own_as_projects"
  on public.as_projects
  for select
  to authenticated
  using (
    portal_visible = true
    and client_id in (
      select client.id
      from public.as_clients client
      where client.auth_user_id = auth.uid()
        and client.portal_access = true
    )
  );

alter table public.as_tasks
  add column if not exists client_visible boolean not null default false;

drop policy if exists "client_read_as_tasks" on public.as_tasks;
create policy "client_read_as_tasks"
  on public.as_tasks
  for select
  to authenticated
  using (
    client_visible = true
    and project_id in (
      select project.id
      from public.as_projects project
      join public.as_clients client on client.id = project.client_id
      where project.portal_visible = true
        and client.portal_access = true
        and client.auth_user_id = auth.uid()
    )
  );

alter table public.as_deliverables
  add column if not exists internal_review_status text not null default 'not_submitted'
    check (internal_review_status in (
      'not_submitted',
      'in_review',
      'changes_required',
      'client_ready',
      'released'
    )),
  add column if not exists released_to_client_at timestamptz;

drop policy if exists "authenticated_users_deliverables" on public.as_deliverables;
drop policy if exists "client_read_deliverables" on public.as_deliverables;
drop policy if exists "team_manage_deliverables" on public.as_deliverables;

create policy "team_manage_deliverables"
  on public.as_deliverables
  for all
  to authenticated
  using (exists (select 1 from public.profiles profile where profile.id = auth.uid()))
  with check (exists (select 1 from public.profiles profile where profile.id = auth.uid()));

create policy "client_read_deliverables"
  on public.as_deliverables
  for select
  to authenticated
  using (
    internal_review_status = 'released'
    and released_to_client_at is not null
    and project_id in (
      select project.id
      from public.as_projects project
      join public.as_clients client on client.id = project.client_id
      where project.portal_visible = true
        and client.portal_access = true
        and client.auth_user_id = auth.uid()
    )
  );

alter table public.as_project_documents
  add column if not exists client_visible boolean not null default false;

drop policy if exists "client_read_as_docs" on public.as_project_documents;
create policy "client_read_as_docs"
  on public.as_project_documents
  for select
  to authenticated
  using (
    client_visible = true
    and project_id in (
      select project.id
      from public.as_projects project
      join public.as_clients client on client.id = project.client_id
      where project.portal_visible = true
        and client.portal_access = true
        and client.auth_user_id = auth.uid()
    )
  );

alter table public.as_project_pages
  add column if not exists client_visible boolean not null default false;

drop policy if exists "client_read_as_pages" on public.as_project_pages;
create policy "client_read_as_pages"
  on public.as_project_pages
  for select
  to authenticated
  using (
    client_visible = true
    and project_id in (
      select project.id
      from public.as_projects project
      join public.as_clients client on client.id = project.client_id
      where project.portal_visible = true
        and client.portal_access = true
        and client.auth_user_id = auth.uid()
    )
  );

alter table public.as_timeline_events
  add column if not exists client_visible boolean not null default false;

drop policy if exists "client_read_as_timeline" on public.as_timeline_events;
create policy "client_read_as_timeline"
  on public.as_timeline_events
  for select
  to authenticated
  using (
    client_visible = true
    and project_id in (
      select project.id
      from public.as_projects project
      join public.as_clients client on client.id = project.client_id
      where project.portal_visible = true
        and client.portal_access = true
        and client.auth_user_id = auth.uid()
    )
  );

-- Formal client approval is intentionally unavailable until UAT activation.
alter table public.as_client_signoffs
  add column if not exists client_response_enabled boolean not null default false;

drop policy if exists "client_respond_signoffs" on public.as_client_signoffs;

-- Existing objects remain intact; only anonymous public delivery is disabled.
update storage.buckets
set public = false
where id = 'sphere-deliverables';

commit;
