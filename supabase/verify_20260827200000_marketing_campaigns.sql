select jsonb_build_object(
  'both_tables_exist', to_regclass('public.marketing_campaigns') is not null
    and to_regclass('public.marketing_campaign_artifacts') is not null,
  'both_tables_use_rls', (
    select count(*) = 2
    from pg_class
    where oid in (
      'public.marketing_campaigns'::regclass,
      'public.marketing_campaign_artifacts'::regclass
    ) and relrowsecurity
  ),
  'browser_roles_are_read_only',
    has_table_privilege('authenticated', 'public.marketing_campaigns', 'select')
    and not has_table_privilege('authenticated', 'public.marketing_campaigns', 'insert, update, delete')
    and has_table_privilege('authenticated', 'public.marketing_campaign_artifacts', 'select')
    and not has_table_privilege('authenticated', 'public.marketing_campaign_artifacts', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.marketing_campaigns', 'select, insert, update, delete'),
  'budget_is_non_negative', exists (
    select 1 from pg_constraint
    where conrelid = 'public.marketing_campaigns'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) like '%planned_budget >=%'
  ),
  'campaign_artifacts_link_canonical_records', (
    select count(*) = 2
    from pg_constraint
    where conrelid = 'public.marketing_campaign_artifacts'::regclass
      and contype = 'f'
      and confrelid in (
        'public.marketing_campaigns'::regclass,
        'public.artifacts'::regclass
      )
  )
);
