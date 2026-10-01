begin;
set local lock_timeout='5s';set local statement_timeout='90s';
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.expect_error(query text,code text,label text) returns void language plpgsql as $$begin begin execute query;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;raise exception 'FAIL % expected % got %: %',label,code,sqlstate,sqlerrm;end;raise exception 'FAIL % did not reject',label;end $$;
insert into public.integration_connections(id,organization_id,provider,display_name,status,public_config,created_by) values('99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999901','google_analytics','B6 synthetic local reporting','verified','{"property_id":"123456"}','99999999-9999-4999-8999-999999999902');
insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by) values('99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999975','marketing','99999999-9999-4999-8999-999999999902');
-- No credential fixture: this proves current authorization stays unavailable.
do $$declare input jsonb:='{"binding_id":null,"expected_revision":0,"engagement_id":"99999999-9999-4999-8999-999999999975","department_id":"marketing","connection_id":"99999999-9999-4999-8999-999999997610","resource_kind":"ga4_property","resource_key":"123456","permitted_operations":["reporting_read"],"state":"enabled"}';v jsonb;s jsonb;begin
 v:=public.preview_project_reporting_binding('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',input);
 s:=public.confirm_project_reporting_binding('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',input,v->>'review_sha256','99999999-9999-4999-8999-999999997611');
 perform set_config('anka.b6binding',s->>'binding_id',true);
end $$;
insert into public.project_reporting_observations(id,organization_id,project_id,binding_id,binding_revision_number,context_checksum,source_contract,source_observation_id,source_record_sha256,source_acceptance,metric_key,metric_label,unit,metric_value,value_state,aggregation,dimensions,dimensions_sha256,period_start,period_end,reporting_time_zone,data_through,retrieved_at,last_success_at,fresh_until,completeness)
select ('99999999-9999-4999-8999-'||lpad((997620+n)::text,12,'0'))::uuid,b.organization_id,b.project_id,b.id,1,r.context_checksum,'local-fixture-only','local-'||n,repeat('a',64),'unverified','fixture_clicks','Fixture clicks','count',case when n=2 then null else 0 end,case when n=2 then 'unknown' else 'available' end,'additive','{}',encode(sha256(convert_to('{}'::jsonb::text,'UTF8')),'hex'),'2026-09-01','2026-09-07','UTC','2026-09-07T23:59:59Z','2026-09-08T12:00:00Z',null,case when n=3 then null else '2026-09-09T12:00:00Z'::timestamptz end,case when n=4 then 'partial' else 'complete' end
from public.project_reporting_bindings b join public.project_reporting_binding_revisions r on r.binding_id=b.id cross join generate_series(1,26) n where b.id=current_setting('anka.b6binding')::uuid;
insert into public.project_reporting_sync_events(organization_id,project_id,binding_id,binding_revision_number,context_checksum,state,occurred_at,next_retry_at,source_contract)
select b.organization_id,b.project_id,b.id,1,r.context_checksum,'rate_limited','2026-09-09T12:00:00Z','2026-09-09T13:00:00Z','local-fixture-only' from public.project_reporting_bindings b join public.project_reporting_binding_revisions r on r.binding_id=b.id where b.id=current_setting('anka.b6binding')::uuid;
select pg_temp.check_true((select count(*) from public.project_reporting_observations where binding_id=current_setting('anka.b6binding')::uuid and metric_value=0)=25 and (select count(*) from public.project_reporting_observations where binding_id=current_setting('anka.b6binding')::uuid and metric_value is null)=1,'Original zero and unknown preserved in immutable storage');
select pg_temp.expect_error($q$insert into public.project_reporting_observations select (jsonb_populate_record(null::public.project_reporting_observations,(select to_jsonb(o)||'{"id":"99999999-9999-4999-8999-999999997660","source_observation_id":"bad-dimensions","dimensions_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb from public.project_reporting_observations o where o.binding_id=current_setting('anka.b6binding')::uuid limit 1))).*$q$,'22023','Unverified dimensions checksum denied');
select pg_temp.expect_error($q$insert into public.project_reporting_observations select (jsonb_populate_record(null::public.project_reporting_observations,(select to_jsonb(o)||'{"id":"99999999-9999-4999-8999-999999997661","source_observation_id":"bad-timezone","reporting_time_zone":"invalid/timezone"}'::jsonb from public.project_reporting_observations o where o.binding_id=current_setting('anka.b6binding')::uuid limit 1))).*$q$,'22023','Unrecognized timezone denied at storage boundary');
select pg_temp.expect_error($q$insert into public.project_reporting_observations select (jsonb_populate_record(null::public.project_reporting_observations,(select to_jsonb(o)||'{"id":"99999999-9999-4999-8999-999999997662","source_observation_id":"bad-page","page_revision_id":"99999999-9999-4999-8999-999999997699"}'::jsonb from public.project_reporting_observations o where o.binding_id=current_setting('anka.b6binding')::uuid limit 1))).*$q$,'42501','Unrelated page revision cannot become report attribution');
set local role authenticated;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';project uuid:='99999999-9999-4999-8999-999999999974';binding uuid:=current_setting('anka.b6binding')::uuid;v jsonb;s jsonb;begin
 s:=public.get_project_stored_reporting_status(org,project,binding);
 perform pg_temp.check_true(s->>'current_authorized'='false' and s->>'provider_resource_verified'='false','Missing credentials/resource acceptance never authorize metrics');
 perform pg_temp.check_true(s#>>'{refresh,eligible}'='false' and s#>>'{refresh,queued}'='false' and s#>'{refresh,cadence_seconds}'='null'::jsonb and s#>'{refresh,history_days}'='null'::jsonb,'Cadence/history/manual-refresh configuration remains explicitly unset');
 perform pg_temp.check_true(s#>>'{latest_sync_event,state}'='rate_limited' and s#>>'{latest_sync_event,next_retry_at}' is not null and s->'historical_last_success_at'='null'::jsonb,'Original rate limit evidence retained without inventing successful sync');
 v:=public.list_project_stored_reporting_observations(org,project,binding,'2026-09-01','2026-09-30','',0,25);
 perform pg_temp.check_true(v->>'total'='26' and v->>'matching'='26' and jsonb_array_length(v->'items')=25 and v->>'has_more'='true','Independent whole totals and bounded first page');
 perform pg_temp.check_true(not exists(select 1 from jsonb_array_elements(v->'items') x where x->'metric_value'<>'null'::jsonb or x->>'value_state'<>'withheld' or x->'dimensions'<>'null'::jsonb),'Every value/dimension withheld under current unverified resource');
 perform pg_temp.check_true(v->>'provider_request_made'='false' and v->>'causal_claim'='false' and v->>'attribution_claim'='false','Stored report read makes no provider/causal/attribution claim');
 perform pg_temp.check_true(v#>>'{items,0,period_start}'='2026-09-01' and v#>>'{items,0,reporting_time_zone}'='UTC' and v#>>'{items,0,source_contract}'='local-fixture-only' and v#>>'{items,0,data_through}' is not null,'Exact source period timezone data-through preserved');
 perform pg_temp.check_true(position('ciphertext' in v::text)=0 and position('public_config' in v::text)=0 and position('access_token' in v::text)=0,'No credentials or raw connector config in reporting read');
 v:=public.list_project_stored_reporting_observations(org,project,binding,'2026-09-01','2026-09-30','',25,25);
 perform pg_temp.check_true(jsonb_array_length(v->'items')=1 and v->>'has_more'='false' and v->>'total'='26','Complete smaller second page preserves whole counts');
 v:=public.list_project_stored_reporting_observations(org,project,binding,'2026-09-01','2026-09-30','no-such-metric',0,25);
 perform pg_temp.check_true(v->>'total'='26' and v->>'matching'='0' and v->'items'='[]'::jsonb,'Empty metric filter is distinct from empty entire resource');
 perform pg_temp.expect_error(format('select public.list_project_stored_reporting_observations(%L,%L,%L,null,null)',org,project,binding),'22023','Omitted periods rejected instead of full-history reads');
 perform pg_temp.expect_error(format('select public.list_project_stored_reporting_observations(%L,%L,%L,%L,%L)',org,project,binding,'2025-01-01','2026-01-02'),'22023','Oversized history period denied');
 perform pg_temp.expect_error(format('select public.list_project_stored_reporting_observations(%L,%L,%L,%L,%L,%L,0,51)',org,project,binding,'2026-09-01','2026-09-30',''),'22023','Oversized page denied');
 perform pg_temp.expect_error(format('select public.get_project_stored_reporting_status(%L,%L,%L)',org,'99999999-9999-4999-8999-999999997699',binding),'42501','Cross-project binding denied');
 perform pg_temp.expect_error('select * from public.project_reporting_observations','42501','Authenticated direct stored data denied');
 perform pg_temp.expect_error('insert into public.project_reporting_sync_events default values','42501','Authenticated cannot enqueue or invent sync proof');
end $$;
reset role;
update public.organization_memberships set status='revoked' where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902';
select pg_temp.expect_error(format('select public.get_project_stored_reporting_status(%L,%L,%L)','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')),'42501','Current membership revocation blocks reads');
update public.organization_memberships set status='active' where organization_id='99999999-9999-4999-8999-999999999901' and user_id='99999999-9999-4999-8999-999999999902';
update public.integration_connections set status='disconnected' where id='99999999-9999-4999-8999-999999997610';
select pg_temp.check_true(public.get_project_stored_reporting_status('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')::uuid)->>'current_authorized'='false','Disconnect keeps stored metric access closed');
select pg_temp.expect_error('update public.project_reporting_observations set metric_value=1','55000','Stored observations immutable');
select pg_temp.expect_error('delete from public.project_reporting_sync_events','55000','Sync evidence retained immutably');
set local role anon;
select pg_temp.expect_error(format('select public.get_project_stored_reporting_status(%L,%L,%L)','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974',current_setting('anka.b6binding')),'42501','Anonymous cannot call stored report reads');
reset role;
set local role service_role;
select pg_temp.expect_error('select * from public.project_reporting_observations','42501','Service role lacks blanket stored metric grants');
reset role;
rollback;
