"""Explicitly authorized, isolated-clone-only native QA; no provider/network clients.
Run with Windows Python and local psql path. Canonical synthetic race audit stays immutable.
"""
import argparse, hashlib, json, os, subprocess, time, uuid
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--psql',required=True);parser.add_argument('--repo',required=True);parser.add_argument('--evidence',required=True);args=parser.parse_args()
repo=Path(args.repo);org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902'
cmd=[args.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql,check=True):
 p=subprocess.run(cmd,input=sql,text=True,capture_output=True,timeout=35)
 if check and p.returncode: raise RuntimeError(p.stderr)
 return p
identity=run("select json_build_object('database',current_database(),'host',inet_server_addr(),'port',inet_server_port(),'data',current_setting('data_directory'),'user',current_user);").stdout.strip();identity=json.loads(identity)
assert identity=={'database':'anka_b1_firstsend_20260930','host':'127.0.0.1','port':55462,'data':'G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data','user':'postgres'},identity
before=run("select count(*) from public.design_creative_brief_versions;").stdout.strip()
behavior=run((repo/'supabase/tests/design_video_brief.behavior.sql').read_text())
assert run("select count(*) from public.design_creative_brief_versions;").stdout.strip()==before,'Rollback leaked versions'
print('Behavior PASS',behavior.stderr.count('PASS '),flush=True)
run(f"insert into public.departments(id,name,organization_id) values ('design','Design','{org}') on conflict(id) do nothing;")
v={'purpose':'Native QA '+str(uuid.uuid4()),'audience':'Synthetic local QA','channel':'Website','assets':'None','script_storyboard':'Local test only.','brand_constraints':'Approved palette','required_text':'None','mode':'explore','duration_seconds':5,'aspect_ratio':'16:9','resolution':'720p','output_format':'mp4','generate_audio':False}
def quote(x):return "'"+str(x).replace("'","''")+"'"
def confirm(conv,op,payload=None,root=None,revision=0):
 return f"select public.confirm_design_video_brief('{org}','{actor}','{conv}',null,{quote(root) if root else 'null'},{revision},'{op}',{quote(json.dumps(payload or v))}::jsonb);"
def launch(name,sql,keep=False):
 env=dict(os.environ,PGAPPNAME=name);p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 p.stdin.write("begin;set local lock_timeout='10s';set local statement_timeout='20s';"+sql+'\n');p.stdin.flush()
 if not keep:p.stdin.write('commit;\n');p.stdin.close();p.stdin=None
 return p
def observed(name,condition):
 end=time.monotonic()+8
 while time.monotonic()<end:
  ok=run(f"select exists(select 1 from pg_stat_activity where application_name={quote(name)} and {condition});").stdout.strip()
  if ok=='t':return True
  time.sleep(.05)
 raise RuntimeError('Expected backend state not observed: '+name+' '+condition)
def finish(p):
 if p.stdin:p.stdin.write('commit;\n');p.stdin.close();p.stdin=None
 out,err=p.communicate(timeout=25);return p.returncode,out,err
races=[]
for name in ['same-operation','changed-body','different-first-operation','optimistic-update','freeze-before-confirm','archive-first','archive-after-confirm','membership-first','membership-after-confirm']:
 conv=str(uuid.uuid4());op=str(uuid.uuid4());root=None;revision=0;expected_count=1;expected_error=None;leader=f'video-brief-{name}-leader';follower=f'video-brief-{name}-follower';lp=fp=None
 run(f"insert into public.department_chat_conversations(id,organization_id,owner_id,department_id,context_kind,title) values('{conv}','{org}','{actor}','design','department_private','Video brief race {name}');")
 a=confirm(conv,op);b=a
 if name=='changed-body': b=confirm(conv,op,{**v,'purpose':'Changed exact body'});expected_error='23505'
 if name=='different-first-operation':b=confirm(conv,str(uuid.uuid4()));expected_error='40001'
 if name in ['optimistic-update','freeze-before-confirm']:
  saved=json.loads(run(confirm(conv,str(uuid.uuid4()))).stdout.strip());root=saved['brief']['id'];revision=saved['brief']['revision'];expected_count=2
  a=confirm(conv,op,{**v,'required_text':'v2'},root,revision);b=confirm(conv,str(uuid.uuid4()),{**v,'required_text':'competing v2'},root,revision);expected_error='40001'
  if name=='freeze-before-confirm':
   a=f"select public.freeze_design_creative_brief_version('{org}','{actor}','{root}','{saved['version']['id']}',{revision},'{op}');";expected_count=1
 archive=f"update public.department_chat_conversations set state='archived',archived_at=now() where id='{conv}';"
 revoke=f"update public.organization_memberships set status='revoked' where organization_id='{org}' and user_id='{actor}';"
 if name=='archive-first':a=archive;expected_count=0;expected_error='42501'
 if name=='archive-after-confirm':b=archive
 if name=='membership-first':a=revoke;expected_count=0;expected_error='42501'
 if name=='membership-after-confirm':b=revoke
 try:
  lp=launch(leader,a,True);observed(leader,"state='idle in transaction'")
  fp=launch(follower,b);observed(follower,"wait_event_type='Lock'")
  ac,ao,ae=finish(lp);bc,bo,be=finish(fp)
  assert ac==0,(name,ae)
  if expected_error:assert bc==3 and expected_error in be,(name,bc,be)
  else:assert bc==0,(name,be)
  count=int(run(f"select count(*) from public.design_creative_brief_versions where organization_id='{org}' and content->'video_context'->>'private_conversation_id'='{conv}';").stdout.strip())
  assert count==expected_count,(name,count,expected_count)
  if name=='same-operation':assert json.loads(ao)['version']['id']==json.loads(bo)['version']['id'] and json.loads(bo)['idempotent_replay']
  races.append({'name':name,'observedLockWait':True,'leaderExit':ac,'followerExit':bc,'expectedError':expected_error,'canonicalVersionCount':count})
  print('Race PASS',name,flush=True)
 finally:
  for p in [lp,fp]:
   if p and p.poll() is None:
    if p.stdin:p.stdin.write('rollback;\n');p.stdin.close();p.stdin=None
    p.communicate(timeout=25)
  run(f"update public.organization_memberships set status='active' where organization_id='{org}' and user_id='{actor}';update public.department_chat_conversations set state='active',archived_at=null where id='{conv}';")
catalog=json.loads(run("select json_agg(json_build_object('schema',n.nspname,'name',p.proname,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'definer',p.prosecdef,'configuration',p.proconfig,'acl',p.proacl)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('save_design_creative_brief_version','freeze_design_creative_brief_version','require_private_design_video_context','confirm_design_video_brief','get_design_video_brief','require_design_video_brief_context','valid_design_video_brief','design_video_brief_content');").stdout)
evidence={'databaseIdentity':identity,'freshHumanApproval':{'threadId':'01a05ea2-d766-7b00-bb20-e6370006eecc','turnId':'01a0f440-b750-7352-a7a3-1b6489c6282b','response':'Approve both'},'behaviorPassCount':behavior.stderr.count('PASS '),'rollbackVerified':True,'races':races,'catalog':catalog,'migration':'20261001001000_design_video_confirmed_canonical_brief.sql','migrationSha256':hashlib.sha256((repo/'supabase/migrations/20261001001000_design_video_confirmed_canonical_brief.sql').read_bytes()).hexdigest(),'deployed':False,'providerCalls':0,'fixtureOrigin':'Owned isolated clone, reused synthetic member; immutable synthetic race audit retained. Membership and conversation state restored. No new users or production fixtures.','verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
p=Path(args.evidence);d=json.loads(p.read_text(encoding='utf-8-sig'));d['videoBriefNative']=evidence;p.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('Native brief acceptance PASS',len(races),'observed races',flush=True)
