-- Read-only verification for Migration 6.
-- Expected: four departments allowed, no invalid rows, safe function grants.

select jsonb_pretty(jsonb_build_object(
  'migration', '20260825060000_team_profile_alignment',
  'profile_count', (select count(*) from public.profiles),
  'invalid_department_count', (
    select count(*)
    from public.profiles
    where department not in ('content', 'design', 'development', 'marketing')
  ),
  'invalid_role_count', (
    select count(*)
    from public.profiles
    where role not in ('admin', 'department_head', 'executive', 'member', 'intern')
  ),
  'department_constraint', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_department_check'
  ),
  'role_constraint', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ),
  'handle_new_user_search_path', (
    select proconfig
    from pg_proc
    where oid = 'public.handle_new_user()'::regprocedure
  ),
  'handle_new_user_anon_execute', has_function_privilege(
    'anon',
    'public.handle_new_user()',
    'execute'
  ),
  'handle_new_user_authenticated_execute', has_function_privilege(
    'authenticated',
    'public.handle_new_user()',
    'execute'
  )
)) as verification_result;
