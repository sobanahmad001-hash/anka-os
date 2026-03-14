-- ============================================================================
-- Anka OS — Phase 13 Migration: Development Environment
-- Run AFTER phase12.sql has been executed.
-- Adds: Git integration, PR tracking, CI/CD pipelines, environment management,
--        sprint planning, and dev issue tracking.
-- ============================================================================


-- ─── 1. Git & Repository Management ──────────────────────────────────────────

create table if not exists public.git_repos (
  id uuid default gen_random_uuid() primary key,
  dept_id text not null check (dept_id = 'development'),
  name text not null,
  owner text not null,
  url text not null,
  provider text not null check (provider in ('github', 'gitlab', 'gitea')),
  token_encrypted text,
  last_sync timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_git_repos_dept on public.git_repos(dept_id);

-- ─── 2. Pull Requests ───────────────────────────────────────────────────────

create table if not exists public.pull_requests (
  id uuid default gen_random_uuid() primary key,
  repo_id uuid references public.git_repos(id) on delete cascade not null,
  pr_number int not null,
  title text not null,
  description text,
  source_branch text not null,
  target_branch text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'changes_requested', 'merged', 'closed')),
  author text not null,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  merged_at timestamptz,
  linked_task_id uuid references public.tasks(id) on delete set null
);

create index if not exists idx_prs_repo on public.pull_requests(repo_id);
create index if not exists idx_prs_status on public.pull_requests(status);

-- ─── 3. Code Reviews & Comments ─────────────────────────────────────────────

create table if not exists public.review_checks (
  id uuid default gen_random_uuid() primary key,
  pr_id uuid references public.pull_requests(id) on delete cascade not null,
  check_name text not null,
  status text not null check (status in ('pending', 'passed', 'failed', 'skipped')),
  url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_checks_pr on public.review_checks(pr_id);

-- ─── 4. CI/CD Pipelines ─────────────────────────────────────────────────────

create table if not exists public.ci_pipelines (
  id uuid default gen_random_uuid() primary key,
  repo_id uuid references public.git_repos(id) on delete cascade not null,
  pipeline_number int not null,
  branch text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'passed', 'failed', 'skipped', 'cancelled')),
  commit_sha text not null,
  url text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_pipelines_repo on public.ci_pipelines(repo_id);
create index if not exists idx_pipelines_branch on public.ci_pipelines(branch);
create index if not exists idx_pipelines_status on public.ci_pipelines(status);

-- ─── 5. Pipeline Jobs ───────────────────────────────────────────────────────

create table if not exists public.pipeline_jobs (
  id uuid default gen_random_uuid() primary key,
  pipeline_id uuid references public.ci_pipelines(id) on delete cascade not null,
  job_number int not null,
  name text not null,
  status text not null check (status in ('pending', 'running', 'passed', 'failed', 'skipped')),
  url text,
  started_at timestamptz,
  completed_at timestamptz,
  log_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_pipeline on public.pipeline_jobs(pipeline_id);
create index if not exists idx_jobs_status on public.pipeline_jobs(status);

-- ─── 6. Environments & Deployments ──────────────────────────────────────────

create table if not exists public.environments (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text not null check (type in ('dev', 'staging', 'prod')),
  url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_envs_type on public.environments(type);

-- ─── 7. Environment Variables ───────────────────────────────────────────────

create table if not exists public.environment_variables (
  id uuid default gen_random_uuid() primary key,
  env_id uuid references public.environments(id) on delete cascade not null,
  key text not null,
  value_encrypted text not null,
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_env_vars_env on public.environment_variables(env_id);
create unique index if not exists idx_env_vars_unique on public.environment_variables(env_id, key);

-- ─── 8. Deployments ────────────────────────────────────────────────────────

create table if not exists public.deployments (
  id uuid default gen_random_uuid() primary key,
  env_id uuid references public.environments(id) on delete cascade not null,
  pipeline_id uuid references public.ci_pipelines(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'success', 'failed', 'rolled_back')),
  version text not null,
  deployed_by uuid references auth.users(id) on delete set null,
  deployed_at timestamptz,
  log_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_deployments_env on public.deployments(env_id);
create index if not exists idx_deployments_status on public.deployments(status);

-- ─── 9. Development Issues / Bug Tracker ────────────────────────────────────

create table if not exists public.dev_issues (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'review', 'closed', 'wontfix')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  linked_task_id uuid references public.tasks(id) on delete set null,
  linked_pr_id uuid references public.pull_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dev_issues_status on public.dev_issues(status);
create index if not exists idx_dev_issues_severity on public.dev_issues(severity);
create index if not exists idx_dev_issues_assigned on public.dev_issues(assigned_to);

-- ─── 10. Issue Labels ───────────────────────────────────────────────────────

create table if not exists public.issue_labels (
  id uuid default gen_random_uuid() primary key,
  issue_id uuid references public.dev_issues(id) on delete cascade not null,
  label text not null
);

create index if not exists idx_labels_issue on public.issue_labels(issue_id);

-- ─── 11. Sprint Planning ────────────────────────────────────────────────────

create table if not exists public.sprints (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  status text not null default 'planning' check (status in ('planning', 'active', 'completed', 'archived')),
  goal text,
  start_date date,
  end_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── 12. Sprint Tasks ───────────────────────────────────────────────────────

create table if not exists public.sprint_tasks (
  id uuid default gen_random_uuid() primary key,
  sprint_id uuid references public.sprints(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade not null,
  story_points int check (story_points in (1, 2, 3, 5, 8, 13, 21)),
  priority text default 'medium' check (priority in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

create index if not exists idx_sprint_tasks_sprint on public.sprint_tasks(sprint_id);
create unique index if not exists idx_sprint_tasks_unique on public.sprint_tasks(sprint_id, task_id);

-- ─── 13. Sprint Metrics ────────────────────────────────────────────────────

create table if not exists public.sprint_metrics (
  id uuid default gen_random_uuid() primary key,
  sprint_id uuid references public.sprints(id) on delete cascade not null unique,
  total_points int default 0,
  completed_points int default 0,
  velocity int generated always as (
    case when total_points > 0 then (completed_points * 100) / total_points else 0 end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sprint_metrics_sprint on public.sprint_metrics(sprint_id);


-- ─── 14. RLS Policies ──────────────────────────────────────────────────────

-- Git Repos - Dev dept only
alter table public.git_repos enable row level security;
create policy "Dev can access repos" on public.git_repos for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );

-- Pull Requests - Dev dept visibility
alter table public.pull_requests enable row level security;
create policy "Dev can view prs" on public.pull_requests for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );

-- CI Pipelines - Dev dept visibility
alter table public.ci_pipelines enable row level security;
create policy "Dev can view pipelines" on public.ci_pipelines for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );

-- Pipeline Jobs - Dev dept visibility
alter table public.pipeline_jobs enable row level security;
create policy "Dev can view jobs" on public.pipeline_jobs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );

-- Environments - Dev dept access
alter table public.environments enable row level security;
create policy "Dev can view environments" on public.environments for select
  using (true); -- Public reference, but modify/delete restricted below
create policy "Dev can manage environments" on public.environments for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Environment Variables - Dev dept access
alter table public.environment_variables enable row level security;
create policy "Dev can view env vars" on public.environment_variables for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );

-- Dev Issues - Assigned or created by user + dev heads can see all
alter table public.dev_issues enable row level security;
create policy "Dev can view issues" on public.dev_issues for select
  using (
    auth.uid() = assigned_to or auth.uid() = created_by
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or (role = 'department_head' and department = 'development'))
    )
  );
create policy "Dev can manage own issues" on public.dev_issues for all
  using (
    auth.uid() = created_by or auth.uid() = assigned_to
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or role = 'department_head')
    )
  );

-- Sprints - Dev dept only
alter table public.sprints enable row level security;
create policy "Dev can access sprints" on public.sprints for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );

-- Sprint Tasks - Via sprint visibility
alter table public.sprint_tasks enable row level security;
create policy "Dev can access sprint tasks" on public.sprint_tasks for all
  using (
    exists (
      select 1 from public.sprints s
      where s.id = sprint_id
      and exists (
        select 1 from public.profiles
        where id = auth.uid() and (role = 'admin' or department = 'development')
      )
    )
  );

-- Sprint Metrics - Dev dept
alter table public.sprint_metrics enable row level security;
create policy "Dev can view sprint metrics" on public.sprint_metrics for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or department = 'development')
    )
  );
