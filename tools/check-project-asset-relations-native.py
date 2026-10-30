"""Owned PG17 QA. Actual current authority helpers + exact candidate migration.
Base records/schema and campaign approved-source boundary are synthetic. No app/live acceptance.
"""
import argparse,json,subprocess,socket,uuid,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
p=argparse.ArgumentParser();p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--helpers',required=True);p.add_argument('--extra',required=True);a=p.parse_args()
qa=Path(a.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29948;flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def cmd(exe,args):
 with (qa/'commands.log').open('ab') as f:r=subprocess.run([str(Path(a.pgbin)/exe),*map(str,args)],stdout=f,stderr=subprocess.STDOUT,creationflags=flags,timeout=90)
 if r.returncode:raise RuntimeError('See owned commands.log')
assert not data.exists(),'Choose fresh QA; preserve existing data'
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Port occupied'
cmd('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
cmd('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {port}','-w','start'])
base=[str(Path(a.pgbin)/'psql.exe'),'-X','-w','-h','127.0.0.1','-p',str(port),'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];db='asset_relations_'+uuid.uuid4().hex[:8]
def run(sql,database=None):return subprocess.run(base+['-d',database or db],input=sql,text=True,encoding='utf8',capture_output=True,creationflags=flags,timeout=30)
def sql(s):
 r=run(s)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
checks=[]
try:
 assert Path(run('show data_directory','postgres').stdout.strip()).resolve()==data
 assert run('create database '+db,'postgres').returncode==0
 sql('''create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 create table public.organizations(id uuid primary key,status text);
 create table public.organization_memberships(organization_id uuid,user_id uuid,role text,status text,member_kind text,department_id text);
 create table public.projects(id uuid primary key,organization_id uuid,archived_at timestamptz);
 create table public.project_manager_bindings(organization_id uuid,project_id uuid,user_id uuid,status text);
 create table public.project_department_participation(organization_id uuid,project_id uuid,department_id text,status text);
 create table public.engagements(id uuid primary key,organization_id uuid,project_id uuid);
 create table public.work_items(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,department_id text,deleted_at timestamptz,status text,row_version bigint,created_by uuid,assignee_id uuid);
 create table public.tasks(id uuid primary key,organization_id uuid,project_id uuid,department_id text,archived_at timestamptz,status text,row_version bigint,user_id uuid,assigned_to uuid);
 create table public.department_chat_conversations(id uuid primary key,organization_id uuid,project_id uuid,owner_id uuid,context_kind text,state text,archived_at timestamptz);
 create table public.project_context_chat_shares(conversation_id uuid,recipient_id uuid,revoked_at timestamptz);
 create table public.project_website_pages(id uuid primary key,organization_id uuid,project_id uuid,page_key text,engagement_id uuid,brand_id uuid);
 create table public.project_campaign_assets(id uuid primary key,organization_id uuid,project_id uuid,brand_id uuid,source_kind text,source_version_id uuid,source_descriptor jsonb);
 create table public.artifacts(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,artifact_type text);
 create table public.artifact_versions(id uuid primary key,organization_id uuid,artifact_id uuid,content jsonb,content_checksum text);
 create table private.qa_source_available(version_id uuid primary key,available boolean);
 create function private.campaign_asset_source(uuid,uuid,uuid,text,uuid) returns jsonb language plpgsql as $$begin if not exists(select 1 from private.qa_source_available where version_id=$5 and available) then raise exception 'Synthetic source unavailable' using errcode='55000';end if;return '{}'::jsonb;end;$$;
 create function private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text) returns jsonb language plpgsql as $$begin if not exists(select 1 from private.qa_source_available where version_id=$3 and available) then raise exception 'Synthetic exact approval unavailable' using errcode='55000';end if;return '{}'::jsonb;end;$$;
 ''')
 helpers=json.loads(Path(a.helpers).read_text(encoding='utf8'))+json.loads(Path(a.extra).read_text(encoding='utf8'))
 wanted=['private.n1b_preserve_receipt()','private.n1c_require_scope(uuid,uuid,uuid)','private.n1c_can_assign(uuid,uuid,uuid)','private.n1c_can_assign_department(uuid,uuid,text,uuid)']
 for sig in wanted:
  h=next(h for h in helpers if h['signature']==sig);sql(h['definition']);sql('revoke all on function '+sig+' from public,anon,authenticated,service_role')
 sql(Path('supabase/migrations/20261030122254_project_asset_relationships.sql').read_text(encoding='utf8'))
 sql(Path('supabase/migrations/20261030123019_project_page_keyword_targets.sql').read_text(encoding='utf8'))
 uid=lambda n:f'a0000000-0000-4000-8000-{n:012d}'
 org,actor,other,project,eng,conv,work,task,page,asset,privateconv,foreignproject,foreignpage,source=[uid(i) for i in range(1,15)]
 q=lambda x:"'"+str(x).replace("'","''")+"'";j=lambda x:q(json.dumps(x,ensure_ascii=False))+'::jsonb'
 sql(f"insert into auth.users values({q(actor)}),({q(other)});insert into public.organizations values({q(org)},'active');insert into public.organization_memberships values({q(org)},{q(actor)},'contributor','active','team','content'),({q(org)},{q(other)},'contributor','active','team','marketing');insert into public.projects values({q(project)},{q(org)},null),({q(foreignproject)},{q(org)},null);insert into public.engagements values({q(eng)},{q(org)},{q(project)});insert into public.work_items values({q(work)},{q(org)},{q(project)},{q(eng)},'content',null,'done',1,{q(actor)},null);insert into public.tasks values({q(task)},{q(org)},{q(project)},'content',null,'not_started',1,{q(actor)},null);insert into public.department_chat_conversations values({q(conv)},{q(org)},{q(project)},{q(actor)},'project_team','active',null),({q(privateconv)},{q(org)},{q(project)},{q(actor)},'private','active',null);insert into public.project_website_pages values({q(page)},{q(org)},{q(project)},'home',{q(eng)},{q(uid(55))}),({q(foreignpage)},{q(org)},{q(foreignproject)},'other',{q(eng)},{q(uid(55))});insert into public.project_campaign_assets values({q(asset)},{q(org)},{q(project)},{q(uid(55))},'artifact_version',{q(source)},'{{}}');insert into private.qa_source_available values({q(source)},true)")
 assets=[{'kind':'website_page','id':page},{'kind':'campaign_asset','id':asset}]
 def auth(s,who=actor,role='authenticated'):return f"begin;set local role {role};set local request.jwt.claim.sub={q(who)};{s};commit;"
 def value(s,**kw):return json.loads(sql(auth(s,**kw)).splitlines()[-1])
 def denied(s,code='42501',**kw):
  r=run(auth(s,**kw));assert r.returncode and code in r.stderr,r.stderr;checks.append('denied '+code)
 def review(kind='engagement_work_item',sid=work,rev=0,row=1,refs=None):return f"select public.review_project_asset_relations({q(org)},{q(project)},{q(kind)},{q(sid)},{rev},{'null' if row is None else row},{j(assets if refs is None else refs)})"
 def save(token,rid,kind='engagement_work_item',sid=work,rev=0,row=1,refs=None):return f"select public.save_project_asset_relations({q(org)},{q(project)},{q(kind)},{q(sid)},{rev},{'null' if row is None else row},{j(assets if refs is None else refs)},{q(token)},{q(rid)})"
 def read(kind='engagement_work_item',sid=work):return f"select public.read_project_asset_relations({q(org)},{q(project)},{q(kind)},{q(sid)})"
 def recover(rid):return f"select public.recover_project_asset_relations({q(org)},{q(project)},{q(rid)})"
 assert value(read())['assets']==[];checks.append('project-wide work needs no asset')
 r=value(review());assert sql('select count(*) from private.project_asset_relation_revisions')=='0';checks.append('review writes nothing')
 rid=uid(101);saved=value(save(r['review_sha256'],rid));assert len(saved['assets'])==2;checks.append('one work links two canonical typed assets')
 assert value(save(r['review_sha256'],rid))==saved;checks.append('exact replay single original revision')
 assert value(recover(rid))['original_result']==saved;checks.append('read-only lost-response recovery')
 assert value(recover(rid),who=other)=={'status':'not_found'};checks.append('other actor receipt private')
 denied(save(r['review_sha256'],rid,refs=[]),'23505');denied(save(r['review_sha256'],uid(102)),'40001')
 denied(review(rev=1),who=other);denied(review(kind='project_task',sid=task),who=other);denied(review(kind='conversation',sid=conv,row=None),who=other)
 denied(review(kind='conversation',sid=privateconv,row=None));denied(review(rev=1,refs=[{'kind':'website_page','id':foreignpage}]))
 denied(review(rev=1,refs=[assets[0],assets[0]]),'22023');denied(review(rev=1,refs=[{'kind':'fake','id':page}]),'22023')
 denied(read(),role='anon');denied(read(),role='service_role');denied('select * from private.project_asset_relation_revisions')
 sql(f"update private.qa_source_available set available=false where version_id={q(source)}");denied(review(rev=1),'55000');sql('update private.qa_source_available set available=true')
 sql('update public.work_items set row_version=2');denied(review(rev=1),'40001');sql('update public.work_items set row_version=1')
 r2=value(review(rev=1,refs=[]));saved2=value(save(r2['review_sha256'],uid(103),rev=1,refs=[]));assert saved2['revision']==2 and value(read())['assets']==[];checks.append('unlink appends; original relationship history intact')
 assert value(recover(rid))['original_result']==saved;assert value(read())['revision']==2;checks.append('old recovery never restores revoked links')
 assert sql("select status||':'||row_version from public.work_items")=='done:1';checks.append('completed work unchanged')
 rt=value(review(kind='project_task',sid=task));value(save(rt['review_sha256'],uid(104),kind='project_task',sid=task));checks.append('project tasks stay typed and separate')
 rc=value(review(kind='conversation',sid=conv,row=None));value(save(rc['review_sha256'],uid(105),kind='conversation',sid=conv,row=None));checks.append('explicit owner project conversation link')
 denied(read(kind='conversation',sid=conv),who=other)
 sql(f"insert into public.project_context_chat_shares values({q(conv)},{q(other)},null)");assert len(value(read(kind='conversation',sid=conv),who=other)['assets'])==2;checks.append('explicit recipient may read existing shared links')
 sql('update public.project_context_chat_shares set revoked_at=now()');denied(read(kind='conversation',sid=conv),who=other)
 sql(f"update public.organization_memberships set status='inactive' where user_id={q(actor)}");denied(read());denied(recover(rid));sql("update public.organization_memberships set status='active'")
 r3=value(review(rev=2));s3=save(r3['review_sha256'],uid(106),rev=2)
 with ThreadPoolExecutor(2) as pool:assert len(set(pool.map(lambda _:sql(auth(s3)),range(2))))==1
 checks.append('concurrent same request creates one revision')
 r4=value(review(rev=3,refs=[]))
 with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda n:run(auth(save(r4['review_sha256'],uid(n),rev=3,refs=[]))),[107,108]))
 assert sorted(x.returncode==0 for x in results)==[False,True];assert any('40001' in x.stderr for x in results);checks.append('concurrent competing edits serialize with stale conflict')
 assert run('update private.project_asset_relation_revisions set assets=assets').returncode;checks.append('even privileged history edit denied')
 denied('select private.asset_relation_assets(null,null,null)');checks.append('helpers closed')


 sql("alter table public.department_chat_conversations add column title text default 'Original project conversation'")
 convlist=f"select public.list_project_asset_conversations({q(org)},{q(project)},'website_page',{q(page)},0)"
 assert len(value(convlist)['conversations'])==1;assert value(convlist,who=other)['conversations']==[];checks.append('asset conversation listing never exposes unshared titles or counts')
 sql("update public.project_context_chat_shares set revoked_at=null");assert len(value(convlist,who=other)['conversations'])==1;sql("update public.project_context_chat_shares set revoked_at=now()");assert value(convlist,who=other)['conversations']==[];checks.append('asset conversation list follows current explicit share revocation')
 assert len(value(f"select public.list_project_asset_relation_options({q(org)},{q(project)},'',0)")['options'])==2;checks.append('bounded canonical asset lookup excludes foreign project')
 assert len(value(f"select public.list_project_asset_work_links({q(org)},{q(project)},'website_page',{q(page)})")['links'])==1;checks.append('asset work reader respects latest unlink and typed task')
 strategy=uid(301);artifact=uid(302)
 content={'schema_version':2,'keywords':[{'term':'Original Anka خدمات','locale':'en-PK','topic_group':'Services','evidence_source':'manual approved research','observation_date':'2026-10-29'},{'term':'Supporting service','locale':'en-PK','topic_group':'Services','evidence_source':'manual research'}]}
 sql(f"insert into public.artifacts values({q(artifact)},{q(org)},{q(project)},{q(eng)},{q(uid(55))},'keyword_strategy');insert into public.artifact_versions values({q(strategy)},{q(org)},{q(artifact)},{j(content)},encode(sha256(convert_to(({j(content)})::text,'UTF8')),'hex'));insert into private.qa_source_available values({q(strategy)},true)")
 checksum=sql(f"select content_checksum from public.artifact_versions where id={q(strategy)}")
 targets=[{'keyword_index':0,'role':'primary','cluster':'Services'},{'keyword_index':1,'role':'supporting','cluster':'Services'}]
 def kr(rev=0,ts=None,check=checksum,pid=page):return f"select public.review_project_page_keyword_targets({q(org)},{q(project)},{q(pid)},{rev},{q(strategy)},{q(check)},{j(targets if ts is None else ts)})"
 def ks(token,rid,rev=0,ts=None):return f"select public.save_project_page_keyword_targets({q(org)},{q(project)},{q(page)},{rev},{q(strategy)},{q(checksum)},{j(targets if ts is None else ts)},{q(token)},{q(rid)})"
 def kread():return f"select public.read_project_page_keyword_targets({q(org)},{q(project)},{q(page)})"
 def krecover(rid):return f"select public.recover_project_page_keyword_targets({q(org)},{q(project)},{q(rid)})"
 denied(kr());sql(f"update public.organization_memberships set role='department_manager' where user_id={q(actor)};insert into public.project_department_participation values({q(org)},{q(project)},'content','active')")
 source=value(f"select public.get_project_page_keyword_source({q(org)},{q(project)},{q(page)},{q(strategy)})");assert source['keywords']==content['keywords'];checks.append('exact source terms locale and evidence retained without observed ranking')
 preview=value(kr());assert preview['draft']['measurement_kind']=='planned_target';assert preview['draft']['targets'][0]['source']['term']==content['keywords'][0]['term'];checks.append('primary supporting cluster review retains Unicode exact source')
 kid=uid(303);savedk=value(ks(preview['review_sha256'],kid));assert value(ks(preview['review_sha256'],kid))==savedk;checks.append('keyword save original replay single immutable revision')
 assert value(krecover(kid))['original_result']==savedk;checks.append('keyword read-only original recovery')
 denied(ks(preview['review_sha256'],uid(304)),'40001');denied(ks(preview['review_sha256'],kid,ts=[]),'23505')
 denied(kr(rev=1,ts=[targets[0],{**targets[1],'role':'primary'}]),'22023');denied(kr(rev=1,ts=[targets[0],targets[0]]),'22023');denied(kr(rev=1,check='0'*64),'40001');denied(kr(rev=1,pid=foreignpage))
 sql(f"update private.qa_source_available set available=false where version_id={q(strategy)}");denied(kr(rev=1),'55000');sql(f"update private.qa_source_available set available=true where version_id={q(strategy)}")
 empty=value(kr(rev=1,ts=[]));value(ks(empty['review_sha256'],uid(305),rev=1,ts=[]));assert value(kread())['current']['targets']==[];assert value(krecover(kid))['original_result']==savedk;checks.append('keyword unlink preserves source history and old recovery cannot restore targets')
 sql("update public.project_department_participation set status='revoked'");denied(kr(rev=2));assert value(kread())['revision']==2;checks.append('write revocation preserves permitted read-only historical access')
 denied(kread(),role='anon');denied(kread(),role='service_role');denied('select * from private.project_page_keyword_target_revisions');assert run('delete from private.project_page_keyword_target_revisions').returncode;checks.append('keyword store closed and immutable')
 assert sql("select status||':'||row_version from public.work_items")=='done:1';checks.append('full sequence never changes work lifecycle')

 # Observe the actual membership row lock, then commit revocation before the waiting writer proceeds.
 latest=value(read())['revision'];race_review=value(review(rev=latest));race_save=save(race_review['review_sha256'],uid(450),rev=latest)
 with ThreadPoolExecutor(2) as pool:
  revoke=pool.submit(sql,f"begin;update public.organization_memberships set status='inactive' where user_id={q(actor)};select pg_sleep(1.5);commit;")
  deadline=time.monotonic()+1;held=False
  while time.monotonic()<deadline:
   held=sql("select count(*) from pg_stat_activity where datname=current_database() and query like '%pg_sleep(1.5)%' and pid<>pg_backend_pid() and state='active'")!='0'
   if held:break
   time.sleep(.02)
  assert held,'Revoker lock not established'
  writer=pool.submit(run,auth('/* ASSET_PERMISSION_RACE */ '+race_save));blocked=False
  while time.monotonic()<deadline:
   blocked=sql("select count(*) from pg_stat_activity where datname=current_database() and query like '%ASSET_PERMISSION_RACE%' and pid<>pg_backend_pid() and wait_event_type='Lock'")!='0'
   if blocked:break
   time.sleep(.02)
  assert blocked,'Writer did not observe retained membership lock'
  revoke.result();outcome=writer.result();assert outcome.returncode and '42501' in outcome.stderr,outcome.stderr
 sql("update public.organization_memberships set status='active'");assert value(read())['revision']==latest;checks.append('observed membership revocation lock race denies waiting writer without new history')
 # Local catalog audit of candidate objects only: closed access, RLS, immutable history, empty search paths.
 audit=json.loads(sql("select json_build_object('closed_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('project_asset_relation_revisions','project_asset_relation_commands','project_page_keyword_target_revisions','project_page_keyword_target_commands') and c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'SELECT') and not has_table_privilege('service_role',c.oid,'INSERT')),'unsafe_search_paths',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('asset_relation_subject','asset_relation_assets','page_keyword_scope','save_project_asset_relations','save_project_page_keyword_targets') and not 'search_path=\"\"'=any(p.proconfig)))"))
 assert audit['closed_tables']==4 and audit['unsafe_search_paths']==0,audit;checks.append('candidate catalog RLS closed table rights and empty definer search paths')
 (qa/'result.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'database':db,'port':port,'base':'synthetic','authority':'actual retained source definitions','campaign_source':'synthetic availability boundary','migration':'exact local source','app_acceptance':False},indent=2),encoding='utf8');print(json.dumps({'passed':len(checks),'database':db}))
finally:cmd('pg_ctl.exe',['-D',data,'-m','fast','-w','stop'])
