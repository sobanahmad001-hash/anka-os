begin;
create function pg_temp.ok(v boolean,t text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end;$$;
do $$declare org uuid:=gen_random_uuid();actor uuid:='99999999-9999-4999-8999-999999999902';conv uuid:=gen_random_uuid();msg uuid:=gen_random_uuid();req uuid:=gen_random_uuid();binding jsonb;r jsonb;result jsonb;brief uuid;version uuid;
begin
insert into public.organizations(id,name,slug,status) values(org,'Rollback Design brief','brief-'||org,'active');
insert into public.organization_memberships(organization_id,user_id,role,department_id,status,member_kind) values(org,actor,'operations_admin','design','active','team');
insert into public.department_chat_conversations(id,organization_id,department_id,owner_id,title,context_kind) values(conv,org,'design',actor,'Rollback brief','department_private');
insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at) values(msg,conv,org,'design',actor,actor,'user','Synthetic','completed',gen_random_uuid(),1,now());
binding:=jsonb_build_object('creative_brief_id',null,'expected_revision',0,'visibility','private','engagement_id',null,'brand_id',null,'engagement_service_id',null,'content','{"title":"","output_type":"image"}'::jsonb,'source_version_ids','[]'::jsonb,'source_manifest','{}'::jsonb);
r:=public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding);perform pg_temp.ok(r->>'status'='pending','begin pending');
perform pg_temp.ok(public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding)=r,'begin exact replay');
begin perform public.begin_design_chat_brief_turn(org,actor,conv,msg,gen_random_uuid(),binding);raise exception 'FAIL changed request';exception when unique_violation then raise notice 'PASS changed request rejected';end;
perform pg_temp.ok(public.recover_design_chat_brief_turn(org,actor,conv,msg,null)->>'request_id'=req::text,'recovery without browser identity');
result:='{"assistant_text":"What is the purpose?","questions":["What is the purpose?"],"patch":{},"content":{"title":"","output_type":"image"},"validation":{"valid":false},"content_checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
r:=public.finalize_design_chat_brief_turn(org,actor,conv,msg,req,result);perform pg_temp.ok(r->>'status'='question_only','question-only does not fabricate title');
perform pg_temp.ok(not exists(select 1 from public.design_creative_briefs where organization_id=org),'question-only no brief');
perform pg_temp.ok(public.finalize_design_chat_brief_turn(org,actor,conv,msg,req,result)=r,'finalize replay stable');
msg:=gen_random_uuid();req:=gen_random_uuid();insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at) values(msg,conv,org,'design',actor,actor,'user','Synthetic second','completed',gen_random_uuid(),2,now());
perform public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding);
result:='{"assistant_text":"Draft saved","questions":[],"patch":{"title":"Synthetic"},"content":{"title":"Synthetic","output_type":"image"},"validation":{"valid":false},"content_checksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
r:=public.finalize_design_chat_brief_turn(org,actor,conv,msg,req,result);perform pg_temp.ok(r->>'status'='saved','atomic draft version');brief:=(r#>>'{result,brief,id}')::uuid;version:=(r#>>'{result,version,id}')::uuid;
perform pg_temp.ok((select frozen_version_id is null from public.design_creative_briefs where id=brief),'not automatically confirmed');
perform public.finalize_design_chat_brief_turn(org,actor,conv,msg,req,result);perform pg_temp.ok((select count(*)=1 from public.design_creative_brief_versions where creative_brief_id=brief),'no duplicate version');
binding:=jsonb_set(jsonb_set(binding,'{creative_brief_id}',to_jsonb(brief::text)),'{expected_revision}','1');msg:=gen_random_uuid();req:=gen_random_uuid();insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at) values(msg,conv,org,'design',actor,actor,'user','Synthetic third','completed',gen_random_uuid(),3,now());
perform public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding);
update public.design_creative_briefs set revision=revision+1 where id=brief;
r:=public.finalize_design_chat_brief_turn(org,actor,conv,msg,req,result);perform pg_temp.ok(r->>'status'='conflict','manual edit prevents stale overwrite');

begin perform public.begin_design_chat_brief_turn(org,actor,gen_random_uuid(),msg,gen_random_uuid(),binding);raise exception 'FAIL foreign conversation';exception when insufficient_privilege then raise notice 'PASS foreign conversation rejected';end;
begin perform public.recover_design_chat_brief_turn(gen_random_uuid(),actor,conv,msg,null);raise exception 'FAIL foreign organization';exception when no_data_found then raise notice 'PASS foreign organization receipt invisible';end;
begin perform public.recover_design_chat_brief_turn(org,gen_random_uuid(),conv,msg,null);raise exception 'FAIL shared recipient';exception when no_data_found then raise notice 'PASS non-owner recipient receipt invisible';end;
update public.organization_memberships set role='contributor',department_id='content' where organization_id=org and user_id=actor;
begin perform public.recover_design_chat_brief_turn(org,actor,conv,msg,null);raise exception 'FAIL absent secondary';exception when insufficient_privilege then raise notice 'PASS absent secondary authority denied';end;
update public.organization_memberships set role='operations_admin',department_id='design' where organization_id=org and user_id=actor;
update public.organization_memberships set status='revoked' where organization_id=org and user_id=actor;
begin perform public.recover_design_chat_brief_turn(org,actor,conv,msg,req);raise exception 'FAIL revoked recovery';exception when insufficient_privilege then raise notice 'PASS revoked recovery denied';end;
perform pg_temp.ok(not has_function_privilege('authenticated','private.design_chat_brief_has_prior_execution(uuid,uuid)','execute'),'history helper closed');
perform pg_temp.ok((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='private.design_chat_brief_has_prior_execution(uuid,uuid)'::regprocedure),'history helper pinned definer');
perform pg_temp.ok(not has_table_privilege('authenticated','public.design_chat_brief_turns','select'),'receipt direct read closed');
perform pg_temp.ok(not has_function_privilege('authenticated','public.begin_design_chat_brief_turn(uuid,uuid,uuid,uuid,uuid,jsonb)','execute'),'RPC service only');
end;$$;

do $$declare org uuid;actor uuid:='99999999-9999-4999-8999-999999999902';conv uuid:=gen_random_uuid();msg uuid:=gen_random_uuid();req uuid:=gen_random_uuid();binding jsonb;
begin
select organization_id into strict org from public.departments where id='design';
insert into public.organization_memberships(organization_id,user_id,role,department_id,status,member_kind) values(org,actor,'contributor','content','active','team') on conflict(organization_id,user_id) do update set role='contributor',department_id='content',status='active',member_kind='team';
insert into public.organization_department_memberships(organization_id,user_id,department_id,status,source) values(org,actor,'design','active','explicit') on conflict(organization_id,user_id,department_id) where status='active' do nothing;
insert into public.department_chat_conversations(id,organization_id,department_id,owner_id,title,context_kind) values(conv,org,'design',actor,'Rollback secondary','department_private');
insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at) values(msg,conv,org,'design',actor,actor,'user','Synthetic','completed',gen_random_uuid(),1,now());
binding:=jsonb_build_object('creative_brief_id',null,'expected_revision',0,'visibility','private','engagement_id',null,'brand_id',null,'engagement_service_id',null,'content','{"title":"","output_type":"image"}'::jsonb,'source_version_ids','[]'::jsonb,'source_manifest','{}'::jsonb);
insert into public.ai_runs(organization_id,user_id,capability,status,input_text,output_text) values(org,actor,'writing_support','completed','Synthetic rollback only','Synthetic rollback only');
insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at,in_reply_to_message_id,ai_run_id) values(gen_random_uuid(),conv,org,'design',actor,null,'assistant','Existing ordinary answer','completed',gen_random_uuid(),2,now(),msg,(select id from public.ai_runs where organization_id=org limit 1));
begin perform public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding);raise exception 'FAIL historical ordinary turn';exception when object_not_in_prerequisite_state then raise notice 'PASS historical ordinary turn cannot acquire brief binding';end;
msg:=gen_random_uuid();req:=gen_random_uuid();
insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at) values(msg,conv,org,'design',actor,actor,'user','New explicit Send','completed',gen_random_uuid(),3,now());
perform pg_temp.ok(public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding)->>'status'='pending','active secondary Design membership retained');
update public.organization_department_memberships set status='revoked',revoked_at=clock_timestamp() where organization_id=org and user_id=actor and department_id='design';
begin perform public.recover_design_chat_brief_turn(org,actor,conv,msg,null);raise exception 'FAIL revoked secondary';exception when insufficient_privilege then raise notice 'PASS revoked secondary authority denied';end;
end;$$;

do $$declare org uuid:='99999999-9999-4999-8999-999999999901';actor uuid:='99999999-9999-4999-8999-999999999902';eng uuid:='99999999-9999-4999-8999-999999999975';conv uuid:=gen_random_uuid();msg uuid:=gen_random_uuid();req uuid:=gen_random_uuid();cat uuid:=gen_random_uuid();svc uuid:=gen_random_uuid();proj uuid;brand uuid;binding jsonb;
begin
update public.organization_memberships set role='operations_admin',department_id='design',status='active' where organization_id=org and user_id=actor;
select project_id,brand_id into strict proj,brand from public.engagements where id=eng and organization_id=org;
insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values(cat,org,'design','website_ux_ui','Rollback exact Design',true);
insert into public.engagement_services(id,organization_id,engagement_id,service_id,status,owner_id,activated_by) values(svc,org,eng,cat,'active',actor,actor);
insert into public.department_chat_conversations(id,organization_id,department_id,owner_id,title,context_kind,project_id,engagement_id) values(conv,org,'design',actor,'Rollback project','department_project',proj,eng);
insert into public.department_chat_messages(id,conversation_id,organization_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence,finished_at,project_id,engagement_id) values(msg,conv,org,'design',actor,actor,'user','Synthetic','completed',gen_random_uuid(),1,now(),proj,eng);
binding:=jsonb_build_object('creative_brief_id',null,'expected_revision',0,'visibility','official','engagement_id',eng,'brand_id',brand,'engagement_service_id',svc,'content','{"title":"","output_type":"image"}'::jsonb,'source_version_ids','[]'::jsonb,'source_manifest','{}'::jsonb);
perform pg_temp.ok(public.begin_design_chat_brief_turn(org,actor,conv,msg,req,binding)->>'status'='pending','exact project service allowed');
begin perform public.begin_design_chat_brief_turn(org,actor,conv,msg,req,jsonb_set(binding,'{engagement_service_id}',to_jsonb(gen_random_uuid()::text)));raise exception 'FAIL foreign service';exception when insufficient_privilege then raise notice 'PASS foreign service rejected';end;
begin perform public.begin_design_chat_brief_turn(org,actor,conv,msg,req,jsonb_set(binding,'{brand_id}',to_jsonb(gen_random_uuid()::text)));raise exception 'FAIL foreign brand';exception when insufficient_privilege then raise notice 'PASS foreign brand rejected';end;
update public.service_catalog set is_active=false where id=cat;
begin perform public.recover_design_chat_brief_turn(org,actor,conv,msg,null);raise exception 'FAIL inactive service';exception when insufficient_privilege then raise notice 'PASS inactive service recovery denied';end;
end;$$;
rollback;





