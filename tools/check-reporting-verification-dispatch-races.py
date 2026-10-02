"""Exact isolated QA clone only. Retains new named local dispatch audit; never reuses or overwrites older audit."""
import argparse,ast,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(v):return "'"+str(v).replace("'","''")+"'"
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');")
assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['verificationDispatch'];migration=repo/'supabase/migrations'/n['migration'];assert hashlib.sha256(migration.read_bytes()).hexdigest()==n['sha256'] and n['behaviorPassCount']>=34
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';connection='99999999-9999-4999-8999-999999997910'
assert run('select count(*) from public.integration_connections where id='+lit(connection)+';')=='0','Retained verification audit already exists; never overwrite or blindly rerun'
if run("select to_regclass('private.reporting_verification_attempts') is null;")=='t':run(migration.read_text(encoding='utf8'))
for f in n['catalog']:
 actual=json.loads(run("select json_build_object('definition',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname||'.'||p.proname="+lit(f['name'])+';'))
 assert actual=={k:f[k] for k in ['definition','acl','definer','config']},f['name']
table_sql=next(ast.literal_eval(node.value) for node in ast.parse((repo/'tools/check-reporting-verification-dispatch-native.py').read_text(encoding='utf8')).body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='table_catalog' for t in node.targets))
assert json.loads(run(table_sql))==n['tableCatalog'],'Exact new closed table catalog mismatch'
original_tables=['public.project_reporting_observations','public.project_reporting_sync_events','private.reporting_refresh_jobs','private.reporting_refresh_attempts','private.reporting_refresh_pages','private.reporting_resource_verifications','private.reporting_verification_challenges']
original={t:json.loads(run("select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from "+t+' t;')) for t in original_tables}
state="select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id="+lit(org)+" and user_id="+lit(actor)+"),'users',(select count(*) from auth.users));"
prior=json.loads(run(state))
fixture=(repo/'supabase/tests/reporting_verification_dispatch.behavior.sql').read_text(encoding='utf8').split("select set_config('anka.claim',")[0]
fixture=fixture.replace('999999997610','999999997910').replace('999999997611','999999997911').replace('local-adapter-only','local-verification-race-only').replace('"lease_seconds":60','"lease_seconds":600').replace('"daily_request_limit":2','"daily_request_limit":100')
run(fixture+'commit;')
binding=run('select id from public.project_reporting_bindings where connection_id='+lit(connection)+';')
mapping=run('select created_at from public.integration_connection_engagements where connection_id='+lit(connection)+';')
claims="select set_config('request.jwt.claim.sub',"+lit(actor)+",false);select set_config('request.jwt.claim.role','service_role',false);"
processes=[];results=[]
def challenge():
 policy=run('select id from private.reporting_refresh_policies where binding_id='+lit(binding)+' order by revision_number desc limit 1;');q=str(uuid.uuid4())
 run(claims+'select public.begin_project_reporting_verification('+','.join(map(lit,[org,project,binding,policy,q]))+');');return q

def claim(q,c):return 'select public.claim_project_reporting_verification('+lit(q)+','+lit(c)+');'
def complete(q,c,observed):return 'select public.complete_project_reporting_verification('+lit(q)+','+lit(c)+",repeat('a',64),"+lit(observed)+"::timestamptz,true,true,repeat('b',64));"
def client(sql):
 name='anka-b6-verify-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',env={**os.environ,'PGAPPNAME':name});processes.append(proc);proc.stdin.write('begin;'+claims+sql+'\n');proc.stdin.flush();return proc,name

def observe(name,blocked=False):
 until=time.monotonic()+8
 while time.monotonic()<until:
  condition='cardinality(pg_blocking_pids(pid))>0' if blocked else "state='idle in transaction'"
  if run('select count(*) from pg_stat_activity where application_name='+lit(name)+' and '+condition+';')=='1':return
  time.sleep(.04)
 raise AssertionError('Expected observed '+('blocked' if blocked else 'idle')+' verification transaction')

def finish(proc,commit=True):
 if proc.stdin:
  try:
   if proc.poll() is None:proc.stdin.write(('commit;' if commit else 'rollback;')+'\n'+chr(92)+'q\n');proc.stdin.flush()
  except (BrokenPipeError,OSError):pass
  try:proc.stdin.close()
  except (BrokenPipeError,OSError):pass
  proc.stdin=None
 out,err=proc.communicate(timeout=15);return proc.returncode,out,err

def race(label,sql1,sql2,check):
 first,name=client(sql1);observe(name);second,name2=client(sql2);observe(name2,True);one=finish(first);two=finish(second);assert one[0]==0,one[2];assert check(one,two),(label,one,two)
 results.append({'case':label,'observed':'second transaction blocked on original project/authority/resource lock','outcome':'one committed original dispatch/receipt or current invalidation respected'})

def restore():
 run('update public.organization_memberships set status='+lit(prior['member']['status'])+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';update public.integration_connection_engagements set created_at='+lit(mapping)+'::timestamptz where connection_id='+lit(connection)+';')
try:
 q=challenge();c=str(uuid.uuid4())
 race('competing original claims',claim(q,c),claim(q,str(uuid.uuid4())),lambda x,y:y[0]==0 and '"dispatch_authorized": true' in x[1] and '"dispatch_authorized": false' in y[1])
 observed=run('select clock_timestamp();')
 race('same original completion',complete(q,c,observed),complete(q,c,observed),lambda x,y:y[0]==0 and '"replayed": false' in x[1] and '"replayed": true' in y[1])
 revoke="update public.organization_memberships set status='revoked' where organization_id="+lit(org)+' and user_id='+lit(actor)+';'
 for before in [True,False]:
  q=challenge();c=str(uuid.uuid4())
  race('administrator revocation '+('before' if before else 'after')+' claim',revoke if before else claim(q,c),claim(q,c) if before else revoke,lambda x,y:y[0]!=0 and '42501' in y[2] if before else y[0]==0 and '"dispatch_authorized": true' in x[1]);restore()
 drift="update public.integration_connection_engagements set created_at=created_at+interval '1 second' where connection_id="+lit(connection)+';'
 for before in [True,False]:
  q=challenge();c=str(uuid.uuid4());run(claims+claim(q,c));observed=run('select clock_timestamp();')
  race('resource mapping change '+('before' if before else 'after')+' completion',drift if before else complete(q,c,observed),complete(q,c,observed) if before else drift,lambda x,y:y[0]!=0 and '42501' in y[2] if before else y[0]==0 and '"resource_verified": true' in x[1]);restore()
 # Observed verification-first quota race; opposite order covered by native rollback suite.
 for verify_first in [True]:
  count=int(run('select (select count(*) from private.reporting_verification_attempts where binding_id='+lit(binding)+')+(select count(*) from private.reporting_refresh_attempts where binding_id='+lit(binding)+');'))
  run(claims+"select public.configure_project_reporting_refresh("+lit(org)+','+lit(project)+','+lit(binding)+",p.revision_number,jsonb_build_object('source_contract',p.source_contract,'reporting_time_zone',p.reporting_time_zone,'limits',p.limits||jsonb_build_object('daily_request_limit',"+str(count+2)+"),'enabled',p.enabled,'binding_revision_number',p.binding_revision_number,'context_checksum',p.context_checksum),gen_random_uuid()) from private.reporting_refresh_policies p where p.binding_id="+lit(binding)+' order by p.revision_number desc limit 1;')
  q=challenge();c=str(uuid.uuid4());run(claims+claim(q,c));run(claims+complete(q,c,run('select clock_timestamp();')))
  policy=run('select id from private.reporting_refresh_policies where binding_id='+lit(binding)+' order by revision_number desc limit 1;')
  job=json.loads(run(claims+'select public.request_project_reporting_refresh('+','.join(map(lit,[org,project,binding,policy]))+",current_date,current_date,gen_random_uuid());").splitlines()[-1])['job_id']
  q2=challenge();v=claim(q2,str(uuid.uuid4()));refresh='select public.claim_project_reporting_refresh('+lit(job)+','+lit(str(uuid.uuid4()))+');'
  race('shared last quota slot '+('verification first' if verify_first else 'refresh first'),v if verify_first else refresh,refresh if verify_first else v,lambda x,y:y[0]==0 and '"dispatch_authorized": true' in x[1] and 'rolling_day_quota_exhausted' in y[1] and '"dispatch_authorized": false' in y[1])
  # End only the local synthetic job through the real native known-failure boundary.
  jobclaim=run('select claim_id from private.reporting_refresh_jobs where id='+lit(job)+';')
  if jobclaim:run(claims+'select public.fail_project_reporting_refresh('+lit(job)+','+lit(jobclaim)+",'disconnected',null);")
  else:
   # Its pinned proof is now superseded by the next explicit policy; it will be denied.
   run(claims+"select public.configure_project_reporting_refresh("+lit(org)+','+lit(project)+','+lit(binding)+",p.revision_number,jsonb_build_object('source_contract',p.source_contract,'reporting_time_zone',p.reporting_time_zone,'limits',p.limits,'enabled',false,'binding_revision_number',p.binding_revision_number,'context_checksum',p.context_checksum),gen_random_uuid()) from private.reporting_refresh_policies p where p.binding_id="+lit(binding)+' order by p.revision_number desc limit 1;')
   # Queue is quota-delayed, preserve it; next trial uses a separate period-free setup below.
   if verify_first:break
finally:
 for proc in processes:
  if proc.poll() is None:finish(proc,False)
 restore()
assert json.loads(run(state))==prior,'Original authority or user count changed'
for table,rows in original.items():
 current=json.loads(run("select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from "+table+' t;'))
 assert all(row in current for row in rows),'Original retained audit changed: '+table
n['concurrency']={'count':len(results),'results':results,'originalAuthorityUsersAndAuditPreserved':True,'fixtureConnectionId':connection,'scope':'Named isolated clone synthetic metadata only; no provider calls or new users'};n['installedLocally']=True;n['status']='Native one-use verification dispatch installed only in isolated clone; runtime endpoint/adapters/UI and release pending.'
e['storedReporting']['verificationDispatch']=n;packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf8',newline='\n');print('Verification dispatch races PASS',len(results),'original audit/authority/users preserved')
