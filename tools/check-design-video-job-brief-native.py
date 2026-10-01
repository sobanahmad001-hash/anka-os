"""Approved owned-local-clone QA only. Synthetic prices/configuration are never live readiness evidence."""
import argparse,hashlib,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);p.add_argument('--official-only',action='store_true');args=p.parse_args();repo=Path(args.repo)
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902'
cmd=[args.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql,check=True):
 result=subprocess.run(cmd,input=sql,text=True,capture_output=True,timeout=40)
 if check and result.returncode:raise RuntimeError(result.stderr)
 return result
identity=json.loads(run("select json_build_object('database',current_database(),'host',inet_server_addr(),'port',inet_server_port(),'data',current_setting('data_directory'),'user',current_user);").stdout)
assert identity=={'database':'anka_b1_firstsend_20260930','host':'127.0.0.1','port':55462,'data':'G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data','user':'postgres'},identity
before=run('select count(*) from private.design_video_generation_jobs;').stdout
# Expand only the explicitly scoped fixture include; all behavior rows must roll back.
behavior_sql=(repo/'supabase/tests/design_video_job_brief.behavior.sql').read_text().replace('\\ir design_video_job_brief.fixture.sql',(repo/'supabase/tests/design_video_job_brief.fixture.sql').read_text())
behavior=run(behavior_sql);assert run('select count(*) from private.design_video_generation_jobs;').stdout==before,'Rollback leaked canonical jobs'
print('Behavior PASS',behavior.stderr.count('PASS '),flush=True)
fixture=run('begin;'+(repo/'supabase/tests/design_video_job_brief.fixture.sql').read_text()+"select json_build_object('connector',current_setting('qa.video.connector'),'quote',current_setting('qa.video.quote'));commit;")
resources=json.loads(fixture.stdout.strip().splitlines()[-1]);connector=resources['connector'];quote_id=resources['quote']
member=json.loads(run(f"select json_build_object('role',role,'status',status) from public.organization_memberships where organization_id='{org}' and user_id='{actor}';").stdout)
q=lambda value:"'"+str(value).replace("'","''")+"'"
v={'purpose':'Native canonical binding QA','audience':'Synthetic local test only','channel':'Website','assets':'None','script_storyboard':'Product then benefits','brand_constraints':'No unlicensed marks','required_text':'None','mode':'explore','duration_seconds':5,'aspect_ratio':'16:9','resolution':'720p','output_format':'mp4','generate_audio':False}
def confirm(conv,root=None,revision=0):return f"select public.confirm_design_video_brief('{org}','{actor}','{conv}',null,{q(root) if root else 'null'},{revision},'{uuid.uuid4()}',{q(json.dumps(v))}::jsonb);"
def create(conv,version,prompt,operation):return f"select public.create_confirmed_design_video_job('{org}','{actor}','{conv}',null,'{version}','{connector}','{quote_id}','{operation}',{q(prompt)},'explore',5,'720p','16:9','mp4',false);"
def launch(name,sql,keep=False):
 process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,PGAPPNAME=name));process.stdin.write("begin;set local lock_timeout='12s';set local statement_timeout='25s';"+sql+'\n');process.stdin.flush()
 if not keep:process.stdin.write('commit;\n');process.stdin.close();process.stdin=None
 return process
def observe(name,condition):
 end=time.monotonic()+10
 while time.monotonic()<end:
  if run(f"select exists(select 1 from pg_stat_activity where application_name={q(name)} and {condition});").stdout.strip()=='t':return
  time.sleep(.05)
 raise RuntimeError('Expected backend state not observed: '+name)
def finish(process):
 if process.stdin:process.stdin.write('commit;\n');process.stdin.close();process.stdin=None
 out,err=process.communicate(timeout=30);return process.returncode,out,err
prior=json.loads(Path(args.evidence).read_text(encoding='utf-8-sig')).get('videoBriefJobBindingNative') if args.official_only else None
if prior:assert prior['databaseIdentity']==identity and prior['migrationSha256']==hashlib.sha256((repo/'supabase/migrations/20261001005000_design_video_exact_brief_job_binding.sql').read_bytes()).hexdigest(),'Reused native evidence must match exact identity and migration'
races=prior['races'] if prior else []
for name in ['same-operation','changed-prompt','different-operation-unsettled','new-confirmation-first','new-confirmation-after-job','archive-first','archive-after-job','membership-first','membership-after-job','connector-first','connector-after-job']:
 if args.official_only:continue
 conv=str(uuid.uuid4());operation=str(uuid.uuid4());lp=fp=None;expected=None
 run(f"insert into public.department_chat_conversations(id,organization_id,owner_id,department_id,context_kind,title) values('{conv}','{org}','{actor}','design','department_private','Video job brief race {name}');")
 saved=json.loads(run(confirm(conv)).stdout);version=saved['version']['id'];prompt=saved['version']['content']['instructions'];command=create(conv,version,prompt,operation);a=command;b=command
 if name=='changed-prompt':b=create(conv,version,prompt+' changed',operation);expected='23505'
 if name=='different-operation-unsettled':b=create(conv,version,prompt,str(uuid.uuid4()));expected='23514'
 updated=confirm(conv,saved['brief']['id'],saved['brief']['revision'])
 if name=='new-confirmation-first':a=updated;expected='42501'
 if name=='new-confirmation-after-job':b=updated
 archive=f"update public.department_chat_conversations set state='archived',archived_at=clock_timestamp() where id='{conv}';"
 revoked=f"update public.organization_memberships set status='revoked' where organization_id='{org}' and user_id='{actor}';"
 disconnected=f"update public.integration_connections set status='disconnected' where id='{connector}';"
 if name=='archive-first':a=archive;expected='42501'
 if name=='archive-after-job':b=archive
 if name=='membership-first':a=revoked;expected='42501'
 if name=='membership-after-job':b=revoked
 if name=='connector-first':a=disconnected;expected='42501'
 if name=='connector-after-job':b=disconnected
 try:
  leader='video-job-brief-'+name+'-leader';follower='video-job-brief-'+name+'-follower'
  lp=launch(leader,a,True);observe(leader,"state='idle in transaction'");fp=launch(follower,b);observe(follower,"wait_event_type='Lock'")
  ac,ao,ae=finish(lp);bc,bo,be=finish(fp);assert ac==0,(name,ae)
  if expected:assert bc==3 and expected in be,(name,bc,be)
  else:assert bc==0,(name,be)
  count=int(run(f"select count(*) from private.design_video_job_brief_bindings where organization_id='{org}' and operation_key='{operation}';").stdout)
  assert count==(0 if name in ['new-confirmation-first','archive-first','membership-first','connector-first'] else 1),(name,count)
  if name=='same-operation':assert json.loads(ao)['job_id']==json.loads(bo)['job_id'] and json.loads(bo)['idempotent_replay']
  if name=='new-confirmation-after-job':assert run(f"select creative_brief_version_id='{version}'::uuid from private.design_video_job_brief_bindings where operation_key='{operation}';").stdout.strip()=='t'
  races.append({'name':name,'observedLockWait':True,'leaderExit':ac,'followerExit':bc,'expectedError':expected,'bindingCount':count});print('Race PASS',name,flush=True)
 finally:
  for child in [lp,fp]:
   if child and child.poll() is None:
    if child.stdin:child.stdin.write('rollback;\n');child.stdin.close();child.stdin=None
    child.communicate(timeout=30)
  run(f"update public.department_chat_conversations set state='active',archived_at=null where id='{conv}';update public.organization_memberships set role={q(member['role'])},status={q(member['status'])} where organization_id='{org}' and user_id='{actor}';update public.integration_connections set status='verified' where id='{connector}';")
for name in ['official-project-archive-first','official-project-archive-after-job','official-service-pause-first','official-service-pause-after-job']:
 session=str(uuid.uuid4());root=str(uuid.uuid4());direction=str(uuid.uuid4());operation=str(uuid.uuid4());lp=fp=None;expected='42501' if name.endswith('first') else None
 run(f"insert into public.design_workshop_sessions(id,organization_id,engagement_id,brand_id,engagement_service_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,status,created_by) values('{session}','{org}','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999973','99999999-9999-4999-8999-999999998906','video_motion','{{}}','Synthetic native QA','{{}}',repeat('a',64),'ready','{actor}');insert into public.design_directions(id,organization_id,session_id,direction_slot) values('{root}','{org}','{session}',1);insert into public.design_direction_versions(id,organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by) values('{direction}','{org}','{root}',1,'{{}}',repeat('b',64),repeat('c',64),'{actor}');")
 saved=json.loads(run(f"select public.confirm_design_video_brief('{org}','{actor}',null,'{direction}',null,0,'{uuid.uuid4()}',{q(json.dumps(v))}::jsonb);").stdout)
 version=saved['version']['id'];prompt=saved['version']['content']['instructions'];command=f"select public.create_confirmed_design_video_job('{org}','{actor}',null,'{direction}','{version}','{connector}','{quote_id}','{operation}',{q(prompt)},'explore',5,'720p','16:9','mp4',false);"
 change="update public.projects set archived_at=clock_timestamp() where id='99999999-9999-4999-8999-999999999974';" if 'project-archive' in name else "update public.engagement_services set status='on_hold' where id='99999999-9999-4999-8999-999999998906';"
 a=change if expected else command;b=command if expected else change
 try:
  leader=name+'-leader';follower=name+'-follower';lp=launch(leader,a,True);observe(leader,"state='idle in transaction'");fp=launch(follower,b);observe(follower,"wait_event_type='Lock'")
  ac,ao,ae=finish(lp);bc,bo,be=finish(fp);assert ac==0,(name,ae)
  if expected:assert bc==3 and expected in be,(name,bc,be)
  else:assert bc==0,(name,be)
  count=int(run(f"select count(*) from private.design_video_job_brief_bindings where organization_id='{org}' and operation_key='{operation}';").stdout);assert count==(0 if expected else 1),(name,count)
  races.append({'name':name,'observedLockWait':True,'leaderExit':ac,'followerExit':bc,'expectedError':expected,'bindingCount':count});print('Race PASS',name,flush=True)
 finally:
  for child in [lp,fp]:
   if child and child.poll() is None:
    if child.stdin:child.stdin.write('rollback;\n');child.stdin.close();child.stdin=None
    child.communicate(timeout=30)
  run("update public.projects set archived_at=null where id='99999999-9999-4999-8999-999999999974';update public.engagement_services set status='active' where id='99999999-9999-4999-8999-999999998906';")
catalog=json.loads(run("select json_agg(json_build_object('schema',n.nspname,'name',p.proname,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'definer',p.prosecdef,'acl',p.proacl,'configuration',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('create_confirmed_design_video_job','get_design_video_job_brief_binding','guard_design_video_job_brief_binding','create_private_design_video_job','create_design_video_job');").stdout)
evidence={'databaseIdentity':identity,'approvalThread':'01a05ea2-d766-7b00-bb20-e6370006eecc','approvalTurn':'01a0f440-b750-7352-a7a3-1b6489c6282b','behaviorPassCount':behavior.stderr.count('PASS '),'rollbackVerified':True,'races':races,'catalog':catalog,'migration':'20261001005000_design_video_exact_brief_job_binding.sql','migrationSha256':hashlib.sha256((repo/'supabase/migrations/20261001005000_design_video_exact_brief_job_binding.sql').read_bytes()).hexdigest(),'deployed':False,'providerCalls':0,'fixtures':'Synthetic budget, connector with no credential, and immutable illustrative local quote only. These are not real resource/price/provider readiness evidence. Reused existing synthetic member. No users/production fixtures/provider calls. Immutable canonical brief/job/binding race audit retained; new conversations active and original membership/connector restored.','verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
packet=Path(args.evidence);data=json.loads(packet.read_text(encoding='utf-8-sig'));data['videoBriefJobBindingNative']=evidence;packet.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Native video brief binding PASS',len(races),'observed races',flush=True)
