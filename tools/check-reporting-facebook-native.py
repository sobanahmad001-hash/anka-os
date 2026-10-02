"""Rollback-only exact Facebook normalized page / access-proof native checks. No HTTP."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError(r.stderr)
 return r
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');").stdout.strip();assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
assert run("select to_regprocedure('private.reporting_http_verified(uuid,uuid,timestamptz,text,text,text)') is null;").stdout.strip()=='t','Candidate already installed: adapt rollback replay instead of reapplying'
m=json.loads((repo/'supabase/functions/_shared/reportingFacebookManifest.json').read_text(encoding='utf8'));entry=m['adapter']
for n,h in m['implementationFiles'].items():assert hashlib.sha256((repo/n).read_text(encoding='utf8').replace('\r\n','\n').encode()).hexdigest()==h,n
migration=repo/'supabase/migrations/20261002134957_reporting_facebook_adapter_proof.sql';source=migration.read_text(encoding='utf8');body=re.sub(r'(?im)^begin;\s*','',source,count=1);body=re.sub(r'(?im)^commit;\s*$','',body)
js="""import {readFileSync} from 'node:fs';import {createFacebookReportingAdapter} from './supabase/functions/_shared/reportingFacebookAdapter.js';
const m=JSON.parse(readFileSync('./supabase/functions/_shared/reportingFacebookManifest.json','utf8')),now=Date.now(),day=new Date(now-86400000).toISOString().slice(0,10),page='123456789012345',id='99999999-9999-4999-8999-999999999901';let calls=0;
const c={organization_id:id,project_id:id,binding_id:id,binding_revision_number:1,context_checksum:'a'.repeat(64),provider:'meta',resource_kind:'meta_facebook_page',resource_key:page};
const adapter=createFacebookReportingAdapter({manifestSha256:m.adapter.manifestSha256,now:()=>now,getCredential:async()=>({token:'synthetic-page-only',facebookPageId:page,expiresAt:new Date(now+3600000).toISOString()}),getVerifierCredential:()=>({appId:'543210',token:'synthetic-debug-only'}),getRequestAudit:()=>({claim:async ordinal=>({ordinal,permitId:crypto.randomUUID()}),record:async()=>{}}),fetcher:async()=>new Response(JSON.stringify(++calls===1?{data:{is_valid:true,app_id:'543210',profile_id:page,user_id:'123987',issued_at:Math.floor(now/1000)-5,expires_at:Math.floor(now/1000)+3600,data_access_expires_at:Math.floor(now/1000)+3600,scopes:['read_insights','pages_read_engagement'],granular_scopes:[{scope:'read_insights'},{scope:'pages_read_engagement'}]}}:{data:[{name:'page_media_view',id:page+'/insights/page_media_view/day',period:'day',values:[{value:0,end_time:day+'T07:00:00+0000'}]}]}))});
console.log(JSON.stringify(await adapter.fetchPage({identity:{...c,source_contract:m.adapter.sourceContract,period_start:day,period_end:day,reporting_time_zone:'UTC'},context:c,limits:{max_observations:25},cursor:null})));"""
page=json.loads(subprocess.check_output(['wsl','-d','Ubuntu-24.04','-u','soban','--cd','/home/soban/code/anka-os-ui-recovery','--','/home/soban/.local/bin/node','--input-type=module','-e',js],text=True,encoding='utf8'))
base=(repo/'supabase/tests/reporting_verified_reads.behavior.sql').read_text(encoding='utf8');base=base[:base.index('select pg_temp.check_true(public.get_project_stored_reporting_status')];base=re.sub(r'(?im)^begin;\s*','',base,count=1)
base=base.replace('B6 synthetic local reporting','B6 Facebook rollback only').replace('google_analytics','meta').replace('ga4_property','meta_facebook_page').replace('"property_id":"123456"','"facebook_page_id":"123456789012345"').replace('"resource_key":"123456"','"resource_key":"123456789012345"').replace('local-adapter-only',entry['sourceContract']).replace('"lease_seconds":1','"lease_seconds":60').replace('"daily_request_limit":2','"daily_request_limit":100')
base=re.sub(r'insert into public.integration_oauth_credentials.*?;',"""insert into public.meta_connections(organization_id,integration_connection_id,brand_id,facebook_page_id,access_token_ciphertext,access_token_iv,token_expires_at,connected_by) values('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999997610','99999999-9999-4999-8999-999999999973','123456789012345','local-metadata-only','local-metadata-only',clock_timestamp()+interval '1 hour','99999999-9999-4999-8999-999999999902');""",base)
def lit(x):return "'"+str(x).replace("'","''")+"'"
org="'99999999-9999-4999-8999-999999999901'";project="'99999999-9999-4999-8999-999999999974'";binding="current_setting('anka.b6binding')::uuid";policy="current_setting('anka.refreshpolicy')::uuid"
status=f'public.get_project_stored_reporting_status({org},{project},{binding})';ready=f'private.reporting_refresh_ready({org},{project},{binding},auth.uid())'
listing=f"public.list_project_stored_reporting_observations({org},{project},{binding},{lit(page['period_start'])}::date,{lit(page['period_end'])}::date)"
checks=[]
def check(expr,label):checks.append('select pg_temp.check_true('+expr+','+lit(label)+');')
def err(query,code,label):checks.append('select pg_temp.expect_error('+lit(query)+','+lit(code)+','+lit(label)+');')
def add(sql):checks.append(sql)
def start():
 add("select set_config('anka.challenge',gen_random_uuid()::text,true);select set_config('anka.claim',gen_random_uuid()::text,true);")
 add(f"select public.begin_project_reporting_verification({org},{project},{binding},{policy},current_setting('anka.challenge')::uuid);")
 add("select set_config('request.jwt.claim.role','service_role',true);select public.claim_project_reporting_verification(current_setting('anka.challenge')::uuid,current_setting('anka.claim')::uuid);")
def permit(kind,ordinal,outcome='validated',valid="clock_timestamp()+interval '1 minute'"):
 add(f"select set_config('anka.permit{ordinal}',gen_random_uuid()::text,true);select public.claim_project_reporting_http_request('{kind}',current_setting('anka.claim')::uuid,{ordinal},current_setting('anka.permit{ordinal}')::uuid);")
 add(f"select public.record_project_reporting_http_outcome(current_setting('anka.permit{ordinal}')::uuid,'{outcome}',repeat('b',64),{valid if ordinal==1 and outcome=='validated' else 'null'});")
def complete():return "select public.complete_project_reporting_verification(current_setting('anka.challenge')::uuid,current_setting('anka.claim')::uuid,"+lit(entry['manifestSha256'])+",clock_timestamp(),true,true,repeat('b',64))"
check(status+"->>'current_authorized'='false'",'Disabled adapter withholds Facebook values')
err(f'select public.begin_project_reporting_verification({org},{project},{binding},{policy},gen_random_uuid())','55000','Disabled reviewed Facebook cannot dispatch')
add('update private.reporting_refresh_adapters set enabled=true where source_contract='+lit(entry['sourceContract'])+';')
add('set local role authenticated;')
err("select private.reporting_http_verified(null,null,null,null,null,null)",'42501','Authenticated cannot manufacture access proof')
add('reset role;set local role service_role;')
err("select private.reporting_http_verified(null,null,null,null,null,null)",'42501','Service cannot directly execute private proof helper')
add('reset role;')
start();permit('verification',1);permit('verification',2);add(complete()+';')
check(status+"->>'current_authorized'='true'",'Both original current HTTP proofs expose exact Meta resource')
check(f'private.reporting_http_usage({binding},clock_timestamp())=2','Facebook verification consumes two HTTP units')
add(f"select set_config('anka.job',(public.request_project_reporting_refresh({org},{project},{binding},{policy},{lit(page['period_start'])}::date,{lit(page['period_end'])}::date,gen_random_uuid())->>'job_id'),true);select set_config('anka.claim',gen_random_uuid()::text,true);")
check("public.claim_project_reporting_refresh(current_setting('anka.job')::uuid,current_setting('anka.claim')::uuid)#>>'{context,provider_http_claim,request_budget}'='2'",'Facebook refresh reserves two original HTTP requests')
add('savepoint refresh_unobserved;');permit('refresh',1,'denied')
check(status+"->>'current_authorized'='false'",'Observed refresh denial withholds before final job failure')
err('select '+ready,'42501','Observed refresh denial blocks next admission')
add('rollback to refresh_unobserved;');permit('refresh',1);permit('refresh',2)
add("select set_config('anka.originalpage',("+lit(json.dumps(page,separators=(',',':')))+"::jsonb||jsonb_build_object('retrieved_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')))::text,true);")
commit="public.commit_project_reporting_refresh_page(current_setting('anka.job')::uuid,current_setting('anka.claim')::uuid,current_setting('anka.originalpage')::jsonb)"
check(commit+"->>'inserted'='2'",'Actual Facebook normalized zero and unavailable metric ingest atomically')
check(commit+"->>'replayed'='true'",'Exact original ingestion recovery does not repeat HTTP or rows')
check(f'private.reporting_http_usage({binding},clock_timestamp())=4','Verification and refresh consume four actual reserved units')
check(f"(select count(*)=1 from public.project_reporting_observations where binding_id={binding} and metric_value=0 and value_state='available')",'Observed zero stays available')
check(f"(select count(*)=1 from public.project_reporting_observations where binding_id={binding} and metric_value is null and value_state='unknown')",'Absent second metric stays unknown')
check(f"(select bool_and(data_through is null and completeness='unknown' and dimensions->'provider_bucket_time_zone'='null'::jsonb and dimensions->'bucket_start'='null'::jsonb) from public.project_reporting_observations where binding_id={binding})",'Unknown provider bucket/freshness retained natively')
check(f"(select dimensions->>'provider_end_time'={lit(page['period_start']+'T07:00:00+0000')} from public.project_reporting_observations where binding_id={binding} and metric_key='page_media_view')",'Original provider boundary retained without timezone inference')
check(f"(select bool_and(aggregation in ('unknown','non_additive')) from public.project_reporting_observations where binding_id={binding})",'No inferred additive or legacy impressions metric')
check("jsonb_array_length("+listing+"->'items')=2 and "+listing+"#>>'{context,current_authorized}'='true'",'Exact native reader exposes current reviewed Facebook observations')
add('savepoint verified;');start();permit('verification',1,'denied')
check(status+"->>'current_authorized'='false'",'Observed debug denial withholds without final verification receipt')
check("not exists(select 1 from jsonb_array_elements("+listing+"->'items') x where x->>'value_state'<>'withheld' or x->'metric_value'<>'null'::jsonb or x->'dimensions'<>'null'::jsonb)",'Known denial withholds both values and dimensions')
err('select '+ready,'42501','Uncompleted observed verification denial prevents refresh')
add('rollback to verified;');start();permit('verification',1,'uncertain')
check(status+"->>'current_authorized'='true'",'Uncertain response never invents observed denial')
add('rollback to verified;');start();permit('verification',1,valid="clock_timestamp()+interval '0.5 second'");permit('verification',2);add('savepoint before_complete;');add(complete()+';')
check(status+"->>'current_authorized'='true'",'New short-lived exact proof initially visible')
add('select pg_sleep(0.55);')
check(status+"->>'current_authorized'='false'",'Observed token expiry withholds despite longer stored credential lifetime')
err('select '+ready,'42501','Expired observed proof cannot authorize refresh')
add('rollback to before_complete;')
err(complete(),'42501','Expired two-request proof cannot create positive completion')
add('rollback to verified;')
check(status+"->>'current_authorized'='true'",'Original verified state restored after isolated rejection probes')
add('update private.reporting_refresh_adapters set enabled=false where source_contract='+lit(entry['sourceContract'])+';')
check(status+"->>'current_authorized'='false'",'Disabled installed Facebook adapter immediately withholds')
tables=['auth.users','public.meta_connections','public.organization_memberships','public.integration_connections','public.integration_connection_engagements','public.integration_oauth_credentials','public.project_reporting_bindings','public.project_reporting_binding_revisions','public.project_reporting_binding_commands','public.project_reporting_observations','public.project_reporting_sync_events','private.reporting_refresh_policies','private.reporting_refresh_adapters','private.reporting_verification_challenges','private.reporting_resource_verifications','private.reporting_verification_attempts','private.reporting_refresh_jobs','private.reporting_refresh_requests','private.reporting_refresh_attempts','private.reporting_refresh_results','private.reporting_refresh_pages','private.reporting_http_costs','private.reporting_http_reservations','private.reporting_http_permits','private.reporting_http_outcomes']
snapshot="select jsonb_build_array("+','.join("(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from "+t+' t)' for t in tables)+");"
catalog="select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'definition',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('reporting_http_verified','stored_reporting_verified','reporting_refresh_ready','reporting_http_completion');"
prior=run(snapshot).stdout;before=run(catalog).stdout
try:
 result=run('begin;'+body+base+'\n'.join(checks)+'rollback;')
 (packet.parent/'b6-facebook-native.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf8',newline='\n');count=result.stderr.count('PASS ');assert count>=28,count
 cat=json.loads(run('begin;'+body+catalog+'rollback;').stdout);assert len(cat)==4 and all(x['definer'] and x['acl']=='{postgres=X/postgres}' and x['config']==['search_path=""'] for x in cat)
finally:
 assert run(snapshot).stdout==prior,'Original audit/users/authority changed';assert run(catalog).stdout==before,'Original functions changed'
e=json.loads(packet.read_text(encoding='utf8'));e['storedReporting']['facebookAdapters']={'migration':migration.name,'sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'databaseIdentity':identity,'nativePassCount':count,'catalog':cat,'manifest':m,'originalAuditAuthorityUsersRestored':True,'installedLocally':False,'status':'Rollback actual normalized Page metrics/native observed-expiry/known-denial guard pass; no provider calls or activation.'};packet.write_text(json.dumps(e,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n');print('Facebook native PASS',count,'four private function/security definitions; original audits/users/authority restored')
