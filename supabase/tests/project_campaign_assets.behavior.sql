-- Local authorized synthetic fixtures only; no users/providers/human approval claim.
-- Temporary isolation of only these new candidate tables; rollback restores all retained receipts.
begin;
truncate public.project_campaign_asset_variants,public.project_campaign_asset_links,public.project_campaign_asset_commands,public.project_campaign_assets;
set local lock_timeout='5s';set local statement_timeout='90s';
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
insert into public.service_catalog(id,organization_id,department_id,slug,name) values('99999999-9999-4999-8999-999999997170','99999999-9999-4999-8999-999999999901','marketing','campaign_registry_native_qa','Synthetic Marketing registry') on conflict(id) do nothing;
insert into public.engagement_services(id,organization_id,engagement_id,service_id,activated_by) values('99999999-9999-4999-8999-999999997171','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999997170','99999999-9999-4999-8999-999999999902') on conflict(id) do nothing;
insert into public.marketing_campaigns(id,organization_id,engagement_id,brand_id,name,planned_channels,created_by,updated_by) values('99999999-9999-4999-8999-999999997172','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999973','Synthetic campaign registry',array['Website','Social'],'99999999-9999-4999-8999-999999999902','99999999-9999-4999-8999-999999999902') on conflict(id) do nothing;
insert into public.marketing_campaign_plan_versions(id,organization_id,campaign_id,engagement_id,brand_id,version_number,title,objective,channels,created_by) values('99999999-9999-4999-8999-999999997173','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999997172','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999973',1,'Synthetic exact plan','Internal planning only',array['Website','Social'],'99999999-9999-4999-8999-999999999902') on conflict(id) do nothing;
insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,change_summary,created_by)
select '99999999-9999-4999-8999-999999997180',organization_id,artifact_id,(select max(version_number)+1 from public.artifact_versions where artifact_id=v.artifact_id),content||jsonb_build_object('synthetic_variant','native registry QA'),encode(sha256(convert_to((content||jsonb_build_object('synthetic_variant','native registry QA'))::text,'UTF8')),'hex'),'Synthetic variant version; no provider','99999999-9999-4999-8999-999999999902' from public.artifact_versions v where id='99999999-9999-4999-8999-999999997111' and not exists(select 1 from public.artifact_versions where id='99999999-9999-4999-8999-999999997180');
insert into public.artifact_approvals(id,organization_id,artifact_id,artifact_version_id,engagement_id,notes,approved_by) select '99999999-9999-4999-8999-999999997181',v.organization_id,v.artifact_id,v.id,'99999999-9999-4999-8999-999999999975','Synthetic fixture, not human approval','99999999-9999-4999-8999-999999999902' from public.artifact_versions v where id='99999999-9999-4999-8999-999999997180' on conflict(id) do nothing;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.expect_error(query text,code text,label text) returns void language plpgsql as $$begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;raise exception 'FAIL % expected % got %: %',label,code,sqlstate,sqlerrm;end;raise exception 'FAIL % did not reject',label;end $$;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';payload jsonb:=jsonb_build_object('command_kind','register_asset','campaign_id','99999999-9999-4999-8999-999999997172','plan_version_id','99999999-9999-4999-8999-999999997173','marketing_service_id','99999999-9999-4999-8999-999999997171','source_kind','artifact_version','source_version_id','99999999-9999-4999-8999-999999997111','asset_id',null,'label',null);preview jsonb;saved jsonb;variant jsonb;vpreview jsonb;registered_variant jsonb;work_count bigint;version_count bigint;request uuid:='99999999-9999-4999-8999-999999997182';begin
 select count(*) into work_count from public.work_items;select count(*) into version_count from public.artifact_versions;
 preview:=public.preview_project_campaign_asset(org,project,payload);
 perform pg_temp.check_true((select count(*) from public.project_campaign_assets)=0 and (select count(*) from public.project_campaign_asset_commands)=0,'Preview makes zero writes');
 perform pg_temp.check_true(preview#>>'{source,version_id}'='99999999-9999-4999-8999-999999997111' and preview#>>'{source,approval_state}'='approved','Exact approved source retained instead of newest variant/draft');
 saved:=public.confirm_project_campaign_asset(org,project,payload,preview->>'review_sha256',request);
 perform pg_temp.check_true(saved->>'asset_id' is not null and saved->>'source_version_id'=payload->>'source_version_id','One canonical shared source registered');
 perform pg_temp.check_true((select count(*) from public.work_items)=work_count and (select count(*) from public.artifact_versions)=version_count,'Registration creates no work or source versions');
 perform pg_temp.check_true(public.confirm_project_campaign_asset(org,project,payload,preview->>'review_sha256',request)->>'replayed'='true' and (select count(*) from public.project_campaign_asset_commands)=1,'Exact UUID replay preserves one command');
 perform pg_temp.expect_error(format('select public.confirm_project_campaign_asset(%L,%L,%L::jsonb,%L,%L)',org,project,payload||jsonb_build_object('source_version_id','99999999-9999-4999-8999-999999997180'),preview->>'review_sha256',request),'23505','Changed exact source under original UUID rejected');
 perform pg_temp.expect_error(format('select public.confirm_project_campaign_asset(%L,%L,%L::jsonb,%L,%L)',org,project,payload,preview->>'review_sha256','99999999-9999-4999-8999-999999997183'),'40001','Stale zero-write review rejects intervening registration');
 preview:=public.preview_project_campaign_asset(org,project,payload);
 perform pg_temp.check_true(public.confirm_project_campaign_asset(org,project,payload,preview->>'review_sha256','99999999-9999-4999-8999-999999997184')->>'asset_id'=saved->>'asset_id' and (select count(*) from public.project_campaign_asset_links)=1,'New reviewed request reuses source and exact campaign link');
 variant:=payload||jsonb_build_object('command_kind','register_variant','asset_id',saved->>'asset_id','label','Organic','source_version_id','99999999-9999-4999-8999-999999997180');vpreview:=public.preview_project_campaign_asset(org,project,variant);
 registered_variant:=public.confirm_project_campaign_asset(org,project,variant,vpreview->>'review_sha256','99999999-9999-4999-8999-999999997185');
 perform pg_temp.check_true(registered_variant->>'asset_id'=saved->>'asset_id' and registered_variant->>'variant_id' is not null and (select source_version_id::text from public.project_campaign_assets where id=(saved->>'asset_id')::uuid)=payload->>'source_version_id','Approved variant maps to the unchanged original canonical source');
 variant:=variant||jsonb_build_object('label','Paid');vpreview:=public.preview_project_campaign_asset(org,project,variant);
 vpreview:=public.confirm_project_campaign_asset(org,project,variant,vpreview->>'review_sha256','99999999-9999-4999-8999-999999997186');
 perform pg_temp.check_true(vpreview->>'asset_id'=saved->>'asset_id' and (select count(*) from public.project_campaign_asset_variants)=2 and (select count(*) from public.work_items)=work_count,'Organic and paid variants retain one source with no cloned work');
 perform pg_temp.check_true(public.get_project_campaign_asset_operation(org,project,request)#>>'{result,asset_id}'=saved->>'asset_id' and public.get_project_campaign_asset_operation(org,project,'99999999-9999-4999-8999-999999997187') is null,'Recovery is exact original UUID only');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload||jsonb_build_object('source_version_id','99999999-9999-4999-8999-999999997113')),'42501','Unapproved source is unavailable');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload||jsonb_build_object('plan_version_id','99999999-9999-4999-8999-999999997175')),'55000','Another or missing plan cannot bind source');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload||jsonb_build_object('marketing_service_id','99999999-9999-4999-8999-999999999977')),'42501','Content service cannot become Marketing authority');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload||jsonb_build_object('publish',true)),'22023','Unknown publication field rejected');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload||jsonb_build_object('campaign_id','not-an-id')),'22023','Malformed canonical identifier rejected');
 perform pg_temp.expect_error(format('update public.project_campaign_assets set source_version_id=%L where id=%L','99999999-9999-4999-8999-999999997180',saved->>'asset_id'),'55000','Shared source identity immutable');
 perform pg_temp.expect_error(format('delete from public.project_campaign_asset_variants where id=%L',registered_variant->>'variant_id'),'55000','Variant attribution/history immutable');
 update public.engagement_services set status='on_hold' where id='99999999-9999-4999-8999-999999997171';
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload),'42501','Current Marketing service revocation rechecked');
 update public.engagement_services set status='active' where id='99999999-9999-4999-8999-999999997171';
 update public.projects set archived_at=now() where id=project;
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload),'42501','Archived project rejects registration');
 update public.projects set archived_at=null where id=project;
 update public.organization_memberships set status='suspended' where organization_id=org and user_id=auth.uid();
 perform pg_temp.expect_error(format('select public.get_project_campaign_asset_operation(%L,%L,%L)',org,project,request),'42501','Suspended actor cannot recover another result');
 update public.organization_memberships set status='active' where organization_id=org and user_id=auth.uid();
 perform pg_temp.check_true(not has_function_privilege('anon','public.confirm_project_campaign_asset(uuid,uuid,jsonb,text,uuid)','execute') and not has_function_privilege('service_role','public.confirm_project_campaign_asset(uuid,uuid,jsonb,text,uuid)','execute') and has_function_privilege('authenticated','public.confirm_project_campaign_asset(uuid,uuid,jsonb,text,uuid)','execute'),'Authenticated-only public native boundary');
 perform pg_temp.check_true(not has_table_privilege('authenticated','public.project_campaign_assets','insert') and not has_table_privilege('service_role','public.project_campaign_assets','insert') and not has_table_privilege('authenticated','public.project_campaign_asset_commands','select'),'No direct source/receipt write or receipt history access');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)','99999999-9999-4999-8999-999999999998',project,payload),'42501','Foreign organization rejected before source');
end $$;

-- Metadata-only released-deliverable reader fixture. No Storage object, generation,
-- or genuine independent human/client approval is represented by these rows.
-- The legacy delivery activity hook omits tenant identity and uses a default absent
-- from this clone. Bind only its rollback-only synthetic fixture activity default;
-- the migration and native asset commands never alter/call that legacy writer.
alter table public.activity_events alter column organization_id set default '99999999-9999-4999-8999-999999999901'::uuid;
select set_config('anka.p7_governed_action','allowed',true);
insert into public.workstreams(id,organization_id,project_id,department_id,name,status) values('99999999-9999-4999-8999-999999997190','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','design','Synthetic source reader','active');
insert into public.files(id,organization_id,project_id,storage_bucket,storage_path,file_name,mime_type,size_bytes,checksum) values('99999999-9999-4999-8999-999999997191','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','qa-local-metadata-only','no-upload/synthetic.mp4','Synthetic metadata only.mp4','video/mp4',0,repeat('b',64));
insert into public.deliverables(id,organization_id,project_id,workstream_id,title,deliverable_type,created_by) values('99999999-9999-4999-8999-999999997192','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999997190','Synthetic governed source reader','video','99999999-9999-4999-8999-999999999902');
insert into public.deliverable_versions(id,organization_id,project_id,deliverable_id,version_number,title,file_id,review_status,client_approval_required,created_by) values('99999999-9999-4999-8999-999999997193','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999997192',1,'Synthetic governed metadata','99999999-9999-4999-8999-999999997191','client_reviewing',true,'99999999-9999-4999-8999-999999999902');
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';payload jsonb:=jsonb_build_object('command_kind','register_asset','campaign_id','99999999-9999-4999-8999-999999997172','plan_version_id','99999999-9999-4999-8999-999999997173','marketing_service_id','99999999-9999-4999-8999-999999997171','source_kind','deliverable_version','source_version_id','99999999-9999-4999-8999-999999997193','asset_id',null,'label',null);preview jsonb;saved jsonb;original_settings jsonb;begin
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload),'55000','Unreleased governed version denied');
 insert into public.deliverable_lifecycle_events(organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,event_type,actor_id,actor_kind,metadata) values(org,project,'99999999-9999-4999-8999-999999997192','99999999-9999-4999-8999-999999997193','99999999-9999-4999-8999-999999997190','released',auth.uid(),'team','{"synthetic_reader_fixture":true}');
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload),'55000','Released version without PM confirmation denied');
 insert into public.deliverable_pm_confirmations(organization_id,project_id,deliverable_id,deliverable_version_id,confirmed_by,confirmed_state_version,request_id) values(org,project,'99999999-9999-4999-8999-999999997192','99999999-9999-4999-8999-999999997193',auth.uid(),1,'99999999-9999-4999-8999-999999997194');
 select organizations.settings into original_settings from public.organizations where id=org;update public.organizations set settings=coalesce(original_settings,'{}')||jsonb_build_object('client_approvals_enabled',true) where id=org;
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload),'55000','Required exact client approval denied when missing');
 insert into public.approvals(organization_id,project_id,deliverable_id,deliverable_version_id,approval_type,decision,rationale,decided_by) values(org,project,'99999999-9999-4999-8999-999999997192','99999999-9999-4999-8999-999999997193','client_approval','approved','Synthetic reader fixture only, not human acceptance',auth.uid());
 preview:=public.preview_project_campaign_asset(org,project,payload);
 perform pg_temp.check_true(preview#>>'{source,file_id}'='99999999-9999-4999-8999-999999997191' and preview#>>'{source,file_checksum}'=repeat('b',64) and preview#>>'{source,release_event_id}' is not null and preview#>>'{source,client_approval_id}' is not null,'Governed reader retains exact version/file/release/client evidence');
 saved:=public.confirm_project_campaign_asset(org,project,payload,preview->>'review_sha256','99999999-9999-4999-8999-999999997195');
 perform pg_temp.check_true((select deliverable_version_id::text from public.project_campaign_assets where id=(saved->>'asset_id')::uuid)='99999999-9999-4999-8999-999999997193','Governed file source uses existing scoped canonical version FK');
 update public.files set archived_at=now() where id='99999999-9999-4999-8999-999999997191';
 perform pg_temp.expect_error(format('select public.preview_project_campaign_asset(%L,%L,%L::jsonb)',org,project,payload),'55000','Archived exact source file unavailable');
 perform pg_temp.check_true(exists(select 1 from jsonb_array_elements(public.list_project_campaign_assets(org,project,'99999999-9999-4999-8999-999999997172','99999999-9999-4999-8999-999999997173','99999999-9999-4999-8999-999999997171')->'items') item where item#>>'{record,source_version_id}'='99999999-9999-4999-8999-999999997193' and item->>'source_state'='unavailable' and item->'current_source'='null'::jsonb),'Registry retains unavailable file reference without pretending it is current');
 update public.files set archived_at=null where id='99999999-9999-4999-8999-999999997191';update public.organizations set settings=original_settings where id=org;
end $$;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';campaign uuid:='99999999-9999-4999-8999-999999997172';plan uuid:='99999999-9999-4999-8999-999999997173';service uuid:='99999999-9999-4999-8999-999999997171';asset_id uuid;result jsonb;commands bigint;begin
 select count(*) into commands from public.project_campaign_asset_commands;
 result:=public.list_project_campaign_assets(org,project,campaign,plan,service,null,'',0,1);
 perform pg_temp.check_true(result->>'total'='2' and result->>'matching_total'='2' and result->>'has_more'='true' and jsonb_array_length(result->'items')=1,'Whole-source registry counts and bounded asset paging');
 result:=public.list_project_campaign_assets(org,project,campaign,plan,service,null,'Synthetic governed',0,25);
 perform pg_temp.check_true(result->>'total'='2' and result->>'matching_total'='1' and jsonb_array_length(result->'items')=1,'Exact registry search preserves independent whole counts');
 select id into asset_id from public.project_campaign_assets where source_kind='artifact_version';
 result:=public.list_project_campaign_assets(org,project,campaign,plan,service,asset_id,'',0,1);
 perform pg_temp.check_true(result->>'total'='2' and result->>'has_more'='true' and result#>>'{asset,source_version_id}'='99999999-9999-4999-8999-999999997111','Variant paging retains exact original shared source');
 update public.engagement_services set status='on_hold' where id=service;
 result:=public.list_project_campaign_assets(org,project,campaign,plan,service);
 perform pg_temp.check_true(result#>>'{context,service_status}'='on_hold' and result->>'total'='2','Inactive service retains readable registry with explicit unavailable state');
 update public.engagement_services set status='active' where id=service;
 update public.projects set archived_at=now() where id=project;
 result:=public.list_project_campaign_assets(org,project,campaign,plan,service);
 perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(result->'items') item where item->>'source_state'<>'archived' or item->'current_source'<>'null'::jsonb),'Archived registry retains history without current source acceptance');
 update public.projects set archived_at=null where id=project;
 perform pg_temp.expect_error(format('select public.list_project_campaign_assets(%L,%L,%L,%L,%L,null,%L,10001,25)',org,project,campaign,plan,service,''),'22023','Unbounded registry offset rejected');
 perform pg_temp.expect_error(format('select public.list_project_campaign_assets(%L,%L,%L,%L,%L,%L)',org,project,campaign,plan,service,'99999999-9999-4999-8999-999999997199'),'42501','Missing or foreign selected asset denied');
 perform pg_temp.check_true((select count(*) from public.project_campaign_asset_commands)=commands,'Registry reads add no source/variant command');
end $$;
set local role authenticated;
select pg_temp.check_true((select count(*) from public.project_campaign_assets)=2 and (select count(*) from public.project_campaign_asset_variants)=2,'Authenticated active team reads exact shared project records');
select pg_temp.check_true(public.preview_project_campaign_asset('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',jsonb_build_object('command_kind','register_asset','campaign_id','99999999-9999-4999-8999-999999997172','plan_version_id','99999999-9999-4999-8999-999999997173','marketing_service_id','99999999-9999-4999-8999-999999997171','source_kind','artifact_version','source_version_id','99999999-9999-4999-8999-999999997111','asset_id',null,'label',null))#>>'{source,approval_state}'='approved','Actual authenticated RPC rechecks canonical approval');
select pg_temp.expect_error('select * from public.project_campaign_asset_commands','42501','Authenticated actor cannot scan operation receipts');
select pg_temp.expect_error('insert into public.project_campaign_assets select * from public.project_campaign_assets limit 1','42501','Authenticated actor cannot bypass native source command');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999998',true);
select pg_temp.check_true((select count(*) from public.project_campaign_assets)=0,'Unknown/foreign actor sees no canonical source through RLS');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
set local role anon;
select pg_temp.expect_error('select public.preview_project_campaign_asset(null,null,null)','42501','Actual anonymous RPC execution denied');
set local role service_role;
select pg_temp.expect_error('select public.preview_project_campaign_asset(null,null,null)','42501','Service caller cannot impersonate native authenticated source writer');
reset role;
rollback;
