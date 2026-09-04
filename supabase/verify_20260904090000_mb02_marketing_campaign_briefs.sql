-- MB02B exhaustive rollback-safe verification. Run only after the migration.
begin;

create temporary table mb02b_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into mb02b_checks values
('ledger_exact_columns_types_defaults', (
  select array_agg(column_name::text order by ordinal_position) = array[
    'id','organization_id','actor_id','action','idempotency_key','payload_checksum',
    'artifact_id','artifact_version_id','campaign_id','created_at','expires_at'
  ]::text[]
  and array_agg(data_type::text order by ordinal_position) = array[
    'uuid','uuid','uuid','text','uuid','text','uuid','uuid','uuid',
    'timestamp with time zone','timestamp with time zone'
  ]::text[]
  and bool_and(is_nullable = 'NO')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'marketing_brief_save_requests'
)),
('ledger_defaults_exact', (
  select count(*) = 4
  from information_schema.columns
  where table_schema = 'public' and table_name = 'marketing_brief_save_requests'
    and ((column_name = 'id' and column_default like '%gen_random_uuid%')
      or (column_name = 'action' and column_default like '%save_campaign_brief%')
      or (column_name = 'created_at' and column_default = 'now()')
      or (column_name = 'expires_at' and column_default like '%30 days%'))
)),
('ledger_checks_exact', (
  select count(*) = 3
    and bool_or(pg_get_constraintdef(oid) like '%action = ''save_campaign_brief''%')
    and bool_or(pg_get_constraintdef(oid) like '%payload_checksum%^[a-f0-9]{64}$%')
    and bool_or(pg_get_constraintdef(oid) like '%expires_at > created_at%')
  from pg_constraint
  where conrelid = 'public.marketing_brief_save_requests'::regclass and contype = 'c'
)),
('ledger_foreign_keys_exact', (
  select count(*) = 5
    and bool_or(pg_get_constraintdef(oid) = 'FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE')
    and bool_or(pg_get_constraintdef(oid) = 'FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT')
    and bool_or(pg_get_constraintdef(oid) = 'FOREIGN KEY (artifact_id, organization_id) REFERENCES artifacts(id, organization_id) ON DELETE CASCADE')
    and bool_or(pg_get_constraintdef(oid) = 'FOREIGN KEY (artifact_version_id, organization_id) REFERENCES artifact_versions(id, organization_id) ON DELETE CASCADE')
    and bool_or(pg_get_constraintdef(oid) = 'FOREIGN KEY (campaign_id, organization_id) REFERENCES marketing_campaigns(id, organization_id) ON DELETE CASCADE')
  from pg_constraint
  where conrelid = 'public.marketing_brief_save_requests'::regclass and contype = 'f'
)),
('ledger_uniqueness_exact', (
  select count(*) = 3
    and bool_or(pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')
    and bool_or(pg_get_constraintdef(oid) = 'UNIQUE (organization_id, actor_id, action, idempotency_key)')
    and bool_or(pg_get_constraintdef(oid) = 'UNIQUE (id, organization_id)')
  from pg_constraint
  where conrelid = 'public.marketing_brief_save_requests'::regclass and contype in ('p','u')
)),
('ledger_expiry_index_exact', exists (
  select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'idx_marketing_brief_save_requests_expiry'
    and indexdef like '%(expires_at)%'
)),
('canonical_lineage_indexes_exact', exists (
  select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'uq_marketing_campaign_artifacts_campaign_brief_lineage'
    and indexdef like '%UNIQUE%organization_id, campaign_id%WHERE (relation_type = ''campaign_brief''%'
) and exists (
  select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'uq_marketing_campaign_artifacts_artifact_lineage'
    and indexdef like '%UNIQUE%organization_id, artifact_id%'
)),
('ledger_rls_and_policies_exact',
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.marketing_brief_save_requests'::regclass)
  and not exists (select 1 from pg_policy where polrelid = 'public.marketing_brief_save_requests'::regclass)
),
('ledger_acl_exact',
  not exists (
    select 1 from pg_class relation
    cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
    where relation.oid = 'public.marketing_brief_save_requests'::regclass
      and acl.grantee in (0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'))
      and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  )
  and has_table_privilege('service_role','public.marketing_brief_save_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
),
('ledger_is_metadata_only', not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'marketing_brief_save_requests'
    and column_name in ('content','brief','prompt','output','body','notes','title')
)),
('rpc_exact_signatures_exist',
  to_regprocedure('public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)') is not null
  and to_regprocedure('public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)') is not null
),
('rpc_owner_invoker_search_path_volatility_exact', (
  select count(*) = 2
    and bool_and(not procedure.prosecdef)
    and bool_and(procedure.proconfig = array['search_path=""'])
    and bool_and(procedure.provolatile = 'v')
    and bool_and(procedure.proowner = (select relowner from pg_class where oid = 'public.marketing_brief_save_requests'::regclass))
  from pg_proc procedure
  where procedure.oid in (
    'public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)'::regprocedure,
    'public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)'::regprocedure
  )
)),
('rpc_acl_exact',
  not has_function_privilege('anon','public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)','EXECUTE')
  and has_function_privilege('service_role','public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)','EXECUTE')
  and not exists (
    select 1 from pg_proc procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
    where procedure.oid in (
      'public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)'::regprocedure,
      'public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)'::regprocedure
    ) and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  )
),
('generic_two_approver_rpc_preserved',
  position('cardinality(p_required_approver_ids) < 2' in pg_get_functiondef(
    'public.create_artifact_approval_request(uuid,text,uuid[],uuid)'::regprocedure)) > 0
),
('expiry_and_concurrency_guards_present',
  position('expires_at <= pg_catalog.clock_timestamp()' in pg_get_functiondef(
    'public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)'::regprocedure)) > 0
  and position('expires_at > pg_catalog.clock_timestamp()' in pg_get_functiondef(
    'public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)'::regprocedure)) > 0
  and (regexp_count(pg_get_functiondef(
    'public.save_marketing_campaign_brief(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text,boolean,uuid,text,uuid)'::regprocedure), 'pg_advisory_xact_lock') = 2)
);

insert into mb02b_checks values
('first_save_is_single_unapproved_lineage', false),
('unexpired_request_replays_exact_version', false),
('expired_request_does_not_replay_and_key_is_reusable', false),
('reused_key_replays_new_version_under_lock', false),
('conflicting_unexpired_reuse_rejected', false),
('duplicate_first_save_rejected', false),
('artifact_rebind_rejected', false),
('cross_tenant_save_rejected', false),
('foreign_asset_version_rejected', false),
('immutable_version_update_rejected', false),
('campaign_brief_one_eligible_approver_succeeds', false),
('campaign_brief_ineligible_approver_rejected', false),
('generic_one_approver_still_rejected', false),
('sequential_lineage_cardinality_exact', false);

do $$
declare
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_contributor uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_engagement uuid := gen_random_uuid();
  v_service uuid := gen_random_uuid();
  v_campaign uuid := gen_random_uuid();
  v_other_campaign uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_artifact uuid;
  v_first_version uuid;
  v_second_version uuid;
  v_generic_artifact uuid := gen_random_uuid();
  v_generic_version uuid := gen_random_uuid();
  v_rejected boolean;
begin
  insert into auth.users (id) values (v_actor), (v_manager), (v_contributor);
  insert into public.organizations (id,name,slug) values
    (v_org,'MB02B verifier','mb02b-' || replace(v_org::text,'-','')),
    (v_other_org,'MB02B other verifier','mb02b-other-' || replace(v_other_org::text,'-',''));
  insert into public.organization_memberships (organization_id,user_id,member_kind,role,department_id,status) values
    (v_org,v_actor,'team','system_owner',null,'active'),
    (v_org,v_manager,'team','department_manager','marketing','active'),
    (v_org,v_contributor,'team','contributor','marketing','active');
  insert into public.agency_clients (id,organization_id,name,created_by)
    values (v_client,v_org,'MB02B client',v_actor);
  insert into public.brands (id,organization_id,client_id,name,is_default,created_by)
    values (v_brand,v_org,v_client,'MB02B brand',true,v_actor);
  insert into public.engagements (id,organization_id,client_id,brand_id,name,status,created_by)
    values (v_engagement,v_org,v_client,v_brand,'MB02B engagement','active',v_actor);
  insert into public.service_catalog (id,organization_id,department_id,slug,name,is_active)
    values (v_service,v_org,'marketing','mb02b_verifier','MB02B verifier',true);
  insert into public.engagement_services (organization_id,engagement_id,service_id,status,activated_by)
    values (v_org,v_engagement,v_service,'active',v_actor);
  insert into public.marketing_campaigns (
    id,organization_id,engagement_id,brand_id,name,planned_channels,created_by,updated_by
  ) values
    (v_campaign,v_org,v_engagement,v_brand,'MB02B campaign',array['email'],v_actor,v_actor),
    (v_other_campaign,v_org,v_engagement,v_brand,'MB02B other campaign',array['search'],v_actor,v_actor);

  select public.save_marketing_campaign_brief(
    v_org,v_engagement,v_campaign,null,null,'MB02B brief',
    '{"campaign_goal":"Launch","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
    repeat('a',64),'first',false,v_key,repeat('1',64),v_actor
  ) into v_first;
  v_artifact := (v_first->>'artifact_id')::uuid;
  v_first_version := (v_first->>'id')::uuid;
  update mb02b_checks set passed = (v_first->>'replayed')::boolean = false
    and (select count(*) = 1 from public.marketing_campaign_artifacts where organization_id=v_org and campaign_id=v_campaign and relation_type='campaign_brief' and artifact_id=v_artifact)
    and (select count(*) = 1 from public.artifact_versions where id=v_first_version and artifact_id=v_artifact)
    and not exists (select 1 from public.artifact_approvals where artifact_version_id=v_first_version)
  where check_name='first_save_is_single_unapproved_lineage';

  select public.save_marketing_campaign_brief(
    v_org,v_engagement,v_campaign,null,null,'MB02B brief',
    '{"campaign_goal":"Launch","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
    repeat('a',64),'first',false,v_key,repeat('1',64),v_actor
  ) into v_replay;
  update mb02b_checks set passed = (v_replay->>'replayed')::boolean
    and (v_replay->>'id')::uuid = v_first_version
    and (select count(*) = 1 from public.artifact_versions where artifact_id=v_artifact)
  where check_name='unexpired_request_replays_exact_version';

  update public.marketing_brief_save_requests
  set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
  where organization_id=v_org and actor_id=v_actor and idempotency_key=v_key;
  select public.save_marketing_campaign_brief(
    v_org,v_engagement,v_campaign,v_artifact,v_first_version,'MB02B brief',
    '{"campaign_goal":"Launch two","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
    repeat('b',64),'second',false,v_key,repeat('2',64),v_actor
  ) into v_second;
  v_second_version := (v_second->>'id')::uuid;
  update mb02b_checks set passed = not (v_second->>'replayed')::boolean
    and v_second_version <> v_first_version
    and (select count(*) = 1 and bool_and(expires_at > now()) from public.marketing_brief_save_requests where organization_id=v_org and actor_id=v_actor and idempotency_key=v_key)
  where check_name='expired_request_does_not_replay_and_key_is_reusable';

  select public.save_marketing_campaign_brief(
    v_org,v_engagement,v_campaign,v_artifact,v_first_version,'MB02B brief',
    '{"campaign_goal":"Launch two","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
    repeat('b',64),'second',false,v_key,repeat('2',64),v_actor
  ) into v_replay;
  update mb02b_checks set passed = (v_replay->>'replayed')::boolean
    and (v_replay->>'id')::uuid = v_second_version
    and (select count(*) = 2 from public.artifact_versions where artifact_id=v_artifact)
  where check_name='reused_key_replays_new_version_under_lock';

  v_rejected := false;
  begin
    perform public.save_marketing_campaign_brief(v_org,v_engagement,v_campaign,v_artifact,v_second_version,'Conflict',
      '{"campaign_goal":"Conflict","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
      repeat('c',64),'conflict',false,v_key,repeat('3',64),v_actor);
  exception when others then v_rejected := sqlerrm like '%different payload%'; end;
  update mb02b_checks set passed=v_rejected where check_name='conflicting_unexpired_reuse_rejected';

  v_rejected := false;
  begin
    perform public.save_marketing_campaign_brief(v_org,v_engagement,v_campaign,null,null,'Duplicate',
      '{"campaign_goal":"Duplicate","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
      repeat('d',64),'duplicate',false,gen_random_uuid(),repeat('4',64),v_actor);
  exception when others then v_rejected := sqlerrm like '%already has a canonical campaign brief%'; end;
  update mb02b_checks set passed=v_rejected where check_name='duplicate_first_save_rejected';

  v_rejected := false;
  begin
    perform public.save_marketing_campaign_brief(v_org,v_engagement,v_other_campaign,v_artifact,v_second_version,'Rebind',
      '{"campaign_goal":"Rebind","channels":["email"],"existing_asset_version_ids":[]}'::jsonb,
      repeat('e',64),'rebind',false,gen_random_uuid(),repeat('5',64),v_actor);
  exception when others then v_rejected := sqlerrm like '%exact canonical lineage%'; end;
  update mb02b_checks set passed=v_rejected where check_name='artifact_rebind_rejected';

  v_rejected := false;
  begin
    perform public.save_marketing_campaign_brief(v_other_org,v_engagement,v_campaign,null,null,'Cross tenant','{}',repeat('f',64),'',false,gen_random_uuid(),repeat('6',64),v_actor);
  exception when others then v_rejected := true; end;
  update mb02b_checks set passed=v_rejected where check_name='cross_tenant_save_rejected';

  v_rejected := false;
  begin
    perform public.save_marketing_campaign_brief(v_org,v_engagement,v_campaign,v_artifact,v_second_version,'Foreign asset',
      jsonb_build_object('campaign_goal','Asset','channels',jsonb_build_array('email'),'existing_asset_version_ids',jsonb_build_array(gen_random_uuid()::text)),
      repeat('0',64),'asset',false,gen_random_uuid(),repeat('7',64),v_actor);
  exception when others then v_rejected := sqlerrm like '%exact readable version%'; end;
  update mb02b_checks set passed=v_rejected where check_name='foreign_asset_version_rejected';

  v_rejected := false;
  begin update public.artifact_versions set content='{}' where id=v_first_version;
  exception when others then v_rejected := sqlerrm like '%immutable%'; end;
  update mb02b_checks set passed=v_rejected where check_name='immutable_version_update_rejected';

  perform public.create_marketing_campaign_brief_approval_request(v_second_version,'parallel',array[v_manager],v_actor);
  update mb02b_checks set passed = exists (
    select 1 from public.artifact_approval_requests request
    join public.artifact_approval_signoffs signoff on signoff.request_id=request.id
    where request.artifact_version_id=v_second_version and signoff.required_approver_id=v_manager
  ) where check_name='campaign_brief_one_eligible_approver_succeeds';

  v_rejected := false;
  begin perform public.create_marketing_campaign_brief_approval_request(v_first_version,'parallel',array[v_contributor],v_actor);
  exception when others then v_rejected := sqlerrm like '%leaders or the Marketing department manager%'; end;
  update mb02b_checks set passed=v_rejected where check_name='campaign_brief_ineligible_approver_rejected';

  insert into public.artifacts (id,organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values (v_generic_artifact,v_org,v_brand,v_engagement,'channel_strategy','Generic approval verifier',v_actor);
  insert into public.artifact_versions (id,organization_id,artifact_id,version_number,content,content_checksum,created_by)
    values (v_generic_version,v_org,v_generic_artifact,1,'{}',repeat('8',64),v_actor);
  v_rejected := false;
  begin perform public.create_artifact_approval_request(v_generic_version,'parallel',array[v_manager],v_actor);
  exception when others then v_rejected := sqlerrm like '%between 2 and 50%'; end;
  update mb02b_checks set passed=v_rejected where check_name='generic_one_approver_still_rejected';

  update mb02b_checks set passed =
    (select count(*)=1 from public.marketing_campaign_artifacts where organization_id=v_org and campaign_id=v_campaign and relation_type='campaign_brief')
    and (select count(*)=1 from public.marketing_campaign_artifacts where organization_id=v_org and artifact_id=v_artifact)
    and (select count(*)=2 from public.artifact_versions where organization_id=v_org and artifact_id=v_artifact)
  where check_name='sequential_lineage_cardinality_exact';
end;
$$;

select jsonb_object_agg(check_name,passed order by check_name) as mb02b_verification
from mb02b_checks;

do $$
declare v_failed text;
begin
  select string_agg(check_name,', ' order by check_name) into v_failed
  from mb02b_checks where not passed;
  if v_failed is not null then raise exception 'MB02B verification failed: %',v_failed; end if;
end;
$$;

select 'PASS' as mb02b_final_result;
rollback;
