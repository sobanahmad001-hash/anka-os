-- ============================================================================
-- Anka OS — Phase 9 Migration
-- Run AFTER phase8.sql has been executed.
-- Adds: subtasks, contacts, tags, pinned_apps
-- Subtasks, Contacts, Tags & Quick Access layer.
-- ============================================================================


-- ─── Subtasks ────────────────────────────────────────────────────────────────
-- Checklist-style child items under a task.

create table if not exists public.subtasks (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  title text not null,
  completed boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_subtasks_task on public.subtasks (task_id);

alter table public.subtasks enable row level security;

create policy "Subtask access follows task owner"
  on public.subtasks for select
  using (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );

create policy "Task owner can insert subtasks"
  on public.subtasks for insert
  with check (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );

create policy "Task owner can update subtasks"
  on public.subtasks for update
  using (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );

create policy "Task owner can delete subtasks"
  on public.subtasks for delete
  using (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );


-- ─── Contacts ────────────────────────────────────────────────────────────────
-- Shared contacts / address book.

create table if not exists public.contacts (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  email text default '',
  phone text default '',
  company text default '',
  role text default '',
  category text not null default 'general'
    check (category in ('general', 'client', 'vendor', 'partner', 'lead', 'other')),
  notes text default '',
  avatar_url text default '',
  is_shared boolean not null default false,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contacts_category on public.contacts (category);

alter table public.contacts enable row level security;

create policy "Users can read shared or own contacts"
  on public.contacts for select
  using (
    auth.role() = 'authenticated'
    and (is_shared = true or created_by = auth.uid())
  );

create policy "Users can create contacts"
  on public.contacts for insert
  with check (auth.uid() = created_by);

create policy "Owner can update contacts"
  on public.contacts for update
  using (created_by = auth.uid());

create policy "Owner can delete contacts"
  on public.contacts for delete
  using (created_by = auth.uid());


-- ─── Tags (Universal) ───────────────────────────────────────────────────────
-- Reusable tags that can be applied to any entity.

create table if not exists public.tags (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  color text not null default '#6c5ce7',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.tags enable row level security;

create policy "Authenticated users can read tags"
  on public.tags for select
  using (auth.role() = 'authenticated');

create policy "Users can create tags"
  on public.tags for insert
  with check (auth.uid() = created_by);


-- ─── Pinned Apps (Quick Access) ──────────────────────────────────────────────
-- User's favorite/pinned apps for the dashboard.

create table if not exists public.pinned_apps (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  app_id text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, app_id)
);

alter table public.pinned_apps enable row level security;

create policy "Users can read own pinned apps"
  on public.pinned_apps for select
  using (auth.uid() = user_id);

create policy "Users can insert own pinned apps"
  on public.pinned_apps for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own pinned apps"
  on public.pinned_apps for delete
  using (auth.uid() = user_id);


-- ─── Enable realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.subtasks;
