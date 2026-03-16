-- Phase 14: Shared Core Upgrade
-- Goal:
-- Add missing project-first shared core entities without breaking existing app logic.
-- Admin remains organizational spine.
-- Department environments inherit shared execution core.

begin;

-- =========================================
-- 1. PROJECT UPDATES
-- =========================================
create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete set null,
  status text default 'in_progress',
  summary text not null default '',
  progress_note text default '',
  blockers_note text default '',
  next_steps text default '',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.project_updates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_updates'
      and policyname = 'Authenticated users can read project_updates'
  ) then
    create policy "Authenticated users can read project_updates"
      on public.project_updates for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_updates'
      and policyname = 'Authenticated users can insert project_updates'
  ) then
    create policy "Authenticated users can insert project_updates"
      on public.project_updates for insert
      with check (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'project_updates'
      and policyname = 'Authenticated users can update project_updates'
  ) then
    create policy "Authenticated users can update project_updates"
      on public.project_updates for update
      using (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_project_updates_project on public.project_updates(project_id, created_at desc);
create index if not exists idx_project_updates_author on public.project_updates(author_id, created_at desc);

-- =========================================
-- 2. BLOCKERS
-- =========================================
create table if not exists public.blockers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  description text default '',
  severity text default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  owner_id uuid references public.profiles(id) on delete set null,
  reported_by uuid references public.profiles(id) on delete set null,
  resolution_note text default '',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table public.blockers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'blockers'
      and policyname = 'Authenticated users can read blockers'
  ) then
    create policy "Authenticated users can read blockers"
      on public.blockers for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'blockers'
      and policyname = 'Authenticated users can insert blockers'
  ) then
    create policy "Authenticated users can insert blockers"
      on public.blockers for insert
      with check (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'blockers'
      and policyname = 'Authenticated users can update blockers'
  ) then
    create policy "Authenticated users can update blockers"
      on public.blockers for update
      using (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_blockers_project on public.blockers(project_id, status, severity);
create index if not exists idx_blockers_task on public.blockers(task_id);
create index if not exists idx_blockers_owner on public.blockers(owner_id);

-- =========================================
-- 3. TASK DEPENDENCIES
-- =========================================
create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade not null,
  depends_on_task_id uuid references public.tasks(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

alter table public.task_dependencies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'task_dependencies'
      and policyname = 'Authenticated users can read task_dependencies'
  ) then
    create policy "Authenticated users can read task_dependencies"
      on public.task_dependencies for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'task_dependencies'
      and policyname = 'Authenticated users can manage task_dependencies'
  ) then
    create policy "Authenticated users can manage task_dependencies"
      on public.task_dependencies for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_task_dependencies_task on public.task_dependencies(task_id);
create index if not exists idx_task_dependencies_depends_on on public.task_dependencies(depends_on_task_id);

-- =========================================
-- 4. DOCUMENTS
-- =========================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  content text default '',
  doc_type text default 'general',
  status text default 'draft' check (status in ('draft', 'active', 'archived')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.documents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'Authenticated users can read documents'
  ) then
    create policy "Authenticated users can read documents"
      on public.documents for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'Authenticated users can manage documents'
  ) then
    create policy "Authenticated users can manage documents"
      on public.documents for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_documents_project on public.documents(project_id, updated_at desc);
create index if not exists idx_documents_author on public.documents(author_id, updated_at desc);

-- =========================================
-- 5. RULES
-- =========================================
create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete cascade,
  title text not null,
  content text not null default '',
  severity int default 3,
  is_active boolean default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.rules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rules'
      and policyname = 'Authenticated users can read rules'
  ) then
    create policy "Authenticated users can read rules"
      on public.rules for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rules'
      and policyname = 'Authenticated users can manage rules'
  ) then
    create policy "Authenticated users can manage rules"
      on public.rules for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_rules_department on public.rules(department_id, is_active);
create index if not exists idx_rules_severity on public.rules(severity desc);

-- =========================================
-- 6. AI PROJECT MEMORY
-- =========================================
create table if not exists public.ai_project_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null unique,
  summary text default '',
  current_focus text default '',
  open_blockers text[] default '{}',
  recent_decisions text[] default '{}',
  next_steps text[] default '{}',
  health text default 'unknown' check (health in ('unknown', 'on_track', 'at_risk', 'blocked', 'completed')),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.ai_project_memory enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_project_memory'
      and policyname = 'Authenticated users can read ai_project_memory'
  ) then
    create policy "Authenticated users can read ai_project_memory"
      on public.ai_project_memory for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_project_memory'
      and policyname = 'Authenticated users can manage ai_project_memory'
  ) then
    create policy "Authenticated users can manage ai_project_memory"
      on public.ai_project_memory for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_ai_project_memory_project on public.ai_project_memory(project_id);

-- =========================================
-- 7. PROJECTS STRENGTHENING
-- =========================================
alter table public.projects
  add column if not exists health text default 'unknown'
    check (health in ('unknown', 'on_track', 'at_risk', 'blocked', 'completed')),
  add column if not exists current_focus text default '',
  add column if not exists next_milestone text default '';

-- =========================================
-- 8. UPDATED_AT TRIGGERS
-- =========================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_rules_updated_at on public.rules;
create trigger trg_rules_updated_at
before update on public.rules
for each row execute function public.set_updated_at();

commit;
