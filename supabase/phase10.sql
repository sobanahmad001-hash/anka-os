-- ============================================================================
-- Anka OS — Phase 10 Migration
-- Run AFTER phase9.sql has been executed.
-- Adds: calendar_events, task_labels, team_announcements
-- Calendar Events, Tag Integration, Kanban & Team features.
-- ============================================================================


-- ─── Calendar Events ─────────────────────────────────────────────────────────
-- Standalone calendar events (meetings, deadlines, reminders).

create table if not exists public.calendar_events (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  description text default '',
  start_time timestamptz not null,
  end_time timestamptz,
  all_day boolean not null default false,
  color text not null default '#6c5ce7',
  recurrence text default null
    check (recurrence is null or recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  location text default '',
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_user on public.calendar_events (user_id);
create index if not exists idx_calendar_events_start on public.calendar_events (start_time);

alter table public.calendar_events enable row level security;

create policy "Users can read own or shared events"
  on public.calendar_events for select
  using (
    auth.role() = 'authenticated'
    and (user_id = auth.uid() or is_shared = true)
  );

create policy "Users can create own events"
  on public.calendar_events for insert
  with check (auth.uid() = user_id);

create policy "Users can update own events"
  on public.calendar_events for update
  using (user_id = auth.uid());

create policy "Users can delete own events"
  on public.calendar_events for delete
  using (user_id = auth.uid());


-- ─── Task Labels (join table: tasks ↔ tags) ─────────────────────────────────
-- Link tags to tasks for filtering/grouping.

create table if not exists public.task_labels (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  tag_id uuid references public.tags(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (task_id, tag_id)
);

create index if not exists idx_task_labels_task on public.task_labels (task_id);
create index if not exists idx_task_labels_tag on public.task_labels (tag_id);

alter table public.task_labels enable row level security;

create policy "Task label access follows task owner"
  on public.task_labels for select
  using (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );

create policy "Task owner can insert labels"
  on public.task_labels for insert
  with check (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );

create policy "Task owner can delete labels"
  on public.task_labels for delete
  using (
    exists (
      select 1 from public.tasks
      where id = task_id and user_id = auth.uid()
    )
  );


-- ─── Team Announcements ─────────────────────────────────────────────────────
-- Broadcast announcements visible to the whole team.

create table if not exists public.team_announcements (
  id uuid default gen_random_uuid() primary key,
  author_id uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null default '',
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  pinned boolean not null default false,
  department text default null,
  expires_at timestamptz default null,
  created_at timestamptz not null default now()
);

alter table public.team_announcements enable row level security;

create policy "Authenticated users can read announcements"
  on public.team_announcements for select
  using (auth.role() = 'authenticated');

create policy "Admins and heads can create announcements"
  on public.team_announcements for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Author can update own announcements"
  on public.team_announcements for update
  using (author_id = auth.uid());

create policy "Author can delete own announcements"
  on public.team_announcements for delete
  using (author_id = auth.uid());


-- ─── Enable realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.team_announcements;
