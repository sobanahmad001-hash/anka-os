"""Approved owned-local-clone QA only. Immutable synthetic audit is retained; no users/providers."""
import argparse,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);p.add_argument('--resume-pm',action='store_true');args=p.parse_args();repo=Path(args.repo)
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
def group_command(op,name,kind='website',source=preset):return f"select public.create_project_pipeline_group('{org}','{eng}','{source}','{kind}',{q(name)},'{op}');"
def create_group(kind='website'):
 result=json.loads(run(group_command(str(uuid.uuid4()),'Native race '+str(uuid.uuid4()),kind,preset if kind=='website' else mktpreset)).stdout)
 return result['group']['id']
def configure(group,op,kind='website',quantity=1):
 steps=[{'key':'website_brief' if kind=='website' else 'marketing_plan','quantity':quantity}];source=definition if kind=='website' else mktdefinition
 return f"select public.create_project_pipeline_group_configuration('{org}','{eng}','{source}','{group}','{op}',{q(json.dumps(steps))}::jsonb,0);"
def prepare_activation(group,kind='website',quantity=1):
 config=json.loads(run(configure(group,str(uuid.uuid4()),kind,quantity)).stdout)['configuration_id'];impact=json.loads(run(f"select public.preview_project_pipeline_activation('{org}','{config}');").stdout)
 return config,impact['impact_token_sha256']
def activate(config,token,request=None):return f"select public.activate_project_pipeline_configuration('{org}','{config}','{request or uuid.uuid4()}','{token}',true);"
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
# Run retained rollback behavior file with its relative fixture resolved by psql.
before=run('select count(*) from public.project_pipeline_groups;').stdout.strip()
b=subprocess.run(cmd+['-f',str(repo/'supabase/tests/project_pipeline_groups.behavior.sql')],text=True,capture_output=True,timeout=40)
assert b.returncode==0,b.stderr;assert run('select count(*) from public.project_pipeline_groups;').stdout.strip()==before,'Rollback leaked group'
behavior_count=b.stderr.count('PASS ');print('Behavior PASS',behavior_count,flush=True)
run('begin;'+(repo/'supabase/tests/project_pipeline_groups.fixture.sql').read_text()+'commit;')
original_member=json.loads(run(f"select json_build_object('role',role,'status',status) from public.organization_memberships where organization_id='{org}' and user_id='{actor}';").stdout)
binding=None
prior=json.loads(Path(args.evidence).read_text(encoding='utf-8-sig')).get('independentPipelineGroups') if args.resume_pm else None
if prior:
 assert prior['databaseIdentity']==identity and prior['migrationSha256']==hashlib.sha256((repo/'supabase/migrations/20261001004000_project_independent_pipeline_groups.sql').read_bytes()).hexdigest(),'Reused native race evidence must have the identical database and migration'
races=prior['races'] if prior else []
for name in ['same-group-request','changed-group-request','same-configuration-request','concurrent-configuration-revisions','independent-activation','competing-group-activation','same-activation-request','archive-first','archive-after','membership-first','membership-after','pm-binding-first','pm-binding-after']:
 if args.resume_pm and not name.startswith('pm-binding'):continue
 op=str(uuid.uuid4());label='Native '+str(uuid.uuid4());group=None;expected_error=None;lp=fp=None;binding=None
 a=group_command(op,label);b=a
 if name=='changed-group-request':b=group_command(op,label+' changed');expected_error='23505'
 if name in ['same-configuration-request','concurrent-configuration-revisions']:
  group=create_group();a=configure(group,op);b=configure(group,op if name=='same-configuration-request' else str(uuid.uuid4()))
 if name in ['independent-activation','competing-group-activation','same-activation-request']:
  group=create_group();config,token=prepare_activation(group);a=activate(config,token,op)
  if name=='independent-activation':second_group=create_group('marketing');config2,token2=prepare_activation(second_group,'marketing');b=activate(config2,token2)
  elif name=='competing-group-activation':config2,token2=prepare_activation(group,quantity=2);b=activate(config2,token2);expected_error='40001'
  else:b=a
 archive=f"update public.projects set archived_at=clock_timestamp() where id='{project}';"
 revoke=f"update public.organization_memberships set status='revoked' where organization_id='{org}' and user_id='{actor}';"
 unbind='' 
 if name=='archive-first':a=archive;expected_error='42501'
 if name=='archive-after':b=archive
 if name=='membership-first':a=revoke;expected_error='42501'
 if name=='membership-after':b=revoke
 leader='pipeline-group-'+name+'-leader';follower='pipeline-group-'+name+'-follower'
 try:
  if name.startswith('pm-binding'):
   binding=str(uuid.uuid4());run(f"insert into public.project_manager_bindings(id,organization_id,project_id,user_id,status,source,source_details) values('{binding}','{org}','{project}','{actor}','active','explicit','{{\"qa\":\"independent_pipeline_groups\"}}');")
   unbind=f"update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp() where id='{binding}';"
   run(f"update public.organization_memberships set role='project_owner' where organization_id='{org}' and user_id='{actor}';")
   if name=='pm-binding-first':a=unbind;expected_error='42501'
   else:b=unbind
  lp=launch(leader,a,True);wait_state(leader,"state='idle in transaction'");fp=launch(follower,b);wait_state(follower,"wait_event_type='Lock'")
  ac,ao,ae=finish(lp);bc,bo,be=finish(fp);assert ac==0,(name,ae)
  if expected_error:assert bc==3 and expected_error in be,(name,bc,be)
  else:assert bc==0,(name,be)
  if name=='same-group-request':assert json.loads(ao)['group']['id']==json.loads(bo)['group']['id'] and json.loads(bo)['idempotent_replay']
  if name=='same-configuration-request':assert json.loads(ao)['configuration_id']==json.loads(bo)['configuration_id'] and json.loads(bo)['idempotent_replay']
  if name=='concurrent-configuration-revisions':assert [json.loads(ao)['group_revision'],json.loads(bo)['group_revision']]==[1,2]
  if name=='independent-activation':assert json.loads(ao)['group_activation_number']==json.loads(bo)['group_activation_number']==1 and json.loads(ao)['pipeline_group_id']!=json.loads(bo)['pipeline_group_id']
  if name=='same-activation-request':assert json.loads(ao)['activation_id']==json.loads(bo)['activation_id'] and json.loads(bo)['idempotent_replay']
  if name in ['archive-first','membership-first','pm-binding-first']:assert run(f"select count(*) from public.project_pipeline_groups where organization_id='{org}' and request_id='{op}';").stdout.strip()=='0'
  races.append({'name':name,'observedLockWait':True,'leaderExit':ac,'followerExit':bc,'expectedError':expected_error});print('Race PASS',name,flush=True)
 finally:
  for child in [lp,fp]:
   if child and child.poll() is None:
    if child.stdin:child.stdin.write('rollback;\n');child.stdin.close();child.stdin=None
    child.communicate(timeout=30)
  run(f"update public.projects set archived_at=null where id='{project}';update public.organization_memberships set role={q(original_member['role'])},status={q(original_member['status'])} where organization_id='{org}' and user_id='{actor}';")
  if binding:run(f"update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp() where id='{binding}' and status='active';")
catalog=json.loads(run("select json_agg(json_build_object('schema',n.nspname,'name',p.proname,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'definer',p.prosecdef,'acl',p.proacl,'configuration',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('create_project_pipeline_group','create_project_pipeline_group_configuration','start_project_pipeline_group_run','activate_project_pipeline_configuration','n6_project_pipeline_impact','n6_pin_current_project_activation','n6_project_configuration_authorized','preflight_pipeline_ai_job','advance_pipeline_manual_step','n6_require_output_reviewer','get_pipeline_ai_text_routes','build_living_project_snapshot_projection');").stdout)
evidence={'databaseIdentity':identity,'approvalThread':'01a05ea2-d766-7b00-bb20-e6370006eecc','approvalTurn':'01a0f440-b750-7352-a7a3-1b6489c6282b','behaviorPassCount':behavior_count,'rollbackVerified':True,'races':races,'catalog':catalog,'migration':'20261001004000_project_independent_pipeline_groups.sql','migrationSha256':hashlib.sha256((repo/'supabase/migrations/20261001004000_project_independent_pipeline_groups.sql').read_bytes()).hexdigest(),'deployed':False,'providerCalls':0,'fixtures':'Reused synthetic member/project; immutable synthetic published-source/group/config/activation/run audit retained. No actual publisher approval journey claimed. Project/member restored; temporary synthetic PM binding revoked. No users or production fixtures.','verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
p=Path(args.evidence);d=json.loads(p.read_text(encoding='utf-8-sig'));d['independentPipelineGroups']=evidence;p.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Native pipeline groups PASS',len(races),'observed races',flush=True)
