"""Approved owned-local-clone QA only. Immutable synthetic audit is retained; no users/providers."""
import argparse,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);args=p.parse_args();repo=Path(args.repo)
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902';eng='99999999-9999-4999-8999-999999999975';project='99999999-9999-4999-8999-999999999974';preset='99999999-9999-4999-8999-999999997012';definition='99999999-9999-4999-8999-999999997014';mktpreset='99999999-9999-4999-8999-999999997022';mktdefinition='99999999-9999-4999-8999-999999997024'
cmd=[args.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
claim=f"do $$begin perform set_config('request.jwt.claim.sub','{actor}',false);perform set_config('request.jwt.claims','{{\"sub\":\"{actor}\",\"role\":\"authenticated\"}}',false);end;$$;"
def run(sql,check=True):
 r=subprocess.run(cmd,input=claim+sql,text=True,capture_output=True,timeout=40)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
identity=json.loads(run("select json_build_object('database',current_database(),'host',inet_server_addr(),'port',inet_server_port(),'data',current_setting('data_directory'),'user',current_user);").stdout)
assert identity=={'database':'anka_b1_firstsend_20260930','host':'127.0.0.1','port':55462,'data':'G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data','user':'postgres'},identity
q=lambda x:"'"+str(x).replace("'","''")+"'"
def launch(name,sql,keep=False):
 r=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,PGAPPNAME=name));r.stdin.write(claim+"begin;set local lock_timeout='12s';set local statement_timeout='25s';"+sql+'\n');r.stdin.flush()
 if not keep:r.stdin.write('commit;\n');r.stdin.close();r.stdin=None
 return r
def wait_state(name,condition):
 deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  if run(f"select exists(select 1 from pg_stat_activity where application_name={q(name)} and {condition});").stdout.strip()=='t':return
  time.sleep(.05)
 raise RuntimeError('Expected backend state missing: '+name+' '+condition)
def finish(r):
 if r.stdin:r.stdin.write('commit;\n');r.stdin.close();r.stdin=None
 out,err=r.communicate(timeout=30);return r.returncode,out,err

before=run('select count(*) from public.pipeline_execution_definitions;').stdout.strip()
b=subprocess.run(cmd+['-f',str(repo/'supabase/tests/pipeline_stage_contracts.behavior.sql')],text=True,capture_output=True,timeout=40)
assert b.returncode==0,b.stderr;assert run('select count(*) from public.pipeline_execution_definitions;').stdout.strip()==before,'Rollback leaked definition'
count=b.stderr.count('PASS ');print('Stage contract behavior PASS',count,flush=True)
fixture=(repo/'supabase/tests/pipeline_stage_contracts.fixture.sql').read_text().replace(r'\ir project_pipeline_groups.fixture.sql',(repo/'supabase/tests/project_pipeline_groups.fixture.sql').read_text())
run('begin;'+fixture+'commit;')
original_member=json.loads(run(f"select json_build_object('role',role,'status',status) from public.organization_memberships where organization_id='{org}' and user_id='{actor}';").stdout)
service='99999999-9999-4999-8999-999999999976';original_catalog=run(f"select is_active from public.service_catalog where id='{service}' and organization_id='{org}';").stdout.strip()
def command(request,optional=True):
 step={'key':'article','label':'Approved article','kind':'human','department_id':'content','service_id':service,'depends_on':[],'stage_contract':{'optional':optional,'output_label':'Approved launch article','reuse_allowed':True,'artifact_type':'content','output_type':'blog_article','required_inputs':[]}}
 return f"select public.create_pipeline_execution_definition('{org}','99999999-9999-4999-8999-999999997102','{request}','Native stage race',{q(json.dumps([step]))}::jsonb);"
races=[]
for name in ['same-author-request','changed-stage-contract','membership-first','membership-after','catalog-first','catalog-after']:
 request=str(uuid.uuid4());a=command(request);b=a;expected=None;lp=fp=None
 if name=='changed-stage-contract':b=command(request,False);expected='23505'
 if name=='membership-first':a=f"update public.organization_memberships set status='suspended' where organization_id='{org}' and user_id='{actor}';";expected='42501'
 if name=='membership-after':b=f"update public.organization_memberships set status='suspended' where organization_id='{org}' and user_id='{actor}';"
 if name=='catalog-first':a=f"update public.service_catalog set is_active=false where id='{service}' and organization_id='{org}';";expected='42501'
 if name=='catalog-after':b=f"update public.service_catalog set is_active=false where id='{service}' and organization_id='{org}';"
 leader='stage-leader-'+str(uuid.uuid4());follower='stage-follower-'+str(uuid.uuid4())
 try:
  lp=launch(leader,a,True);wait_state(leader,"state='idle in transaction'")
  fp=launch(follower,b);wait_state(follower,"wait_event_type='Lock'")
  lc,lo,le=finish(lp);lp=None;fc,fo,fe=finish(fp);fp=None
  assert lc==0,le
  if expected:assert fc!=0 and expected in fe,fe
  else:assert fc==0,fe
  retained=int(run(f"select count(*) from public.pipeline_execution_definitions where organization_id='{org}' and request_id='{request}';").stdout)
  assert retained==(0 if name.endswith('-first') else 1),(name,retained)
  races.append({'name':name,'observedLockWait':True,'leaderExit':lc,'followerExit':fc,'expectedError':expected,'definitionCount':retained});print('Stage race PASS',name,flush=True)
 finally:
  for process in [lp,fp]:
   if process and process.poll() is None:process.terminate();process.communicate(timeout=10)
  run(f"update public.organization_memberships set role={q(original_member['role'])},status={q(original_member['status'])} where organization_id='{org}' and user_id='{actor}';update public.service_catalog set is_active={'true' if original_catalog=='t' else 'false'} where id='{service}' and organization_id='{org}';")
assert json.loads(run(f"select json_build_object('role',role,'status',status) from public.organization_memberships where organization_id='{org}' and user_id='{actor}';").stdout)==original_member
packet=Path(args.evidence);evidence=json.loads(packet.read_text(encoding='utf-8'));migration=repo/'supabase/migrations/20261001010000_pipeline_published_stage_contracts.sql'
evidence['publishedStageContracts']={'databaseIdentity':identity,'migration':migration.name,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'behaviorPassCount':count,'rollbackVerified':True,'races':races,'syntheticMemberAndCatalogRestored':True,'limits':['Local clone only; no users/provider calls','Synthetic service preset fixture; actual two-human head publication journey remains unverified','This declares support; configuration omission/reuse binding and execution integration remain open']}
packet.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Native stage contracts PASS',len(races),flush=True)
