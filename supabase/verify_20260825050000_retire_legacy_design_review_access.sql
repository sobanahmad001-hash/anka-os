-- Read-only verification for Migration 5.
-- Expected: all counts zero and both RLS values true.

select jsonb_pretty(jsonb_build_object(
  'migration', '20260825050000_retire_legacy_design_review_access',
  'legacy_review_policy_count', (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in ('design_reviews', 'review_comments')
  ),
  'anon_legacy_review_grant_count', (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('design_reviews', 'review_comments')
      and grantee = 'anon'
  ),
  'authenticated_legacy_review_grant_count', (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('design_reviews', 'review_comments')
      and grantee = 'authenticated'
  ),
  'design_reviews_rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.design_reviews'::regclass
  ),
  'review_comments_rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.review_comments'::regclass
  ),
  'design_review_rows', (select count(*) from public.design_reviews),
  'review_comment_rows', (select count(*) from public.review_comments)
)) as verification_result;
