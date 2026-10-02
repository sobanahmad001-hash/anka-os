"""Observed read/revocation ordering; reuse original retained B6 race binding and user."""
import argparse,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);p.add_argument('--resume-ordering',action='store_true');a=p.parse_args();repo=Path(a.repo);packet=Path(a.evidence)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(v):return "'"+str(v).replace("'","''")+"'"
assert run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');")=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['verifiedReads'];migration=repo/'supabase/migrations'/n['migration'];assert hashlib.sha256(migration.read_bytes()).hexdigest()==n['sha256'] and n['behaviorPassCount']==16
source=migration.read_text(encoding='utf8')
if not a.resume_ordering:run(source)
for f in n['catalog']:
 actual=json.loads(run("select json_build_object('definition',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname||'.'||p.proname="+lit(f['name'])+';'))
 assert actual=={k:f[k] for k in ['definition','acl','definer','config']},f['name']
org='99999999-9999-4999-8999-999999999901';project='99999999-9999-4999-8999-999999999974';actor='99999999-9999-4999-8999-999999999902';connection='99999999-9999-4999-8999-999999997810'
binding=run('select id from public.project_reporting_bindings where connection_id='+lit(connection)+';');assert len(binding)==36
claim=f"select set_config('request.jwt.claim.sub',{lit(actor)},false);select set_config('request.jwt.claim.role','authenticated',false);"
read=f'select public.get_project_stored_reporting_status({lit(org)},{lit(project)},{lit(binding)});'
state=f"select json_build_object('member',(select to_jsonb(m) from public.organization_memberships m where organization_id={lit(org)} and user_id={lit(actor)}),'mapping',(select to_jsonb(m) from public.integration_connection_engagements m where connection_id={lit(connection)}),'users',(select count(*) from auth.users),'observations',(select count(*) from public.project_reporting_observations),'attempts',(select count(*) from private.reporting_refresh_attempts));"
prior=json.loads(run(state));assert json.loads(run(claim+read).splitlines()[-1])['current_authorized'],'Retained exact synthetic resource proof must still be current; do not renew or invent it'
processes=[];results=[]
def client(sql):
 name='anka-b6-read-'+uuid.uuid4().hex;proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',env={**os.environ,'PGAPPNAME':name});processes.append(proc);proc.stdin.write('begin;'+claim+sql+'\n');proc.stdin.flush();return proc,name
def observe(name,blocked=False):
 until=time.monotonic()+8
 while time.monotonic()<until:
  condition='cardinality(pg_blocking_pids(pid))>0' if blocked else "state='idle in transaction'"
  if run('select count(*) from pg_stat_activity where application_name='+lit(name)+' and '+condition+';')=='1':return
  time.sleep(.04)
 raise AssertionError('Expected observed '+('blocked' if blocked else 'idle')+' reader/mutator')
def finish(proc,commit=True):
 if proc.stdin:
  try:
   if proc.poll() is None:proc.stdin.write(('commit;' if commit else 'rollback;')+'\n'+chr(92)+'q\n');proc.stdin.flush()
  except (BrokenPipeError,OSError):pass
  try:proc.stdin.close()
  except (BrokenPipeError,OSError):pass
  proc.stdin=None
 out,err=proc.communicate(timeout=15);return proc.returncode,out,err
def restore():run(f"update public.organization_memberships set status={lit(prior['member']['status'])} where organization_id={lit(org)} and user_id={lit(actor)};update public.integration_connection_engagements set created_at={lit(prior['mapping']['created_at'])}::timestamptz where connection_id={lit(connection)};")
changes=[('membership',f"update public.organization_memberships set status='revoked' where organization_id={lit(org)} and user_id={lit(actor)};"),('resource mapping',f"update public.integration_connection_engagements set created_at=created_at+interval '1 second' where connection_id={lit(connection)};")]
try:
 if not a.resume_ordering:
  first,name=client(read);observe(name);second,name2=client(read);observe(name2);assert finish(first)[0]==0;assert finish(second)[0]==0
 results.append({'case':'parallel verified reads','observed':'both idle in transaction concurrently; no exclusive project lock upgrade','reusedBeforeHarnessMessageFix':a.resume_ordering})
 for label,change in changes:
  for mutation_first in [True,False]:
   first,name=client(change if mutation_first else read);observe(name);second,name2=client(read if mutation_first else change);observe(name2,True);code,out,err=finish(first);assert code==0,err;code2,out2,err2=finish(second)
   if mutation_first and label=='membership':assert code2!=0 and '42501' in err2,err2
   elif mutation_first:assert code2==0 and '"current_authorized": false' in out2,err2
   else:assert code2==0 and '"current_authorized": true' in out,err2
   results.append({'case':label+(' before read' if mutation_first else ' after read'),'observed':'blocked on original authority/resource lock','outcome':'current access denied/withheld' if mutation_first else 'read completed before later invalidation'});restore()
finally:
 for proc in processes:
  if proc.poll() is None:finish(proc,False)
 restore()
assert json.loads(run(state))==prior,'Read races changed original authority/history/users'
e=json.loads(packet.read_text(encoding='utf8'));n=e['storedReporting']['verifiedReads'];n['concurrency']={'count':len(results),'results':results,'authorityMappingHistoryUsersRestored':True,'noNewFixtureOrProviderCalls':True};n['localCandidateInstalled']=True;n['installedFunctionSecurityMatches']=True;packet.write_text(json.dumps(e,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'racesPassed':len(results),'originalStateRestored':True,'reusedOriginalFixture':True}))
