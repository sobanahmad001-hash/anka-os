-- DESIGN B04 rollback-only safe archive gate.
begin;
create temporary table b04_checks(check_name text primary key, passed boolean not null) on commit drop;
insert into b04_checks values
('archive_columns_complete',(
  select count(*)=4 from information_schema.columns
  where table_schema='public' and table_name='design_assets'
    and column_name in ('archived_at','archived_by','archive_operation_key','archive_reason'))),
('active_context_index',to_regclass('public.idx_design_assets_active_context') is not null),
('archive_rpc_service_only',
  has_function_privilege('service_role','public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)','EXECUTE')),
('archive_rpc_invoker_and_locked',
  not (select prosecdef from pg_proc where oid='public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)'::regprocedure)
  and position('for update' in lower(pg_get_functiondef('public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)'::regprocedure)))>0),
('version_insert_guard',exists(select 1 from pg_trigger where tgrelid='public.design_asset_versions'::regclass
  and tgname='trg_design_asset_versions_active_root' and tgenabled<>'D')),
('soft_only',pg_get_functiondef('public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)'::regprocedure)
  !~* 'delete[[:space:]]+from|storage\.objects'),
('version_history_still_readable',has_table_privilege('authenticated','public.design_asset_versions','SELECT')),
('archive_fields_only_update',
  has_column_privilege('service_role','public.design_assets','archived_at','UPDATE')
  and has_column_privilege('service_role','public.design_assets','archived_by','UPDATE')
  and not has_column_privilege('service_role','public.design_assets','name','UPDATE'));

insert into b04_checks values
('eligible_archive',false),('same_request_replay',false),('history_retained',false),
('new_version_rejected',false),('restore_rejected',false),('other_department_rejected',false),
('changed_replay_intent_rejected',false),('null_department_rejected',false),
('inactive_member_rejected',false),('missing_member_rejected',false),('client_member_rejected',false),
('wrong_organization_rejected',false),('stale_latest_rejected',false),('ineligible_history_rejected',false);

do $$
declare
  org_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); content_id uuid:=gen_random_uuid();
  null_department_id uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid(); client_member_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); brand_id uuid:=gen_random_uuid(); engagement_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid();
  engagement_service_id uuid:=gen_random_uuid();
  v_asset_id uuid:=gen_random_uuid(); v_version_id uuid:=gen_random_uuid(); v_extra_id uuid:=gen_random_uuid();
  stale_asset_id uuid:=gen_random_uuid(); stale_version_id uuid:=gen_random_uuid();
  linked_asset_id uuid:=gen_random_uuid(); linked_asset_version_id uuid:=gen_random_uuid();
  session_id uuid:=gen_random_uuid(); direction_id uuid:=gen_random_uuid(); direction_version_id uuid:=gen_random_uuid();
  result jsonb; replay jsonb; rejected boolean;
begin
  insert into auth.users(id) values(owner_id),(content_id),(null_department_id),(inactive_id),(client_member_id);
  insert into public.organizations(id,name,slug,status)
    values(org_id,'B04 archive verifier','b04-archive-'||replace(org_id::text,'-',''),'active');
  insert into public.departments(id,name,description,color,icon,organization_id) values
    ('design','Design','','#e84393','D',org_id),('content','Content','','#d97706','C',org_id)
    on conflict (id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org_id,owner_id,'team','contributor','design','active'),
    (org_id,content_id,'team','contributor','content','active'),
    (org_id,null_department_id,'team','contributor',null,'active'),
    (org_id,inactive_id,'team','contributor','design','suspended'),
    (org_id,client_member_id,'client','client_viewer',null,'active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(client_id,org_id,'B04 client',owner_id);
  insert into public.brands(id,organization_id,client_id,name,is_default,created_by)
    values(brand_id,org_id,client_id,'B04 brand',true,owner_id);
  insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by)
    values(engagement_id,org_id,client_id,brand_id,'B04 engagement','active',owner_id);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active)
    values(service_id,org_id,'design','b04_archive_verifier','B04 archive verifier',true);
  insert into public.engagement_services(id,organization_id,engagement_id,service_id,status,activated_by)
    values(engagement_service_id,org_id,engagement_id,service_id,'active',owner_id);
  insert into public.design_workshop_sessions(id,organization_id,engagement_id,brand_id,engagement_service_id,output_family,
    output_brief,designer_instructions,context_manifest,context_checksum,status,created_by)
    values(session_id,org_id,engagement_id,brand_id,engagement_service_id,'brand_identity','{}','B04 linked fixture','{}',
      repeat('c',64),'comparison',owner_id);
  insert into public.design_directions(id,organization_id,session_id,direction_slot)
    values(direction_id,org_id,session_id,1);
  insert into public.design_direction_versions(id,organization_id,direction_id,version_number,content,
    content_checksum,distinctness_signature,created_by,is_experimental,experiment_visibility)
    values(direction_version_id,org_id,direction_id,1,'{"title":"Linked fixture"}',repeat('d',64),repeat('e',64),owner_id,false,null);

  perform public.register_design_asset_upload(org_id,engagement_id,brand_id,v_asset_id,v_version_id,null,null,
    'Standalone draft','static_image','','','draft.png',
    org_id::text||'/assets/'||v_asset_id::text||'/'||v_version_id::text||'/file.png',
    'image/png',68,1,1,repeat('a',64),'','b04-upload-operation',repeat('1',64),owner_id);
  perform public.register_design_asset_upload(org_id,engagement_id,brand_id,stale_asset_id,stale_version_id,null,null,
    'Stale draft','static_image','','','stale.png',
    org_id::text||'/assets/'||stale_asset_id::text||'/'||stale_version_id::text||'/file.png',
    'image/png',68,1,1,repeat('f',64),'','b04-stale-upload',repeat('3',64),owner_id);
  perform public.register_design_asset_upload(org_id,engagement_id,brand_id,linked_asset_id,linked_asset_version_id,null,direction_version_id,
    'Direction-linked draft','static_image','','','linked.png',
    org_id::text||'/assets/'||linked_asset_id::text||'/'||linked_asset_version_id::text||'/file.png',
    'image/png',68,1,1,repeat('9',64),'','b04-linked-upload',repeat('4',64),owner_id);

  set local role service_role;
  select public.archive_design_asset(org_id,v_asset_id,v_version_id,'b04-archive-operation','Explicit verifier confirmation',owner_id) into result;
  reset role;
  update b04_checks set passed=result->'asset'->>'archived_at' is not null
    and (result->>'retained_version_count')::int=1
    and (result->>'storage_objects_deleted')::int=0 where check_name='eligible_archive';

  set local role service_role;
  select public.archive_design_asset(org_id,v_asset_id,v_version_id,'b04-archive-operation','Explicit verifier confirmation',owner_id) into replay;
  reset role;
  update b04_checks set passed=(replay->>'idempotent_replay')::boolean where check_name='same_request_replay';
  update b04_checks set passed=(select count(*)=1 from public.design_asset_versions where asset_id=v_asset_id)
    where check_name='history_retained';

  rejected:=false;
  begin
    insert into public.design_asset_versions(id,organization_id,asset_id,version_number,parent_version_id,source_kind,
      lifecycle_status,storage_path,mime_type,byte_size,width,height,original_filename,content_checksum,
      change_summary,operation_key,request_checksum,created_by)
    values(v_extra_id,org_id,v_asset_id,2,v_version_id,'upload','draft',
      org_id::text||'/assets/'||v_asset_id::text||'/'||v_extra_id::text||'/file.png',
      'image/png',68,1,1,'after.png',repeat('b',64),'','after-archive-operation',repeat('2',64),owner_id);
  exception when others then rejected:=sqlerrm like '%cannot receive new versions%'; end;
  update b04_checks set passed=rejected where check_name='new_version_rejected';

  rejected:=false;
  begin update public.design_assets set archived_at=null,archived_by=null,archive_operation_key=null,archive_reason=null where id=v_asset_id;
  exception when others then rejected:=sqlerrm like '%immutable%'; end;
  update b04_checks set passed=rejected where check_name='restore_rejected';

  rejected:=false;
  begin perform public.archive_design_asset(org_id,v_asset_id,v_version_id,'different-operation','Denied',content_id);
  exception when others then rejected:=sqlerrm like '%Design department access required%'; end;
  update b04_checks set passed=rejected where check_name='other_department_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,v_asset_id,v_version_id,'b04-archive-operation','Changed reason',owner_id);
  exception when others then rejected:=sqlerrm like '%different confirmed intent%'; end;
  reset role; update b04_checks set passed=rejected where check_name='changed_replay_intent_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,stale_asset_id,stale_version_id,'null-department-op','Denied',null_department_id);
  exception when others then rejected:=sqlerrm like '%Design department access required%'; end;
  reset role; update b04_checks set passed=rejected where check_name='null_department_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,stale_asset_id,stale_version_id,'inactive-member-op','Denied',inactive_id);
  exception when others then rejected:=sqlerrm like '%Design department access required%'; end;
  reset role; update b04_checks set passed=rejected where check_name='inactive_member_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,stale_asset_id,stale_version_id,'missing-member-op','Denied',gen_random_uuid());
  exception when others then rejected:=sqlerrm like '%Design department access required%'; end;
  reset role; update b04_checks set passed=rejected where check_name='missing_member_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,stale_asset_id,stale_version_id,'client-member-op','Denied',client_member_id);
  exception when others then rejected:=sqlerrm like '%Design department access required%'; end;
  reset role; update b04_checks set passed=rejected where check_name='client_member_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(gen_random_uuid(),stale_asset_id,stale_version_id,'wrong-org-operation','Denied',owner_id);
  exception when others then rejected:=sqlerrm like '%Design department access required%'; end;
  reset role; update b04_checks set passed=rejected where check_name='wrong_organization_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,stale_asset_id,gen_random_uuid(),'stale-latest-operation','Denied',owner_id);
  exception when serialization_failure then rejected:=true; end;
  reset role; update b04_checks set passed=rejected where check_name='stale_latest_rejected';

  rejected:=false;
  begin set local role service_role;
    perform public.archive_design_asset(org_id,linked_asset_id,linked_asset_version_id,'linked-history-op','Denied',owner_id);
  exception when others then rejected:=sqlerrm like '%Only standalone uploaded draft assets%'; end;
  reset role; update b04_checks set passed=rejected where check_name='ineligible_history_rejected';
end;
$$;

select jsonb_object_agg(check_name,passed order by check_name) as b04_verification from b04_checks;
do $$ declare failed text; begin
  select string_agg(check_name,', ' order by check_name) into failed from b04_checks where not passed;
  if failed is not null then raise exception 'B04 verification failed: %',failed; end if;
end $$;
select 'PASS' as b04_final_result;
rollback;
