-- MB03B rollback-safe verification. Run after 20260912160000_mb03b_seo_research.sql.
begin;

create temporary table mb03b_checks(check_name text primary key, passed boolean not null) on commit drop;

insert into mb03b_checks values
('artifact_allowlist_additive', (
  select pg_get_constraintdef(oid) like '%seo_research%'
    and pg_get_constraintdef(oid) like '%keyword_strategy%'
    and pg_get_constraintdef(oid) like '%design_system%'
  from pg_constraint where conrelid='public.artifacts'::regclass and conname='artifacts_artifact_type_check'
)),
('generic_two_approver_policy_preserved', position('cardinality(p_required_approver_ids) < 2' in pg_get_functiondef(
  'public.create_artifact_approval_request(uuid,text,uuid[],uuid)'::regprocedure)) > 0),
('ledger_metadata_only', not exists (
  select 1 from information_schema.columns where table_schema='public' and table_name='marketing_seo_research_save_requests'
    and column_name in ('content','research','prompt','output','body','notes','title')
)),
('ledger_rls_no_browser_policy',
  (select relrowsecurity from pg_class where oid='public.marketing_seo_research_save_requests'::regclass)
  and not exists(select 1 from pg_policy where polrelid='public.marketing_seo_research_save_requests'::regclass)
),
('ledger_browser_acl_denied',
  not has_table_privilege('anon','public.marketing_seo_research_save_requests','SELECT')
  and not has_table_privilege('authenticated','public.marketing_seo_research_save_requests','SELECT')
),
('rpc_invoker_fixed_path', (
  select not prosecdef and proconfig=array['search_path=""'] from pg_proc
  where oid='public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid)'::regprocedure
)),
('rpc_acl_service_only',
  not has_function_privilege('anon','public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid)','EXECUTE')
),
('replay_and_concurrency_guards_present',
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid)'::regprocedure)) > 0
  and position('expected_latest_version_id' in pg_get_functiondef('public.save_marketing_seo_research(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid)'::regprocedure)) > 0
);

insert into mb03b_checks values
('first_save_unapproved',false),('same_request_replays',false),('conflicting_reuse_rejected',false),
('optimistic_second_version',false),('foreign_strategy_rejected',false),('cross_tenant_rejected',false),
('immutable_version_preserved',false),('unknown_artifact_type_rejected',false),
('service_role_runtime_save',false),('null_department_rejected',false),
('suspended_member_replay_rejected',false),('inactive_service_replay_rejected',false),
('expired_replay_creates_fresh_output',false);

grant select, update on mb03b_checks to service_role;

do $$
declare
  v_org uuid:=gen_random_uuid(); v_other_org uuid:=gen_random_uuid(); v_actor uuid:=gen_random_uuid();
  v_other_actor uuid:=gen_random_uuid(); v_client uuid:=gen_random_uuid(); v_brand uuid:=gen_random_uuid();
  v_engagement uuid:=gen_random_uuid(); v_service uuid:=gen_random_uuid(); v_strategy uuid:=gen_random_uuid();
  v_strategy_version uuid:=gen_random_uuid(); v_key uuid:=gen_random_uuid(); v_first jsonb; v_replay jsonb; v_second jsonb;
  v_expiry_key uuid:=gen_random_uuid(); v_expiry_first jsonb; v_expiry_second jsonb;
  v_artifact uuid; v_first_version uuid; v_rejected boolean; v_content jsonb;
begin
  insert into auth.users(id) values(v_actor),(v_other_actor);
  insert into public.organizations(id,name,slug) values
    (v_org,'MB03B verifier','mb03b-'||replace(v_org::text,'-','')),
    (v_other_org,'MB03B other','mb03b-other-'||replace(v_other_org::text,'-',''));
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (v_org,v_actor,'team','contributor','marketing','active'),
    (v_other_org,v_other_actor,'team','contributor','marketing','active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(v_client,v_org,'MB03B client',v_actor);
  insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values(v_brand,v_org,v_client,'MB03B brand',true,v_actor);
  insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by)
    values(v_engagement,v_org,v_client,v_brand,'MB03B engagement','active',v_actor);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active)
    values(v_service,v_org,'marketing','mb03b_verifier','MB03B verifier',true);
  insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by)
    values(v_org,v_engagement,v_service,'active',v_actor);
  insert into public.artifacts(id,organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(v_strategy,v_org,v_brand,v_engagement,'keyword_strategy','Canonical strategy',v_actor);
  insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,created_by)
    values(v_strategy_version,v_org,v_strategy,1,'{}',repeat('9',64),v_actor);
  v_content:=jsonb_build_object(
    'input',jsonb_build_object('research_type','page','target_url','https://example.test/page','market','Test market',
      'language',null,'device',null,'seed_keywords',jsonb_build_array('test query'),'content_strategy_version_id',v_strategy_version),
    'captured_at','2026-09-12T00:00:00Z','source_availability',jsonb_build_array(),
    'source_facts',jsonb_build_array(jsonb_build_object('category','index status','observation','Latest stored index status: indexed.',
      'source','technical_seo_audit','evidence_date','2026-09-12','affected_url','https://example.test/page','source_record_id',gen_random_uuid())),
    'interpretations',jsonb_build_array(jsonb_build_object('category','index status','proposed_action','Retain monitoring.',
      'limitations','Stored evidence only.','affected_url','https://example.test/page')),
    'limitations',jsonb_build_array('No remote fetch was performed.')
  );
  execute 'set local role service_role';
  select public.save_marketing_seo_research(v_org,v_engagement,null,null,'MB03B research',v_content,repeat('a',64),'first',v_key,repeat('1',64),v_actor) into v_first;
  v_artifact:=(v_first->>'artifact_id')::uuid; v_first_version:=(v_first->>'id')::uuid;
  update mb03b_checks set passed=not (v_first->>'replayed')::boolean
    and (select artifact_type='seo_research' from public.artifacts where id=v_artifact)
    and not exists(select 1 from public.artifact_approvals where artifact_version_id=v_first_version)
  where check_name='first_save_unapproved';
  update mb03b_checks set passed=current_user='service_role' where check_name='service_role_runtime_save';
  select public.save_marketing_seo_research(v_org,v_engagement,null,null,'MB03B research',v_content,repeat('a',64),'first',v_key,repeat('1',64),v_actor) into v_replay;
  update mb03b_checks set passed=(v_replay->>'replayed')::boolean and (v_replay->>'id')::uuid=v_first_version
    and (select count(*)=1 from public.artifact_versions where artifact_id=v_artifact)
  where check_name='same_request_replays';
  update public.organization_memberships set department_id=null
    where organization_id=v_org and user_id=v_actor;
  v_rejected:=false;
  begin perform public.save_marketing_seo_research(v_org,v_engagement,null,null,'Null department',v_content,repeat('a',64),'',gen_random_uuid(),repeat('6',64),v_actor);
  exception when insufficient_privilege then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='null_department_rejected';
  update public.organization_memberships set department_id='marketing'
    where organization_id=v_org and user_id=v_actor;
  update public.organization_memberships set status='suspended'
    where organization_id=v_org and user_id=v_actor;
  v_rejected:=false;
  begin perform public.save_marketing_seo_research(v_org,v_engagement,null,null,'MB03B research',v_content,repeat('a',64),'first',v_key,repeat('1',64),v_actor);
  exception when insufficient_privilege then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='suspended_member_replay_rejected';
  update public.organization_memberships set status='active'
    where organization_id=v_org and user_id=v_actor;
  update public.service_catalog set is_active=false where id=v_service;
  v_rejected:=false;
  begin perform public.save_marketing_seo_research(v_org,v_engagement,null,null,'MB03B research',v_content,repeat('a',64),'first',v_key,repeat('1',64),v_actor);
  exception when insufficient_privilege then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='inactive_service_replay_rejected';
  update public.service_catalog set is_active=true where id=v_service;
  select public.save_marketing_seo_research(v_org,v_engagement,null,null,'Expiry first',v_content,repeat('e',64),'',v_expiry_key,repeat('7',64),v_actor) into v_expiry_first;
  update public.marketing_seo_research_save_requests
    set created_at=pg_catalog.clock_timestamp()-interval '31 days', expires_at=pg_catalog.clock_timestamp()-interval '1 second'
    where organization_id=v_org and actor_id=v_actor and idempotency_key=v_expiry_key;
  select public.save_marketing_seo_research(v_org,v_engagement,null,null,'Expiry first',v_content,repeat('e',64),'',v_expiry_key,repeat('7',64),v_actor) into v_expiry_second;
  update mb03b_checks set passed=not (v_expiry_second->>'replayed')::boolean
    and (v_expiry_second->>'id')::uuid<>(v_expiry_first->>'id')::uuid
  where check_name='expired_replay_creates_fresh_output';
  v_rejected:=false;
  begin perform public.save_marketing_seo_research(v_org,v_engagement,null,null,'Conflict',v_content,repeat('a',64),'',v_key,repeat('2',64),v_actor);
  exception when unique_violation then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='conflicting_reuse_rejected';
  select public.save_marketing_seo_research(v_org,v_engagement,v_artifact,v_first_version,'MB03B research v2',v_content,repeat('b',64),'second',gen_random_uuid(),repeat('3',64),v_actor) into v_second;
  update mb03b_checks set passed=(v_second->>'replayed')::boolean=false and (v_second->>'parent_version_id')::uuid=v_first_version
    and (select count(*)=2 from public.artifact_versions where artifact_id=v_artifact)
  where check_name='optimistic_second_version';
  v_rejected:=false;
  begin perform public.save_marketing_seo_research(v_org,v_engagement,null,null,'Foreign strategy',jsonb_set(v_content,'{input,content_strategy_version_id}',to_jsonb(gen_random_uuid())),repeat('c',64),'',gen_random_uuid(),repeat('4',64),v_actor);
  exception when insufficient_privilege then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='foreign_strategy_rejected';
  v_rejected:=false;
  begin perform public.save_marketing_seo_research(v_other_org,v_engagement,null,null,'Cross tenant',v_content,repeat('d',64),'',gen_random_uuid(),repeat('5',64),v_other_actor);
  exception when insufficient_privilege then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='cross_tenant_rejected';
  v_rejected:=false;
  begin update public.artifact_versions set content='{}' where id=v_first_version;
  exception when others then v_rejected:=sqlerrm like '%immutable%'; end;
  update mb03b_checks set passed=v_rejected where check_name='immutable_version_preserved';
  v_rejected:=false;
  begin insert into public.artifacts(organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(v_org,v_brand,v_engagement,'unknown_research','Invalid',v_actor);
  exception when check_violation then v_rejected:=true; end;
  update mb03b_checks set passed=v_rejected where check_name='unknown_artifact_type_rejected';
  execute 'reset role';
end;
$$;

select jsonb_object_agg(check_name,passed order by check_name) as mb03b_verification from mb03b_checks;
do $$ declare v_failed text; begin
  select string_agg(check_name,', ' order by check_name) into v_failed from mb03b_checks where not passed;
  if v_failed is not null then raise exception 'MB03B verification failed: %',v_failed; end if;
end $$;
select 'PASS' as mb03b_final_result;
rollback;
