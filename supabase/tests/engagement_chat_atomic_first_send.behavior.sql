\set ON_ERROR_STOP on
begin;
do $$ begin if current_database() <> 'anka_b1_firstsend_20260930' then raise exception 'Owned local fixture required'; end if; end $$;
create function private.engagement_atomic_force_failure() returns trigger language plpgsql as $$ begin if new.body='Force atomic rollback' then raise exception 'forced failure' using errcode='23514'; end if; return new; end $$;
create trigger engagement_atomic_force_failure before insert on public.department_chat_messages for each row execute function private.engagement_atomic_force_failure();
do $$
declare
 org uuid := '99999999-9999-4999-8999-999999999901'; actor uuid := '99999999-9999-4999-8999-999999999902';
 project uuid := '99999999-9999-4999-8999-999999999974'; engagement uuid := '99999999-9999-4999-8999-999999999975';
 cid uuid := gen_random_uuid(); request uuid := gen_random_uuid(); failed uuid := gen_random_uuid(); result jsonb; replay jsonb;
begin
 if not has_function_privilege('service_role','public.start_engagement_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text)','execute') or has_function_privilege('authenticated','public.start_engagement_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text)','execute') or has_function_privilege('anon','public.start_engagement_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text)','execute') then raise exception 'ACL mismatch'; end if;
 result := public.start_engagement_chat_turn(cid,org,project,engagement,'content',actor,request,E'First\n  direction');
 replay := public.start_engagement_chat_turn(cid,org,project,engagement,'content',actor,request,E'First\n  direction');
 if result#>>'{conversation,title}' <> 'First direction' or result#>>'{message,id}' <> replay#>>'{message,id}' or (replay->>'replayed')::boolean is not true or (select count(*) from public.department_chat_messages where conversation_id=cid) <> 1 then raise exception 'Replay mismatch'; end if;
 begin perform public.start_engagement_chat_turn(cid,org,project,engagement,'content',actor,request,'Changed prompt'); raise exception 'Changed replay accepted'; exception when unique_violation then null; end;
 begin perform public.start_engagement_chat_turn(cid,org,project,engagement,'content',actor,gen_random_uuid(),E'First\n  direction'); raise exception 'Changed identity accepted'; exception when unique_violation then null; end;
 begin perform public.start_engagement_chat_turn(failed,org,project,engagement,'content',actor,gen_random_uuid(),'Force atomic rollback'); raise exception 'Forced failure accepted'; exception when check_violation then null; end;
 if exists(select 1 from public.department_chat_conversations where id=failed) then raise exception 'Orphan conversation after rollback'; end if;
 begin perform public.start_engagement_chat_turn(gen_random_uuid(),org,'99999999-9999-4999-8999-999999999911',engagement,'content',actor,gen_random_uuid(),'Foreign parent'); raise exception 'Foreign parent accepted'; exception when insufficient_privilege then null; end;
 update public.projects set archived_at=now() where id=project;
 begin perform public.start_engagement_chat_turn(gen_random_uuid(),org,project,engagement,'content',actor,gen_random_uuid(),'Archived parent'); raise exception 'Archive accepted'; exception when insufficient_privilege then null; end;
 update public.projects set archived_at=null where id=project;
 update public.engagement_services set status='on_hold' where id='99999999-9999-4999-8999-999999999977';
 begin perform public.start_engagement_chat_turn(gen_random_uuid(),org,project,engagement,'content',actor,gen_random_uuid(),'Paused service'); raise exception 'Service accepted'; exception when insufficient_privilege then null; end;
end $$;
rollback;
