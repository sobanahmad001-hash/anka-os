"""Observed B6 native races in the existing isolated clone; retain local synthetic audit."""
import argparse,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);p.add_argument('--resume-ingestion',action='store_true');a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=45)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(v):return "'"+str(v).replace("'","''")+"'"
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');")
assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['nativeRefreshAuthority'];assert n['behaviorPassCount']>=79 and n['allChangesRolledBack']
source=''
for file_key,hash_key in [('migration','sha256'),('queueMigration','queueSha256'),('ingestionMigration','ingestionSha256'),('cadenceMigration','cadenceSha256')]:
 path=repo/'supabase/migrations'/n[file_key];assert hashlib.sha256(path.read_bytes()).hexdigest()==n[hash_key],'Exact tested candidate only'
 sql=path.read_text(encoding='utf8');sql=re.sub(r'(?im)^begin;\s*','',sql,count=1);sql=re.sub(r'(?im)^commit;\s*$','',sql);source+=sql
exists=run("select to_regclass('private.reporting_refresh_policies') is not null;")
if exists=='f':run('begin;'+source+'commit;')
# Every installed function must match the prior complete rollback catalog, including ACL.
for f in n['catalog']['functions']:
 actual=json.loads(run("select json_build_object('definition',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname||'.'||p.proname="+lit(f['name'])+';'))
 assert actual=={k:f[k] for k in ['definition','acl','definer','config']},f['name']
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';connection='99999999-9999-4999-8999-999999997810'
claim=f"select set_config('request.jwt.claim.sub',{lit(actor)},false);select set_config('request.jwt.claim.role','service_role',false);"
if not a.resume_ingestion:assert run('select count(*) from public.integration_connections where id='+lit(connection)+';')=='0','Never overwrite retained race fixture; inspect prior receipt before a new run'
fixture=(repo/'supabase/tests/reporting_refresh_authority.behavior.sql').read_text(encoding='utf8').split('set local role authenticated;')[0]
fixture=fixture.replace('999999997610','999999997810').replace('999999997611','999999997811').replace('B6 synthetic local reporting','B6 synthetic local reporting races').replace('local-adapter-only','local-race-adapter-only').replace('"lease_seconds":1','"lease_seconds":60').replace('"daily_request_limit":2','"daily_request_limit":10')
fixture+=f"""
select set_config('anka.refreshpolicy',(public.configure_project_reporting_refresh({lit(org)},{lit(project)},current_setting('anka.b6binding')::uuid,0,current_setting('anka.refreshinput')::jsonb,gen_random_uuid())->>'policy_id'),true);
insert into private.reporting_refresh_adapters values('local-race-adapter-only','google_analytics','ga4_property',repeat('a',64),'[{{"metric_key":"fixture_clicks","metric_label":"Fixture clicks","unit":"count","aggregation":"additive"}}]',true);
select set_config('anka.challenge',gen_random_uuid()::text,true);
select public.begin_project_reporting_verification({lit(org)},{lit(project)},current_setting('anka.b6binding')::uuid,current_setting('anka.refreshpolicy')::uuid,current_setting('anka.challenge')::uuid);
select set_config('request.jwt.claim.role','service_role',true);
select public.record_project_reporting_verification(current_setting('anka.challenge')::uuid,repeat('a',64),clock_timestamp(),true,true,repeat('b',64));
select json_build_object('binding',current_setting('anka.b6binding'),'policy',current_setting('anka.refreshpolicy'));
commit;
"""
meta=json.loads(run(f"select json_build_object('binding',b.id,'policy',(select id from private.reporting_refresh_policies where binding_id=b.id order by revision_number desc limit 1)) from public.project_reporting_bindings b where connection_id={lit(connection)};")) if a.resume_ingestion else json.loads(run(fixture).splitlines()[-1]);binding=meta['binding'];policy=meta['policy'];results=[];processes=[]
def client(sql):
 name='anka-b6-'+uuid.uuid4().hex
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',env={**os.environ,'PGAPPNAME':name});processes.append(proc)
 proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
def observe(name,kind):
 until=time.monotonic()+8
 while time.monotonic()<until:
  condition='cardinality(pg_blocking_pids(pid))>0' if kind=='blocked' else "state='idle in transaction'"
  if run('select count(*) from pg_stat_activity where application_name='+lit(name)+' and '+condition+';')=='1':return
  time.sleep(.04)
 raise AssertionError('Expected observed '+kind)
def finish(proc,commit=True):
 if proc.stdin:
  try:
   if proc.poll() is None:proc.stdin.write(('commit;' if commit else 'rollback;')+'\n'+chr(92)+'q\n');proc.stdin.flush()
  except (BrokenPipeError,OSError):pass
  try:proc.stdin.close()
  except (BrokenPipeError,OSError):pass
  proc.stdin=None
 out,err=proc.communicate(timeout=15);return proc.returncode,out,err
def race(first_sql,second_sql,label,expected=None):
 first,name=client(first_sql);observe(name,'idle');second,name2=client(second_sql);observe(name2,'blocked');assert finish(first)[0]==0
 code,out,err=finish(second)
 if expected is None:assert code==0,err
 else:assert code!=0 and expected in err,err
 results.append({'case':label,'observedBlocking':True,'outcome':expected or 'both complete with serialized semantics'});return out
state=f"select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id={lit(org)} and user_id={lit(actor)}),'mapping',(select to_jsonb(m) from public.integration_connection_engagements m where connection_id={lit(connection)}),'users',(select count(*) from auth.users));"
prior=json.loads(run(state));request=str(uuid.uuid4());today="timezone('UTC',clock_timestamp())::date"
def enqueue(req,start=today):return f'select public.request_project_reporting_refresh({lit(org)},{lit(project)},{lit(binding)},{lit(policy)},{start},{today},{lit(req)});'
def restore():
 run(f"update public.organization_memberships set status={lit(prior['member']['status'])} where organization_id={lit(org)} and user_id={lit(actor)};update public.integration_connection_engagements set created_at={lit(prior['mapping']['created_at'])}::timestamptz where connection_id={lit(connection)};")
try:
 if not a.resume_ingestion:
  out=race(enqueue(request),enqueue(request),'same UUID enqueue');assert '"replayed": true' in out
  out=race(enqueue(request),enqueue(request,today+'-1'),'changed original enqueue payload','Original refresh request changed')
  job=json.loads(run(claim+f'select public.get_project_reporting_refresh_operation({lit(org)},{lit(project)},{lit(request)});').splitlines()[-1])['job_id']
  revoke=f"update public.organization_memberships set status='revoked' where organization_id={lit(org)} and user_id={lit(actor)};"
  out=race(revoke,f'select public.claim_project_reporting_refresh({lit(job)},{lit(uuid.uuid4())});','membership revoked before claim');assert '"state": "denied"' in out;restore()
  scheduled=json.loads(run(claim+f'select public.schedule_project_reporting_refresh({lit(org)},array[{lit(policy)}::uuid]);').splitlines()[-1]);job=scheduled['items'][0]['job']['job_id'];claim_id=str(uuid.uuid4())
  out=race(f'select public.claim_project_reporting_refresh({lit(job)},{lit(claim_id)});',f'select public.claim_project_reporting_refresh({lit(job)},{lit(uuid.uuid4())});','competing worker claims');assert '"dispatch_authorized": false' in out
 else:
  # The previous run reached ingestion only after all four observed races passed.
  # Resume that exact retained job; never repeat dispatch or manufacture another fixture.
  active=json.loads(run(f"select json_build_object('id',id,'claim_id',claim_id,'state',state) from private.reporting_refresh_jobs where binding_id={lit(binding)} and state='running';"));job=active['id'];claim_id=active['claim_id']
  assert run(f"select count(*) from private.reporting_refresh_attempts where binding_id={lit(binding)};")=='1'
  assert run(f"select count(*) from private.reporting_refresh_pages p join private.reporting_refresh_attempts a on a.claim_id=p.claim_id where a.binding_id={lit(binding)};")=='0'
  results.extend({'case':label,'observedBlocking':True,'outcome':'passed before initial harness pipe-close error; unchanged result reused'} for label in ['same UUID enqueue','changed original enqueue payload','membership revoked before claim','competing worker claims'])
  revoke=f"update public.organization_memberships set status='revoked' where organization_id={lit(org)} and user_id={lit(actor)};"
 page=json.loads(run(f"select json_build_object('source_contract','local-race-adapter-only','resource_key','123456','period_start',period_start,'period_end',period_end,'reporting_time_zone','UTC','cursor',null,'next_cursor',null,'complete',true,'retrieved_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'observations','[]'::jsonb) from private.reporting_refresh_jobs where id={lit(job)};"))
 commit=f'select public.commit_project_reporting_refresh_page({lit(job)},{lit(claim_id)},{lit(json.dumps(page))}::jsonb);'
 race(revoke,commit,'membership revoked before ingestion','Current exact project refresh authority required');restore()
 change=f"update public.integration_connection_engagements set created_at=created_at+interval '1 second' where connection_id={lit(connection)};"
 race(change,commit,'mapping changed before ingestion','Current exact reporting binding and credentials required');restore()
 out=race(commit,commit,'same original ingestion response');assert '"replayed": true' in out
 counts=json.loads(run(f"select json_build_object('jobs',(select count(*) from private.reporting_refresh_jobs where binding_id={lit(binding)}),'attempts',(select count(*) from private.reporting_refresh_attempts where binding_id={lit(binding)}),'pages',(select count(*) from private.reporting_refresh_pages p join private.reporting_refresh_attempts a on a.claim_id=p.claim_id where a.binding_id={lit(binding)}),'success',(select count(*) from public.project_reporting_sync_events where binding_id={lit(binding)} and state='succeeded'));"));assert counts=={'jobs':2,'attempts':1,'pages':1,'success':1},counts
finally:
 for proc in processes:
  if proc.poll() is None:finish(proc,False)
 restore()
assert json.loads(run(state))==prior,'Authority, mapping or existing users changed'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['nativeRefreshAuthority'];n['concurrency']={'observedRaceCount':len(results),'results':results,'counts':counts,'authorityMappingUsersRestored':True,'localAuditRetained':True,'scope':'Exact existing isolated clone, original one synthetic user and metadata-only source; no provider/human acceptance'};n['concurrency']['harnessRepair']='First four races reused; ingestion races resumed on original claim after expected-error pipe-close handling was fixed. No duplicate dispatch.';n['localCandidateInstalled']=True;n['installedFunctionSecurityMatches']=True;packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'racesPassed':len(results),'counts':counts,'authorityMappingUsersRestored':True}))
