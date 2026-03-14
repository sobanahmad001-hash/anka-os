-- ============================================================================
-- Anka OS — Phase 3 Migration
-- Run AFTER phase2.sql has been executed.
-- Adds: notifications, activity_log tables
-- ============================================================================


-- ─── Notifications ───────────────────────────────────────────────────────────
-- In-app notifications for task assignments, project updates, messages, etc.

create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null default 'info'
    check (type in ('info', 'task_assigned', 'project_update', 'message', 'mention', 'system')),
  title text not null,
  body text not null default '',
  link text default null,            -- optional deep-link context (e.g. project id)
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- Users can only see their own notifications
create policy "Users can read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Users can update (mark read) their own notifications
create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- Users can delete their own notifications
create policy "Users can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- System / admins can insert notifications for anyone
create policy "Authenticated users can create notifications"
  on public.notifications for insert
  with check (auth.role() = 'authenticated');


-- ─── Activity Log ────────────────────────────────────────────────────────────
-- Tracks workspace-wide activity for dashboards and audit trails.

create table if not exists public.activity_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,               -- e.g. 'created_project', 'completed_task', 'uploaded_asset'
  entity_type text not null,          -- e.g. 'project', 'task', 'client', 'asset'
  entity_id text,                     -- the id of the entity (uuid as text)
  metadata jsonb default '{}'::jsonb, -- extra context
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

-- Admins and executives can read all activity
create policy "Admins can read all activity"
  on public.activity_log for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'executive')
    )
  );

-- Users can read their own activity
create policy "Users can read own activity"
  on public.activity_log for select
  using (auth.uid() = user_id);

-- Authenticated users can insert activity
create policy "Authenticated users can log activity"
  on public.activity_log for insert
  with check (auth.role() = 'authenticated');


-- ─── Enable Realtime on notifications ────────────────────────────────────────

alter publication supabase_realtime add table public.notifications;
