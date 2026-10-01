-- Synthetic existing-actor fixtures in one rollback. No users/providers/production writes.
begin;
set local lock_timeout='5s';set local statement_timeout='90s';
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.expect_error(query text,code text,label text) returns void language plpgsql as $$begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;raise exception 'FAIL % expected % got %: %',label,code,sqlstate,sqlerrm;end;raise exception 'FAIL % did not reject',label;end $$;
-- The known clone-only activity default is changed only inside this rollback for one canonical Task fixture.
alter table public.activity_events alter column organization_id set default '99999999-9999-4999-8999-999999999901'::uuid;
insert into public.backlink_targets(id,organization_id,brand_id,site_name,site_url,domain_authority,estimated_traffic,relevance_score,created_by)
values('99999999-9999-4999-8999-999999997400','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999973','Synthetic publication research','https://Example.invalid:443/publication/#fragment',null,null,null,'99999999-9999-4999-8999-999999999902'),('99999999-9999-4999-8999-999999997401','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999973','Duplicate canonical research target','https://example.invalid/publication',0,0,0,'99999999-9999-4999-8999-999999999902');
insert into public.tasks(id,organization_id,project_id,user_id,created_by,title,department_id,due_date,status)
values('99999999-9999-4999-8999-999999997402','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999902','99999999-9999-4999-8999-999999999902','Synthetic existing governed Marketing Project Task','marketing','2026-10-10','backlog');
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';eng uuid:='99999999-9999-4999-8999-999999999975';service uuid:='99999999-9999-4999-8999-999999997171';request uuid:='99999999-9999-4999-8999-999999997410';input jsonb;review jsonb;saved jsonb;saved2 jsonb;linked jsonb;link_input jsonb;query text;candidates bigint;observations bigint;commands bigint;task_links bigint;tasks bigint;work bigint;targets bigint;users bigint;
begin
 select count(*) into candidates from public.project_marketing_opportunities;select count(*) into observations from public.project_marketing_opportunity_observations;select count(*) into commands from public.project_marketing_opportunity_commands;select count(*) into task_links from public.project_marketing_opportunity_task_links;select count(*) into tasks from public.tasks;select count(*) into work from public.work_items;select count(*) into targets from public.backlink_targets;select count(*) into users from auth.users;
 input:=jsonb_build_object('command_kind','record_research','target_id','99999999-9999-4999-8999-999999997400','candidate_kind','publication','source_url','https://example.invalid/research?record=1#citation','observed_on','2026-09-30','notes','Synthetic manual research; no provider verification');
 review:=public.preview_project_marketing_opportunity(org,project,eng,service,input);
 perform pg_temp.check_true(review->>'zero_write'='true' and (select count(*) from public.project_marketing_opportunities)=candidates and (select count(*) from public.project_marketing_opportunity_commands)=commands,'Research review makes zero writes');
 perform pg_temp.check_true(review#>>'{reference,normalized_site_url}'='https://example.invalid/publication' and review#>'{reference,target,estimated_traffic}'='null','Safe syntactic URL dedupe preserves unknown manual quality metrics');
 perform pg_temp.check_true(private.marketing_opportunity_url('https://example.invalid/publication?a=1')<>private.marketing_opportunity_url('https://example.invalid/publication?a=2'),'Distinct query resource identities are never silently merged');
 query:=format('select public.preview_project_marketing_opportunity(%L,%L,%L,%L,',org,project,eng,service);
 perform pg_temp.expect_error(query||quote_literal(input||'{"extra":true}')||'::jsonb)','22023','Unknown candidate fields rejected');
 perform pg_temp.expect_error(query||quote_literal(input||'{"observed_on":"2026-02-30"}')||'::jsonb)','22008','Nonexistent research date rejected');
 perform pg_temp.expect_error(query||quote_literal(input||jsonb_build_object('observed_on',(current_date+1)::text))||'::jsonb)','22023','Future research date is not fabricated evidence');
 perform pg_temp.expect_error(query||quote_literal(input||'{"source_url":"https://secret@example.invalid"}')||'::jsonb)','22023','Credential-bearing source URL rejected');
 perform pg_temp.expect_error(query||quote_literal(input||'{"candidate_kind":"advertising"}')||'::jsonb)','22023','Unagreed opportunity categories rejected');
 perform pg_temp.expect_error(query||quote_literal(input||'{"target_id":"99999999-9999-4999-8999-999999997499"}')||'::jsonb)','42501','Unknown/foreign canonical target cannot be synthesized');
 saved:=public.confirm_project_marketing_opportunity(org,project,eng,service,input,review->>'review_checksum',request);
 perform pg_temp.check_true((select count(*) from public.project_marketing_opportunities)=candidates+1 and (select count(*) from public.project_marketing_opportunity_observations)=observations+1 and (select count(*) from public.project_marketing_opportunity_commands)=commands+1,'Research confirm atomically saves one deduped root, original source/date observation and UUID receipt');
 perform pg_temp.check_true(saved#>>'{observation,source_url}'=input->>'source_url' and saved#>>'{observation,observed_on}'='2026-09-30' and saved->>'work_created'='false' and saved->>'provider_verified'='false','Original source/date is immutable manual research without work/provider acceptance');
 perform pg_temp.check_true(public.confirm_project_marketing_opportunity(org,project,eng,service,input,review->>'review_checksum',request)=saved,'Original UUID/payload replays one exact research receipt');
 perform pg_temp.expect_error(format('select public.confirm_project_marketing_opportunity(%L,%L,%L,%L,%L::jsonb,%L,%L)',org,project,eng,service,input||'{"notes":"Changed"}',review->>'review_checksum',request),'23505','Altered same-UUID research conflicts rather than duplicating');
 perform pg_temp.check_true(public.get_project_marketing_opportunity_operation(org,project,request)=saved and public.get_project_marketing_opportunity_operation(org,project,'99999999-9999-4999-8999-999999997419') is null,'Read-only original recovery returns exact receipt or unknown');
 input:=input||'{"target_id":"99999999-9999-4999-8999-999999997401","observed_on":"2026-09-29","notes":"Second retained manual source"}';review:=public.preview_project_marketing_opportunity(org,project,eng,service,input);
 perform pg_temp.check_true(review#>>'{reference,existing_candidate_id}'=saved#>>'{candidate,id}' and (review#>>'{reference,target,estimated_traffic}')::numeric=0,'Equivalent duplicate canonical target reuses original root while zero remains explicit');
 saved2:=public.confirm_project_marketing_opportunity(org,project,eng,service,input,review->>'review_checksum','99999999-9999-4999-8999-999999997411');
 perform pg_temp.check_true(saved2#>>'{candidate,id}'=saved#>>'{candidate,id}' and saved2->>'deduplicated'='true' and (select count(*) from public.project_marketing_opportunities)=candidates+1 and (select count(*) from public.project_marketing_opportunity_observations)=observations+2,'Deduped candidate retains both original source/date observations without duplicate work');
 link_input:=jsonb_build_object('command_kind','link_task','candidate_id',saved#>>'{candidate,id}','observation_id',saved#>>'{observation,id}','task_id','99999999-9999-4999-8999-999999997402');
 review:=public.preview_project_marketing_opportunity(org,project,eng,service,link_input);
 perform pg_temp.check_true(review#>>'{reference,task,kind}'='project_task' and review#>>'{reference,task,due_date}'='2026-10-10' and (select count(*) from public.project_marketing_opportunity_task_links)=task_links,'Explicit commitment review uses current canonical Project Task/deadline and writes nothing');
 linked:=public.confirm_project_marketing_opportunity(org,project,eng,service,link_input,review->>'review_checksum','99999999-9999-4999-8999-999999997412');
 perform pg_temp.check_true(linked#>>'{task_link,observation_id}'=saved#>>'{observation,id}' and linked#>>'{task_link,task_id}'='99999999-9999-4999-8999-999999997402' and linked->>'ready_to_submit'='false','One reviewed Task link retains exact original research source without submission authority');
 perform pg_temp.check_true((select count(*) from public.tasks)=tasks and (select count(*) from public.work_items)=work and (select count(*) from public.backlink_targets)=targets and (select count(*) from auth.users)=users,'Research/commitment never creates or copies Tasks, Work Items, targets or users');
 link_input:=link_input||jsonb_build_object('observation_id',saved2#>>'{observation,id}');review:=public.preview_project_marketing_opportunity(org,project,eng,service,link_input);perform pg_temp.check_true(review#>>'{reference,existing_task_link,observation_id}'=saved#>>'{observation,id}' and review#>>'{reference,existing_task_link,original_research,observed_on}'='2026-09-30','Duplicate commitment review exposes its original retained source/date before confirmation');linked:=public.confirm_project_marketing_opportunity(org,project,eng,service,link_input,review->>'review_checksum','99999999-9999-4999-8999-999999997413');
 perform pg_temp.check_true(linked->>'deduplicated'='true' and (select count(*) from public.project_marketing_opportunity_task_links)=task_links+1 and linked#>>'{task_link,observation_id}'=saved#>>'{observation,id}' and linked#>>'{observation,id}'=saved#>>'{observation,id}','Duplicate Task link preserves original commitment source rather than renewing it');
 review:=public.preview_project_marketing_opportunity(org,project,eng,service,link_input);update public.tasks set due_date='2026-10-11' where id='99999999-9999-4999-8999-999999997402';
 perform pg_temp.expect_error(format('select public.confirm_project_marketing_opportunity(%L,%L,%L,%L,%L::jsonb,%L,%L)',org,project,eng,service,link_input,review->>'review_checksum','99999999-9999-4999-8999-999999997414'),'40001','Concurrent canonical Task deadline/revision invalidates reviewed commitment');
 update public.tasks set archived_at=clock_timestamp() where id='99999999-9999-4999-8999-999999997402';
 perform pg_temp.expect_error(query||quote_literal(link_input)||'::jsonb)','42501','Archived Task cannot become newly committed work');
 update public.tasks set archived_at=null where id='99999999-9999-4999-8999-999999997402';
 update public.backlink_targets set notes='Changed current manual target' where id='99999999-9999-4999-8999-999999997401';
 perform pg_temp.expect_error(query||quote_literal(link_input)||'::jsonb)','40001','Changed canonical target requires a fresh recorded observation');
 perform pg_temp.check_true(public.get_project_marketing_opportunity_operation(org,project,'99999999-9999-4999-8999-999999997412')#>>'{task_link,observation_id}'=saved#>>'{observation,id}','Changed current target/work keeps original commitment history');
 update public.engagement_services set status='on_hold' where id=service;
 perform pg_temp.expect_error(query||quote_literal(input)||'::jsonb)','42501','Withdrawn agreed Marketing service blocks new research');
 update public.engagement_services set status='active' where id=service;
 update public.organization_memberships set status='revoked' where organization_id=org and user_id='99999999-9999-4999-8999-999999999902';
 perform pg_temp.expect_error(query||quote_literal(input)||'::jsonb)','42501','Revoked actor cannot record research or commitment');
 update public.organization_memberships set status='active' where organization_id=org and user_id='99999999-9999-4999-8999-999999999902';
 update public.projects set archived_at=clock_timestamp() where id=project;
 perform pg_temp.expect_error(query||quote_literal(input)||'::jsonb)','42501','Archived project blocks new research');
 perform pg_temp.check_true(public.get_project_marketing_opportunity_operation(org,project,request)=saved,'Archived Team history retains exact original receipt');
 perform pg_temp.expect_error(format('delete from public.project_marketing_opportunity_observations where id=%L',saved#>>'{observation,id}'),'55000','Original research observations cannot be deleted or rewritten');
 perform pg_temp.expect_error(format('update public.project_marketing_opportunity_task_links set task_id=task_id where id=%L',linked#>>'{task_link,id}'),'55000','Committed canonical Task links remain immutable');
end $$;
update public.projects set archived_at=null where id='99999999-9999-4999-8999-999999999974';
set local role authenticated;
do $$declare input jsonb;review jsonb;receipt jsonb;org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';eng uuid:='99999999-9999-4999-8999-999999999975';service uuid:='99999999-9999-4999-8999-999999997171';begin
input:=jsonb_build_object('command_kind','record_research','target_id','99999999-9999-4999-8999-999999997400','candidate_kind','publication','source_url','https://example.invalid/research/authenticated','observed_on','2026-09-30','notes','Synthetic authenticated research; no provider/human acceptance');review:=public.preview_project_marketing_opportunity(org,project,eng,service,input);receipt:=public.confirm_project_marketing_opportunity(org,project,eng,service,input,review->>'review_checksum','99999999-9999-4999-8999-999999997415');perform pg_temp.check_true(receipt->>'request_id'='99999999-9999-4999-8999-999999997415' and receipt->>'work_created'='false','Authenticated research preview/confirmation works without direct table access');end $$;

select pg_temp.check_true(public.get_project_marketing_opportunity_operation('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999997410')->>'request_id'='99999999-9999-4999-8999-999999997410','Authenticated original recovery works through closed tables');
select pg_temp.expect_error('select * from public.project_marketing_opportunities','42501','Authenticated direct opportunity-table access denied');
reset role;set local role anon;
select pg_temp.expect_error('select public.get_project_marketing_opportunity_operation(null,null,null)','42501','Anonymous opportunity API denied');
reset role;set local role service_role;
select pg_temp.expect_error('select public.get_project_marketing_opportunity_operation(null,null,null)','42501','Service role cannot bypass actor-owned opportunity recovery');
reset role;rollback;
