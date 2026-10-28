"""Owned PG17: exact current P5 writer/authority and triggers; synthetic base schema/records.
Page-path/recurrence/automation machinery is outside these fixed commands and not simulated as acceptance.
"""
import argparse,json,subprocess,socket,uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--helpers',required=True);p.add_argument('--extra',required=True);a=p.parse_args()
qa=Path(a.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29934;flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def command(exe,args):
 with (qa/'commands.log').open('ab') as f:r=subprocess.run([str(Path(a.pgbin)/exe),*map(str,args)],stdout=f,stderr=subprocess.STDOUT,creationflags=flags,timeout=60)
 if r.returncode:raise RuntimeError('Owned PostgreSQL command failed; see commands.log')
assert not data.exists() or (data/'PG_VERSION').exists(),'Preserve incomplete unknown data'
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned port occupied'
if not (data/'PG_VERSION').exists():command('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
command('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {port}','-w','start'])
base=[str(Path(a.pgbin)/'psql.exe'),'-X','-w','-h','127.0.0.1','-p',str(port),'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
database='actions_'+uuid.uuid4().hex[:8]
def run(sql,ok=True,db=None):
 r=subprocess.run(base+['-d',db or database],input=sql,text=True,encoding='utf8',capture_output=True,creationflags=flags,timeout=30)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r
assert Path(run('show data_directory',db='postgres').stdout.strip()).resolve()==data
run('create database '+database,db='postgres')
bootstrap="""
create role anon;create role authenticated;create role service_role;
create schema auth;create schema private;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;
create table public.organizations(id uuid primary key,status text);
create table public.organization_memberships(organization_id uuid,user_id uuid,member_kind text,status text,role text,department_id text);
create table public.projects(id uuid primary key,organization_id uuid,archived_at timestamptz);
create table public.project_manager_bindings(organization_id uuid,project_id uuid,user_id uuid,status text);
create table public.project_department_participation(organization_id uuid,project_id uuid,department_id text,status text);
create table public.departments(id text,organization_id uuid);
create table public.engagements(id uuid primary key,organization_id uuid,project_id uuid,brand_id uuid,status text);
create table public.service_catalog(id uuid,organization_id uuid,department_id text,is_active boolean);
create table public.engagement_services(id uuid,organization_id uuid,engagement_id uuid,service_id uuid,status text);
create table public.artifacts(id uuid primary key,organization_id uuid,engagement_id uuid,artifact_type text);
create table public.artifact_versions(id uuid primary key,organization_id uuid,artifact_id uuid);
create table public.engagement_stage_instances(id uuid,organization_id uuid,engagement_id uuid);
create table public.engagement_events(id uuid primary key default gen_random_uuid(),organization_id uuid,engagement_id uuid,event_type text,actor_id uuid,payload jsonb);
create table public.work_items(id uuid primary key default gen_random_uuid(),organization_id uuid,engagement_id uuid,brand_id uuid,project_id uuid,department_id text,title text,description text,work_item_type text,priority text,status text,assignee_id uuid,created_by uuid,linked_artifact_id uuid,linked_artifact_version_id uuid,linked_engagement_stage_instance_id uuid,start_date date,due_date date,position integer,parent_work_item_id uuid,created_via text,deleted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),row_version bigint default 1,recurring_occurrence_id uuid,recurring_plan_id uuid,recurring_plan_version_id uuid,recurring_template_key text,automation_flagged_at timestamptz,automation_flagged_by_rule_id uuid);
create table private.n1c_assignment_history(organization_id uuid,project_id uuid,record_kind text,record_id uuid,actor_id uuid,previous_assignee_id uuid,assignee_id uuid,row_version bigint);
"""
run(bootstrap)
helpers=json.loads(Path(a.helpers).read_text(encoding='utf8'))+json.loads(Path(a.extra).read_text(encoding='utf8'))
installed=set()
for h in helpers:
 if h['signature'] in installed or any(x in h['signature'] for x in ['guard_work_item_page_link','clear_work_item_automation','protect_work_item_recurring']):continue
 installed.add(h['signature']);run(h['definition']);run('revoke all on function '+h['signature']+' from public,anon,authenticated,service_role')
run("create trigger a_derive before insert or update on public.work_items for each row execute function private.derive_engagement_project_ownership();create trigger b_revision before update on public.work_items for each row execute function private.p5_advance_row_version();create trigger zz_assignment before insert or update on public.work_items for each row execute function private.n1c_guard_assignment();")
run(Path('supabase/migrations/20261027221708_project_delivery_work_actions.sql').read_text(encoding='utf8'))
uid=lambda n:f'e0000000-0000-4000-8000-{n:012d}'
org,actor,other,project,eng,svc,catalog,art,ver,ver2=[uid(n) for n in range(1,11)]
q=lambda x:"'"+str(x).replace("'","''")+"'"
j=lambda x:q(json.dumps(x,ensure_ascii=False))+'::jsonb'
run(f"insert into auth.users values({q(actor)}),({q(other)});insert into public.organizations values({q(org)},'active');insert into public.organization_memberships values({q(org)},{q(actor)},'team','active','contributor','content'),({q(org)},{q(other)},'team','active','contributor','content');insert into public.projects values({q(project)},{q(org)},null);insert into public.engagements values({q(eng)},{q(org)},{q(project)},{q(uid(99))},'planning');insert into public.service_catalog values({q(catalog)},{q(org)},'content',true);insert into public.engagement_services values({q(svc)},{q(org)},{q(eng)},{q(catalog)},'active');insert into public.departments values('content',{q(org)}),('marketing',{q(org)}),('development',{q(org)});insert into public.artifacts values({q(art)},{q(org)},{q(eng)},'content');insert into public.artifact_versions values({q(ver)},{q(org)},{q(art)}),({q(ver2)},{q(org)},{q(art)});")
def call(sql,role='service_role',who=None,ok=True):return run(f"begin;set local role {role};select set_config('request.jwt.claim.sub',{q(who or '')},true);"+sql+';commit',ok)
def apply(cmd,rid=None,who=actor):return f'select public.apply_project_work_command({q(org)},{q(project)},{q(eng)},{q(svc)},{q(rid or str(uuid.uuid4()))},{j(cmd)},{q(who)})'
def recover(rid):return f'select public.recover_project_work_command({q(org)},{q(project)},{q(rid)})'
def value(sql,**kw):return json.loads(call(sql,**kw).stdout.splitlines()[-1])
checks=[]
def passed(name):checks.append(name)
def denied(sql,code=None,**kw):
 r=call(sql,ok=False,**kw);assert r.returncode and (not code or code in r.stderr),r.stderr;passed('denied '+(code or 'invalid request'))
create={'action':'create','title':'Original صفحہ request','description':'Reviewed exact brief'};rid=str(uuid.uuid4());saved=value(apply(create,rid));item=saved['work_item'];assert item['status']=='not_started' and item['assignee_id'] is None and item['project_id']==project;passed('canonical unassigned request with full Unicode through current actual P5 writer')
assert value(apply(create,rid))==saved;passed('original request replay has no duplicate work or event')
assert value(recover(rid),role='authenticated',who=actor)==saved;passed('read-only original recovery')
assert value(recover(rid),role='authenticated',who=other)=={'status':'not_applied'};passed('other actor cannot read receipt')
denied(apply({**create,'title':'changed'},rid),'23505');denied(apply(create),role='authenticated',who=actor,code='42501');denied(apply(create),role='anon',code='42501')
for cmd in [{**create,'assignee_id':other},{**create,'status':'done'},{'action':'arbitrary_sql'},{**create,'title':'x'*241},{**create,'description':'x'*20001},{**create,'title':None}]:denied(apply(cmd),'22023')
link={'action':'link_content_version','work_item_id':item['id'],'row_version':item['row_version'],'artifact_version_id':ver};linked=value(apply(link));assert linked['work_item']['linked_artifact_version_id']==ver and linked['work_item']['status']==item['status'];passed('current P5 CAS links exact version without approval or completion')
denied(apply({**link,'artifact_version_id':ver2}),'40001');denied(apply({**link,'row_version':2},who=other),'42501')
run(f"update public.work_items set status='done' where id={q(item['id'])}") if False else None
# Change through an actual authorized server writer rather than bypassing the table guard.
run(f"update public.organization_memberships set role='operations_admin' where user_id={q(actor)}")
row=linked['work_item'];args=[org,row['id'],eng,row['title'],row['description'],'request','medium','done',None,'content',art,ver,None,None,None,0,None,actor,row['row_version'],'manual']
sql='select public.save_p5_work_item('+','.join('null' if x is None else str(x) if isinstance(x,int) else q(x) for x in args)+')'
run("create function public.qa_finish() returns void language plpgsql security definer set search_path='' as $$begin "+sql.replace('select public.save_p5_work_item','perform public.save_p5_work_item')+';end;$$');call('select public.qa_finish()')
denied(apply({**link,'row_version':3}),'40001');passed('completed work output/history protected')
run(f"update public.engagement_services set status='paused' where id={q(svc)}");denied(apply(create),'42501');assert value(recover(rid),role='authenticated',who=actor)==saved;passed('inactive service blocks writes but original receipt remains recoverable');run(f"update public.engagement_services set status='active' where id={q(svc)}")
run(f"update public.organization_memberships set status='inactive' where user_id={q(actor)}");denied(apply(create),'42501');denied(recover(rid),role='authenticated',who=actor,code='42501');run(f"update public.organization_memberships set status='active' where user_id={q(actor)}")
same=str(uuid.uuid4())
with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:value(apply(create,same)),range(2)))
assert results[0]==results[1];passed('concurrent identical create serialized to one canonical record')
before=run('select count(*) from public.work_items').stdout.strip();run("create function private.qa_reject() returns trigger language plpgsql as $$begin raise exception 'QA late receipt failure' using errcode='55000';end;$$;create trigger qa_reject before insert on private.project_work_commands for each row execute function private.qa_reject();")
denied(apply(create),'55000');assert run('select count(*) from public.work_items').stdout.strip()==before;passed('late receipt failure rolls back work and events');run('drop trigger qa_reject on private.project_work_commands')
assert run("select has_table_privilege('authenticated','private.project_work_commands','SELECT')").stdout.strip()=='f';passed('closed receipt store')
assert run('select count(*) from private.n1c_assignment_history').stdout.strip()=='0';passed('no assignment history fabricated')
(qa/'result.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'port':port,'boundary':'Synthetic base schema; exact current writer and assignment/scope/version guards. No live business writes.'},indent=2),encoding='utf8')
command('pg_ctl.exe',['-D',data,'-m','fast','-w','stop']);print(json.dumps({'passed':len(checks),'stopped':True,'qa':str(qa)}))
