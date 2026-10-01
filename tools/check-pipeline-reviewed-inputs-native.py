"""Approved owned-local-clone QA only. Immutable synthetic audit is retained; no users/providers."""
import argparse,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source-only',action='store_true');p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);args=p.parse_args();repo=Path(args.repo)
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



import re
migration=repo/'supabase/migrations/20261001012000_pipeline_reviewed_ai_inputs.sql'
signature='public.get_pipeline_ai_step_input_context(uuid,uuid,uuid,uuid)'
state="select json_build_object('function',md5(pg_get_functiondef('"+signature+"'::regprocedure)),'acl',(select proacl::text from pg_proc where oid='"+signature+"'::regprocedure),'history',(select json_build_array((select count(*) from public.artifact_versions),(select count(*) from public.project_pipeline_stage_reviews),(select count(*) from public.ai_execution_jobs),(select count(*) from public.ai_execution_input_approvals))));"
prior=json.loads(run(state).stdout)
source=re.sub(r'(?im)^begin;\s*','',migration.read_text(),count=1);source=re.sub(r'(?im)^commit;\s*$','',source)
replay=json.loads(run('begin;drop function '+signature+';'+source+state+'rollback;').stdout.strip().splitlines()[-1]);assert replay==prior,'Full input migration source differs from checked native function/grants/history';assert json.loads(run(state).stdout)==prior,'Input migration rollback changed native history'
packet=Path(args.evidence);evidence=json.loads(packet.read_text(encoding='utf-8'));native=evidence.setdefault('stageFulfilment',{}).setdefault('aiInputs',{}).setdefault('native',{});native['migrationSha256']=hashlib.sha256(migration.read_bytes()).hexdigest();native['atomicSourceReplay']={'fullMigrationMatched':True,'functionDefinitionAndGrantsMatched':True,'allHistoryRestoredByRollback':True};packet.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Exact input migration source replay PASS',flush=True)
if args.source_only:exit()
snapshot="select json_build_array((select count(*) from public.artifact_versions),(select count(*) from public.project_pipeline_stage_reviews),(select count(*) from public.ai_execution_jobs),(select count(*) from public.ai_execution_input_approvals));"
before=run(snapshot).stdout.strip();b=subprocess.run(cmd+['-f',str(repo/'supabase/tests/pipeline_reviewed_ai_inputs.behavior.sql')],text=True,capture_output=True,timeout=45);assert b.returncode==0,b.stderr;assert run(snapshot).stdout.strip()==before,'Read behavior leaked immutable history'
count=b.stderr.count('PASS ');assert count==16,count;print('Reviewed AI input behavior PASS',count,flush=True)
def expand(path):return re.sub(r'\\ir ([^\r\n]+)',lambda m:expand(path.parent/m.group(1).strip()),path.read_text())
source=expand(repo/'supabase/tests/pipeline_reviewed_ai_inputs.behavior.sql')
start=source.index('do $$declare org uuid:');end=source.index(" perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context",start)
setup=source[start:end]+" insert into public.ai_execution_input_approvals(organization_id,job_id,request_id,request_sha256,job_input_sha256,work_sha256,approved_by,approved_scope) values(org,job.id,gen_random_uuid(),repeat('a',64),job.input_sha256,plan->>'work_sha256',actor,'configured_text_ai');end;$$;"
fixtures=expand(repo/'supabase/tests/pipeline_stage_fulfilment.fixture.sql')
ids=run(f"select coalesce(json_agg(id),'[]') from public.ai_execution_jobs where organization_id='{org}';").stdout
run('begin;'+fixtures+setup+'commit;')
new=json.loads(run(f"select json_build_object('job',j.id,'step',s.id) from public.ai_execution_jobs j join public.ai_execution_configured_steps s on s.job_id=j.id and s.step_key='page_copy' where j.organization_id='{org}' and j.id not in (select json_array_elements_text({q(ids)}::json)::uuid);").stdout);job_id=new['job'];step_id=new['step']
context=f"select public.get_pipeline_ai_step_input_context('{org}','{job_id}','{step_id}','{actor}');"
original=json.loads(run(f"select json_build_object('status',(select status from public.organization_memberships where organization_id='{org}' and user_id='{actor}'),'archived_at',(select archived_at from public.projects where id='{project}')); ").stdout)
races=[]
for name in ['membership-first','resolver-before-membership','archive-first','resolver-before-archive']:
 a=context;b=context;expected=None;lp=fp=None
 change=f"update public.organization_memberships set status='suspended' where organization_id='{org}' and user_id='{actor}';" if 'membership' in name else f"update public.projects set archived_at=now() where id='{project}';"
 if name.endswith('-first'):a=change;expected='42501'
 else:b=change
 leader='input-leader-'+str(uuid.uuid4());follower='input-follower-'+str(uuid.uuid4())
 try:
  lp=launch(leader,a,True);wait_state(leader,"state='idle in transaction'");fp=launch(follower,b);wait_state(follower,"wait_event_type='Lock'");lc,lo,le=finish(lp);lp=None;fc,fo,fe=finish(fp);fp=None;assert lc==0,le
  if expected:assert fc!=0 and expected in fe,fe
  else:assert fc==0,fe;assert json.loads(lo)['approved_sources'][0]['reference']['artifact_version_id']=='99999999-9999-4999-8999-999999997111'
  races.append({'name':name,'observedLockWait':True,'leaderExit':lc,'followerExit':fc,'expectedError':expected});print('Reviewed input race PASS',name,flush=True)
 finally:
  for process in [lp,fp]:
   if process and process.poll() is None:process.terminate();process.communicate(timeout=10)
  run(f"update public.organization_memberships set status={q(original['status'])} where organization_id='{org}' and user_id='{actor}';update public.projects set archived_at={'null' if original['archived_at'] is None else q(original['archived_at'])+'::timestamptz'} where id='{project}';")
assert json.loads(run(f"select json_build_object('status',(select status from public.organization_memberships where organization_id='{org}' and user_id='{actor}'),'archived_at',(select archived_at from public.projects where id='{project}'));").stdout)==original
assert run(f"select count(*) from private.ai_execution_step_budget_reservations where job_id='{job_id}';").stdout.strip()=='0'
migration=repo/'supabase/migrations/20261001012000_pipeline_reviewed_ai_inputs.sql';packet=Path(args.evidence);evidence=json.loads(packet.read_text(encoding='utf-8'));evidence.setdefault('stageFulfilment',{}).setdefault('aiInputs',{}).setdefault('native',{}).update({'databaseIdentity':identity,'migration':migration.name,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'behaviorPassCount':count,'rollbackVerified':True,'races':races,'syntheticAuthorityStateRestored':True,'noBudgetReservations':True,'scope':'Current generating step only; full exact canonical source/manual values; no later drafts/private histories; service-only RPC with preserved exact-job preflight/consent and current project authority','limits':['No production/provider calls or users','Synthetic publication/reviewer/acknowledgement prerequisite isolates bytes access; actual distinct-human journeys remain unverified','Immutable synthetic local audit retained; oversized source rejected whole']})
packet.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Reviewed AI inputs native PASS',len(races),flush=True)
