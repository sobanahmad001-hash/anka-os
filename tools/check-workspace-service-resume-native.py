"""Only the owned B1 PostgreSQL clone; no providers or new users."""
import argparse, json, os, subprocess, time, uuid
parser=argparse.ArgumentParser(); parser.add_argument('--psql',required=True); args=parser.parse_args()
base=[args.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-At','-v','ON_ERROR_STOP=1']
org='99999999-9999-4999-8999-999999999901'; actor='99999999-9999-4999-8999-999999999902'; project='99999999-9999-4999-8999-999999999911'
def query(sql):
 r=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=10)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
def spawn(sql,label):
 env=os.environ.copy(); env['PGAPPNAME']=label
 p=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 p.stdin.write(sql); p.stdin.close(); p.stdin=None; return p
def observed(label,condition):
 end=time.monotonic()+5
 while time.monotonic()<end:
  if query(f"select count(*) from pg_stat_activity where application_name='{label}' and {condition}")=='1': return
  time.sleep(.05)
 raise RuntimeError('Required native wait missing: '+label)
original=query(f"select status||'|'||engagement_type from public.projects where id='{project}'").split('|')
results=[]
try:
 for changed in [False,True]:
  service,scope,request=[str(uuid.uuid4()) for _ in range(3)]
  query(f"begin; insert into public.departments(id,name,organization_id) values('content','Local Content fixture','{org}') on conflict(id) do nothing; update public.projects set status='active',engagement_type='internal' where id='{project}'; insert into public.service_catalog(id,organization_id,department_id,slug,name) values('{service}','{org}','content','b2_'||replace('{service}','-',''),'Local resume race'); insert into public.project_service_scopes(id,organization_id,project_id,service_id,status,source,created_by) values('{scope}','{org}','{project}','{service}','on_hold','project_setup','{actor}'); commit;")
  token=query(f"set request.jwt.claim.sub='{actor}';select item->>'impact_token' from jsonb_array_elements(public.get_project_service_scope('{org}','{project}')->'scopes') item where item->>'id'='{scope}'").splitlines()[-1]
  def resume(value): return f"select public.change_project_service_scope(p_organization_id=>'{org}',p_project_id=>'{project}',p_request_id=>'{request}',p_action=>'resume',p_scope_id=>'{scope}',p_expected_revision=>1,p_impact_token=>'{value}',p_impact_acknowledged=>true);"
  label='b2_resume_'+uuid.uuid4().hex[:8]
  leader=spawn(f"begin;set local role authenticated;set local request.jwt.claim.sub='{actor}';{resume(token)} select pg_sleep(1.5);commit;",label+'_leader')
  observed(label+'_leader',"wait_event='PgSleep'")
  follower=spawn(f"begin;set local role authenticated;set local request.jwt.claim.sub='{actor}';{resume('changed' if changed else token)} rollback;",label+'_follower')
  observed(label+'_follower',"wait_event_type='Lock'")
  _,leader_error=leader.communicate(timeout=8); follower_output,follower_error=follower.communicate(timeout=8)
  assert leader.returncode==0,leader_error
  if changed: assert follower.returncode!=0 and 'different inputs' in follower_error,follower_error
  else: assert follower.returncode==0 and '"replayed": true' in follower_output,follower_error
  assert query(f"select count(*) from private.n2_service_scope_events where scope_id='{scope}' and action='resume'")=='1'
  results.append({'case':'changed-impact' if changed else 'same-request','observedLockWait':True,'leaderExit':leader.returncode,'followerExit':follower.returncode,'resumeEvents':1})
finally:
 query(f"update public.projects set status='{original[0]}',engagement_type='{original[1]}' where id='{project}'")
print(json.dumps({'database':'anka_b1_firstsend_20260930','postgres':'17.11','providerCalls':0,'newUsers':0,'races':results}))
