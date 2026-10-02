"""Install exact locally tested candidate in the isolated clone, then retain a distinct named synthetic request audit. Never rerun on its existing fixture."""
import argparse,ast,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(v):return "'"+str(v).replace("'","''")+"'"
assert run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');")=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['httpRequestAccounting'];m=repo/'supabase/migrations'/n['migration'];assert n['nativePassCount']>=55 and n['oneCallCompatibilityPassCount']>=34 and hashlib.sha256(m.read_bytes()).hexdigest()==n['sha256']
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';connection='99999999-9999-4999-8999-999999997510'
assert run('select count(*) from public.integration_connections where id='+lit(connection)+';')=='0','Named HTTP audit already retained; do not blindly rerun'
source=ast.parse((repo/'tools/check-reporting-http-native.py').read_text(encoding='utf8'));constants={}
for node in source.body:
 if isinstance(node,ast.Assign):
  for target in node.targets:
   if isinstance(target,ast.Name) and target.id in ['catalog','table_catalog','tables']:constants[target.id]=ast.literal_eval(node.value)
original={t:set(json.loads(run("select coalesce(jsonb_agg(md5(to_jsonb(t)::text)),'[]'::jsonb) from "+t+' t;'))) for t in constants['tables']}
state="select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id="+lit(org)+" and user_id="+lit(actor)+"),'users',(select count(*) from auth.users));";prior=json.loads(run(state))
if run("select to_regclass('private.reporting_http_costs') is null;")=='t':run(m.read_text(encoding='utf8'))
assert json.loads(run(constants['catalog']))==n['catalog']
assert json.loads(run(constants['table_catalog']))==n['tableCatalog']
fixture=(repo/'supabase/tests/reporting_verification_dispatch.behavior.sql').read_text(encoding='utf8').split("select set_config('anka.claim',")[0]
fixture=fixture.replace('999999997610','999999997510').replace('999999997611','999999997511').replace('local-adapter-only','local-http-accounting-race-only').replace('B6 synthetic local reporting','B6 two-request accounting isolated audit').replace('"lease_seconds":60','"lease_seconds":600').replace('"daily_request_limit":2','"daily_request_limit":100')
run(fixture+"insert into private.reporting_http_costs values('local-http-accounting-race-only',repeat('a',64),2);commit;")
binding=run('select id from public.project_reporting_bindings where connection_id='+lit(connection)+';')
claims="select set_config('request.jwt.claim.sub',"+lit(actor)+",false);select set_config('request.jwt.claim.role','service_role',false);"
procs=[];results=[]
def policy():return run('select id from private.reporting_refresh_policies where binding_id='+lit(binding)+' order by revision_number desc limit 1;')
def challenge():
 q=str(uuid.uuid4());run(claims+'select public.begin_project_reporting_verification('+','.join(map(lit,[org,project,binding,policy(),q]))+');');return q
def claim(q,c):return 'select public.claim_project_reporting_verification('+lit(q)+','+lit(c)+');'
def permit(c,ordinal,p):return 'select public.claim_project_reporting_http_request(\'verification\','+lit(c)+','+str(ordinal)+','+lit(p)+');'
def outcome(p,first=False):return 'select public.record_project_reporting_http_outcome('+lit(p)+",'validated',repeat('b',64),"+("'2099-01-01T00:00:00Z'::timestamptz" if first else 'null')+');'
def complete(q,c,observed):return 'select public.complete_project_reporting_verification('+lit(q)+','+lit(c)+",repeat('a',64),"+lit(observed)+"::timestamptz,true,true,repeat('b',64));"
def prepared():
 q=challenge();c=str(uuid.uuid4());run(claims+claim(q,c));p=str(uuid.uuid4());run(claims+permit(c,1,p)+outcome(p,True));return q,c
def settled():
 q,c=prepared();p=str(uuid.uuid4());run(claims+permit(c,2,p)+outcome(p)+complete(q,c,run('select clock_timestamp();')));return q,c
def client(sql):
 name='anka-http-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',env={**os.environ,'PGAPPNAME':name});procs.append(proc);proc.stdin.write('begin;'+claims+sql+'\n');proc.stdin.flush();return proc,name
def observe(name,blocked=False):
 until=time.monotonic()+8
 while time.monotonic()<until:
  condition='cardinality(pg_blocking_pids(pid))>0' if blocked else "state='idle in transaction'"
  if run('select count(*) from pg_stat_activity where application_name='+lit(name)+' and '+condition+';')=='1':return
  time.sleep(.04)
 raise AssertionError('Expected observed '+('lock wait' if blocked else 'idle transaction'))
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
 x,name=client(sql1);observe(name);y,name2=client(sql2);observe(name2,True);one=finish(x);two=finish(y);assert one[0]==0,one[2];assert check(one,two),(label,one,two)
 results.append({'case':label,'observedLockWait':True});print('PASS',label,flush=True)
def restore():run('update public.organization_memberships set status='+lit(prior['member']['status'])+' where organization_id='+lit(org)+' and user_id='+lit(actor)+';')
def configure(limit,enabled=True):run(claims+"select public.configure_project_reporting_refresh("+lit(org)+','+lit(project)+','+lit(binding)+",p.revision_number,jsonb_build_object('source_contract',p.source_contract,'reporting_time_zone',p.reporting_time_zone,'limits',p.limits||jsonb_build_object('daily_request_limit',"+str(limit)+"),'enabled',"+str(enabled).lower()+",'binding_revision_number',p.binding_revision_number,'context_checksum',p.context_checksum),gen_random_uuid()) from private.reporting_refresh_policies p where p.binding_id="+lit(binding)+' order by p.revision_number desc limit 1;')
once=lambda x,y:y[0]==0 and '"dispatch_authorized": true' in x[1] and '"dispatch_authorized": false' in y[1]
try:
 q=challenge();c=str(uuid.uuid4());race('competing original two-request claims',claim(q,c),claim(q,str(uuid.uuid4())),once)
 p1=str(uuid.uuid4());race('competing first HTTP permits',permit(c,1,p1),permit(c,1,str(uuid.uuid4())),once)
 race('duplicate original first outcome',outcome(p1,True),outcome(p1,True),lambda x,y:y[0]==0 and '"dispatch_authorized": false' in x[1] and '"dispatch_authorized": false' in y[1])
 assert run('select count(*) from private.reporting_http_outcomes where permit_id='+lit(p1)+';')=='1'
 p2=str(uuid.uuid4());race('competing second HTTP permits',permit(c,2,p2),permit(c,2,str(uuid.uuid4())),once);run(claims+outcome(p2));observed=run('select clock_timestamp();')
 race('duplicate original two-request verification completion',complete(q,c,observed),complete(q,c,observed),lambda x,y:y[0]==0 and '"replayed": false' in x[1] and '"replayed": true' in y[1])
 revoke="update public.organization_memberships set status='revoked' where organization_id="+lit(org)+' and user_id='+lit(actor)+';'
 for before in [True,False]:
  q,c=prepared();p2=str(uuid.uuid4());race('revocation '+('before' if before else 'after')+' second HTTP permit',revoke if before else permit(c,2,p2),permit(c,2,p2) if before else revoke,lambda x,y:y[0]!=0 and '42501' in y[2] if before else y[0]==0 and '"dispatch_authorized": true' in x[1]);restore()
 used=int(run('select private.reporting_http_usage('+lit(binding)+',clock_timestamp());'));configure(used+4);settled()
 job=json.loads(run(claims+'select public.request_project_reporting_refresh('+','.join(map(lit,[org,project,binding,policy()]))+",current_date,current_date,gen_random_uuid());").splitlines()[-1])['job_id'];q=challenge();c=str(uuid.uuid4())
 refresh='select public.claim_project_reporting_refresh('+lit(job)+','+lit(str(uuid.uuid4()))+');'
 race('verification versus refresh for last two HTTP units',claim(q,c),refresh,lambda x,y:once(x,y) and 'rolling_day_quota_exhausted' in y[1])
 assert int(run('select private.reporting_http_usage('+lit(binding)+',clock_timestamp());'))==used+4
 configure(used+4,False)
finally:
 for proc in procs:
  if proc.poll() is None:finish(proc,False)
 restore()
assert json.loads(run(state))==prior,'Original authority/users changed'
for t,hashes in original.items():assert hashes.issubset(set(json.loads(run("select coalesce(jsonb_agg(md5(to_jsonb(t)::text)),'[]'::jsonb) from "+t+' t;')))),'Original retained row changed: '+t
assert json.loads(run(constants['catalog']))==n['catalog'] and json.loads(run(constants['table_catalog']))==n['tableCatalog']
n['concurrency']={'count':len(results),'results':results,'fixtureConnectionId':connection,'originalAuditAuthorityUsersPreserved':True,'scope':'Existing isolated clone synthetic metadata only; shared quota remains per binding. No HTTP/providers/new users.'};n['installedLocally']=True;n['installedCatalogMatches']=True;n['status']='55 native checks/34 affected one-call replay and8 observed races;11-function/4-table catalog installed only in isolated clone. Transport integration and registered adapter release still pending.'
e['storedReporting']['httpRequestAccounting']=n;packet.write_text(json.dumps(e,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n');print('PASS',len(results),'observed races; exact installed source/security; original audit/authority/users retained')
