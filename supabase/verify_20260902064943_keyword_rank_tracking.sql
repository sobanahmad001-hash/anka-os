-- MK6a rollback-safe runtime verification. Run after the MK6a migration is applied.

begin;

create temporary table mk6a_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_brand_id uuid;
  v_client_id uuid;
  v_actor_id uuid;
  v_page_id uuid := gen_random_uuid();
  v_keyword_id uuid := gen_random_uuid();
  v_other_organization_id uuid := gen_random_uuid();
  v_other_client_id uuid := gen_random_uuid();
  v_other_brand_id uuid := gen_random_uuid();
  v_other_page_id uuid := gen_random_uuid();
  v_other_keyword_id uuid := gen_random_uuid();
  v_duplicate_rejected boolean := false;
  v_invalid_tier_rejected boolean := false;
  v_cross_org_page_rejected boolean := false;
  v_visible_keywords integer;
  v_hidden_keywords integer;
  v_visible_snapshots integer;
  v_hidden_snapshots integer;
begin
  select brand.organization_id, brand.id, brand.client_id, membership.user_id
    into v_organization_id, v_brand_id, v_client_id, v_actor_id
  from public.brands brand
  join public.organization_memberships membership
    on membership.organization_id = brand.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;
  if not found then
    raise exception 'MK6a verification requires one brand and active team member';
  end if;

  insert into public.tracked_pages (
    id, organization_id, brand_id, page_url, page_type, created_by
  ) values (
    v_page_id, v_organization_id, v_brand_id,
    'https://mk6a-' || substr(v_page_id::text, 1, 8) || '.example/',
    'service', v_actor_id
  );

  insert into public.tracked_keywords (
    id, organization_id, brand_id, tracked_page_id, keyword, target_rank_tier, created_by
  ) values (
    v_keyword_id, v_organization_id, v_brand_id, v_page_id,
    'mk6a rank tracking', 'top_10', v_actor_id
  );

  insert into public.keyword_rank_snapshots (
    organization_id, tracked_keyword_id, snapshot_date, position,
    search_console_clicks, search_console_impressions
  ) values (
    v_organization_id, v_keyword_id, current_date, null, null, null
  );

  insert into mk6a_runtime_checks values
    ('null_position_is_honest_not_yet_ranking_state', (
      select position is null
        and search_console_clicks is null
        and search_console_impressions is null
      from public.keyword_rank_snapshots
      where tracked_keyword_id = v_keyword_id and snapshot_date = current_date
    ));

  begin
    insert into public.keyword_rank_snapshots (
      organization_id, tracked_keyword_id, snapshot_date, position
    ) values (v_organization_id, v_keyword_id, current_date, 9);
  exception when unique_violation then
    v_duplicate_rejected := true;
  end;
  insert into mk6a_runtime_checks values ('one_snapshot_per_keyword_per_day', v_duplicate_rejected);

  begin
    insert into public.tracked_keywords (
      organization_id, brand_id, tracked_page_id, keyword, target_rank_tier, created_by
    ) values (v_organization_id, v_brand_id, v_page_id, 'invalid tier', 'top_100', v_actor_id);
  exception when check_violation then
    v_invalid_tier_rejected := true;
  end;
  insert into mk6a_runtime_checks values ('target_rank_tier_is_constrained', v_invalid_tier_rejected);

  insert into public.organizations (id, name, slug)
  values (v_other_organization_id, 'MK6a verifier hidden org', 'mk6a-' || substr(v_other_organization_id::text, 1, 8));
  insert into public.agency_clients (id, organization_id, name, created_by)
  values (v_other_client_id, v_other_organization_id, 'MK6a verifier hidden client', v_actor_id);
  insert into public.brands (id, organization_id, client_id, name, created_by)
  values (v_other_brand_id, v_other_organization_id, v_other_client_id, 'MK6a verifier hidden brand', v_actor_id);
  insert into public.tracked_pages (
    id, organization_id, brand_id, page_url, page_type, created_by
  ) values (
    v_other_page_id, v_other_organization_id, v_other_brand_id,
    'https://mk6a-hidden-' || substr(v_other_page_id::text, 1, 8) || '.example/',
    'service', v_actor_id
  );
  insert into public.tracked_keywords (
    id, organization_id, brand_id, tracked_page_id, keyword, created_by
  ) values (
    v_other_keyword_id, v_other_organization_id, v_other_brand_id, v_other_page_id,
    'hidden mk6a keyword', v_actor_id
  );
  insert into public.keyword_rank_snapshots (
    organization_id, tracked_keyword_id, snapshot_date, position
  ) values (v_other_organization_id, v_other_keyword_id, current_date, 8);

  begin
    insert into public.tracked_keywords (
      organization_id, brand_id, tracked_page_id, keyword, created_by
    ) values (v_organization_id, v_brand_id, v_other_page_id, 'cross organization page', v_actor_id);
  exception when foreign_key_violation then
    v_cross_org_page_rejected := true;
  end;
  insert into mk6a_runtime_checks values ('composite_page_foreign_key_rejects_cross_org_target', v_cross_org_page_rejected);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_visible_keywords from public.tracked_keywords where id = v_keyword_id;
  select count(*) into v_hidden_keywords from public.tracked_keywords where id = v_other_keyword_id;
  select count(*) into v_visible_snapshots from public.keyword_rank_snapshots where tracked_keyword_id = v_keyword_id;
  select count(*) into v_hidden_snapshots from public.keyword_rank_snapshots where tracked_keyword_id = v_other_keyword_id;
  reset role;
  insert into mk6a_runtime_checks values
    ('authenticated_reads_are_organization_isolated',
      v_visible_keywords = 1 and v_hidden_keywords = 0 and v_visible_snapshots = 1 and v_hidden_snapshots = 0
    );
end;
$$;

select jsonb_build_object(
  'mk6a_tables_exist_and_rls_enabled', (
    select count(*) = 2 and bool_and(relrowsecurity)
    from pg_class
    where oid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
  ),
  'mk6a_browser_is_read_only', (
    select bool_and(
      has_table_privilege('authenticated', oid, 'select')
      and not has_table_privilege('authenticated', oid, 'insert, update, delete')
      and not has_table_privilege('anon', oid, 'select, insert, update, delete')
    )
    from pg_class
    where oid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
  ),
  'mk6a_team_read_policies_exist', (
    select count(*) = 2
    from pg_policies
    where schemaname = 'public'
      and tablename in ('tracked_keywords', 'keyword_rank_snapshots')
      and cmd = 'SELECT'
      and qual like '%is_team_organization_member(organization_id)%'
  ),
  'mk6a_composite_foreign_keys_exist', (
    select count(*) = 4
    from pg_constraint
    where contype = 'f'
      and conrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and array_length(conkey, 1) = 2
  ),
  'mk6a_snapshots_are_append_only_for_service_role',
    has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'select, insert')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'update, delete')
) || (select jsonb_object_agg(check_name, passed) from mk6a_runtime_checks);

rollback;
