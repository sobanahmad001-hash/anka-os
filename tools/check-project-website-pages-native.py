"""Owned local AD1 verification. No production, users, providers or assignment changes."""
import argparse,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--psql',required=True);p.add_argument('--repo',required=True);p.add_argument('--evidence',required=True);p.add_argument('--source-only',action='store_true');a=p.parse_args();repo=Path(a.repo)
org='99999999-9999-4999-8999-999999999901';actor='99999999-9999-4999-8999-999999999902';project='99999999-9999-4999-8999-999999999974';version='99999999-9999-4999-8999-999999997141'
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
q=lambda v:"'"+str(v).replace("'","''")+"'"
claim=f"do $$begin perform set_config('request.jwt.claim.sub','{actor}',false);perform set_config('request.jwt.claims','{{\"sub\":\"{actor}\",\"role\":\"authenticated\"}}',false);end;$$;"
def run(sql,check=True):
 r=subprocess.run(cmd,input=claim+sql,text=True,capture_output=True,timeout=60,encoding='utf-8')
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
identity=json.loads(run("select json_build_object('database',current_database(),'host',inet_server_addr(),'port',inet_server_port(),'data',current_setting('data_directory'),'user',current_user);").stdout)
assert identity=={'database':'anka_b1_firstsend_20260930','host':'127.0.0.1','port':55462,'data':'G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data','user':'postgres'},identity
migration=repo/'supabase/migrations/20261001013000_project_website_page_identity.sql';text=migration.read_text(encoding='utf-8');names=re.findall(r'create function ((?:private|public)\.[a-z_]+)\(',text);tables=re.findall(r'create table public\.([a-z_]+)\(',text)
condition=' or '.join(f"n.nspname||'.'||p.proname={q(name)}" for name in names);table_names=','.join(q(x) for x in tables)
catalog=f"""select json_build_object('functions',(select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'source',md5(replace(p.prosrc,chr(13),'')),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where {condition}),
'columns',(select json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by table_name,column_name) from information_schema.columns where table_schema='public' and table_name in ({table_names})),
'constraints',(select json_agg(json_build_object('table',t.relname,'definition',pg_get_constraintdef(c.oid)) order by t.relname,pg_get_constraintdef(c.oid)) from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relname in ({table_names})),
'rls',(select json_agg(json_build_object('table',relname,'enabled',relrowsecurity) order by relname) from pg_class where relname in ({table_names})),
'policies',(select json_agg(json_build_object('table',tablename,'roles',roles,'command',cmd,'qual',qual) order by tablename) from pg_policies where schemaname='public' and tablename in ({table_names})),
'indexes',(select json_agg(indexdef order by indexdef) from pg_indexes where schemaname='public' and tablename in ({table_names})),
'grants',(select json_agg(json_build_object('table',table_name,'grantee',grantee,'privilege',privilege_type) order by table_name,grantee,privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name in ({table_names})));"""
history='select json_build_array('+','.join('(select count(*) from public.'+x+')' for x in tables+['artifact_versions','artifact_approvals','work_items','tracked_pages'])+');'
prior=json.loads(run(catalog).stdout);original_history=run(history).stdout
signatures=json.loads(run(f"select json_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where {condition};").stdout)
body=re.sub(r'(?im)^begin;\s*','',text,count=1);body=re.sub(r'(?im)^commit;\s*$','',body)
remove=''.join('drop function '+signature+';' for signature in signatures)+''.join('drop table public.'+x+' cascade;' for x in reversed(tables))
replay=json.loads(run('begin;'+remove+body+catalog+'rollback;').stdout.strip().splitlines()[-1]);assert replay==prior,'Complete Website migration differs from native catalog';assert json.loads(run(catalog).stdout)==prior and run(history).stdout==original_history,'Migration replay changed native history'
print('AD1 complete migration source/catalog/grants replay PASS; rollback restored history',flush=True)
packet=Path(a.evidence);evidence=json.loads(packet.read_text(encoding='utf-8'));native=evidence.setdefault('pageIdentity',{}).setdefault('native',{});native.update({'databaseIdentity':identity,'migration':migration.name,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'atomicCompleteMigrationReplay':True,'sourceCatalogMatched':True,'historyRestoredAfterReplay':True,'functions':len(names),'additiveTables':len(tables),'noProviderOrProductionCalls':True})
if a.source_only:packet.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8');raise SystemExit
def expand(path):return re.sub(r'\\ir ([^\r\n]+)',lambda m:expand(path.parent/m.group(1).strip()),path.read_text(encoding='utf-8'))
behavior_source=expand(repo/'supabase/tests/project_website_pages.behavior.sql').replace('begin;','begin;truncate '+','.join('public.'+x for x in tables)+';',1)
behavior=run(behavior_source);count=behavior.stderr.count('PASS ');assert count==49,count;assert run(history).stdout==original_history,'Rollback behavior leaked history';print('AD1 rollback behavior PASS',count,flush=True)
def launch(name,sql,keep=False):
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env=dict(os.environ,PGAPPNAME=name));proc.stdin.write(claim+"begin;set local lock_timeout='12s';set local statement_timeout='25s';"+sql+'\n');proc.stdin.flush()
 if not keep:proc.stdin.write('commit;\n');proc.stdin.close();proc.stdin=None
 return proc
def wait(name,condition):
 deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  if run(f"select exists(select 1 from pg_stat_activity where application_name={q(name)} and {condition});").stdout.strip()=='t':return
  time.sleep(.05)
 raise RuntimeError('Expected native wait missing '+name)
def finish(proc):
 if proc.stdin:proc.stdin.write('commit;\n');proc.stdin.close();proc.stdin=None
 out,err=proc.communicate(timeout=30);return proc.returncode,out,err
fixture=(repo/'supabase/tests/project_website_pages.fixture.sql').read_text();run('begin;'+fixture+'commit;')
keys='["page:1"]';review=json.loads(run(f"select public.preview_project_website_pages('{org}','{project}','{version}',{q(keys)});").stdout)['review_sha256'];request=str(uuid.uuid4())
def register(request_id,keys=keys,sha=review):return f"select public.register_project_website_pages('{org}','{project}','{version}',{q(keys)},{q(sha)},'{request_id}');"
original=json.loads(run(f"select json_build_object('member',(select status from public.organization_memberships where organization_id='{org}' and user_id='{actor}'),'archive',(select archived_at from public.projects where id='{project}'),'engagement',(select status from public.engagements where id='99999999-9999-4999-8999-999999999975'));").stdout)
races=[]
def race(name,leader_sql,follower_sql,error=None):
 leader='page-leader-'+str(uuid.uuid4());follower='page-follower-'+str(uuid.uuid4());lp=fp=None
 try:
  lp=launch(leader,leader_sql,True);wait(leader,"state='idle in transaction'");fp=launch(follower,follower_sql);wait(follower,"wait_event_type='Lock'");lc,lo,le=finish(lp);lp=None;fc,fo,fe=finish(fp);fp=None;assert lc==0,le
  if error:assert fc!=0 and error in fe,fe
  else:assert fc==0,fe
  races.append({'name':name,'observedLockWait':True,'leaderExit':lc,'followerExit':fc,'expectedError':error});print('AD1 race PASS',name,flush=True)
 finally:
  for proc in [lp,fp]:
   if proc and proc.poll() is None:proc.terminate();proc.communicate(timeout=10)
  run(f"update public.organization_memberships set status={q(original['member'])} where organization_id='{org}' and user_id='{actor}';update public.projects set archived_at={'null' if original['archive'] is None else q(original['archive'])+'::timestamptz'} where id='{project}';update public.engagements set status={q(original['engagement'])} where id='99999999-9999-4999-8999-999999999975';")
race('same-operation-first-registration',register(request),register(request))
race('changed-payload-same-operation',register(request),register(request,'["page:2"]'),'23505')
# Fresh preview after the original registration; original-operation replay still rechecks authority.
review=json.loads(run(f"select public.preview_project_website_pages('{org}','{project}','{version}',{q(keys)});").stdout)['review_sha256']
member=f"update public.organization_memberships set status='suspended' where organization_id='{org}' and user_id='{actor}';";archive=f"update public.projects set archived_at=now() where id='{project}';";engage="update public.engagements set status='on_hold' where id='99999999-9999-4999-8999-999999999975';"
for name,change in [('membership',member),('archive',archive),('engagement',engage)]:
 race(name+'-first',change,register(str(uuid.uuid4()),sha=review),'42501')
 race('registration-before-'+name,register(str(uuid.uuid4()),sha=review),change)
page_id=run(f"select id from public.project_website_pages where project_id='{project}' and page_key='page:1';").stdout.strip()
ops=json.dumps({'planned_url':'https://example.invalid/home','recorded_live_url':None,'redirect_url':None,'publication_state':'in_progress','template':None,'work_item_id':'99999999-9999-4999-8999-999999997160','implementation_notes':'Synthetic native operations','qa_evidence':''})
expected=int(run(f"select coalesce(max(revision_number),0) from public.project_website_page_revisions where page_id='{page_id}';").stdout)
def save():return f"select public.save_project_website_page_operations('{org}','{project}','{page_id}','{version}',{expected},{q(ops)},'{uuid.uuid4()}');"
race('competing-operational-revisions',save(),save(),'40001')
assert json.loads(run(f"select json_build_object('member',(select status from public.organization_memberships where organization_id='{org}' and user_id='{actor}'),'archive',(select archived_at from public.projects where id='{project}'),'engagement',(select status from public.engagements where id='99999999-9999-4999-8999-999999999975'));").stdout)==original
native.update({'behaviorPassCount':count,'behaviorRollbackVerified':True,'races':races,'authorityStatesRestored':True,'retainedImmutableSyntheticAudit':True,'scope':'101 pages, exact approved source and canonical work; synthetic approval is not human acceptance; local only'})
packet.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8');print('AD1 existing evidence packet updated',flush=True)
