begin;
set local lock_timeout='5s';set local statement_timeout='90s';
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.expect_error(query text,code text,label text) returns void language plpgsql as $$begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;raise exception 'FAIL % expected % got %: %',label,code,sqlstate,sqlerrm;end;raise exception 'FAIL % did not reject',label;end $$;
insert into public.integration_connections(id,organization_id,provider,display_name,status,public_config,created_by) values('99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999901','google_analytics','B6 synthetic local reporting','verified','{"property_id":"123456"}','99999999-9999-4999-8999-999999999902');
insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by) values('99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999975','marketing','99999999-9999-4999-8999-999999999902');
insert into public.integration_oauth_credentials(connection_id,organization_id,provider,access_token_ciphertext,access_token_iv,refresh_token_ciphertext,refresh_token_iv,granted_scopes,access_token_expires_at) values('99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999901','google_analytics','local-metadata-only','local-metadata-only','local-metadata-only','local-metadata-only',array['https://www.googleapis.com/auth/analytics.readonly'],now()+interval '1 hour');
do $$declare input jsonb:='{"binding_id":null,"expected_revision":0,"engagement_id":"99999999-9999-4999-8999-999999999975","department_id":"marketing","connection_id":"99999999-9999-4999-8999-999999997610","resource_kind":"ga4_property","resource_key":"123456","permitted_operations":["reporting_read"],"state":"enabled"}';v jsonb;s jsonb;begin
 v:=public.preview_project_reporting_binding('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',input);
 s:=public.confirm_project_reporting_binding('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',input,v->>'review_sha256','99999999-9999-4999-8999-999999997611');
 perform set_config('anka.b6binding',s->>'binding_id',true);
end $$;

select set_config('request.jwt.claim.role','authenticated',true);
do $$declare r public.project_reporting_binding_revisions%rowtype;input jsonb;begin
 select * into r from public.project_reporting_binding_revisions where binding_id=current_setting('anka.b6binding')::uuid;
 input:=jsonb_build_object('source_contract','local-adapter-only','reporting_time_zone','UTC','limits','{"cadence_seconds":3600,"history_days":30,"stale_after_seconds":7200,"manual_min_interval_seconds":60,"daily_request_limit":2,"backoff_seconds":1,"max_backoff_seconds":2,"max_period_days":7,"max_observations":25,"lease_seconds":1}'::jsonb,'enabled',true,'binding_revision_number',r.revision_number,'context_checksum',r.context_checksum);
 perform set_config('anka.refreshinput',input::text,true);
end $$;
set local role authenticated;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';binding uuid:=current_setting('anka.b6binding')::uuid;input jsonb:=current_setting('anka.refreshinput')::jsonb;v jsonb;r uuid:='99999999-9999-4999-8999-999999997710';begin
 v:=public.configure_project_reporting_refresh(org,project,binding,0,input,r);
 perform set_config('anka.refreshpolicy',v->>'policy_id',true);
 perform pg_temp.check_true(v->>'revision_number'='1' and v->>'dispatch_authorized'='false','Explicit durable policy grants no dispatch');
 perform pg_temp.check_true(public.configure_project_reporting_refresh(org,project,binding,0,input,r)->>'replayed'='true','Original policy UUID replays without extra revision');
 perform pg_temp.expect_error(format('select public.configure_project_reporting_refresh(%L,%L,%L,0,%L,%L)',org,project,binding,input||'{"enabled":false}',r),'23505','Changed policy replay rejected');
 perform pg_temp.expect_error(format('select public.configure_project_reporting_refresh(%L,%L,%L,0,%L,%L)',org,project,binding,input,gen_random_uuid()),'40001','Stale expected policy revision rejected');
 perform pg_temp.expect_error(format('select public.configure_project_reporting_refresh(%L,%L,%L,1,%L,%L)',org,project,binding,input||'{"unknown":true}',gen_random_uuid()),'22023','Unknown configuration field rejected');
 perform pg_temp.expect_error(format('select public.configure_project_reporting_refresh(%L,%L,%L,1,%L,%L)',org,project,binding,jsonb_set(input,'{limits,daily_request_limit}','0'),gen_random_uuid()),'22023','No implicit unlimited quota');
 perform pg_temp.expect_error(format('select public.configure_project_reporting_refresh(%L,%L,%L,1,%L,%L)',org,project,binding,input||'{"reporting_time_zone":"invalid/zone"}',gen_random_uuid()),'22023','Unknown resource timezone rejected');
 perform pg_temp.expect_error(format('select public.configure_project_reporting_refresh(%L,%L,%L,1,%L,%L)',org,project,binding,input||'{"binding_revision_number":2}',gen_random_uuid()),'40001','Changed binding revision rejected');
 perform pg_temp.expect_error(format('select public.begin_project_reporting_verification(%L,%L,%L,%L,%L)',org,project,binding,v->>'policy_id',gen_random_uuid()),'55000','Uninstalled adapter cannot be inferred from configuration');
 v:=public.get_project_reporting_refresh_configuration(org,project,binding);
 perform pg_temp.check_true(v#>>'{policy,limits,history_days}'='30' and v->>'provider_request_made'='false','Bounded current policy read without provider request');
 perform pg_temp.expect_error('select * from private.reporting_refresh_policies','42501','Authenticated direct policy table access denied');
 perform pg_temp.expect_error('insert into private.reporting_refresh_adapters default values','42501','Authenticated cannot register a provider capability');
 perform pg_temp.expect_error(format('select public.get_project_reporting_refresh_configuration(%L,%L,%L)',org,gen_random_uuid(),binding),'42501','Cross-project configuration read rejected');
end $$;
reset role;
-- Deployment-owned local synthetic manifest; never installed outside rollback fixture.
insert into private.reporting_refresh_adapters values('local-adapter-only','google_analytics','ga4_property',repeat('a',64),'[{"metric_key":"fixture_clicks","metric_label":"Fixture clicks","unit":"count","aggregation":"additive"}]',true);
set local role authenticated;
do $$declare q jsonb;begin
 q:=public.begin_project_reporting_verification('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,current_setting('anka.refreshpolicy')::uuid,'99999999-9999-4999-8999-999999997711');
 perform pg_temp.check_true(q->>'replayed'='false' and q->>'dispatch_authorized'='false','Verification challenge is not provider dispatch authority');
 perform pg_temp.check_true(public.begin_project_reporting_verification('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,current_setting('anka.refreshpolicy')::uuid,'99999999-9999-4999-8999-999999997711')->>'replayed'='true','Original challenge replays without renewal');
 perform pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997711',repeat('a',64),clock_timestamp(),true,true,repeat('b',64))$q$,'42501','Authenticated cannot forge provider verification');
end $$;
reset role;
select set_config('anka.observed',clock_timestamp()::text,true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$declare v jsonb;begin
 perform pg_temp.expect_error('select * from private.reporting_refresh_policies','42501','Service role has no blanket private-table access');
 perform pg_temp.expect_error('insert into private.reporting_refresh_adapters default values','42501','Service role cannot invent adapter support');
 perform pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997711',repeat('c',64),current_setting('anka.observed')::timestamptz,true,true,repeat('b',64))$q$,'22023','Wrong adapter manifest rejected');
 perform pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997711',repeat('a',64),clock_timestamp()+interval '1 day',true,true,repeat('b',64))$q$,'22023','Future verification observation rejected');
 v:=public.record_project_reporting_verification('99999999-9999-4999-8999-999999997711',repeat('a',64),current_setting('anka.observed')::timestamptz,true,true,repeat('b',64));
 perform pg_temp.check_true(v->>'resource_verified'='true' and v->>'dispatch_authorized'='false','Trusted exact positive evidence stored without dispatch grant');
 perform pg_temp.check_true(public.record_project_reporting_verification('99999999-9999-4999-8999-999999997711',repeat('a',64),current_setting('anka.observed')::timestamptz,true,true,repeat('b',64))->>'replayed'='true','Trusted evidence original response replay');
 perform pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997711',repeat('a',64),current_setting('anka.observed')::timestamptz,false,true,repeat('b',64))$q$,'23505','Conflicting verification replay rejected');
end $$;
reset role;
select pg_temp.check_true((select count(*) from private.reporting_refresh_policies)=1 and (select count(*) from private.reporting_resource_verifications)=1,'Replay never multiplies durable policy or resource receipts');
select pg_temp.expect_error('update private.reporting_resource_verifications set resource_matches=false','55000','Verification evidence is immutable');
select pg_temp.expect_error('delete from private.reporting_refresh_policies','55000','Policy history is immutable');
select set_config('request.jwt.claim.role','authenticated',true);

-- Atomic queue branches reuse only the current rollback-only verified fixture.
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';binding uuid:=current_setting('anka.b6binding')::uuid;policy uuid:=current_setting('anka.refreshpolicy')::uuid;day date:=timezone('UTC',clock_timestamp())::date;v jsonb;w jsonb;begin
 v:=public.request_project_reporting_refresh(org,project,binding,policy,day,day,'99999999-9999-4999-8999-999999997720');perform set_config('anka.refreshjob',v->>'job_id',true);
 perform pg_temp.check_true(v->>'state'='queued' and v->>'dispatch_authorized'='false','Queue request grants no provider dispatch');
 perform pg_temp.check_true(public.request_project_reporting_refresh(org,project,binding,policy,day,day,'99999999-9999-4999-8999-999999997720')->>'replayed'='true','Original queue UUID returns same receipt');
 w:=public.request_project_reporting_refresh(org,project,binding,policy,day,day,'99999999-9999-4999-8999-999999997721');
 perform pg_temp.check_true(w->>'job_id'=v->>'job_id','Different UUID deduplicates same active resource period');
 perform pg_temp.expect_error(format('select public.request_project_reporting_refresh(%L,%L,%L,%L,%L,%L,%L)',org,project,binding,policy,day-1,day,'99999999-9999-4999-8999-999999997720'),'23505','Changed original queue request rejected');
 perform pg_temp.expect_error(format('select public.request_project_reporting_refresh(%L,%L,%L,%L,%L,%L,%L)',org,project,binding,policy,day-1,day,gen_random_uuid()),'55000','Different period cannot overlap unresolved resource');
 perform pg_temp.expect_error(format('select public.request_project_reporting_refresh(%L,%L,%L,%L,%L,%L,%L)',org,project,binding,policy,day-31,day-30,gen_random_uuid()),'22023','Server resource timezone history bound enforced');
 perform pg_temp.expect_error('select * from private.reporting_refresh_jobs','42501','Authenticated direct queue access denied');
 perform pg_temp.expect_error(format('select public.claim_project_reporting_refresh(%L,%L)',v->>'job_id',gen_random_uuid()),'42501','Authenticated cannot claim provider work');
 perform pg_temp.check_true(public.get_project_reporting_refresh_operation(org,project,'99999999-9999-4999-8999-999999997721')->>'job_id'=v->>'job_id','Each deduplicated caller UUID has recoverable receipt');
end $$;
reset role;
savepoint queued_job;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722')->>'dispatch_authorized'='true','First atomic claim authorizes exactly one read');
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722')->>'dispatch_authorized'='false','Same claim replay never redispatches');
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,gen_random_uuid())->>'dispatch_authorized'='false','Competing worker cannot claim running job');
reset role;
savepoint claimed_job;

-- Commit original provider response, cursor and receipt atomically; every branch rolls back.
select set_config('anka.adapterpage',jsonb_build_object('source_contract','local-adapter-only','resource_key','123456','period_start',timezone('UTC',clock_timestamp())::date,'period_end',timezone('UTC',clock_timestamp())::date,'reporting_time_zone','UTC','cursor',null,'next_cursor','page2','complete',false,'retrieved_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'observations',jsonb_build_array(jsonb_build_object('source_observation_id','row-zero','source_record_sha256',repeat('e',64),'metric_key','fixture_clicks','metric_value',0,'value_state','available','dimensions','{}'::jsonb,'data_through',null,'completeness','complete'),jsonb_build_object('source_observation_id','row-unknown','source_record_sha256',repeat('f',64),'metric_key','fixture_clicks','metric_value',null,'value_state','unknown','dimensions','{}'::jsonb,'data_through',null,'completeness','unknown')))::text,true);
set local role service_role;
select pg_temp.expect_error($q$select public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722',current_setting('anka.adapterpage')::jsonb||'{"resource_key":"654321"}')$q$,'22023','Wrong provider resource cannot enter trusted storage');
select pg_temp.expect_error($q$select public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722',jsonb_set(current_setting('anka.adapterpage')::jsonb,'{observations,1,metric_value}','0'))$q$,'22023','Unknown metric cannot be coerced to zero after an earlier row');
reset role;
select pg_temp.check_true((select count(*) from public.project_reporting_observations where binding_id=current_setting('anka.b6binding')::uuid)=0,'Invalid later row rolls back the entire page');
set local role service_role;
do $$declare v jsonb;page jsonb:=current_setting('anka.adapterpage')::jsonb;begin
 page:=jsonb_set(page,'{observations}',(page->'observations')||jsonb_build_array(page#>'{observations,0}'));perform set_config('anka.adapterpage',page::text,true);
 v:=public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722',page);
 perform pg_temp.check_true(v->>'inserted'='2' and v->>'deduplicated'='1' and v->>'state'='queued' and v->>'result_state'='partial','Partial page stores exact zero/unknown and collapses only identical duplicate');
 perform pg_temp.check_true(public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722',page)->>'replayed'='true','Unknown commit acknowledgement safely replays original page');
 perform pg_temp.expect_error(format('select public.commit_project_reporting_refresh_page(%L,%L,%L)',current_setting('anka.refreshjob'),'99999999-9999-4999-8999-999999997722',jsonb_set(page,'{observations,0,metric_value}','2')),'23505','Conflicting page replay never rewrites stored source');
 v:=public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997724');
 perform pg_temp.check_true(v->>'dispatch_authorized'='true' and v->>'cursor'='page2','Next cursor dispatch is a new quota-counted atomic claim');
 page:=page||jsonb_build_object('cursor','page2','next_cursor','page2','retrieved_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'observations','[]'::jsonb);
 perform pg_temp.expect_error(format('select public.commit_project_reporting_refresh_page(%L,%L,%L)',current_setting('anka.refreshjob'),'99999999-9999-4999-8999-999999997724',page),'22023','Repeated cursor cannot create an endless refresh');
 page:=page||'{"next_cursor":null,"complete":true}';
 v:=public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997724',page);
 perform pg_temp.check_true(v->>'state'='succeeded' and v->>'observation_count'='2' and v->>'page_count'='2' and v->>'result_state'='complete','Final empty page completes prior observations without claiming empty whole result');
 perform pg_temp.check_true(public.schedule_project_reporting_refresh('99999999-9999-4999-8999-999999999901',array[current_setting('anka.refreshpolicy')::uuid])#>>'{items,0,reason_code}'='55000','Cadence refuses a new scheduled refresh immediately after success');
 perform pg_temp.check_true(public.get_project_reporting_refresh_claim(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997724')#>>'{original_result,state}'='succeeded','Original claim recovery returns stored completion without dispatch');
end $$;
reset role;
select pg_temp.check_true((select count(*) from public.project_reporting_observations where binding_id=current_setting('anka.b6binding')::uuid and metric_value=0)=1 and (select count(*) from public.project_reporting_observations where binding_id=current_setting('anka.b6binding')::uuid and metric_value is null)=1,'Original zero remains distinct from unknown in native observations');
select pg_temp.check_true((select count(*) from public.project_reporting_sync_events where binding_id=current_setting('anka.b6binding')::uuid and state='succeeded')=1,'Only complete job appends successful sync evidence');
select pg_temp.expect_error('delete from private.reporting_refresh_pages','55000','Page recovery evidence is immutable');
rollback to claimed_job;
set local role service_role;
select public.fail_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722','uncertain');
select pg_temp.check_true(public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722',jsonb_build_object('source_contract','local-adapter-only','resource_key','123456','period_start',timezone('UTC',clock_timestamp())::date,'period_end',timezone('UTC',clock_timestamp())::date,'reporting_time_zone','UTC','cursor',null,'next_cursor',null,'complete',true,'retrieved_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'observations','[]'::jsonb))->>'result_state'='successful_empty','Late original verified empty response resolves uncertain attempt without redispatch');
reset role;
select pg_temp.check_true((select outcome from private.reporting_refresh_results where claim_id='99999999-9999-4999-8999-999999997722')='uncertain' and (select count(*) from private.reporting_refresh_pages)=1,'Late recovery preserves original uncertain audit plus immutable resolution');
rollback to claimed_job;

set local role service_role;
select pg_temp.check_true(public.fail_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722','rate_limited')->>'state'='retry','Known rate limit records bounded retry');
select pg_temp.check_true(public.fail_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722','rate_limited')->>'replayed'='true','Failure replay never multiplies attempts');
select pg_temp.expect_error($q$select public.fail_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722','uncertain')$q$,'23505','Changed worker result rejected');
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,gen_random_uuid())->>'dispatch_authorized'='false','Backoff cannot be bypassed by another worker UUID');
select pg_sleep(1.05);
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997723')->>'dispatch_authorized'='true','Known failed attempt can retry only when due');
select pg_temp.check_true(public.fail_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997723','temporary_failure')->>'state'='retry','Temporary failure preserves backoff history');
select pg_sleep(2.05);
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,gen_random_uuid())->>'reason'='rolling_day_quota_exhausted','Atomic rolling24-hour quota counts actual claims');
reset role;
select pg_temp.check_true((select count(*) from private.reporting_refresh_attempts)=2,'Denied and replayed claims consume no extra provider attempt');
rollback to claimed_job;
set local role service_role;
select pg_temp.check_true(public.fail_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,'99999999-9999-4999-8999-999999997722','uncertain')->>'automatic_retry'='false','Unknown response never automatically retries');
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,gen_random_uuid())->>'state'='uncertain','Unknown original attempt blocks all later dispatch');
reset role;
rollback to claimed_job;
set local role service_role;
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,gen_random_uuid())->>'state'='uncertain','Expired running lease becomes uncertain rather than reissued');
reset role;
rollback to queued_job;
update public.organization_memberships set status='revoked' where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select pg_temp.check_true(public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,gen_random_uuid())->>'state'='denied','Worker rechecks original actor membership before dispatch');
reset role;
update public.organization_memberships set status='active' where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902';
select pg_temp.check_true((select count(*) from private.reporting_refresh_attempts)=0,'Revoked original actor never consumes a dispatch claim');
set local role service_role;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';policy uuid:=current_setting('anka.refreshpolicy')::uuid;v jsonb;w jsonb;begin
 v:=public.schedule_project_reporting_refresh(org,array[policy]);
 perform pg_temp.check_true(v#>>'{items,0,job,state}'='queued' and v->>'provider_request_made'='false','Bounded scheduler queues only configured verified resource');
 w:=public.schedule_project_reporting_refresh(org,array[policy]);
 perform pg_temp.check_true(w#>>'{items,0,job,job_id}'=v#>>'{items,0,job,job_id}' and w#>>'{items,0,job,replayed}'='true','Repeated cadence call deduplicates active job and request receipt');
 perform pg_temp.check_true(jsonb_array_length(public.list_due_project_reporting_refreshes(org,1)->'items')=1,'Worker due list is explicitly organization-scoped and bounded');
 perform pg_temp.expect_error(format('select public.schedule_project_reporting_refresh(%L,%L::uuid[])',org,array[policy,policy]),'22023','Duplicate scheduler input rejected');
 perform pg_temp.expect_error(format('select public.schedule_project_reporting_refresh(%L,%L::uuid[])',org,array[gen_random_uuid()]),'42501','Foreign policy scheduler input rejected');
 perform pg_temp.expect_error(format('select public.list_due_project_reporting_refreshes(%L,26)',org),'22023','Unbounded worker list rejected');
end $$;
reset role;
select pg_temp.check_true((select count(*) from private.reporting_refresh_requests)=3,'Repeated scheduler ticks create no duplicate command records');


-- A fresh challenge is invalidated by current mapping, adapter and administrator changes.
select public.begin_project_reporting_verification('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,current_setting('anka.refreshpolicy')::uuid,'99999999-9999-4999-8999-999999997712');
select set_config('request.jwt.claim.role','service_role',true);
update private.reporting_refresh_adapters set enabled=false;
select pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997712',repeat('a',64),clock_timestamp(),true,true,repeat('b',64))$q$,'42501','Disabled adapter invalidates pending verification');
update private.reporting_refresh_adapters set enabled=true;
update public.organization_memberships set status='revoked' where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902';
select pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997712',repeat('a',64),clock_timestamp(),true,true,repeat('b',64))$q$,'42501','Revoked original administrator invalidates verification');
update public.organization_memberships set status='active' where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902';
delete from public.integration_connection_engagements where connection_id='99999999-9999-4999-8999-999999997610';
select pg_temp.expect_error($q$select public.record_project_reporting_verification('99999999-9999-4999-8999-999999997712',repeat('a',64),clock_timestamp(),true,true,repeat('b',64))$q$,'42501','Removed resource mapping invalidates verification');
-- Disabling configuration remains possible after disconnect, preserving historical identity.
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.check_true(public.configure_project_reporting_refresh('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,1,current_setting('anka.refreshinput')::jsonb||'{"enabled":false}',gen_random_uuid())->>'enabled'='false','Disabled policy can be recorded after mapping removal');
set local role anon;
select pg_temp.expect_error($q$select public.get_project_reporting_refresh_configuration('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid)$q$,'42501','Anonymous configuration read rejected');
reset role;
rollback;
