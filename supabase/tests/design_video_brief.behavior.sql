-- Run only against the approved isolated anka_b1_firstsend_20260930 clone.
-- Reuses its synthetic user; all data/helper mutations in this file roll back.
begin;
set local lock_timeout='5s'; set local statement_timeout='30s';
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end; $$;
create function pg_temp.expect_error(command text,wanted text,label text) returns void language plpgsql as $$
begin
 begin execute command; exception when others then
  if sqlstate<>wanted then raise exception 'FAIL % expected %, got %: %',label,wanted,sqlstate,sqlerrm; end if;
  raise notice 'PASS %',label; return;
 end;
 raise exception 'FAIL % unexpectedly succeeded',label;
end; $$;
create function pg_temp.fail_freeze() returns trigger language plpgsql as $$
begin if new.frozen_version_id is not null then raise exception 'forced freeze rollback' using errcode='P0001'; end if; return new; end; $$;
create trigger video_brief_forced_failure before update on public.design_creative_briefs for each row execute function pg_temp.fail_freeze();
insert into public.departments(id,name,organization_id) values ('design','Design','99999999-9999-4999-8999-999999999901') on conflict(id) do nothing;
insert into public.department_chat_conversations(id,organization_id,owner_id,department_id,context_kind,title)
values ('99999999-9999-4999-8999-999999998001','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999902','design','department_private','Video brief rollback QA');
do $$
declare
 org uuid:='99999999-9999-4999-8999-999999999901'; actor uuid:='99999999-9999-4999-8999-999999999902';
 conv uuid:='99999999-9999-4999-8999-999999998001'; direction uuid:='99999999-9999-4999-8999-999999998004';
 op uuid:=gen_random_uuid(); op2 uuid:=gen_random_uuid(); root uuid; v1 uuid; result jsonb; replay jsonb; v jsonb; k text; before_count integer;
begin
 v:='{"purpose":"Explain the service","audience":"Existing customers","channel":"Website","assets":"None","script_storyboard":"Introduce the product, then show the benefit.","brand_constraints":"Use the approved palette","required_text":"Anka","mode":"explore","duration_seconds":5,"aspect_ratio":"16:9","resolution":"720p","output_format":"mp4","generate_audio":false}'::jsonb;
 perform pg_temp.check_true(private.valid_design_video_brief(v),'complete exact brief');
 foreach k in array array['purpose','audience','channel','assets','script_storyboard','brand_constraints','required_text','mode','duration_seconds','aspect_ratio','resolution','output_format','generate_audio'] loop
  perform pg_temp.check_true(not private.valid_design_video_brief(jsonb_set(v,array[k],'null'::jsonb)),'null rejected '||k);
 end loop;
 perform pg_temp.check_true(not private.valid_design_video_brief(v||'{"history":"secret"}'),'unknown history field rejected');
 perform pg_temp.check_true(not private.valid_design_video_brief(v||'{"resolution":"1080p"}'),'1080p rejected without downgrade');
 perform pg_temp.check_true(not private.valid_design_video_brief(v||'{"duration_seconds":"5"}'),'duration type not coerced');
 perform pg_temp.check_true(not private.valid_design_video_brief(v||'{"mode":"production","resolution":"480p"}'),'production low resolution rejected');
 perform pg_temp.check_true(private.valid_design_video_brief(v||'{"mode":"production","duration_seconds":30}'),'explicit supported production settings');
 perform pg_temp.check_true(has_function_privilege('service_role','public.confirm_design_video_brief(uuid,uuid,uuid,uuid,uuid,integer,uuid,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.confirm_design_video_brief(uuid,uuid,uuid,uuid,uuid,integer,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.get_design_video_brief(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'service-only public APIs');
 perform pg_temp.check_true(not has_function_privilege('service_role','private.require_design_video_brief_context(uuid,uuid,uuid,uuid)','EXECUTE'),'private authority helper revoked');
 select count(*) into before_count from public.design_creative_briefs where organization_id=org;
 perform pg_temp.expect_error(format('select public.confirm_design_video_brief(%L,%L,%L,null,null,0,%L,%L)',org,actor,conv,op,v),'P0001','save and Freeze fail atomically');
 perform pg_temp.check_true((select count(*)=before_count from public.design_creative_briefs where organization_id=org) and not exists(select 1 from public.design_creative_brief_versions where operation_key=op),'failed Freeze leaves no root or version');
 drop trigger video_brief_forced_failure on public.design_creative_briefs;
 result:=public.confirm_design_video_brief(org,actor,conv,null,null,0,op,v);
 root:=(result->'brief'->>'id')::uuid; v1:=(result->'version'->>'id')::uuid;
 perform pg_temp.check_true(result->'brief'->>'visibility'='private' and (result->'brief'->>'revision')::integer=2 and result->'brief'->>'frozen_version_id'=v1::text and result->'brief'->>'engagement_id' is null and result->'version'->'content'->'video_brief'=v,'one owner-private canonical version frozen');
 replay:=public.confirm_design_video_brief(org,actor,conv,null,null,0,op,v);
 perform pg_temp.check_true(replay->'version'->>'id'=v1::text and (replay->>'idempotent_replay')::boolean,'same exact operation replays one version');
 perform pg_temp.expect_error(format('select public.confirm_design_video_brief(%L,%L,%L,null,null,0,%L,%L)',org,actor,conv,op,v||'{"purpose":"Changed"}'),'23505','changed operation payload denied');
 perform pg_temp.expect_error(format('select public.confirm_design_video_brief(%L,%L,%L,null,%L,2,%L,%L)',org,actor,conv,root,op,v),'23505','changed operation root and revision denied');
 perform pg_temp.expect_error(format('select public.confirm_design_video_brief(%L,%L,%L,null,null,0,%L,%L)',org,actor,conv,op2,v),'40001','second first-root denied');
 perform pg_temp.expect_error(format('select public.confirm_design_video_brief(%L,%L,%L,null,%L,1,%L,%L)',org,actor,conv,root,op2,v),'40001','stale revision denied');
 result:=public.confirm_design_video_brief(org,actor,conv,null,root,2,op2,v||'{"required_text":"Updated exact text"}');
 perform pg_temp.check_true((result->'version'->>'version_number')::integer=2 and result->'version'->>'parent_version_id'=v1::text and (result->'brief'->>'revision')::integer=4,'new immutable version preserves parent');
 replay:=public.get_design_video_brief(org,actor,conv,null,op);
 perform pg_temp.check_true(replay->'version'->>'id'=v1::text and not (replay->>'confirmation_current')::boolean and replay->'version'->'content'->'video_brief'=v,'exact history lookup does not substitute latest');
 replay:=public.confirm_design_video_brief(org,actor,conv,null,null,0,op,v);
 perform pg_temp.check_true(replay->'brief'->>'frozen_version_id'=result->'version'->>'id' and not (replay->>'confirmation_current')::boolean,'old replay never refreezes current root');
 perform pg_temp.expect_error(format('select public.confirm_design_video_brief(%L,%L,%L,%L,null,0,%L,%L)',org,actor,conv,direction,gen_random_uuid(),v),'22023','two contexts denied');
 perform pg_temp.expect_error(format('select public.get_design_video_brief(%L,%L,%L,null,null)',org,gen_random_uuid(),conv),'42501','foreign actor denied');
 perform pg_temp.expect_error(format('select public.get_design_video_brief(%L,%L,%L,null,null)',gen_random_uuid(),actor,conv),'42501','foreign organization denied');
 update public.department_chat_conversations set state='archived',archived_at=now() where id=conv;
 perform pg_temp.expect_error(format('select public.get_design_video_brief(%L,%L,%L,null,null)',org,actor,conv),'42501','archived context denied');
 update public.department_chat_conversations set state='active',archived_at=null where id=conv;
 update public.organization_memberships set status='revoked' where organization_id=org and user_id=actor;
 perform pg_temp.expect_error(format('select public.get_design_video_brief(%L,%L,%L,null,null)',org,actor,conv),'42501','revoked membership denied');
 update public.organization_memberships set status='active' where organization_id=org and user_id=actor;
 -- Official source anchor stays private, and exact source authority must remain active.
 update public.service_catalog set department_id='design' where id='99999999-9999-4999-8999-999999999976';
 insert into public.design_workshop_sessions(id,organization_id,engagement_id,brand_id,engagement_service_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,status,created_by)
 values ('99999999-9999-4999-8999-999999998002',org,'99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999973','99999999-9999-4999-8999-999999999977','video_motion','{}','QA','{}',repeat('a',64),'ready',actor);
 insert into public.design_directions(id,organization_id,session_id,direction_slot) values ('99999999-9999-4999-8999-999999998003',org,'99999999-9999-4999-8999-999999998002',1);
 insert into public.design_direction_versions(id,organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by)
 values(direction,org,'99999999-9999-4999-8999-999999998003',1,'{}',repeat('b',64),repeat('c',64),actor);
 result:=public.confirm_design_video_brief(org,actor,null,direction,null,0,gen_random_uuid(),v);
 perform pg_temp.check_true(result->'brief'->>'visibility'='private' and result->'version'->'content'->'video_context'->>'direction_version_id'=direction::text,'exact active direction creates private brief only');
 update public.engagement_services set status='on_hold' where id='99999999-9999-4999-8999-999999999977';
 perform pg_temp.expect_error(format('select public.get_design_video_brief(%L,%L,null,%L,null)',org,actor,direction),'42501','on-hold Design service denies direction');
 update public.engagement_services set status='active' where id='99999999-9999-4999-8999-999999999977';
 update public.projects set archived_at=now() where id='99999999-9999-4999-8999-999999999974';
 perform pg_temp.expect_error(format('select public.get_design_video_brief(%L,%L,null,%L,null)',org,actor,direction),'42501','archived project denies direction');
end; $$;
rollback;
