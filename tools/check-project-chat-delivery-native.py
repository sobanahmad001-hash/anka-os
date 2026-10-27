"""Owned PG17 contract QA. Synthetic base records; exact installed authority helpers plus new migration."""
import argparse,json,subprocess,socket,uuid,os,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--helpers',required=True);p.add_argument('--scope-helper',required=True);a=p.parse_args()
repo=Path(a.repo);qa=Path(a.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29932;flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def command(exe,args):
 with (qa/'commands.log').open('a') as log:r=subprocess.run([str(Path(a.pgbin)/exe),*map(str,args)],stdout=log,stderr=subprocess.STDOUT,creationflags=flags,timeout=60)
 if r.returncode:raise RuntimeError('Native command failed; see commands.log')
if not(data/'PG_VERSION').exists():
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned port occupied'
 command('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
status=subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
if status.returncode:command('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {port}','-w','start'])
database='chat_delivery_'+uuid.uuid4().hex[:8];base=[str(Path(a.pgbin)/'psql.exe'),'-X','-w','-h','127.0.0.1','-p',str(port),'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql,db=None,ok=True):
 r=subprocess.run(base+['-d',db or database],input=sql,text=True,encoding='utf-8',capture_output=True,creationflags=flags,timeout=30)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r
assert Path(run("show data_directory",'postgres').stdout.strip()).resolve()==data
run('create database '+database,'postgres')
bootstrap="""
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$;
create schema auth;create schema private;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.organizations(id uuid primary key,status text);
create table public.organization_memberships(organization_id uuid,user_id uuid,member_kind text,status text,role text);
create table public.projects(id uuid,organization_id uuid,archived_at timestamptz,primary key(id,organization_id));
create table public.project_manager_bindings(id uuid primary key,organization_id uuid,project_id uuid,user_id uuid,status text);
create table public.engagements(id uuid,organization_id uuid,project_id uuid,name text,status text,primary key(id,organization_id),unique(id,project_id,organization_id));
create table public.service_catalog(id uuid,organization_id uuid,name text,department_id text,display_order integer,is_active boolean,primary key(id,organization_id));
create table private.service_setup_leaves(service_id uuid,organization_id uuid,legacy_service_id uuid,definition jsonb);
create table public.project_service_scopes(id uuid,organization_id uuid,project_id uuid,service_id uuid,quantity integer,unit text,recurrence text,status text,revision integer);
create table private.project_setup_state(organization_id uuid,project_id uuid,plan jsonb,revision integer);
create function public.get_project_service_scope(p_org uuid,p_project uuid) returns jsonb language sql as $$select jsonb_build_object('scopes',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.project_service_scopes s where s.organization_id=p_org and s.project_id=p_project),'[]'),'catalog',(select jsonb_agg(to_jsonb(c)) from public.service_catalog c where c.organization_id=p_org),'project_status','active')$$;
create table public.pipeline_template_publications(id uuid primary key,organization_id uuid);
create table public.pipeline_execution_definitions(id uuid primary key,organization_id uuid,preset_publication_id uuid,version_number integer,name text,steps jsonb);
create table public.pipeline_execution_publications(id uuid primary key,organization_id uuid,definition_id uuid);
create table public.project_pipeline_groups(id uuid primary key default gen_random_uuid(),organization_id uuid,engagement_id uuid,project_id uuid,kind text,name text,preset_publication_id uuid,request_id uuid,request_sha256 text,created_by uuid,created_at timestamptz default now(),unique(engagement_id,kind,name));
create table public.work_items(id uuid primary key,state text,output_id uuid);
create table public.pipeline_outputs(id uuid primary key,status text,content jsonb);
create table public.project_pipeline_configurations(id uuid primary key,state text);
"""
run(bootstrap);run(Path(a.scope_helper).read_text(encoding='utf-8'))
helpers=json.loads(Path(a.helpers).read_text(encoding='utf-8'))
for name in ['private.n1b_preserve_receipt','private.n1e_exact_project_manager','private.n2_scope_require_member','private.n6_project_configuration_authorized','create_project_pipeline_group','get_project_setup']:
 row=next(h for h in helpers if h['signature'].startswith(name+'('));run(row['definition']);signature=row['signature'];run(f'revoke all on function {signature} from public,anon,authenticated,service_role;')
run("grant execute on function public.get_project_setup(uuid,uuid),public.create_project_pipeline_group(uuid,uuid,uuid,text,text,uuid) to authenticated")
run((repo/'supabase/migrations/20261027180506_service_driven_project_plans.sql').read_text(encoding='utf-8'))
uid=lambda n:f'd0000000-0000-4000-8000-{n:012d}';org,actor,project,engagement,copy,design,caption,preset,definition,publication=[uid(n) for n in range(1,11)];scope1=uid(20)
q=lambda v:"'"+str(v).replace("'","''")+"'"
j=lambda v:q(json.dumps(v))+'::jsonb'
claim=lambda who=actor:f"select set_config('request.jwt.claim.sub',{q(who)},false);"
def call(sql,role='authenticated',who=actor,ok=True):return run(f'begin;set local role {role};'+claim(who)+sql+';commit;',ok=ok)
def value(sql,**kwargs):return json.loads(call(sql,**kwargs).stdout.splitlines()[-1])
def get(choices=None,eng=engagement,request=None,version=None):return f"select public.get_project_delivery_plan({q(org)},{q(project)},{q(eng)},{j(choices or {})},{q(request)+'::uuid' if request else 'null'},{q(version)+'::uuid' if version else 'null'})"
def apply(d,request,choices=None,eng=engagement):return f"select public.apply_project_delivery_plan({q(org)},{q(project)},{q(eng)},{q(request)},{q(d['draft']['review_sha256'])},{j(choices or {})})"
def stage(key,service,depends=()):return {'key':key,'label':key.replace('_',' ').title(),'kind':'approval_gate' if key.endswith('review') else 'human','service_id':service,'department_id':'content','depends_on':list(depends),'stage_contract':{'optional':False,'output_label':'Reviewed output','reuse_allowed':False,'required_inputs':[]}}
steps=[stage('copy',copy),stage('copy_review',copy,['copy']),stage('layouts',design,['copy_review']),stage('design_review',design,['layouts'])]
run(f"insert into auth.users values({q(actor)}),({q(uid(99))});insert into public.organizations values({q(org)},'active');insert into public.organization_memberships values({q(org)},{q(actor)},'team','active','operations_admin');insert into public.projects values({q(project)},{q(org)},null);insert into public.engagements values({q(engagement)},{q(org)},{q(project)},'QA project','active');insert into public.pipeline_template_publications values({q(preset)},{q(org)});insert into public.pipeline_execution_definitions values({q(definition)},{q(org)},{q(preset)},1,'Website core',{j(steps)});insert into public.pipeline_execution_publications values({q(publication)},{q(org)},{q(definition)});")
for n,sid,name in [(0,copy,'Page copy'),(1,design,'Page design'),(2,caption,'Monthly caption')]:run(f"insert into public.service_catalog values({q(sid)},{q(org)},{q(name)},'content',{n},true);insert into private.service_setup_leaves values({q(sid)},{q(org)},{q(sid)},{j({'name':name,'department_id':'content','group':'QA','unit':'page','recurrence':'once'})});")
run(f"insert into public.project_service_scopes values({q(scope1)},{q(org)},{q(project)},{q(copy)},2,'page','once','active',1);insert into private.project_setup_state values({q(org)},{q(project)},{j({'contributions':[{'service_id':copy,'pipeline':'website','cadence':'once','deliverable_key':'pages'}],'pipelines':['website']})},1);insert into public.work_items values({q(uid(30))},'completed',{q(uid(31))});insert into public.pipeline_outputs values({q(uid(31))},'approved','{{\"text\":\"Original completed output\"}}');insert into public.project_pipeline_configurations values({q(uid(32))},'historical');")
checks=[]
def passed(name):checks.append(name)
def denied(sql,code='42501',**kw):r=call(sql,ok=False,**kw);assert r.returncode and code in r.stderr,r.stderr;passed('denied '+code)

# Existing proposal details are an explicitly synthetic lower-level boundary here;
# the exact reviewed apply_project_setup and new composed transaction are executed.
run("alter table public.service_catalog add column unit text default 'page',add column recurrence text default 'once';alter table public.project_service_scopes add column updated_at timestamptz;alter table private.project_setup_state add column updated_by uuid,add column updated_at timestamptz;create unique index setup_state_project on private.project_setup_state(project_id);create table private.project_setup_commands(organization_id uuid,actor_id uuid,request_id uuid,project_id uuid,payload jsonb,result jsonb,created_at timestamptz default now(),primary key(organization_id,actor_id,request_id));")
run("create function public.propose_workspace_service_scope(p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_service_id uuid,p_details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare sid uuid:=gen_random_uuid();begin insert into public.project_service_scopes(id,organization_id,project_id,service_id,quantity,unit,recurrence,status,revision) values(sid,p_organization_id,p_project_id,p_service_id,(p_details->>'quantity')::int,p_details->>'unit',p_details->>'recurrence','proposed',1);return jsonb_build_object('scope_id',sid,'revision',1);end;$$;")
setup_sql=(repo/'supabase/migrations/20261026221219_service_catalogue_project_setup.sql').read_text(encoding='utf-8')
run(setup_sql[setup_sql.index('create function public.apply_project_setup('):setup_sql.index('-- Keep broad historical scope')])
run((repo/'supabase/migrations/20261027213344_project_chat_delivery_integration.sql').read_text(encoding='utf-8'))
def item(sid,qty=2,pipeline='website'):
 return {'service_id':sid,'quantity':qty,'unit':'page','expected_revision':None,'cadence':'once','custom_cadence':'','pipeline':pipeline,'channels':[],'audience':'standard','delivery_method':'human','deliverable_key':'','evidence':'Manual quantity reviewed'}
def setup():return value(f"select public.get_project_setup({q(org)},{q(project)})")
def preview(plan,token=None,choices=None,eng=engagement):return f"select public.review_project_delivery_setup({q(org)},{q(project)},{q(token or setup()['token'])},{j(plan)},{q(eng)},{j(choices or {})})"
def combined(review,plan,request,token,choices=None):return f"select public.apply_project_delivery_setup({q(org)},{q(project)},{q(request)},{q(token)},{j(plan)},{q(engagement)},{j(choices or {})},{q(review['review_sha256'])})"
def recover(request):return f"select public.recover_project_delivery_setup({q(org)},{q(project)},{q(request)})"
plan={'items':[item(design,12)],'pipelines':['website'],'questions':[],'explanation':'Add Design service with published Website plan','legacy_acknowledgements':[]}
run(f"update private.service_setup_leaves set legacy_service_id={q(uid(800))}")
initial=setup();before=run("select md5((select jsonb_agg(to_jsonb(s)) from public.project_service_scopes s)::text||(select jsonb_agg(to_jsonb(w)) from public.work_items w)::text)").stdout.strip();review=value(preview(plan));assert len(review['draft']['groups'])==1 and len(review['draft']['groups'][0]['stages'])==4
assert run("select count(*) from private.project_delivery_setup_commands").stdout.strip()=='0'
assert before==run("select md5((select jsonb_agg(to_jsonb(s)) from public.project_service_scopes s)::text||(select jsonb_agg(to_jsonb(w)) from public.work_items w)::text)").stdout.strip();passed('combined preview validates complete proposal with zero persisted writes')
diagnostic=run('begin;'+claim()+f"select public.apply_project_setup({q(org)},{q(project)},{q(uid(400))},{q(initial['token'])},{j(plan)});select private.delivery_setup_semantics(private.build_service_project_plan({q(org)},{q(project)},{q(engagement)},'{{}}'));rollback;")
actual=json.loads(diagnostic.stdout.splitlines()[-1]);expected=value(f"select private.delivery_setup_semantics({j(review['draft'])})",role='postgres')
if actual!=expected:
 import difflib
 (qa/'projection-diff.txt').write_text('\n'.join(difflib.unified_diff(json.dumps(expected,indent=2,sort_keys=True).splitlines(),json.dumps(actual,indent=2,sort_keys=True).splitlines())),encoding='utf-8')
 raise AssertionError('Projection differs; inspect projection-diff.txt')
request=uid(401);saved=value(combined(review,plan,request,initial['token']));assert saved['atomic'] and saved['delivery']['version_number']==1 and len(saved['setup']['results'])==1;passed('single reviewed transaction saves exact services and immutable pipeline plan')
assert saved==value(combined(review,plan,request,initial['token']))==value(recover(request));passed('lost response replay and read-only recovery preserve one original receipt')
assert run('select count(*) from public.project_pipeline_groups').stdout.strip()=='1';assert run('select count(*) from private.project_delivery_plan_versions').stdout.strip()=='1';passed('replay cannot duplicate groups or versions')
denied(combined(review,{**plan,'explanation':'changed'},request,initial['token']),'23505')
denied(combined(review,plan,uid(402),initial['token']),'40001')
old_history=run("select md5((select jsonb_agg(to_jsonb(w)) from public.work_items w)::text||(select jsonb_agg(to_jsonb(o)) from public.pipeline_outputs o)::text||(select jsonb_agg(to_jsonb(c)) from public.project_pipeline_configurations c)::text)").stdout.strip()
fresh=setup();scope=next(s for s in fresh['scopes'] if s['service_id']==design);change={**plan,'items':[{**item(design,20),'expected_revision':scope['revision']}]};review2=value(preview(change));assert review2['draft']['groups'][0]['pipeline_group_id']==saved['delivery']['snapshot']['groups'][0]['pipeline_group_id'];passed('additive review retains exact previously bound pipeline')
# A failure after service writes and before delivery version commit rolls back every write.
run("create function private.qa_reject_plan() returns trigger language plpgsql as $$begin raise exception 'Synthetic late plan failure' using errcode='55000';end;$$;create trigger qa_reject before insert on private.project_delivery_plan_versions for each row execute function private.qa_reject_plan();")
denied(combined(review2,change,uid(403),fresh['token']),'55000');assert setup()['token']==fresh['token'];passed('late plan failure atomically rolls back service revision, metadata and all receipts')
run('drop trigger qa_reject on private.project_delivery_plan_versions')
with ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(lambda _:call(combined(review2,change,uid(404),fresh['token'])),range(2)))
assert all(x.returncode==0 for x in results);assert len({json.loads(x.stdout.splitlines()[-1])['delivery']['id'] for x in results})==1;passed('parallel original request creates one service update and one plan version')
assert old_history==run("select md5((select jsonb_agg(to_jsonb(w)) from public.work_items w)::text||(select jsonb_agg(to_jsonb(o)) from public.pipeline_outputs o)::text||(select jsonb_agg(to_jsonb(c)) from public.project_pipeline_configurations c)::text)").stdout.strip();passed('completed work, output and configuration histories remain byte-identical')
denied(preview(plan),role='anon');denied(preview(plan),role='service_role');denied(preview(plan),who=uid(99));denied(recover(request),who=uid(99))
for name in ['project_delivery_setup_commands']:
 denied(f'select * from private.{name}');denied(f'update private.{name} set result=result',role='postgres');denied(f'delete from private.{name}',role='postgres')
passed('closed immutable receipt cannot be read or changed directly')
fresh=setup();scope=next(s for s in fresh['scopes'] if s['service_id']==design);change={**plan,'items':[{**item(design,30),'expected_revision':scope['revision']}]};r1=value(preview(change));run(f"update public.organization_memberships set role='project_owner' where user_id={q(actor)};insert into public.project_manager_bindings values({q(uid(470))},{q(org)},{q(project)},{q(actor)},'active');")
revoker=subprocess.Popen(base+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=flags);revoker.stdin.write(f"begin;set application_name='combined_revoke';update public.project_manager_bindings set status='revoked' where id={q(uid(470))};select pg_sleep(2);commit;");revoker.stdin.close();revoker.stdin=None
for _ in range(50):
 if run("select exists(select 1 from pg_stat_activity where application_name='combined_revoke' and wait_event='PgSleep')").stdout.strip()=='t':break
 time.sleep(.02)
else:raise AssertionError('Revocation lock not observed')
denied(combined(r1,change,uid(405),fresh['token']));revoker.communicate(timeout=10);assert revoker.returncode==0;passed('current exact PM revocation lock prevents new combined write')
run(f"update public.organization_memberships set role='operations_admin' where user_id={q(actor)};")
assert value(recover(request))==saved;passed('historical original receipt remains readable after newer versions')
assert value(recover(uid(499)))['status']=='not_applied';passed('absent original request is explicit and does not retry')
functions=json.loads(run("select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)))) from pg_proc p where p.proname in ('preview_combined_setup','build_combined_service_plan','delivery_setup_semantics','review_project_delivery_setup','apply_project_delivery_setup','recover_project_delivery_setup')").stdout.strip())
result={'database':database,'port':port,'data':str(data),'count':len(checks),'checks':checks,'functions':functions,'boundary':'Owned synthetic PG17 with exact new functions/current setup writer/current authority; prior lower-level service proposal boundary synthetic, unchanged prior-release contracts retained; no production business/provider writes'}
(qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
