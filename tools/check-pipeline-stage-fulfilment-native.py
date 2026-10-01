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


before=run('select json_build_array((select count(*) from public.project_pipeline_configurations),(select count(*) from public.project_pipeline_stage_reviews),(select count(*) from public.pipeline_run_intents));').stdout.strip()
checks=[]
for filename in ['pipeline_stage_fulfilment.behavior.sql','project_pipeline_groups.behavior.sql']:
 b=subprocess.run(cmd+['-f',str(repo/'supabase/tests'/filename)],text=True,capture_output=True,timeout=45)
 assert b.returncode==0,b.stderr
 assert run('select json_build_array((select count(*) from public.project_pipeline_configurations),(select count(*) from public.project_pipeline_stage_reviews),(select count(*) from public.pipeline_run_intents));').stdout.strip()==before,'Rollback leaked canonical history'
 checks.append({'source':filename,'passCount':b.stderr.count('PASS '),'rollbackVerified':True});print('Native behavior PASS',filename,checks[-1]['passCount'],flush=True)
def fixture_text(path):
 import re
 return re.sub(r'\\ir ([^\r\n]+)',lambda m:fixture_text(path.parent/m.group(1).strip()),path.read_text())
# Resolve only repository-controlled fixture includes; no external inputs.
fixture=fixture_text(repo/'supabase/tests/pipeline_stage_fulfilment.fixture.sql')
assert '\\ir ' not in fixture
run('begin;'+fixture+'commit;')
original=json.loads(run(f"select json_build_object('member',(select json_build_object('role',role,'status',status) from public.organization_memberships where organization_id='{org}' and user_id='{actor}'),'archived_at',(select archived_at from public.projects where id='{project}'),'catalog',(select is_active from public.service_catalog where id='99999999-9999-4999-8999-999999999976'));").stdout)
group=json.loads(run(f"select public.create_project_pipeline_group('{org}','{eng}','99999999-9999-4999-8999-999999997102','website','Native stage race {uuid.uuid4()}','{uuid.uuid4()}');").stdout)['group']['id']
decisions=[{'key':'article_source','action':'reuse','artifact_version_id':'99999999-9999-4999-8999-999999997111'},{'key':'page_copy','action':'run','quantity':1,'inputs':[{'key':'article','artifact_version_id':'99999999-9999-4999-8999-999999997111'}]},{'key':'extra_proof','action':'omit','reason':'Existing approved source supplies evidence'}]
def command(request,changed=False,version=None):
 d=json.loads(json.dumps(decisions))
 if changed:d[2]['reason']='Changed reviewed reason'
 if version:d[0]['artifact_version_id']=version;d[1]['inputs'][0]['artifact_version_id']=version
 return f"select public.create_reviewed_project_pipeline_configuration('{org}','{eng}','99999999-9999-4999-8999-999999997121','{group}','{request}',{q(json.dumps(d))}::jsonb,1000);"
races=[]
for name in ['same-review-request','changed-review-reason','independent-review-requests','membership-first','membership-after','archive-first','archive-after','catalog-first','catalog-after','approval-first']:
 request=str(uuid.uuid4());second=str(uuid.uuid4()) if name=='independent-review-requests' else request;a=command(request);b=command(second);expected=None;lp=fp=None
 if name=='changed-review-reason':b=command(request,True);expected='23505'
 if name=='membership-first':a=f"update public.organization_memberships set status='suspended' where organization_id='{org}' and user_id='{actor}';";expected='42501'
 if name=='membership-after':b=f"update public.organization_memberships set status='suspended' where organization_id='{org}' and user_id='{actor}';"
 if name=='archive-first':a=f"update public.projects set archived_at=now() where id='{project}';";expected='42501'
 if name=='archive-after':b=f"update public.projects set archived_at=now() where id='{project}';"
 if name=='catalog-first':a=f"update public.service_catalog set is_active=false where id='99999999-9999-4999-8999-999999999976';";expected='55000'
 if name=='catalog-after':b=f"update public.service_catalog set is_active=false where id='99999999-9999-4999-8999-999999999976';"
 if name=='approval-first':
  version=str(uuid.uuid4());approval=str(uuid.uuid4())
  run(f"insert into public.artifact_versions(id,organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,change_summary,ai_use_allowed,data_classification,created_by) select '{version}',organization_id,artifact_id,(select max(version_number)+1 from public.artifact_versions where artifact_id=v.artifact_id),id,jsonb_set(content,'{{body}}',to_jsonb('Synthetic concurrency {version}'::text)),encode(sha256(convert_to(jsonb_set(content,'{{body}}',to_jsonb('Synthetic concurrency {version}'::text))::text,'UTF8')),'hex'),'Synthetic race; not human approval acceptance',true,'internal','{actor}' from public.artifact_versions v where id='99999999-9999-4999-8999-999999997111';")
  a=f"insert into public.artifact_approvals(id,organization_id,artifact_id,artifact_version_id,engagement_id,decision,notes,approved_by) values('{approval}','{org}','99999999-9999-4999-8999-999999997110','{version}','{eng}','approved','Synthetic observed-lock prerequisite only','{actor}');";b=command(request,version=version)
 leader='stage-review-leader-'+str(uuid.uuid4());follower='stage-review-follower-'+str(uuid.uuid4())
 try:
  lp=launch(leader,a,True);wait_state(leader,"state='idle in transaction'")
  fp=launch(follower,b);wait_state(follower,"wait_event_type='Lock'")
  lc,lo,le=finish(lp);lp=None;fc,fo,fe=finish(fp);fp=None
  assert lc==0,le
  if expected:assert fc!=0 and expected in fe,fe
  else:assert fc==0,fe
  count=int(run(f"select count(*) from public.project_pipeline_stage_reviews where organization_id='{org}' and request_id in ('{request}','{second}');").stdout)
  wanted=0 if name.endswith('-first') and name!='approval-first' else 2 if name=='independent-review-requests' else 1
  assert count==wanted,(name,count,wanted)
  rows=json.loads(run(f"select coalesce(json_agg(json_build_object('id',r.id,'configuration',r.configuration_id,'group_revision',c.group_revision,'refs',r.resolved_artifacts)),'[]') from public.project_pipeline_stage_reviews r join public.project_pipeline_configurations c on c.id=r.configuration_id where r.organization_id='{org}' and r.request_id in ('{request}','{second}');").stdout)
  if name=='independent-review-requests':assert len({row['group_revision'] for row in rows})==2
  if name=='approval-first':assert all(ref['reference']['artifact_version_id']==version and ref['reference']['approval_id']==approval for ref in rows[0]['refs'])
  races.append({'name':name,'observedLockWait':True,'leaderExit':lc,'followerExit':fc,'expectedError':expected,'reviewCount':count});print('Stage fulfilment race PASS',name,flush=True)
 finally:
  for process in [lp,fp]:
   if process and process.poll() is None:process.terminate();process.communicate(timeout=10)
  run(f"update public.organization_memberships set role={q(original['member']['role'])},status={q(original['member']['status'])} where organization_id='{org}' and user_id='{actor}';update public.projects set archived_at={'null' if original['archived_at'] is None else q(original['archived_at'])+'::timestamptz'} where id='{project}';update public.service_catalog set is_active={'true' if original['catalog'] else 'false'} where id='99999999-9999-4999-8999-999999999976';")
assert json.loads(run(f"select json_build_object('member',(select json_build_object('role',role,'status',status) from public.organization_memberships where organization_id='{org}' and user_id='{actor}'),'archived_at',(select archived_at from public.projects where id='{project}'),'catalog',(select is_active from public.service_catalog where id='99999999-9999-4999-8999-999999999976'));").stdout)==original
packet=Path(args.evidence);evidence=json.loads(packet.read_text(encoding='utf-8'));migration=repo/'supabase/migrations/20261001011000_pipeline_reviewed_stage_fulfilment.sql'
evidence.setdefault('stageFulfilment',{})['native']={'databaseIdentity':identity,'migration':migration.name,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'behavior':checks,'races':races,'syntheticAuthorityStateRestored':True,'limits':['Owned local clone only; no users/provider calls or production mutations','Synthetic published and approved sources are not actual distinct-human publication/approval/consent acceptance','Immutable local race audit is retained; exact original approval/version is pinned']}
packet.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print('Native stage fulfilment PASS',len(races),flush=True)
