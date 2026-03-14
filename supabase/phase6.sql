-- ============================================================================
-- Anka OS — Phase 6 Migration
-- Run AFTER phase5.sql has been executed.
-- Adds: time_logs, reports, bookmarks, terminal_history
-- Productivity & Reporting layer.
-- ============================================================================


-- ─── Time Logs (Shared) ─────────────────────────────────────────────────────
-- Tracks time spent on tasks and projects.

create table if not exists public.time_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  description text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes int generated always as (
    case when ended_at is not null
      then extract(epoch from (ended_at - started_at))::int / 60
      else null
    end
  ) stored,
  billable boolean not null default true,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

alter table public.time_logs enable row level security;

create policy "Users can read own time logs"
  on public.time_logs for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Users can create own time logs"
  on public.time_logs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own time logs"
  on public.time_logs for update
  using (auth.uid() = user_id);

create policy "Users can delete own time logs"
  on public.time_logs for delete
  using (auth.uid() = user_id);


-- ─── Reports (Shared) ───────────────────────────────────────────────────────
-- Saved report configurations and snapshots.

create table if not exists public.reports (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text not null default '',
  report_type text not null default 'summary'
    check (report_type in ('summary', 'time', 'tasks', 'projects', 'team', 'custom')),
  filters jsonb not null default '{}'::jsonb,
  snapshot jsonb default null,          -- cached report data
  date_range_start date,
  date_range_end date,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "Users can read own and shared reports"
  on public.reports for select
  using (
    created_by = auth.uid()
    or is_shared = true
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Users can create reports"
  on public.reports for insert
  with check (auth.uid() = created_by);

create policy "Owner can update own reports"
  on public.reports for update
  using (created_by = auth.uid());

create policy "Owner can delete own reports"
  on public.reports for delete
  using (created_by = auth.uid());


-- ─── Bookmarks (Browser) ────────────────────────────────────────────────────
-- User browser bookmarks.

create table if not exists public.bookmarks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default '',
  url text not null,
  favicon text default '',
  folder text not null default 'General',
  position int default 0,
  created_at timestamptz not null default now()
);

alter table public.bookmarks enable row level security;

create policy "Users can manage own bookmarks"
  on public.bookmarks for all
  using (auth.uid() = user_id);


-- ─── Terminal History ────────────────────────────────────────────────────────
-- Persisted terminal command history per user.

create table if not exists public.terminal_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  command text not null,
  output text default '',
  exit_code int default 0,
  created_at timestamptz not null default now()
);

alter table public.terminal_history enable row level security;

create policy "Users can manage own terminal history"
  on public.terminal_history for all
  using (auth.uid() = user_id);


-- ─── Enable realtime for time tracking ──────────────────────────────────────
alter publication supabase_realtime add table public.time_logs;
