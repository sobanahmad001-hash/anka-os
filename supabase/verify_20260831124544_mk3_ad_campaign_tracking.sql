begin;

create temporary table mk3_runtime_checks (
  check_name text primary key,
  passed boolean not null
);
grant select, insert on mk3_runtime_checks to authenticated;

create temporary table mk3_fixture_ids (
  campaign_id uuid not null,
  group_id uuid not null,
  keyword_id uuid not null,
  snapshot_id uuid not null
);
grant select on mk3_fixture_ids to authenticated;

insert into mk3_runtime_checks values
  ('mk3_tables_exist', (
    select count(*) = 4
    from unnest(array[
      'public.ad_campaigns', 'public.ad_groups', 'public.ad_group_keywords',
      'public.ad_campaign_performance_snapshots'
    ]) name
    where to_regclass(name) is not null
  )),
  ('mk3_rls_enabled', (
    select bool_and(relrowsecurity)
    from pg_class
    where oid = any(array[
      'public.ad_campaigns'::regclass, 'public.ad_groups'::regclass,
      'public.ad_group_keywords'::regclass,
      'public.ad_campaign_performance_snapshots'::regclass
    ])
  )),
  ('mk3_browser_read_only', (
    select bool_and(
      has_table_privilege('authenticated', oid, 'select')
      and not has_table_privilege('authenticated', oid, 'insert, update, delete')
      and not has_table_privilege('anon', oid, 'select, insert, update, delete')
    )
    from pg_class
    where oid = any(array[
      'public.ad_campaigns'::regclass, 'public.ad_groups'::regclass,
      'public.ad_group_keywords'::regclass,
      'public.ad_campaign_performance_snapshots'::regclass
    ])
  )),
  ('mk3_tenant_read_policies', (
    select count(*) = 4
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'ad_campaigns', 'ad_groups', 'ad_group_keywords',
        'ad_campaign_performance_snapshots'
      )
      and cmd = 'SELECT'
      and qual like '%is_team_organization_member(organization_id)%'
  )),
  ('mk3_composite_foreign_keys', (
    select count(*) = 6
    from pg_constraint
    where contype = 'f'
      and conrelid = any(array[
        'public.ad_campaigns'::regclass, 'public.ad_groups'::regclass,
        'public.ad_group_keywords'::regclass,
        'public.ad_campaign_performance_snapshots'::regclass
      ])
      and array_length(conkey, 1) = 2
  )),
  ('mk3_parent_scoped_uniqueness', (
    select count(*) = 4
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_ad_campaigns_brand_name', 'idx_ad_campaigns_external_identity',
        'idx_ad_groups_campaign_name', 'idx_ad_group_keywords_parent_term'
      )
      and indexdef like 'CREATE UNIQUE INDEX%'
  )),
  ('mk3_snapshot_idempotency_constraint', exists (
    select 1 from pg_constraint
    where conrelid = 'public.ad_campaign_performance_snapshots'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (ad_campaign_id, snapshot_date)'
  )),
  ('mk3_derived_metrics_not_stored', (
    select count(*) = 0
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ad_campaign_performance_snapshots'
      and column_name in ('ctr', 'cpc', 'cost_per_conversion')
  )),
  ('mk3_security_invoker_metrics_view', exists (
    select 1 from pg_class
    where oid = 'public.ad_campaign_performance_metrics'::regclass
      and reloptions @> array['security_invoker=true']
  ));

do $$
declare
  owner_id uuid;
  other_org_id uuid := gen_random_uuid();
  other_client_id uuid := gen_random_uuid();
  brand_id uuid := gen_random_uuid();
  campaign_id uuid := gen_random_uuid();
  group_id uuid := gen_random_uuid();
  second_group_id uuid := gen_random_uuid();
  connection_id uuid := gen_random_uuid();
  keyword_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
begin
  select id into owner_id from auth.users order by created_at limit 1;
  if owner_id is null then
    raise exception 'MK3 verifier needs one existing auth user';
  end if;

  insert into public.organizations(id, name, slug)
  values (other_org_id, 'MK3 verifier org', 'mk3-verifier-' || substr(other_org_id::text, 1, 8));
  insert into public.agency_clients(id, organization_id, name, created_by)
  values (other_client_id, other_org_id, 'MK3 verifier client', owner_id);
  insert into public.brands(id, organization_id, client_id, name, created_by)
  values (brand_id, other_org_id, other_client_id, 'MK3 verifier brand', owner_id);
  insert into public.integration_connections(
    id, organization_id, provider, display_name, public_config, status, created_by
  ) values (
    connection_id, other_org_id, 'google_ads', 'MK3 verifier Ads',
    '{"customer_id":"1234567890"}'::jsonb, 'verified', owner_id
  );
  insert into public.ad_campaigns(
    id, organization_id, brand_id, campaign_name, campaign_type, status,
    daily_budget, total_budget, start_date, end_date, goal,
    location_targeting, audience_segment, created_by
  ) values (
    campaign_id, other_org_id, brand_id, 'Search launch', 'search', 'draft',
    25, 500, current_date, current_date + 10, 'Qualified demand',
    array['Pakistan'], 'Operations leaders', owner_id
  );
  insert into public.ad_groups(id, organization_id, ad_campaign_id, name, status, created_by)
  values
    (group_id, other_org_id, campaign_id, 'Core services', 'draft', owner_id),
    (second_group_id, other_org_id, campaign_id, 'Brand terms', 'active', owner_id);
  insert into public.ad_group_keywords(id, organization_id, ad_group_id, keyword, match_type, is_negative, created_by)
  values
    (keyword_id, other_org_id, group_id, 'digital agency', 'phrase', false, owner_id),
    (gen_random_uuid(), other_org_id, group_id, 'free', 'broad', true, owner_id),
    (gen_random_uuid(), other_org_id, second_group_id, 'anka sphere', 'exact', false, owner_id);

  insert into public.ad_campaign_performance_snapshots(
    id, organization_id, ad_campaign_id, snapshot_date, impressions, clicks,
    cost, conversions, provider_connection_id, external_campaign_id, created_by
  )
  values
    (gen_random_uuid(), other_org_id, campaign_id, current_date - 1, 0, 0, 0, 0,
      connection_id, '123456789', owner_id),
    (snapshot_id, other_org_id, campaign_id, current_date, 100, 10, 25, 2,
      connection_id, '123456789', owner_id);
  insert into public.ad_campaign_performance_snapshots(
    organization_id, ad_campaign_id, snapshot_date, impressions, clicks,
    cost, conversions, provider_connection_id, external_campaign_id, created_by
  ) values (
    other_org_id, campaign_id, current_date, 999, 999, 999, 999,
    connection_id, '123456789', owner_id
  ) on conflict (ad_campaign_id, snapshot_date) do nothing;

  insert into mk3_fixture_ids(campaign_id, group_id, keyword_id, snapshot_id)
  values (campaign_id, group_id, keyword_id, snapshot_id);

  insert into mk3_runtime_checks values
    ('mk3_hierarchy_round_trip', (
      select count(distinct ad_group.id) = 2 and count(keyword.id) = 3
      from public.ad_groups ad_group
      left join public.ad_group_keywords keyword on keyword.ad_group_id = ad_group.id
      where ad_group.ad_campaign_id = campaign_id
    )),
    ('mk3_rejects_negative_budget', not exists (
      select 1 from public.ad_campaigns where daily_budget < 0 or total_budget < 0
    )),
    ('mk3_derived_metrics_zero_safe', (
      select ctr is null and cpc is null and cost_per_conversion is null
      from public.ad_campaign_performance_metrics
      where ad_campaign_id = campaign_id and snapshot_date = current_date - 1
    )),
    ('mk3_derived_metrics_correct', (
      select ctr = 0.1 and cpc = 2.5 and cost_per_conversion = 12.5
      from public.ad_campaign_performance_metrics
      where ad_campaign_id = campaign_id and snapshot_date = current_date
    )),
    ('mk3_repeat_import_keeps_original', (
      select count(*) = 2
        and max(impressions) = 100
      from public.ad_campaign_performance_snapshots
      where ad_campaign_id = campaign_id
    ));
end $$;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from auth.users order by created_at limit 1), 'role', 'authenticated')::text,
  true
);
set local role authenticated;
insert into mk3_runtime_checks values (
  ('mk3_campaign_rls_isolation', not exists (
    select 1 from public.ad_campaigns
    where id = (select campaign_id from mk3_fixture_ids)
  )),
  ('mk3_ad_group_rls_isolation', not exists (
    select 1 from public.ad_groups
    where id = (select group_id from mk3_fixture_ids)
  )),
  ('mk3_keyword_rls_isolation', not exists (
    select 1 from public.ad_group_keywords
    where id = (select keyword_id from mk3_fixture_ids)
  )),
  ('mk3_snapshot_rls_isolation', not exists (
    select 1 from public.ad_campaign_performance_snapshots
    where id = (select snapshot_id from mk3_fixture_ids)
  )),
  ('mk3_metrics_view_rls_isolation', not exists (
    select 1 from public.ad_campaign_performance_metrics
    where id = (select snapshot_id from mk3_fixture_ids)
  ));
reset role;

select check_name, passed from mk3_runtime_checks order by check_name;

do $$
begin
  if exists (select 1 from mk3_runtime_checks where not passed) then
    raise exception 'One or more MK3 verification checks failed';
  end if;
end $$;

rollback;
