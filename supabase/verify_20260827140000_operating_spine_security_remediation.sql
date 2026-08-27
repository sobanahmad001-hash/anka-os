select jsonb_build_object(
  'browser_select_revoked', not exists (
    select 1
    from unnest(array[
      'deployments', 'design_reviews', 'review_checks', 'review_comments',
      'sprint_tasks', 'system_health_logs', 'user_activity_logs',
      'department_metrics', 'as_crm_signals', 'as_project_phases',
      'issue_labels', 'environment_variables'
    ]) as target(table_name)
    where has_table_privilege(
      'authenticated',
      format('public.%I', target.table_name),
      'select'
    )
  ),
  'graphql_disabled_for_authenticated', not coalesce(
    has_function_privilege(
      'authenticated',
      to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)'),
      'execute'
    ),
    false
  ),
  'graphql_disabled_for_anon', not coalesce(
    has_function_privilege(
      'anon',
      to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)'),
      'execute'
    ),
    false
  ),
  'task_helper_fixed_search_path', (
    select p.proconfig = array['search_path=""']
    from pg_proc p
    where p.oid = 'public.can_access_task(uuid)'::regprocedure
  ),
  'environment_variables_rows', (select count(*) from public.environment_variables)
);
