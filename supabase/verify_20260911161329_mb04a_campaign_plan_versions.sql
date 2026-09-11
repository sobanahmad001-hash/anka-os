-- MB04A exhaustive rollback-safe PostgreSQL 17 gate. Run after the migration.
begin;

create temporary table mb04a_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into mb04a_checks values
('plan_versions_table_exists', to_regclass('public.marketing_campaign_plan_versions') is not null),
('creative_requirements_table_exists', to_regclass('public.marketing_campaign_plan_creative_requirements') is not null),
('plan_versions_rls_enabled', (select relrowsecurity from pg_class where oid='public.marketing_campaign_plan_versions'::regclass)),
('creative_requirements_rls_enabled', (select relrowsecurity from pg_class where oid='public.marketing_campaign_plan_creative_requirements'::regclass)),
('plan_versions_team_read_policy', exists (
  select 1 from pg_policies where schemaname='public' and tablename='marketing_campaign_plan_versions'
  and roles=array['authenticated']::name[] and cmd='SELECT' and qual like '%is_team_organization_member%'
)),
('requirements_team_read_policy', exists (
  select 1 from pg_policies where schemaname='public' and tablename='marketing_campaign_plan_creative_requirements'
  and roles=array['authenticated']::name[] and cmd='SELECT' and qual like '%is_team_organization_member%'
)),
('authenticated_tables_read_only',
  has_table_privilege('authenticated','public.marketing_campaign_plan_versions','SELECT')
  and has_table_privilege('authenticated','public.marketing_campaign_plan_creative_requirements','SELECT')
  and not has_table_privilege('authenticated','public.marketing_campaign_plan_versions','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.marketing_campaign_plan_creative_requirements','INSERT,UPDATE,DELETE')
),
('service_tables_narrow_write_acl',
  has_table_privilege('service_role','public.marketing_campaign_plan_versions','SELECT,INSERT')
  and has_table_privilege('service_role','public.marketing_campaign_plan_creative_requirements','SELECT,INSERT')
  and not has_table_privilege('service_role','public.marketing_campaign_plan_versions','UPDATE')
  and not has_table_privilege('service_role','public.marketing_campaign_plan_versions','DELETE')
  and not has_table_privilege('service_role','public.marketing_campaign_plan_versions','TRUNCATE')
  and not has_table_privilege('service_role','public.marketing_campaign_plan_creative_requirements','UPDATE')
  and not has_table_privilege('service_role','public.marketing_campaign_plan_creative_requirements','DELETE')
  and not has_table_privilege('service_role','public.marketing_campaign_plan_creative_requirements','TRUNCATE')
),
('plan_versions_immutable_trigger', exists (
  select 1 from pg_trigger where tgrelid='public.marketing_campaign_plan_versions'::regclass
  and tgname='trg_marketing_campaign_plan_versions_immutable' and tgenabled <> 'D'
)),
('requirements_immutable_trigger', exists (
  select 1 from pg_trigger where tgrelid='public.marketing_campaign_plan_creative_requirements'::regclass
  and tgname='trg_marketing_campaign_plan_requirements_immutable' and tgenabled <> 'D'
)),
('campaign_version_unique', exists (
  select 1 from pg_constraint where conrelid='public.marketing_campaign_plan_versions'::regclass
  and contype='u' and pg_get_constraintdef(oid)='UNIQUE (campaign_id, version_number)'
)),
('requirements_redundant_composite_unique_absent', not exists (
  select 1 from pg_constraint where conrelid='public.marketing_campaign_plan_creative_requirements'::regclass
  and contype='u' and pg_get_constraintdef(oid)='UNIQUE (id, organization_id)'
)),
('engagement_event_type_registered', exists (
  select 1 from pg_constraint where conrelid='public.engagement_events'::regclass
  and conname='engagement_events_event_type_check' and position('marketing_campaign_plan_version_created' in pg_get_constraintdef(oid))>0
)),
('draft_only_lifecycle', exists (
  select 1 from pg_constraint where conrelid='public.marketing_campaign_plan_versions'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%lifecycle_status%draft%'
)),
('foreign_key_indexes_present', (
  select count(*)=9 from pg_indexes where schemaname='public' and indexname in (
    'idx_marketing_campaign_plan_versions_campaign','idx_marketing_campaign_plan_versions_engagement',
    'idx_marketing_campaign_plan_versions_brand','idx_marketing_campaign_plan_versions_parent',
    'idx_marketing_campaign_plan_versions_source','idx_marketing_campaign_plan_versions_message',
    'idx_marketing_campaign_plan_versions_measurement','idx_marketing_campaign_plan_requirements_version',
    'idx_marketing_campaign_plan_requirements_message'
  )
)),
('save_rpc_exact_signature', to_regprocedure('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)') is not null),
('save_rpc_security_invoker', not (select prosecdef from pg_proc where oid='public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure)),
('save_rpc_empty_search_path', (select proconfig=array['search_path=""'] from pg_proc where oid='public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure)),
('save_rpc_not_client_callable',
  not has_function_privilege('anon','public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)','EXECUTE')
  and not exists (
    select 1 from pg_proc procedure
    cross join lateral aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) acl
    where procedure.oid='public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  )
),
('save_rpc_service_role_execute', has_function_privilege('service_role','public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)','EXECUTE')),
('save_rpc_active_team_check', position('member_kind = ''team'' and status = ''active''' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0),
('save_rpc_active_marketing_service_check', position('sc.department_id = ''marketing'' and sc.is_active' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0),
('save_rpc_optimistic_concurrency', position('v_latest.id is distinct from p_expected_latest_version_id' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0),
('save_rpc_no_update_acl_dependency', position('limit 1 for update' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))=0),
('concurrent_save_guard_present', position('pg_advisory_xact_lock' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0),
('save_rpc_exact_source_checks', position('join public.artifact_approvals approval' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0
  and position('campaign_messaging' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0
  and position('measurement_plan' in pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure))>0),
('save_rpc_scope_boundary', pg_get_functiondef('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)'::regprocedure)
  !~* 'insert into public\.(work_items|artifact_approval|production_handoff|provider_connections)|planned_budget|currency_code');

insert into mb04a_checks values
('owner_save_succeeds',false),('marketing_member_save_succeeds',false),
('other_department_rejected',false),('other_organization_rejected',false),
('suspended_member_rejected',false),('disabled_marketing_service_rejected',false),
('unapproved_message_source_rejected',false),('wrong_measurement_type_rejected',false),
('foreign_engagement_source_rejected',false),('creative_message_source_rejected',false),
('stale_revision_rejected',false),('sequential_versions_exact',false),
('version_update_immutable',false),('version_delete_immutable',false),
('requirement_update_immutable',false),('requirement_delete_immutable',false),
('draft_save_has_no_approval_or_work_side_effect',false),
('owner_rls_reads_exact_organization',false),('other_org_rls_reads_nothing',false),
('authenticated_direct_write_rejected',false),('authenticated_rpc_execute_rejected',false);

create temporary table mb04a_fixture (key text primary key, id uuid not null) on commit drop;

do $$
declare
  v_org uuid:=gen_random_uuid(); v_other_org uuid:=gen_random_uuid();
  v_owner uuid:=gen_random_uuid(); v_member uuid:=gen_random_uuid(); v_other_dept uuid:=gen_random_uuid();
  v_suspended uuid:=gen_random_uuid(); v_other_actor uuid:=gen_random_uuid();
  v_client uuid:=gen_random_uuid(); v_brand uuid:=gen_random_uuid(); v_engagement uuid:=gen_random_uuid();
  v_other_engagement uuid:=gen_random_uuid(); v_service uuid:=gen_random_uuid(); v_campaign uuid:=gen_random_uuid();
  v_message_artifact uuid:=gen_random_uuid(); v_message_version uuid:=gen_random_uuid();
  v_unapproved_artifact uuid:=gen_random_uuid(); v_unapproved_version uuid:=gen_random_uuid();
  v_measure_artifact uuid:=gen_random_uuid(); v_measure_version uuid:=gen_random_uuid();
  v_wrong_artifact uuid:=gen_random_uuid(); v_wrong_version uuid:=gen_random_uuid();
  v_foreign_artifact uuid:=gen_random_uuid(); v_foreign_version uuid:=gen_random_uuid();
  v_one jsonb; v_two jsonb; v_one_id uuid; v_two_id uuid; v_rejected boolean; v_work_before bigint;
begin
  insert into auth.users(id) values (v_owner),(v_member),(v_other_dept),(v_suspended),(v_other_actor);
  insert into public.organizations(id,name,slug,status) values
    (v_org,'MB04A verifier','mb04a-'||replace(v_org::text,'-',''),'active'),
    (v_other_org,'MB04A other','mb04a-other-'||replace(v_other_org::text,'-',''),'active');
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (v_org,v_owner,'team','system_owner',null,'active'),
    (v_org,v_member,'team','contributor','marketing','active'),
    (v_org,v_other_dept,'team','contributor','design','active'),
    (v_org,v_suspended,'team','contributor','marketing','suspended'),
    (v_other_org,v_other_actor,'team','system_owner',null,'active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(v_client,v_org,'MB04A client',v_owner);
  insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values(v_brand,v_org,v_client,'MB04A brand',true,v_owner);
  insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values
    (v_engagement,v_org,v_client,v_brand,'MB04A engagement','active',v_owner),
    (v_other_engagement,v_org,v_client,v_brand,'MB04A other engagement','active',v_owner);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values(v_service,v_org,'marketing','mb04a_verifier','MB04A verifier',true);
  insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values(v_org,v_engagement,v_service,'active',v_owner);
  insert into public.marketing_campaigns(id,organization_id,engagement_id,brand_id,name,planned_channels,planned_budget,currency_code,created_by,updated_by)
    values(v_campaign,v_org,v_engagement,v_brand,'MB04A campaign',array['email'],123.45,'EUR',v_owner,v_owner);

  insert into public.artifacts(id,organization_id,brand_id,engagement_id,artifact_type,title,created_by) values
    (v_message_artifact,v_org,v_brand,v_engagement,'campaign_messaging','Approved message',v_owner),
    (v_unapproved_artifact,v_org,v_brand,v_engagement,'campaign_messaging','Unapproved message',v_owner),
    (v_measure_artifact,v_org,v_brand,v_engagement,'measurement_plan','Measurement',v_owner),
    (v_wrong_artifact,v_org,v_brand,v_engagement,'channel_strategy','Wrong type',v_owner),
    (v_foreign_artifact,v_org,v_brand,v_other_engagement,'campaign_messaging','Other engagement',v_owner);
  insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,created_by) values
    (v_message_version,v_org,v_message_artifact,1,'{}',repeat('1',64),v_owner),
    (v_unapproved_version,v_org,v_unapproved_artifact,1,'{}',repeat('2',64),v_owner),
    (v_measure_version,v_org,v_measure_artifact,1,'{}',repeat('3',64),v_owner),
    (v_wrong_version,v_org,v_wrong_artifact,1,'{}',repeat('4',64),v_owner),
    (v_foreign_version,v_org,v_foreign_artifact,1,'{}',repeat('5',64),v_owner);
  insert into public.artifact_approvals(organization_id,artifact_id,artifact_version_id,engagement_id,approved_by) values
    (v_org,v_message_artifact,v_message_version,v_engagement,v_owner),
    (v_org,v_foreign_artifact,v_foreign_version,v_other_engagement,v_owner);

  select count(*) into v_work_before from public.work_items;
  select public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,null,'Plan one','Qualified demand',array['Email'],date '2026-09-12',date '2026-10-12','Audience','https://example.com',v_message_version,v_measure_version,
    jsonb_build_array(jsonb_build_object('format','Static image','intended_placement','Homepage','message_version_id',v_message_version,'due_date','2026-09-20')),'first',null,v_owner) into v_one;
  v_one_id:=(v_one->>'id')::uuid;
  update mb04a_checks set passed=(v_one->>'version_number')::int=1 and (v_one->>'lifecycle_status')='draft' where check_name='owner_save_succeeds';

  select public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_one_id,'Plan two','Qualified demand',array['Email','Search'],null,null,'Audience','',v_message_version,v_measure_version,'[]','second',v_one_id,v_member) into v_two;
  v_two_id:=(v_two->>'id')::uuid;
  update mb04a_checks set passed=(v_two->>'version_number')::int=2 and (v_two->>'parent_version_id')::uuid=v_one_id where check_name='marketing_member_save_succeeds';
  update mb04a_checks set passed=(select count(*)=2 and min(version_number)=1 and max(version_number)=2 from public.marketing_campaign_plan_versions where campaign_id=v_campaign)
    and (select planned_budget=123.45 and currency_code='EUR' from public.marketing_campaigns where id=v_campaign) where check_name='sequential_versions_exact';
  update mb04a_checks set passed=(select count(*)=1 from public.marketing_campaign_plan_creative_requirements where plan_version_id=v_one_id)
    and not exists(select 1 from public.artifact_approvals where artifact_version_id in (v_one_id,v_two_id))
    and (select count(*) from public.work_items)=v_work_before where check_name='draft_save_has_no_approval_or_work_side_effect';

  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',null,null,'[]','',null,v_other_dept); exception when others then v_rejected:=sqlerrm like '%Marketing department access required%'; end;
  update mb04a_checks set passed=v_rejected where check_name='other_department_rejected';
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_other_org,v_engagement,v_campaign,null,'Denied','x',array['Email'],null,null,'','',null,null,'[]','',null,v_other_actor); exception when others then v_rejected:=true; end;
  update mb04a_checks set passed=v_rejected where check_name='other_organization_rejected';
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',null,null,'[]','',null,v_suspended); exception when others then v_rejected:=sqlerrm like '%Marketing department access required%'; end;
  update mb04a_checks set passed=v_rejected where check_name='suspended_member_rejected';

  update public.service_catalog set is_active=false where id=v_service;
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',null,null,'[]','',null,v_owner); exception when others then v_rejected:=sqlerrm like '%Active Marketing engagement required%'; end;
  update mb04a_checks set passed=v_rejected where check_name='disabled_marketing_service_rejected';
  update public.service_catalog set is_active=true where id=v_service;

  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',v_unapproved_version,null,'[]','',null,v_owner); exception when others then v_rejected:=sqlerrm like '%Approved message%'; end;
  update mb04a_checks set passed=v_rejected where check_name='unapproved_message_source_rejected';
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',null,v_wrong_version,'[]','',null,v_owner); exception when others then v_rejected:=sqlerrm like '%Measurement source%'; end;
  update mb04a_checks set passed=v_rejected where check_name='wrong_measurement_type_rejected';
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',v_foreign_version,null,'[]','',null,v_owner); exception when others then v_rejected:=sqlerrm like '%Approved message%'; end;
  update mb04a_checks set passed=v_rejected where check_name='foreign_engagement_source_rejected';
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_two_id,'Denied','x',array['Email'],null,null,'','',null,null,jsonb_build_array(jsonb_build_object('format','A','intended_placement','B','message_version_id',v_unapproved_version)),'',null,v_owner); exception when others then v_rejected:=sqlerrm like '%Creative message%'; end;
  update mb04a_checks set passed=v_rejected where check_name='creative_message_source_rejected';
  v_rejected:=false; begin perform public.save_marketing_campaign_plan_draft(v_org,v_engagement,v_campaign,v_one_id,'Stale','x',array['Email'],null,null,'','',null,null,'[]','',null,v_owner); exception when sqlstate '40001' then v_rejected:=true; end;
  update mb04a_checks set passed=v_rejected and (select count(*)=2 from public.marketing_campaign_plan_versions where campaign_id=v_campaign) where check_name='stale_revision_rejected';

  v_rejected:=false; begin update public.marketing_campaign_plan_versions set title='mutated' where id=v_one_id; exception when others then v_rejected:=sqlerrm like '%immutable%'; end;
  update mb04a_checks set passed=v_rejected where check_name='version_update_immutable';
  v_rejected:=false; begin delete from public.marketing_campaign_plan_versions where id=v_one_id; exception when others then v_rejected:=sqlerrm like '%immutable%'; end;
  update mb04a_checks set passed=v_rejected where check_name='version_delete_immutable';
  v_rejected:=false; begin update public.marketing_campaign_plan_creative_requirements set format='mutated' where plan_version_id=v_one_id; exception when others then v_rejected:=sqlerrm like '%immutable%'; end;
  update mb04a_checks set passed=v_rejected where check_name='requirement_update_immutable';
  v_rejected:=false; begin delete from public.marketing_campaign_plan_creative_requirements where plan_version_id=v_one_id; exception when others then v_rejected:=sqlerrm like '%immutable%'; end;
  update mb04a_checks set passed=v_rejected where check_name='requirement_delete_immutable';

  insert into mb04a_fixture values ('org',v_org),('owner',v_owner),('other_actor',v_other_actor),('campaign',v_campaign),('engagement',v_engagement);
end
$$;

grant select on mb04a_fixture to authenticated;
grant select,update on mb04a_checks to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from mb04a_fixture where key='owner'),'role','authenticated')::text,true);
set local role authenticated;
update mb04a_checks set passed=
  (select count(*)=2 from public.marketing_campaign_plan_versions where organization_id=(select id from mb04a_fixture where key='org'))
  and (select count(*)=1 from public.marketing_campaign_plan_creative_requirements where organization_id=(select id from mb04a_fixture where key='org'))
where check_name='owner_rls_reads_exact_organization';
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from mb04a_fixture where key='other_actor'),'role','authenticated')::text,true);
set local role authenticated;
update mb04a_checks set passed=
  not exists(select 1 from public.marketing_campaign_plan_versions)
  and not exists(select 1 from public.marketing_campaign_plan_creative_requirements)
where check_name='other_org_rls_reads_nothing';
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from mb04a_fixture where key='owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare rejected boolean:=false; begin
  begin insert into public.marketing_campaign_plan_versions(organization_id,campaign_id,engagement_id,brand_id,version_number,title,objective,channels,created_by)
    values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),99,'Denied','Denied',array['Email'],gen_random_uuid());
  exception when insufficient_privilege then rejected:=true; end;
  update mb04a_checks set passed=rejected where check_name='authenticated_direct_write_rejected';
end $$;
do $$ declare rejected boolean:=false; begin
  begin perform public.save_marketing_campaign_plan_draft(null,null,null,null,'Denied','Denied',array['Email'],null,null,'','',null,null,'[]','',null,null);
  exception when insufficient_privilege then rejected:=true; end;
  update mb04a_checks set passed=rejected where check_name='authenticated_rpc_execute_rejected';
end $$;
reset role;

select jsonb_object_agg(check_name,passed order by check_name) as mb04a_verification from mb04a_checks;
do $$ declare failed text; begin
  select string_agg(check_name,', ' order by check_name) into failed from mb04a_checks where not passed;
  if failed is not null then raise exception 'MB04A verification failed: %',failed; end if;
end $$;
select 'PASS' as mb04a_final_result;
rollback;
