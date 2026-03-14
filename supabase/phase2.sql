-- ============================================================================
-- Anka OS — Phase 2 Migration
-- Run AFTER schema.sql has been executed.
-- Adds: departments, projects, project_members, clients, assets tables
-- Adds: admin policies for user management
-- Upgrades: tasks to support project association
-- ============================================================================


-- ─── Departments ─────────────────────────────────────────────────────────────
-- Formal department records with settings and metadata.

create table if not exists public.departments (
  id text primary key check (id in ('design', 'development', 'marketing')),
  name text not null,
  description text not null default '',
  color text not null default '#6c5ce7',
  icon text not null default '🏢',
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;

create policy "Anyone can read departments"
  on public.departments for select
  using (true);

create policy "Admins can manage departments"
  on public.departments for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Seed the three departments
insert into public.departments (id, name, description, color, icon) values
  ('design',      'Design',      'Creative design, branding, and visual assets', '#e84393', '🎨'),
  ('development', 'Development', 'Engineering, coding, and technical systems',   '#0984e3', '💻'),
  ('marketing',   'Marketing',   'Growth, campaigns, and client engagement',     '#fdcb6e', '📈')
on conflict (id) do nothing;


-- ─── Projects ────────────────────────────────────────────────────────────────
-- Cross-department project tracking.

create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text not null default '',
  department_id text references public.departments(id) not null,
  status text not null default 'active'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'archived')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  owner_id uuid references auth.users(id) on delete set null,
  start_date date,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- All authenticated users can see projects in their department
create policy "Users can read department projects"
  on public.projects for select
  using (
    auth.role() = 'authenticated'
    and (
      department_id = (select department from public.profiles where id = auth.uid())
      or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'executive'))
    )
  );

-- Department heads, executives, and admins can create projects
create policy "Leads can create projects"
  on public.projects for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head', 'executive')
    )
  );

-- Project owner, department heads, and admins can update
create policy "Authorized users can update projects"
  on public.projects for update
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

-- Only admins can delete projects
create policy "Admins can delete projects"
  on public.projects for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ─── Project Members ────────────────────────────────────────────────────────
-- Links users to projects they're working on.

create table if not exists public.project_members (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null default 'member'
    check (role in ('lead', 'member', 'reviewer')),
  joined_at timestamptz not null default now(),
  unique (project_id, user_id)
);

alter table public.project_members enable row level security;

create policy "Users can see project members"
  on public.project_members for select
  using (auth.role() = 'authenticated');

create policy "Leads can manage project members"
  on public.project_members for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head', 'executive')
    )
    or exists (
      select 1 from public.project_members pm
      join public.projects p on p.id = pm.project_id
      where pm.user_id = auth.uid() and pm.role = 'lead'
    )
  );


-- ─── Upgrade Tasks — add project association ─────────────────────────────────

alter table public.tasks
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists priority text default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  add column if not exists due_date date,
  add column if not exists description text default '';


-- ─── Clients ─────────────────────────────────────────────────────────────────
-- Client profiles for marketing & project tracking.

create table if not exists public.clients (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  email text,
  company text not null default '',
  industry text not null default '',
  status text not null default 'active'
    check (status in ('lead', 'active', 'inactive', 'churned')),
  notes text not null default '',
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;

create policy "Authenticated users can read clients"
  on public.clients for select
  using (auth.role() = 'authenticated');

create policy "Leads can manage clients"
  on public.clients for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head', 'executive')
    )
  );


-- ─── Client-Project Link ────────────────────────────────────────────────────

create table if not exists public.client_projects (
  client_id uuid references public.clients(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  primary key (client_id, project_id)
);

alter table public.client_projects enable row level security;

create policy "Authenticated users can read client_projects"
  on public.client_projects for select
  using (auth.role() = 'authenticated');

create policy "Leads can manage client_projects"
  on public.client_projects for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head', 'executive')
    )
  );


-- ─── Assets (Design) ────────────────────────────────────────────────────────
-- Design assets linked to projects.

create table if not exists public.assets (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null not null,
  name text not null,
  file_path text not null,
  file_type text not null default '',
  file_size bigint default 0,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

alter table public.assets enable row level security;

create policy "Authenticated users can read assets"
  on public.assets for select
  using (auth.role() = 'authenticated');

create policy "Users can upload assets"
  on public.assets for insert
  with check (auth.uid() = uploaded_by);

create policy "Owners and admins can manage assets"
  on public.assets for update
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owners and admins can delete assets"
  on public.assets for delete
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Admin: allow admins to update any profile ──────────────────────────────

create policy "Admins can update any profile"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ─── Enable Realtime on new tables ──────────────────────────────────────────

alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.clients;
