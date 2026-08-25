-- Anka Sphere OS - Phase 1 / Migration 3 (20260825030000)
-- Guarded reset of owner-classified disposable application data.
--
-- DESTRUCTIVE WITHIN THE EXPLICIT TEST-DATA SCOPE:
--   * preserves auth.users
--   * preserves profiles and organization memberships
--   * preserves organizations and departments
--   * preserves storage objects (storage cleanup requires the Storage API)
--   * aborts if live counts differ from the approved 128-row inventory
--   * clears application/project/client/task/AI/demo records only

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Guard: do not reset if any inventoried count has changed
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from (
      select 'ai_conversations'::text as table_name, count(*)::bigint as row_count from public.ai_conversations
      union all select 'ai_messages', count(*) from public.ai_messages
      union all select 'api_docs', count(*) from public.api_docs
      union all select 'as_assistant_messages', count(*) from public.as_assistant_messages
      union all select 'as_assistant_threads', count(*) from public.as_assistant_threads
      union all select 'as_clients', count(*) from public.as_clients
      union all select 'as_deliverables', count(*) from public.as_deliverables
      union all select 'as_project_documents', count(*) from public.as_project_documents
      union all select 'as_project_pages', count(*) from public.as_project_pages
      union all select 'as_projects', count(*) from public.as_projects
      union all select 'as_tasks', count(*) from public.as_tasks
      union all select 'as_wp_pages', count(*) from public.as_wp_pages
      union all select 'as_wp_sites', count(*) from public.as_wp_sites
      union all select 'department_metrics', count(*) from public.department_metrics
      union all select 'departments', count(*) from public.departments
      union all select 'profiles', count(*) from public.profiles
      union all select 'projects', count(*) from public.projects
      union all select 'pull_requests', count(*) from public.pull_requests
      union all select 'sprints', count(*) from public.sprints
      union all select 'system_health_logs', count(*) from public.system_health_logs
      union all select 'tasks', count(*) from public.tasks
      union all select 'user_activity_logs', count(*) from public.user_activity_logs
      union all select 'user_performance_snapshots', count(*) from public.user_performance_snapshots
      union all select 'user_preferences', count(*) from public.user_preferences
      union all select 'user_status', count(*) from public.user_status
    ) observed
    join (
      values
        ('ai_conversations'::text, 7::bigint),
        ('ai_messages', 9),
        ('api_docs', 4),
        ('as_assistant_messages', 10),
        ('as_assistant_threads', 2),
        ('as_clients', 2),
        ('as_deliverables', 3),
        ('as_project_documents', 2),
        ('as_project_pages', 12),
        ('as_projects', 3),
        ('as_tasks', 4),
        ('as_wp_pages', 20),
        ('as_wp_sites', 2),
        ('department_metrics', 4),
        ('departments', 4),
        ('profiles', 5),
        ('projects', 2),
        ('pull_requests', 1),
        ('sprints', 3),
        ('system_health_logs', 5),
        ('tasks', 2),
        ('user_activity_logs', 3),
        ('user_performance_snapshots', 18),
        ('user_preferences', 1),
        ('user_status', 1)
    ) expected(table_name, row_count)
      using (table_name)
    where observed.row_count <> expected.row_count
  ) then
    raise exception using
      message = 'Test-data reset aborted: live row counts differ from the approved inventory.',
      hint = 'Run the exact row-count inventory again and review all changed tables before preparing a new reset.';
  end if;

  if (select count(*) from auth.users) <> 5 then
    raise exception using
      message = 'Test-data reset aborted: authentication user count is no longer five.',
      hint = 'Review identity changes before resetting application data.';
  end if;

  if (select count(*) from public.organization_memberships) <> 5 then
    raise exception using
      message = 'Test-data reset aborted: organization membership count is no longer five.',
      hint = 'Review membership changes before resetting application data.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Clear disposable application roots; CASCADE clears dependent test rows
-- ---------------------------------------------------------------------------

truncate table
  public.ai_conversations,
  public.api_docs,
  public.as_assistant_threads,
  public.as_clients,
  public.department_metrics,
  public.projects,
  public.sprints,
  public.system_health_logs,
  public.user_activity_logs,
  public.user_performance_snapshots,
  public.user_preferences,
  public.user_status
restart identity cascade;

commit;
