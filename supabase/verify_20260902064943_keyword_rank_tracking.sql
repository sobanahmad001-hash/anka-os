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
  v_source_artifact_id uuid := gen_random_uuid();
  v_source_keyword_id uuid := gen_random_uuid();
  v_other_organization_id uuid := gen_random_uuid();
  v_other_client_id uuid := gen_random_uuid();
  v_other_brand_id uuid := gen_random_uuid();
  v_other_page_id uuid := gen_random_uuid();
  v_other_keyword_id uuid := gen_random_uuid();
  v_duplicate_rejected boolean := false;
  v_invalid_tier_rejected boolean := false;
  v_cross_org_page_rejected boolean := false;
  v_cross_org_brand_rejected boolean := false;
  v_cross_org_source_rejected boolean := false;
  v_cross_org_snapshot_rejected boolean := false;
  v_negative_position_rejected boolean := false;
  v_negative_clicks_rejected boolean := false;
  v_negative_impressions_rejected boolean := false;
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

  begin
    insert into public.keyword_rank_snapshots (organization_id, tracked_keyword_id, snapshot_date, position)
    values (v_organization_id, v_keyword_id, current_date + 1, -1);
  exception when check_violation then v_negative_position_rejected := true;
  end;
  begin
    insert into public.keyword_rank_snapshots (organization_id, tracked_keyword_id, snapshot_date, search_console_clicks)
    values (v_organization_id, v_keyword_id, current_date + 2, -1);
  exception when check_violation then v_negative_clicks_rejected := true;
  end;
  begin
    insert into public.keyword_rank_snapshots (organization_id, tracked_keyword_id, snapshot_date, search_console_impressions)
    values (v_organization_id, v_keyword_id, current_date + 3, -1);
  exception when check_violation then v_negative_impressions_rejected := true;
  end;
  insert into mk6a_runtime_checks values
    ('negative_rank_metrics_are_rejected', v_negative_position_rejected and v_negative_clicks_rejected and v_negative_impressions_rejected);

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
    insert into public.tracked_keywords (organization_id, brand_id, tracked_page_id, keyword, created_by)
    values (v_organization_id, v_other_brand_id, v_page_id, 'cross organization brand', v_actor_id);
  exception when foreign_key_violation then v_cross_org_brand_rejected := true;
  end;
  begin
    insert into public.tracked_keywords (organization_id, brand_id, tracked_page_id, source_artifact_id, keyword, created_by)
    values (v_organization_id, v_brand_id, v_page_id, gen_random_uuid(), 'cross organization source', v_actor_id);
  exception when foreign_key_violation then v_cross_org_source_rejected := true;
  end;
  begin
    insert into public.keyword_rank_snapshots (organization_id, tracked_keyword_id, snapshot_date, position)
    values (v_organization_id, v_other_keyword_id, current_date + 1, 8);
  exception when foreign_key_violation then v_cross_org_snapshot_rejected := true;
  end;
  insert into mk6a_runtime_checks values
    ('composite_brand_source_and_snapshot_foreign_keys_reject_cross_org_targets', v_cross_org_brand_rejected and v_cross_org_source_rejected and v_cross_org_snapshot_rejected);

  insert into public.artifacts (id, organization_id, brand_id, artifact_type, title, created_by)
  values (v_source_artifact_id, v_organization_id, v_brand_id, 'keyword_strategy', 'MK6a verifier keyword source', v_actor_id);
  insert into public.tracked_keywords (id, organization_id, brand_id, tracked_page_id, source_artifact_id, keyword, created_by)
  values (v_source_keyword_id, v_organization_id, v_brand_id, v_page_id, v_source_artifact_id, 'source deletion check', v_actor_id);
  delete from public.artifacts where id = v_source_artifact_id;
  insert into mk6a_runtime_checks values
    ('source_artifact_deletion_nulls_only_source_column', (
      select source_artifact_id is null and organization_id = v_organization_id and brand_id = v_brand_id and tracked_page_id = v_page_id
      from public.tracked_keywords where id = v_source_keyword_id
    ));

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
      and not has_table_privilege('authenticated', oid, 'insert')
      and not has_table_privilege('authenticated', oid, 'update')
      and not has_table_privilege('authenticated', oid, 'delete')
      and not has_table_privilege('authenticated', oid, 'truncate')
      and not has_table_privilege('authenticated', oid, 'references')
      and not has_table_privilege('authenticated', oid, 'trigger')
      and not has_table_privilege('authenticated', oid, 'maintain')
      and not has_table_privilege('anon', oid, 'select')
      and not has_table_privilege('anon', oid, 'insert')
      and not has_table_privilege('anon', oid, 'update')
      and not has_table_privilege('anon', oid, 'delete')
      and not has_table_privilege('anon', oid, 'truncate')
      and not has_table_privilege('anon', oid, 'references')
      and not has_table_privilege('anon', oid, 'trigger')
      and not has_table_privilege('anon', oid, 'maintain')
    )
    from pg_class
    where oid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
  ),
  'mk6a_exact_team_read_policies_exist', (
    select count(*) = 2 and count(distinct tablename) = 2
    from pg_policies
    where schemaname = 'public'
      and tablename in ('tracked_keywords', 'keyword_rank_snapshots')
      and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
      and with_check is null
      and qual like '%is_team_organization_member(organization_id)%'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('tracked_keywords', 'keyword_rank_snapshots')
      and (cmd <> 'SELECT' or permissive <> 'PERMISSIVE' or roles <> array['authenticated']::name[] or with_check is not null or qual not like '%is_team_organization_member(organization_id)%')
  ),
  'mk6a_composite_foreign_keys_exist', (
    select count(*) = 4
    from pg_constraint
    where contype = 'f'
      and conrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and array_length(conkey, 1) = 2
  ),
  'mk6a_service_role_acl_is_deliberate', (
    has_table_privilege('service_role', 'public.tracked_keywords', 'select')
    and has_table_privilege('service_role', 'public.tracked_keywords', 'insert')
    and has_table_privilege('service_role', 'public.tracked_keywords', 'update')
    and has_table_privilege('service_role', 'public.tracked_keywords', 'delete')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'truncate')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'references')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'trigger')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'maintain')
  ),
  'mk6a_snapshots_are_strictly_append_only_for_service_role', (
    has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'select')
    and has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'insert')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'update')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'delete')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'truncate')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'references')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'trigger')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'maintain')
  ),
  'mk6a_no_explicit_column_grants_or_grant_options', not exists (
    select 1
    from pg_attribute attribute
    where attribute.attrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attacl is not null
  ) and not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('tracked_keywords', 'keyword_rank_snapshots')
      and grantee in ('anon', 'authenticated', 'service_role')
      and is_grantable = 'YES'
  ) and not has_table_privilege('authenticated', 'public.tracked_keywords', 'select with grant option')
    and not has_table_privilege('authenticated', 'public.keyword_rank_snapshots', 'select with grant option')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'select with grant option')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'insert with grant option')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'update with grant option')
    and not has_table_privilege('service_role', 'public.tracked_keywords', 'delete with grant option')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'select with grant option')
    and not has_table_privilege('service_role', 'public.keyword_rank_snapshots', 'insert with grant option'),
  'mk6a_columns_match_contract', (
    select count(*) = 18
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'tracked_keywords' and column_name in ('id', 'organization_id', 'brand_id', 'tracked_page_id', 'keyword', 'source_artifact_id', 'target_rank_tier', 'active', 'created_by', 'created_at'))
        or (table_name = 'keyword_rank_snapshots' and column_name in ('id', 'organization_id', 'tracked_keyword_id', 'snapshot_date', 'position', 'search_console_clicks', 'search_console_impressions', 'fetched_at'))
      )
  ) and (
    select count(*) = 18
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('tracked_keywords', 'keyword_rank_snapshots')
  ),
  'mk6a_constraints_match_contract', (
    select count(*) = 2
    from pg_constraint
    where conrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and contype = 'u'
      and pg_get_constraintdef(oid) in ('UNIQUE (id, organization_id)', 'UNIQUE (tracked_keyword_id, snapshot_date)')
  ) and (
    select count(*) = 2
    from pg_constraint
    where conrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and contype = 'p'
  ) and (
    select count(*) = 5
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_tracked_keywords_page_list', 'idx_tracked_keywords_brand_list', 'idx_tracked_keywords_source_artifact_fk',
        'idx_keyword_rank_snapshots_keyword_history', 'idx_keyword_rank_snapshots_keyword_fk'
      )
  )
  ),
  'mk6a_exact_column_types_nullability_and_defaults', (
    select jsonb_agg(jsonb_build_object('table', rel.relname, 'column', attribute.attname, 'type', format_type(attribute.atttypid, attribute.atttypmod), 'not_null', attribute.attnotnull, 'default', coalesce(pg_get_expr(definition.adbin, definition.adrelid), '')) order by rel.relname, attribute.attnum)
    from pg_attribute attribute
    join pg_class rel on rel.oid = attribute.attrelid
    left join pg_attrdef definition on definition.adrelid = attribute.attrelid and definition.adnum = attribute.attnum
    where attribute.attrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and attribute.attnum > 0 and not attribute.attisdropped
  ) = '[{"table":"keyword_rank_snapshots","column":"id","type":"uuid","not_null":true,"default":"gen_random_uuid()"},{"table":"keyword_rank_snapshots","column":"organization_id","type":"uuid","not_null":true,"default":""},{"table":"keyword_rank_snapshots","column":"tracked_keyword_id","type":"uuid","not_null":true,"default":""},{"table":"keyword_rank_snapshots","column":"snapshot_date","type":"date","not_null":true,"default":""},{"table":"keyword_rank_snapshots","column":"position","type":"numeric","not_null":false,"default":""},{"table":"keyword_rank_snapshots","column":"search_console_clicks","type":"integer","not_null":false,"default":""},{"table":"keyword_rank_snapshots","column":"search_console_impressions","type":"integer","not_null":false,"default":""},{"table":"keyword_rank_snapshots","column":"fetched_at","type":"timestamp with time zone","not_null":true,"default":"now()"},{"table":"tracked_keywords","column":"id","type":"uuid","not_null":true,"default":"gen_random_uuid()"},{"table":"tracked_keywords","column":"organization_id","type":"uuid","not_null":true,"default":""},{"table":"tracked_keywords","column":"brand_id","type":"uuid","not_null":true,"default":""},{"table":"tracked_keywords","column":"tracked_page_id","type":"uuid","not_null":true,"default":""},{"table":"tracked_keywords","column":"keyword","type":"text","not_null":true,"default":""},{"table":"tracked_keywords","column":"source_artifact_id","type":"uuid","not_null":false,"default":""},{"table":"tracked_keywords","column":"target_rank_tier","type":"text","not_null":false,"default":""},{"table":"tracked_keywords","column":"active","type":"boolean","not_null":true,"default":"true"},{"table":"tracked_keywords","column":"created_by","type":"uuid","not_null":true,"default":""},{"table":"tracked_keywords","column":"created_at","type":"timestamp with time zone","not_null":true,"default":"now()"}]'::jsonb,
  'mk6a_foreign_keys_are_exact_and_validated', (
    select count(*) = 5
    from pg_constraint foreign_key
    where foreign_key.contype = 'f'
      and foreign_key.conrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and foreign_key.convalidated
  ) and exists (
    select 1 from pg_constraint where conrelid = 'public.tracked_keywords'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (source_artifact_id, organization_id) REFERENCES artifacts(id, organization_id) ON DELETE SET NULL (source_artifact_id)%'
  ),
  'mk6a_indexes_are_all_valid', (
    select count(*) = 5
    from pg_index index_definition
    join pg_class index_class on index_class.oid = index_definition.indexrelid
    where index_definition.indrelid in ('public.tracked_keywords'::regclass, 'public.keyword_rank_snapshots'::regclass)
      and index_class.relname in ('idx_tracked_keywords_page_list', 'idx_tracked_keywords_brand_list', 'idx_tracked_keywords_source_artifact_fk', 'idx_keyword_rank_snapshots_keyword_history', 'idx_keyword_rank_snapshots_keyword_fk')
      and index_definition.indisvalid and index_definition.indisready
  )
) || (select jsonb_object_agg(check_name, passed) from mk6a_runtime_checks);

rollback;
