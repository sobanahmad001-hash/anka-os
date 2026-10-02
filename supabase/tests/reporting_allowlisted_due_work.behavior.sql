begin;
set local lock_timeout='5s';set local statement_timeout='90s';
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.expect_error(query text,code text,label text) returns void language plpgsql as $$begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;raise exception 'FAIL % expected % got %: %',label,code,sqlstate,sqlerrm;end;raise exception 'FAIL % did not reject',label;end $$;
insert into public.integration_connections(id,organization_id,provider,display_name,status,public_config,created_by) values('99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999901','google_analytics','B6 due allowlist rollback only','verified','{"property_id":"123456"}','99999999-9999-4999-8999-999999999902');
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
 input:=jsonb_build_object('source_contract','local-adapter-only','reporting_time_zone','UTC','limits','{"cadence_seconds":3600,"history_days":30,"stale_after_seconds":7200,"manual_min_interval_seconds":60,"daily_request_limit":2,"backoff_seconds":1,"max_backoff_seconds":2,"max_period_days":7,"max_observations":25,"lease_seconds":60}'::jsonb,'enabled',true,'binding_revision_number',r.revision_number,'context_checksum',r.context_checksum);
 perform set_config('anka.refreshinput',input::text,true);
end $$;

select set_config('anka.refreshpolicy',(public.configure_project_reporting_refresh('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,0,current_setting('anka.refreshinput')::jsonb,gen_random_uuid())->>'policy_id'),true);
select pg_temp.check_true(public.get_project_stored_reporting_status('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid)->>'current_authorized'='false','Policy alone never exposes metric values');
insert into private.reporting_refresh_adapters values('local-adapter-only','google_analytics','ga4_property',repeat('a',64),'[{"metric_key":"fixture_clicks","metric_label":"Fixture clicks","unit":"count","aggregation":"additive"}]',true);
select set_config('anka.challenge',gen_random_uuid()::text,true);
select public.begin_project_reporting_verification('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,current_setting('anka.refreshpolicy')::uuid,current_setting('anka.challenge')::uuid);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('anka.verificationclaim',gen_random_uuid()::text,true);select public.claim_project_reporting_verification(current_setting('anka.challenge')::uuid,current_setting('anka.verificationclaim')::uuid);select public.complete_project_reporting_verification(current_setting('anka.challenge')::uuid,current_setting('anka.verificationclaim')::uuid,repeat('a',64),clock_timestamp(),true,true,repeat('b',64));
select set_config('anka.refreshjob',(public.request_project_reporting_refresh('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid,current_setting('anka.refreshpolicy')::uuid,timezone('UTC',clock_timestamp())::date,timezone('UTC',clock_timestamp())::date,gen_random_uuid())->>'job_id'),true);
select set_config('anka.claim',gen_random_uuid()::text,true);
select public.claim_project_reporting_refresh(current_setting('anka.refreshjob')::uuid,current_setting('anka.claim')::uuid);
select public.commit_project_reporting_refresh_page(current_setting('anka.refreshjob')::uuid,current_setting('anka.claim')::uuid,jsonb_build_object('source_contract','local-adapter-only','resource_key','123456','period_start',timezone('UTC',clock_timestamp())::date,'period_end',timezone('UTC',clock_timestamp())::date,'reporting_time_zone','UTC','cursor',null,'next_cursor',null,'complete',true,'retrieved_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'observations',jsonb_build_array(jsonb_build_object('source_observation_id','read-zero','source_record_sha256',repeat('e',64),'metric_key','fixture_clicks','metric_value',0,'value_state','available','dimensions','{"device":"desktop"}'::jsonb,'data_through',null,'completeness','complete'),jsonb_build_object('source_observation_id','read-unknown','source_record_sha256',repeat('f',64),'metric_key','fixture_clicks','metric_value',null,'value_state','unknown','dimensions','{}'::jsonb,'data_through',null,'completeness','unknown'))));

select set_config('request.jwt.claim.role','authenticated',true);
-- A second synthetic queue identity models older unrelated due work; no claim/provider acceptance.
do $$declare b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();j uuid:=gen_random_uuid();begin
 insert into public.project_reporting_bindings select (jsonb_populate_record(null::public.project_reporting_bindings,to_jsonb(x)||jsonb_build_object('id',b,'resource_key','123457'))).* from public.project_reporting_bindings x where id=current_setting('anka.b6binding')::uuid;
 insert into public.project_reporting_binding_revisions select (jsonb_populate_record(null::public.project_reporting_binding_revisions,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'binding_id',b))).* from public.project_reporting_binding_revisions x where binding_id=current_setting('anka.b6binding')::uuid and revision_number=1;
 insert into private.reporting_refresh_policies select (jsonb_populate_record(null::private.reporting_refresh_policies,to_jsonb(x)||jsonb_build_object('id',p,'binding_id',b,'request_id',gen_random_uuid()))).* from private.reporting_refresh_policies x where id=current_setting('anka.refreshpolicy')::uuid;
 insert into private.reporting_refresh_jobs select (jsonb_populate_record(null::private.reporting_refresh_jobs,to_jsonb(x)||jsonb_build_object('id',j,'binding_id',b,'policy_id',p,'state','queued','next_attempt_at','1900-01-01T00:00:00Z','claim_id',null,'lease_expires_at',null))).* from private.reporting_refresh_jobs x where id=current_setting('anka.refreshjob')::uuid;
 update private.reporting_refresh_jobs set state='queued',next_attempt_at='1901-01-01T00:00:00Z',claim_id=null,lease_expires_at=null where id=current_setting('anka.refreshjob')::uuid;
 perform set_config('anka.unrelatedpolicy',p::text,true);perform set_config('anka.unrelatedjob',j::text,true);
end $$;
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.due() returns jsonb language sql as $$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999901',array[current_setting('anka.refreshpolicy')::uuid],1)$$;
set local role service_role;
select pg_temp.check_true(public.list_due_project_reporting_refreshes('99999999-9999-4999-8999-999999999901',1)#>>'{items,0,job_id}'<>current_setting('anka.refreshjob'),'Old global bound demonstrates unrelated-job starvation');
select pg_temp.check_true(pg_temp.due()#>>'{items,0,job_id}'=current_setting('anka.refreshjob') and jsonb_array_length(pg_temp.due()->'items')=1,'Exact policy filter precedes due bound');
select pg_temp.check_true(pg_temp.due()->>'organization_id'='99999999-9999-4999-8999-999999999901' and pg_temp.due()#>>'{policy_ids,0}'=current_setting('anka.refreshpolicy') and pg_temp.due()->>'dispatch_authorized'='false','Due selection pins exact scope without a dispatch grant');
select pg_temp.expect_error($q$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999901',array[]::uuid[],1)$q$,'22023','Empty policy allowlist rejected');
select pg_temp.expect_error($q$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999901',array[current_setting('anka.refreshpolicy')::uuid,current_setting('anka.refreshpolicy')::uuid],1)$q$,'22023','Duplicate policies rejected');
select pg_temp.expect_error($q$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999901',array[null]::uuid[],1)$q$,'22023','Null policy rejected');
select pg_temp.expect_error($q$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999901',array[gen_random_uuid()],1)$q$,'42501','Foreign or nonexistent policy denied');
select pg_temp.expect_error($q$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999903',array[current_setting('anka.refreshpolicy')::uuid],1)$q$,'42501','Wrong organization denied');
select pg_temp.expect_error($q$select public.list_due_project_reporting_refreshes_for_policies('99999999-9999-4999-8999-999999999901',array[current_setting('anka.refreshpolicy')::uuid],26)$q$,'22023','Due limit remains bounded');
reset role;savepoint due_original;
update private.reporting_refresh_jobs set next_attempt_at=clock_timestamp()+interval '1 day' where id=current_setting('anka.refreshjob')::uuid;
select pg_temp.check_true(jsonb_array_length(pg_temp.due()->'items')=0,'Future selected job does not substitute unrelated work');
rollback to due_original;
update private.reporting_refresh_jobs set state='running',claim_id=gen_random_uuid(),lease_expires_at=clock_timestamp()-interval '1 second' where id=current_setting('anka.refreshjob')::uuid;
select pg_temp.check_true(pg_temp.due()#>>'{items,0,job_id}'=current_setting('anka.refreshjob'),'Expired original lease remains selected for uncertainty handling');
update private.reporting_refresh_jobs set lease_expires_at=clock_timestamp()+interval '1 hour' where id=current_setting('anka.refreshjob')::uuid;
select pg_temp.check_true(jsonb_array_length(pg_temp.due()->'items')=0,'Live original lease is not redispatched');
rollback to due_original;
set local role authenticated;
select pg_temp.expect_error('select pg_temp.due()','42501','Authenticated browser cannot read scheduled due queue');
reset role;set local role anon;
select pg_temp.expect_error('select pg_temp.due()','42501','Anonymous due queue denied');
reset role;
rollback;
