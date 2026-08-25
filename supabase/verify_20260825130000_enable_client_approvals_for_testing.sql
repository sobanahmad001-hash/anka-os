select jsonb_build_object(
  'migration', '20260825130000_enable_client_approvals_for_testing',
  'client_approvals_enabled', coalesce((
    select bool_and(coalesce((settings ->> 'client_approvals_enabled')::boolean, false))
    from public.organizations
  ), false),
  'client_insert_policy', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approvals'
      and policyname = 'Clients can record client approvals'
  ),
  'client_select_policy', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approvals'
      and policyname = 'Clients can read own client approvals'
  ),
  'apply_trigger', exists (
    select 1 from pg_trigger
    where tgname = 'apply_client_approval_decision'
  )
);
