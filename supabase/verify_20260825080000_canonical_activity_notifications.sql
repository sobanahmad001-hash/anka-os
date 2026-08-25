-- Read-only verification for Migration 8.

select jsonb_pretty(jsonb_build_object(
  'migration', '20260825080000_canonical_activity_notifications',
  'notification_rls_enabled', (
    select relrowsecurity from pg_class where oid = 'public.notifications'::regclass
  ),
  'notification_policy_names', (
    select coalesce(jsonb_agg(policyname order by policyname), '[]'::jsonb)
    from pg_policies where schemaname = 'public' and tablename = 'notifications'
  ),
  'authenticated_notification_insert_grant', has_table_privilege(
    'authenticated', 'public.notifications', 'insert'
  ),
  'authenticated_activity_insert_grant', has_table_privilege(
    'authenticated', 'public.activity_events', 'insert'
  ),
  'capture_function_search_path', (
    select proconfig from pg_proc
    where oid = 'private.capture_delivery_activity()'::regprocedure
  ),
  'capture_function_anon_execute', has_function_privilege(
    'anon', 'private.capture_delivery_activity()', 'execute'
  ),
  'capture_function_authenticated_execute', has_function_privilege(
    'authenticated', 'private.capture_delivery_activity()', 'execute'
  ),
  'delivery_trigger_count', (
    select count(*) from pg_trigger
    where tgname in (
      'trg_record_project_activity', 'trg_capture_task_activity',
      'trg_capture_request_activity', 'trg_capture_deliverable_version_activity',
      'trg_capture_comment_activity'
    ) and not tgisinternal
  ),
  'notifications_in_realtime_publication', exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  )
)) as verification_result;
