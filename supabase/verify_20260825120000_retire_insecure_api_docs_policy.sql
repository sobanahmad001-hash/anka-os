select jsonb_build_object(
  'migration', '20260825120000_retire_insecure_api_docs_policy',
  'insecure_policy_exists', exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'api_docs'
      and policyname = 'Admins can manage API docs'
  ),
  'profile_backed_update_policy_exists', exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'api_docs'
      and policyname = 'Owner and admins can update docs'
  ),
  'profile_backed_delete_policy_exists', exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'api_docs'
      and policyname = 'Owner and admins can delete docs'
  )
) as verification_result;
