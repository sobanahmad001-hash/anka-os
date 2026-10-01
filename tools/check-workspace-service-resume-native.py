"""Only the owned B1 PostgreSQL clone; no providers or new users."""
import argparse, json, os, subprocess, time, uuid, sys
parser=argparse.ArgumentParser(); parser.add_argument('--psql',required=True); parser.add_argument('--proposal-details',action='store_true'); parser.add_argument('--pm-revocation',action='store_true'); args=parser.parse_args()
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
if args.pm_revocation:
 original_role=query(f"select role from public.organization_memberships where organization_id='{org}' and user_id='{actor}'")
 assert query(f"select count(*) from public.project_manager_bindings where organization_id='{org}' and project_id='{project}' and user_id='{actor}' and status='active'")=='0', 'Existing active binding must remain untouched'
 results=[]
 try:
  for revoke_first in [True,False]:
   service,request,binding=[str(uuid.uuid4()) for _ in range(3)]
   query(f"begin; update public.organization_memberships set role='contributor' where organization_id='{org}' and user_id='{actor}'; insert into public.departments(id,name,organization_id) values('content','Local Content fixture','{org}') on conflict(id) do nothing; insert into public.service_catalog(id,organization_id,department_id,slug,name) values('{service}','{org}','content','b2_'||replace('{service}','-',''),'Local PM race'); insert into public.project_manager_bindings(id,organization_id,user_id,project_id,source) values('{binding}','{org}','{actor}','{project}','explicit'); commit;")
   details=json.dumps({'unit':'article','recurrence':'monthly','quantity':1})
   proposal=f"set local role authenticated; set local request.jwt.claim.sub='{actor}';select public.propose_workspace_service_scope('{org}','{project}','{request}','{service}','{details}'::jsonb);"
   revoke=f"update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp() where id='{binding}';"
   label='b2_pm_'+uuid.uuid4().hex[:8]
   leader=spawn('begin;'+(revoke if revoke_first else proposal)+'select pg_sleep(1.5);commit;',label+'_leader')
   observed(label+'_leader',"wait_event='PgSleep'")
   follower=spawn('begin;'+(proposal if revoke_first else revoke)+'commit;',label+'_follower')
   observed(label+'_follower',"wait_event_type='Lock'")
   _,leader_error=leader.communicate(timeout=8); _,follower_error=follower.communicate(timeout=8)
   assert leader.returncode==0,leader_error
   if revoke_first: assert follower.returncode!=0 and 'authority changed' in follower_error,follower_error
   else: assert follower.returncode==0,follower_error
   count=query(f"select count(*) from private.workspace_service_proposal_details where request_id='{request}'")
   assert count==('0' if revoke_first else '1')
   results.append({'case':'pm-revocation-first' if revoke_first else 'proposal-first','observedLockWait':True,'leaderExit':leader.returncode,'followerExit':follower.returncode,'proposalCount':int(count)})
 finally:
  query(f"update public.organization_memberships set role='{original_role}' where organization_id='{org}' and user_id='{actor}'")
 print(json.dumps({'database':'anka_b1_firstsend_20260930','postgres':'17.11','providerCalls':0,'newUsers':0,'races':results}))
 sys.exit()
results=[]
try:
 for changed in [False,True]:
  service,scope,request=[str(uuid.uuid4()) for _ in range(3)]
  scope_seed='' if args.proposal_details else f"insert into public.project_service_scopes(id,organization_id,project_id,service_id,status,source,created_by) values('{scope}','{org}','{project}','{service}','on_hold','project_setup','{actor}');"
  query(f"begin; insert into public.departments(id,name,organization_id) values('content','Local Content fixture','{org}') on conflict(id) do nothing; update public.projects set status='active',engagement_type='internal' where id='{project}'; insert into public.service_catalog(id,organization_id,department_id,slug,name) values('{service}','{org}','content','b2_'||replace('{service}','-',''),'Local service race'); {scope_seed} commit;")
  token='article' if args.proposal_details else query(f"set request.jwt.claim.sub='{actor}';select item->>'impact_token' from jsonb_array_elements(public.get_project_service_scope('{org}','{project}')->'scopes') item where item->>'id'='{scope}'").splitlines()[-1]
  def resume(value):
   if args.proposal_details:
    details=json.dumps({'unit':value,'recurrence':'monthly','quantity':1})
    return f"select public.propose_workspace_service_scope('{org}','{project}','{request}','{service}','{details}'::jsonb);"
   return f"select public.change_project_service_scope(p_organization_id=>'{org}',p_project_id=>'{project}',p_request_id=>'{request}',p_action=>'resume',p_scope_id=>'{scope}',p_expected_revision=>1,p_impact_token=>'{value}',p_impact_acknowledged=>true);"
  label='b2_resume_'+uuid.uuid4().hex[:8]
  leader=spawn(f"begin;set local role authenticated;set local request.jwt.claim.sub='{actor}';{resume(token)} select pg_sleep(1.5);commit;",label+'_leader')
  observed(label+'_leader',"wait_event='PgSleep'")
  follower=spawn(f"begin;set local role authenticated;set local request.jwt.claim.sub='{actor}';{resume('changed' if changed else token)} rollback;",label+'_follower')
  observed(label+'_follower',"wait_event_type='Lock'")
  _,leader_error=leader.communicate(timeout=8); follower_output,follower_error=follower.communicate(timeout=8)
  assert leader.returncode==0,leader_error
  if changed: assert follower.returncode!=0 and 'different' in follower_error,follower_error
  else: assert follower.returncode==0 and '"replayed": true' in follower_output,follower_error
  action='add' if args.proposal_details else 'resume'
  assert query(f"select count(*) from private.n2_service_scope_events where request_id='{request}' and action='{action}'")=='1'
  if args.proposal_details: assert query(f"select count(*) from private.workspace_service_proposal_details where request_id='{request}' and payload->>'unit'='article'")=='1'
  results.append({'case':'changed-impact' if changed else 'same-request','observedLockWait':True,'leaderExit':leader.returncode,'followerExit':follower.returncode,'commandEvents':1,'detailsProposal':args.proposal_details})
finally:
 query(f"update public.projects set status='{original[0]}',engagement_type='{original[1]}' where id='{project}'")
print(json.dumps({'database':'anka_b1_firstsend_20260930','postgres':'17.11','providerCalls':0,'newUsers':0,'races':results}))
