-- Verification for 20260825030000_guarded_test_data_reset.sql
-- READ-ONLY: run after Migration 3 and return the single JSON result.

with reset_table_counts as (
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
  union all select 'projects', count(*) from public.projects
  union all select 'pull_requests', count(*) from public.pull_requests
  union all select 'sprints', count(*) from public.sprints
  union all select 'system_health_logs', count(*) from public.system_health_logs
  union all select 'tasks', count(*) from public.tasks
  union all select 'user_activity_logs', count(*) from public.user_activity_logs
  union all select 'user_performance_snapshots', count(*) from public.user_performance_snapshots
  union all select 'user_preferences', count(*) from public.user_preferences
  union all select 'user_status', count(*) from public.user_status
),
preserved_counts as (
  select jsonb_build_object(
    'auth_users', (select count(*) from auth.users),
    'profiles', (select count(*) from public.profiles),
    'organizations', (select count(*) from public.organizations),
    'organization_memberships', (select count(*) from public.organization_memberships),
    'departments', (select count(*) from public.departments),
    'storage_objects', (
      select count(*)
      from storage.objects
      where bucket_id = 'sphere-deliverables'
    )
  ) as value
)
select jsonb_pretty(
  jsonb_build_object(
    'migration', '20260825030000_guarded_test_data_reset',
    'reset_table_total_rows', (select sum(row_count) from reset_table_counts),
    'non_empty_reset_tables', coalesce((
      select jsonb_agg(
        jsonb_build_object('table', table_name, 'row_count', row_count)
        order by table_name
      )
      from reset_table_counts
      where row_count > 0
    ), '[]'::jsonb),
    'preserved', (select value from preserved_counts),
    'departments', (
      select jsonb_agg(
        jsonb_build_object('id', id, 'name', name)
        order by id
      )
      from public.departments
    ),
    'membership_roles', (
      select jsonb_agg(
        jsonb_build_object(
          'role', role,
          'member_kind', member_kind,
          'count', role_count
        ) order by role, member_kind
      )
      from (
        select role, member_kind, count(*) as role_count
        from public.organization_memberships
        group by role, member_kind
      ) roles
    )
  )
) as migration_3_verification;
