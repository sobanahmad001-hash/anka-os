"""Install exact tested Facebook candidate only in isolated clone; retain a distinct synthetic proof audit."""
import argparse,ast,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(x):return "'"+str(x).replace("'","''")+"'"
assert run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');")=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['facebookAdapters'];m=repo/'supabase/migrations'/n['migration'];entry=n['manifest']['adapter'];assert n['nativePassCount']==28 and n['oneCallCompatibilityPassCount']==16 and hashlib.sha256(m.read_bytes()).hexdigest()==n['sha256']
for name,h in n['manifest']['implementationFiles'].items():assert hashlib.sha256((repo/name).read_text(encoding='utf8').replace('\r\n','\n').encode()).hexdigest()==h,name
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';connection='99999999-9999-4999-8999-999999997410'
assert run('select count(*) from public.integration_connections where id='+lit(connection)+';')=='0','Named proof audit already retained; do not rerun blindly'
constants={}
for node in ast.parse((repo/'tools/check-reporting-facebook-native.py').read_text(encoding='utf8')).body:
 if isinstance(node,ast.Assign):
  for t in node.targets:
   if isinstance(t,ast.Name) and t.id in ['catalog','tables']:constants[t.id]=ast.literal_eval(node.value)
original={t:set(json.loads(run("select coalesce(jsonb_agg(md5(to_jsonb(t)::text)),'[]'::jsonb) from "+t+' t;'))) for t in constants['tables']}
state="select jsonb_build_object('users',(select count(*) from auth.users),'members',(select md5(jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text)::text) from public.organization_memberships m));";prior=run(state)
if run("select to_regprocedure('private.reporting_http_verified(uuid,uuid,timestamptz,text,text,text)') is null;")=='t':run(m.read_text(encoding='utf8'))
assert json.loads(run(constants['catalog']))==n['catalog']
base=(repo/'supabase/tests/reporting_verified_reads.behavior.sql').read_text(encoding='utf8');base=base[:base.index('select pg_temp.check_true(public.get_project_stored_reporting_status')]
base=base.replace('999999997610','999999997410').replace('999999997611','999999997411').replace('B6 synthetic local reporting','B6 Facebook observed-proof isolated audit').replace('google_analytics','meta').replace('ga4_property','meta_facebook_page').replace('"property_id":"123456"','"facebook_page_id":"123456789012347"').replace('"resource_key":"123456"','"resource_key":"123456789012347"').replace('local-adapter-only',entry['sourceContract']).replace('"lease_seconds":1','"lease_seconds":600').replace('"daily_request_limit":2','"daily_request_limit":100')
import re
base=re.sub(r'insert into public.integration_oauth_credentials.*?;',"insert into public.meta_connections(organization_id,integration_connection_id,brand_id,facebook_page_id,access_token_ciphertext,access_token_iv,token_expires_at,connected_by) values("+','.join(map(lit,[org,connection,'99999999-9999-4999-8999-999999999973','123456789012347','local-metadata-only','local-metadata-only']))+",clock_timestamp()+interval '1 day',"+lit(actor)+");",base)
run(base+'commit;')
binding=run('select id from public.project_reporting_bindings where connection_id='+lit(connection)+';');policy=run('select id from private.reporting_refresh_policies where binding_id='+lit(binding)+' order by revision_number desc limit 1;')
claims="select set_config('request.jwt.claim.sub',"+lit(actor)+",false);select set_config('request.jwt.claim.role','service_role',false);"
run('update private.reporting_refresh_adapters set enabled=true where source_contract='+lit(entry['sourceContract'])+';')
procs=[];results=[]
def new():
 q,c,p1,p2=[str(uuid.uuid4()) for _ in range(4)]
 run(claims+'select public.begin_project_reporting_verification('+','.join(map(lit,[org,project,binding,policy,q]))+');select public.claim_project_reporting_verification('+lit(q)+','+lit(c)+');'+permit(c,1,p1));return q,c,p1,p2
def permit(c,ordinal,p):return "select public.claim_project_reporting_http_request('verification',"+lit(c)+','+str(ordinal)+','+lit(p)+');'
def outcome(p,first=False,denied=False):return 'select public.record_project_reporting_http_outcome('+lit(p)+','+lit('denied' if denied else 'validated')+",repeat('b',64),"+("'2099-01-01T00:00:00Z'::timestamptz" if first and not denied else 'null')+');'
def complete(q,c):return 'select public.complete_project_reporting_verification('+lit(q)+','+lit(c)+','+lit(entry['manifestSha256'])+",clock_timestamp(),true,true,repeat('b',64));"
def prepared():
 q,c,p1,p2=new();run(claims+outcome(p1,True)+permit(c,2,p2)+outcome(p2));return q,c
read="select 'AUTH='||(public.get_project_stored_reporting_status("+','.join(map(lit,[org,project,binding]))+")->>'current_authorized');"
def client(sql):
 name='anka-facebook-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',env={**os.environ,'PGAPPNAME':name});procs.append(proc);proc.stdin.write('begin;'+claims+sql+'\n');proc.stdin.flush();return proc,name
def observe(name,blocked=False):
 until=time.monotonic()+8
 while time.monotonic()<until:
  cond='cardinality(pg_blocking_pids(pid))>0' if blocked else "state='idle in transaction'"
  if run('select count(*) from pg_stat_activity where application_name='+lit(name)+' and '+cond+';')=='1':return
  time.sleep(.04)
 raise AssertionError('Expected observed native lock wait/idle transaction')
def finish(proc,commit=True):
 if proc.stdin:
  try:
   if proc.poll() is None:proc.stdin.write(('commit;' if commit else 'rollback;')+'\n'+chr(92)+'q\n');proc.stdin.flush()
  except (BrokenPipeError,OSError):pass
  proc.stdin.close();proc.stdin=None
 out,err=proc.communicate(timeout=15);return proc.returncode,out,err
def race(label,sql1,sql2,expected1=None,expected2=None):
 x,name=client(sql1);observe(name);y,name2=client(sql2);observe(name2,True);one=finish(x);two=finish(y);assert one[0]==two[0]==0,(one,two)
 if expected1:assert expected1 in one[1],one
 if expected2:assert expected2 in two[1],two
 results.append({'case':label,'observedLockWait':True});print('PASS',label,flush=True)
try:
 q,c=prepared();run(claims+complete(q,c));assert 'AUTH=true' in run(claims+read)
 q,c,p1,p2=new();race('known denial before current-resource read',outcome(p1,denied=True),read,expected2='AUTH=false')
 q,c=prepared();race('new exact positive completion before current-resource read',complete(q,c),read,expected2='AUTH=true')
 q,c,p1,p2=new();race('current-resource read before observed denial',read,outcome(p1,denied=True),expected1='AUTH=true');assert 'AUTH=false' in run(claims+read)
finally:
 for proc in procs:
  if proc.poll() is None:finish(proc,False)
 run('update private.reporting_refresh_adapters set enabled=false where source_contract='+lit(entry['sourceContract'])+';')
 run(claims+'select public.configure_project_reporting_refresh('+lit(org)+','+lit(project)+','+lit(binding)+",p.revision_number,jsonb_build_object('source_contract',p.source_contract,'reporting_time_zone',p.reporting_time_zone,'limits',p.limits,'enabled',false,'binding_revision_number',p.binding_revision_number,'context_checksum',p.context_checksum),gen_random_uuid()) from private.reporting_refresh_policies p where p.binding_id="+lit(binding)+' order by p.revision_number desc limit 1;')
assert run(state)==prior,'Original users/authority changed'
for t,hashes in original.items():assert hashes.issubset(set(json.loads(run("select coalesce(jsonb_agg(md5(to_jsonb(t)::text)),'[]'::jsonb) from "+t+' t;')))),'Original retained row changed: '+t
assert json.loads(run(constants['catalog']))==n['catalog']
registry=json.loads(run("select jsonb_build_object('source_contract',a.source_contract,'provider',a.provider,'resource_kind',a.resource_kind,'manifest_sha256',a.manifest_sha256,'metric_definitions',a.metric_definitions,'enabled',a.enabled,'request_budget',c.request_budget) from private.reporting_refresh_adapters a join private.reporting_http_costs c using(source_contract,manifest_sha256) where a.source_contract="+lit(entry['sourceContract'])+';'))
assert registry['enabled'] is False and registry['request_budget']==2 and registry['manifest_sha256']==entry['manifestSha256'] and registry['metric_definitions']==entry['metricDefinitions']
n.update({'concurrency':{'count':len(results),'results':results,'fixtureConnectionId':connection,'originalAuditAuthorityUsersPreserved':True},'installedLocally':True,'installedCatalogMatches':True,'installedRegistry':registry,'status':'28 native/16 affected one-call reader checks and3 observed proof/read races;4 private function catalogs and exact disabled Facebook two-request registry installed only in isolated clone. No live provider calls or activation.'});e['storedReporting']['facebookAdapters']=n;packet.write_text(json.dumps(e,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n');print('PASS',len(results),'observed races; exact installed catalog/disabled registry; original audits/users/authority preserved')
