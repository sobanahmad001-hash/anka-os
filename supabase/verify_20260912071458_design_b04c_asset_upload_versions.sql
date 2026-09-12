-- DESIGN B04c rollback-only schema, permission, idempotency, and immutability gate.
begin;
create temporary table b04c_checks(check_name text primary key, passed boolean not null) on commit drop;
insert into b04c_checks values
('asset_table_exists',to_regclass('public.design_assets') is not null),
('version_table_exists',to_regclass('public.design_asset_versions') is not null),
('asset_rls',(select relrowsecurity from pg_class where oid='public.design_assets'::regclass)),
('version_rls',(select relrowsecurity from pg_class where oid='public.design_asset_versions'::regclass)),
('browser_tables_read_only',
  has_table_privilege('authenticated','public.design_assets','SELECT')
  and has_table_privilege('authenticated','public.design_asset_versions','SELECT')
  and not has_table_privilege('authenticated','public.design_assets','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.design_asset_versions','INSERT,UPDATE,DELETE')),
('public_and_anon_denied',
  not exists (
    select 1 from pg_class relation
    cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r',relation.relowner))) privilege
    where relation.oid in ('public.design_assets'::regclass,'public.design_asset_versions'::regclass)
      and privilege.grantee=0
      and privilege.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
  )
  and not has_table_privilege('anon','public.design_assets','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon','public.design_asset_versions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
('service_version_no_update_delete',
  has_table_privilege('service_role','public.design_assets','SELECT,INSERT')
  and has_table_privilege('service_role','public.design_asset_versions','SELECT,INSERT')
  and not has_table_privilege('service_role','public.design_assets','UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role','public.design_asset_versions','UPDATE,DELETE,TRUNCATE')),
('version_immutable_trigger',exists(select 1 from pg_trigger where tgrelid='public.design_asset_versions'::regclass
  and tgname='trg_design_asset_versions_immutable' and tgenabled <> 'D')),
('rpc_exists',to_regprocedure('public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)') is not null),
('rpc_security_invoker',not (select prosecdef from pg_proc where oid='public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)'::regprocedure)),
('rpc_empty_search_path',(select proconfig=array['search_path=""'] from pg_proc where oid='public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)'::regprocedure)),
('rpc_not_browser_callable',
  not has_function_privilege('anon','public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)','EXECUTE')),
('rpc_service_only',has_function_privilege('service_role','public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)','EXECUTE')),
('draft_only',exists(select 1 from pg_constraint where conrelid='public.design_asset_versions'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%lifecycle_status%draft%')),
('exact_source_and_object_constraints',(
  select count(*) >= 3 from pg_constraint where conrelid='public.design_asset_versions'::regclass and contype='c'
    and (pg_get_constraintdef(oid) like '%source_kind%' or pg_get_constraintdef(oid) like '%storage_path%'))),
('operation_unique',exists(select 1 from pg_constraint where conrelid='public.design_asset_versions'::regclass and contype='u'
  and pg_get_constraintdef(oid)='UNIQUE (organization_id, created_by, operation_key)')),
('rpc_lock_and_stale_guard',position('pg_advisory_xact_lock' in pg_get_functiondef('public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)'::regprocedure))>0
  and position('v_latest.id is distinct from p_expected_latest_version_id' in pg_get_functiondef('public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)'::regprocedure))>0),
('rpc_no_approval_release_or_work_write',pg_get_functiondef('public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)'::regprocedure)
  !~* 'insert into public\.(artifact_approvals|design_direction_releases|work_items|production_handoff)');

insert into b04c_checks values
('first_upload_draft',false),('same_request_idempotent',false),('replacement_is_child',false),
('stale_replacement_rejected',false),('other_department_rejected',false),('cross_organization_rejected',false),
('immutable_update_rejected',false);

do $$
declare
  org_id uuid:=gen_random_uuid(); other_org_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); content_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); brand_id uuid:=gen_random_uuid(); engagement_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid();
  asset_id uuid:=gen_random_uuid(); v1_id uuid:=gen_random_uuid(); v2_id uuid:=gen_random_uuid(); v3_id uuid:=gen_random_uuid();
  denied_asset_id uuid:=gen_random_uuid(); denied_version_id uuid:=gen_random_uuid();
  cross_asset_id uuid:=gen_random_uuid(); cross_version_id uuid:=gen_random_uuid();
  first_result jsonb; replay_result jsonb; second_result jsonb; rejected boolean;
begin
  insert into auth.users(id) values(owner_id),(content_id);
  insert into public.organizations(id,name,slug,status) values
    (org_id,'B04c verifier','b04c-'||replace(org_id::text,'-',''),'active'),
    (other_org_id,'B04c other verifier','b04c-other-'||replace(other_org_id::text,'-',''),'active');
  insert into public.departments(id,name,description,color,icon,organization_id) values
    ('design','Design','','#e84393','D',org_id),('content','Content','','#d97706','C',org_id)
    on conflict (id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org_id,owner_id,'team','contributor','design','active'),(org_id,content_id,'team','contributor','content','active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(client_id,org_id,'B04c client',owner_id);
  insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values(brand_id,org_id,client_id,'B04c brand',true,owner_id);
  insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by)
    values(engagement_id,org_id,client_id,brand_id,'B04c engagement','active',owner_id);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active)
    values(service_id,org_id,'design','b04c_verifier','B04c verifier',true);
  insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by)
    values(org_id,engagement_id,service_id,'active',owner_id);

  select public.register_design_asset_upload(org_id,engagement_id,brand_id,asset_id,v1_id,null,null,
    'Hero','static_image','Homepage','Owned','hero.png',org_id::text||'/assets/'||asset_id::text||'/'||v1_id::text||'/file.png',
    'image/png',68,1,1,repeat('a',64),'Initial','operation-one',repeat('1',64),owner_id) into first_result;
  update b04c_checks set passed=(first_result->'version'->>'version_number')::int=1
    and first_result->'version'->>'lifecycle_status'='draft' where check_name='first_upload_draft';

  select public.register_design_asset_upload(org_id,engagement_id,brand_id,asset_id,v1_id,null,null,
    'Hero','static_image','Homepage','Owned','hero.png',org_id::text||'/assets/'||asset_id::text||'/'||v1_id::text||'/file.png',
    'image/png',68,1,1,repeat('a',64),'Initial','operation-one',repeat('1',64),owner_id) into replay_result;
  update b04c_checks set passed=(replay_result->>'idempotent_replay')::boolean
    and replay_result->'version'->>'id'=v1_id::text where check_name='same_request_idempotent';

  select public.register_design_asset_upload(org_id,engagement_id,brand_id,asset_id,v2_id,v1_id,null,
    'Hero','static_image','Homepage','Owned','hero-v2.png',org_id::text||'/assets/'||asset_id::text||'/'||v2_id::text||'/file.png',
    'image/png',69,1,1,repeat('b',64),'Crop','operation-two',repeat('2',64),owner_id) into second_result;
  update b04c_checks set passed=(second_result->'version'->>'version_number')::int=2
    and second_result->'version'->>'parent_version_id'=v1_id::text where check_name='replacement_is_child';

  rejected:=false;
  begin
    perform public.register_design_asset_upload(org_id,engagement_id,brand_id,asset_id,v3_id,v1_id,null,
      'Hero','static_image','','','hero-v3.png',org_id::text||'/assets/'||asset_id::text||'/'||v3_id::text||'/file.png',
      'image/png',70,1,1,repeat('c',64),'Stale','operation-three',repeat('3',64),owner_id);
  exception when serialization_failure then rejected:=true; end;
  update b04c_checks set passed=rejected and (select count(*)=2 from public.design_asset_versions where id in (v1_id,v2_id))
    where check_name='stale_replacement_rejected';

  rejected:=false;
  begin
    perform public.register_design_asset_upload(org_id,engagement_id,brand_id,denied_asset_id,denied_version_id,null,null,
      'Denied','static_image','','','denied.png',org_id::text||'/assets/'||denied_asset_id::text||'/'||denied_version_id::text||'/file.png',
      'image/png',68,1,1,repeat('d',64),'','operation-denied',repeat('4',64),content_id);
  exception when others then rejected:=true; end;
  update b04c_checks set passed=rejected where check_name='other_department_rejected';

  rejected:=false;
  begin
    perform public.register_design_asset_upload(other_org_id,engagement_id,brand_id,cross_asset_id,cross_version_id,null,null,
      'Cross organization','static_image','','','cross.png',other_org_id::text||'/assets/'||cross_asset_id::text||'/'||cross_version_id::text||'/file.png',
      'image/png',68,1,1,repeat('e',64),'','operation-cross-org',repeat('5',64),owner_id);
  exception when others then rejected:=true; end;
  update b04c_checks set passed=rejected where check_name='cross_organization_rejected';

  rejected:=false;
  begin update public.design_asset_versions set change_summary='mutated' where id=v1_id;
  exception when sqlstate '55000' then rejected:=true; end;
  update b04c_checks set passed=rejected where check_name='immutable_update_rejected';
end;
$$;

select jsonb_object_agg(check_name,passed order by check_name) as b04c_verification from b04c_checks;
do $$ declare failed text; begin
  select string_agg(check_name,', ' order by check_name) into failed from b04c_checks where not passed;
  if failed is not null then raise exception 'B04c verification failed: %',failed; end if;
end $$;
select 'PASS' as b04c_final_result;
rollback;
