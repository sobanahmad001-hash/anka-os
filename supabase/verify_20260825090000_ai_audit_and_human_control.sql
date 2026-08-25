-- Read-only verification for Migration 9.

select jsonb_pretty(jsonb_build_object(
  'migration', '20260825090000_ai_audit_and_human_control',
  'table_exists', to_regclass('public.ai_runs') is not null,
  'rls_enabled', (
    select relrowsecurity from pg_class where oid = 'public.ai_runs'::regclass
  ),
  'policy_names', (
    select coalesce(jsonb_agg(policyname order by policyname), '[]'::jsonb)
    from pg_policies where schemaname = 'public' and tablename = 'ai_runs'
  ),
  'authenticated_select', has_table_privilege('authenticated', 'public.ai_runs', 'select'),
  'authenticated_insert', has_table_privilege('authenticated', 'public.ai_runs', 'insert'),
  'authenticated_update', has_table_privilege('authenticated', 'public.ai_runs', 'update'),
  'authenticated_delete', has_table_privilege('authenticated', 'public.ai_runs', 'delete'),
  'pending_action_count', (
    select count(*) from public.ai_runs where human_decision = 'pending'
  ),
  'invalid_action_count', (
    select count(*) from public.ai_runs
    where capability = 'action_proposal' and status = 'completed'
      and proposed_action is null
  )
)) as verification_result;
