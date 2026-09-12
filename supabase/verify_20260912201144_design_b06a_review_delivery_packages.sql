-- DESIGN B06a rollback-only verification.
begin;
create temporary table b06a_checks(check_name text primary key, passed boolean not null) on commit drop;

insert into b06a_checks values
('canonical_type',exists(select 1 from pg_constraint where conname='artifacts_artifact_type_check'
  and pg_get_constraintdef(oid) like '%design_delivery_package%')),
('context_table',to_regclass('public.design_delivery_package_version_contexts') is not null),
('asset_reference_table',to_regclass('public.design_delivery_package_version_assets') is not null),
('context_rls',(select relrowsecurity from pg_class where oid='public.design_delivery_package_version_contexts'::regclass)),
('asset_reference_rls',(select relrowsecurity from pg_class where oid='public.design_delivery_package_version_assets'::regclass)),
('browser_read_only',has_table_privilege('authenticated','public.design_delivery_package_version_contexts','select')
  and has_table_privilege('authenticated','public.design_delivery_package_version_assets','select')
  and not has_any_column_privilege('authenticated','public.design_delivery_package_version_contexts','insert,update,references')
  and not has_any_column_privilege('authenticated','public.design_delivery_package_version_assets','insert,update,references')),
('service_least_privilege',has_table_privilege('service_role','public.design_delivery_package_version_contexts','select')
  and has_table_privilege('service_role','public.design_delivery_package_version_contexts','insert')
  and not has_table_privilege('service_role','public.design_delivery_package_version_contexts','update')
  and not has_table_privilege('service_role','public.design_delivery_package_version_contexts','delete')),
('save_rpc_service_only',has_function_privilege('service_role','public.save_design_delivery_package_version(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid[])','execute')
  and not has_function_privilege('authenticated','public.save_design_delivery_package_version(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid[])','execute')),
('archive_lock_trigger',exists(select 1 from pg_trigger where tgrelid='public.design_assets'::regclass
  and tgname='trg_design_assets_package_reference_archive_guard' and tgenabled<>'D')),
('review_guards',exists(select 1 from pg_trigger where tgrelid='public.artifact_approval_requests'::regclass
  and tgname='trg_design_delivery_package_review_ready' and tgenabled<>'D')
  and exists(select 1 from pg_trigger where tgrelid='public.artifact_approvals'::regclass
  and tgname='trg_design_delivery_package_approval_ready' and tgenabled<>'D')),
('no_storage_delete',pg_get_functiondef('public.save_design_delivery_package_version(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid[])'::regprocedure)
  !~* 'delete[[:space:]]+from|storage\.objects');

insert into b06a_checks values
('website_save',false),('same_intent_replay',false),('changed_replay_rejected',false),
('exact_reference',false),('typed_work_link',false),('referenced_archive_rejected',false),
('missing_object_review_rejected',false),('review_ready_after_object_restore',false),
('other_department_rejected',false),('inactive_destination_rejected',false),
('member_rls_read',false),('outsider_rls_denied',false);

do $$
declare
  org_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); content_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); brand_id uuid:=gen_random_uuid(); engagement_id uuid:=gen_random_uuid();
  design_service_id uuid:=gen_random_uuid(); design_es_id uuid:=gen_random_uuid(); marketing_service_id uuid:=gen_random_uuid(); marketing_es_id uuid:=gen_random_uuid();
  task_id uuid:=gen_random_uuid(); asset_id uuid:=gen_random_uuid(); asset_version_id uuid:=gen_random_uuid();
  result jsonb; replay jsonb; package_id uuid; package_version_id uuid; object_id uuid:=gen_random_uuid(); rejected boolean; visible_count integer;
  content jsonb:='{"schema_version":1,"destination_type":"website","placement_label":"Homepage hero","placement_description":"Above fold","website_page_section":"Home / Hero","social_platform":"","width":1440,"height":900,"usage_instructions":"Use exact version without cropping","export_guidance":"PNG"}'::jsonb;
begin
  insert into auth.users(id) values(owner_id),(content_id),(outsider_id);
  insert into public.organizations(id,name,slug,status) values(org_id,'B06a verifier','b06a-'||replace(org_id::text,'-',''),'active');
  insert into public.departments(id,name,description,color,icon,organization_id) values
    ('design','Design','','#e84393','D',org_id),('content','Content','','#d97706','C',org_id),
    ('marketing','Marketing','','#2563eb','M',org_id),('development','Development','','#16a34a','V',org_id)
    on conflict(id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org_id,owner_id,'team','contributor','design','active'),
    (org_id,content_id,'team','contributor','content','active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(client_id,org_id,'B06a client',owner_id);
  insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values(brand_id,org_id,client_id,'B06a brand',true,owner_id);
  insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by)
    values(engagement_id,org_id,client_id,brand_id,'B06a engagement','active',owner_id);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values
    (design_service_id,org_id,'design','b06a_design','B06a Design',true),
    (marketing_service_id,org_id,'marketing','b06a_marketing','B06a Marketing',true);
  insert into public.engagement_services(id,organization_id,engagement_id,service_id,status,activated_by) values
    (design_es_id,org_id,engagement_id,design_service_id,'active',owner_id),
    (marketing_es_id,org_id,engagement_id,marketing_service_id,'planned',owner_id);
  insert into public.tasks(id,user_id,title,status,project_id,organization_id,department,department_id,created_by)
    select task_id,owner_id,'B06a existing task','ready',engagement.project_id,org_id,'design','design',owner_id
    from public.engagements engagement where engagement.id=engagement_id;
  perform public.register_design_asset_upload(org_id,engagement_id,brand_id,asset_id,asset_version_id,null,null,
    'B06a hero','static_image','Homepage hero','','hero.png',
    org_id::text||'/assets/'||asset_id::text||'/'||asset_version_id::text||'/file.png',
    'image/png',68,1,1,repeat('a',64),'','b06a-upload-operation',repeat('1',64),owner_id);
  insert into storage.buckets(id,name,public) values('design-generated-media','design-generated-media',false)
    on conflict(id) do nothing;
  insert into storage.objects(id,bucket_id,name,owner_id,metadata)
    values(object_id,'design-generated-media',org_id::text||'/assets/'||asset_id::text||'/'||asset_version_id::text||'/file.png',owner_id::text,'{}');

  set local role service_role;
  select public.save_design_delivery_package_version(org_id,owner_id,null,engagement_id,brand_id,design_es_id,
    null,null,task_id,null,null,'b06a-package-operation',repeat('2',64),'Website launch package',content,repeat('3',64),array[asset_version_id]) into result;
  reset role;
  package_id:=(result->'artifact'->>'id')::uuid; package_version_id:=(result->'version'->>'id')::uuid;
  update b06a_checks set passed=(result->>'idempotent_replay')::boolean=false
    and result->'version'->>'version_number'='1' where check_name='website_save';
  update b06a_checks set passed=exists(select 1 from public.design_delivery_package_version_assets
    where artifact_version_id=package_version_id and design_asset_version_id=asset_version_id and position=1)
    where check_name='exact_reference';
  update b06a_checks set passed=exists(select 1 from public.design_delivery_package_version_contexts
    where artifact_version_id=package_version_id and project_task_id=task_id and engagement_work_item_id is null)
    where check_name='typed_work_link';

  set local role service_role;
  select public.save_design_delivery_package_version(org_id,owner_id,null,engagement_id,brand_id,design_es_id,
    null,null,task_id,null,null,'b06a-package-operation',repeat('2',64),'Website launch package',content,repeat('3',64),array[asset_version_id]) into replay;
  reset role;
  update b06a_checks set passed=(replay->>'idempotent_replay')::boolean
    and replay->'version'->>'id'=package_version_id::text where check_name='same_intent_replay';
  rejected:=false;
  begin set local role service_role;
    perform public.save_design_delivery_package_version(org_id,owner_id,null,engagement_id,brand_id,design_es_id,
      null,null,task_id,null,null,'b06a-package-operation',repeat('9',64),'Changed intent',content,repeat('3',64),array[asset_version_id]);
  exception when unique_violation then rejected:=true; end; reset role;
  update b06a_checks set passed=rejected where check_name='changed_replay_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,asset_id,asset_version_id,'b06a-archive-operation','Attempt referenced archive',owner_id);
  exception when check_violation then rejected:=sqlerrm like '%referenced by delivery packages%'; end; reset role;
  update b06a_checks set passed=rejected where check_name='referenced_archive_rejected';

  update storage.objects set archived_at=now() where id=object_id;
  rejected:=false;
  begin insert into public.artifact_approval_requests(organization_id,artifact_version_id,approval_policy,requested_by)
    values(org_id,package_version_id,'parallel',owner_id);
  exception when check_violation then rejected:=sqlerrm like '%selected Design object is missing%'; end;
  update b06a_checks set passed=rejected where check_name='missing_object_review_rejected';
  update storage.objects set archived_at=null where id=object_id;
  insert into public.artifact_approval_requests(organization_id,artifact_version_id,approval_policy,requested_by)
    values(org_id,package_version_id,'parallel',owner_id);
  update b06a_checks set passed=true where check_name='review_ready_after_object_restore';

  rejected:=false;
  begin set local role service_role;
    perform public.save_design_delivery_package_version(org_id,content_id,null,engagement_id,brand_id,design_es_id,
      null,null,task_id,null,null,'b06a-content-operation',repeat('4',64),'Denied package',content,repeat('5',64),array[asset_version_id]);
  exception when insufficient_privilege then rejected:=true; end; reset role;
  update b06a_checks set passed=rejected where check_name='other_department_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.save_design_delivery_package_version(org_id,owner_id,null,engagement_id,brand_id,design_es_id,
      'marketing',marketing_es_id,task_id,null,null,'b06a-inactive-destination',repeat('6',64),'Blocked social',
      content||'{"destination_type":"social","social_platform":"LinkedIn","website_page_section":""}'::jsonb,
      repeat('7',64),array[asset_version_id]);
  exception when check_violation then rejected:=sqlerrm like '%downstream destination service%'; end; reset role;
  update b06a_checks set passed=rejected where check_name='inactive_destination_rejected';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into visible_count from public.design_delivery_package_version_contexts where organization_id=org_id;
  reset role;
  update b06a_checks set passed=visible_count=1 where check_name='member_rls_read';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into visible_count from public.design_delivery_package_version_contexts where organization_id=org_id;
  reset role;
  update b06a_checks set passed=visible_count=0 where check_name='outsider_rls_denied';
end;
$$;

select jsonb_object_agg(check_name,passed order by check_name) as b06a_verification from b06a_checks;
do $$ declare failed text; begin
  select string_agg(check_name,', ' order by check_name) into failed from b06a_checks where not passed;
  if failed is not null then raise exception 'B06a verification failed: %',failed; end if;
end $$;
select 'PASS' as b06a_final_result;
rollback;
