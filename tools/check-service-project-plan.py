"""Owned PG17 contract QA. Synthetic base records; exact installed authority helpers plus new migration."""
import argparse,json,subprocess,socket,uuid,os,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--helpers',required=True);p.add_argument('--scope-helper',required=True);a=p.parse_args()
repo=Path(a.repo);qa=Path(a.qa).resolve();qa.mkdir(parents=True,exist_ok=True);data=qa/'data';port=29926;flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def command(exe,args):
 with (qa/'commands.log').open('a') as log:r=subprocess.run([str(Path(a.pgbin)/exe),*map(str,args)],stdout=log,stderr=subprocess.STDOUT,creationflags=flags,timeout=60)
 if r.returncode:raise RuntimeError('Native command failed; see commands.log')
if not(data/'PG_VERSION').exists():
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned port occupied'
 command('initdb.exe',['-D',data,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
status=subprocess.run([str(Path(a.pgbin)/'pg_ctl.exe'),'-D',str(data),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
if status.returncode:command('pg_ctl.exe',['-D',data,'-l',qa/'server.log','-o',f'-h 127.0.0.1 -p {port}','-w','start'])
database='service_plan_'+uuid.uuid4().hex[:8];base=[str(Path(a.pgbin)/'psql.exe'),'-X','-w','-h','127.0.0.1','-p',str(port),'-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
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
initial=value(get());assert len(initial['draft']['groups'])==1 and len(initial['draft']['groups'][0]['stages'])==2;passed('single-service scope produces a short published-stage plan')
assert all(s['source_review_required'] for s in initial['draft']['groups'][0]['stages']);passed('no stage is automatically satisfied or approved')
op=uid(40);saved=value(apply(initial,op));group=saved['snapshot']['groups'][0]['pipeline_group_id'];assert saved['version_number']==1;passed('actual admin explicitly saves immutable plan and canonical group')
assert value(apply(initial,op))['id']==saved['id'];passed('original request replay returns same immutable version')
denied(apply(initial,op,{'unknown':'new'}),'23505');denied(apply(initial,uid(41)),'40001')
assert len(value(get())['draft']['changes'])==0;passed('unchanged service scope has no new plan delta')
denied('select * from private.project_delivery_plan_versions');denied('select * from private.project_delivery_plan_versions',role='service_role')
denied(f"select public.get_project_delivery_plan({q(org)},{q(project)},{q(engagement)})",who=uid(99))
denied(f"update private.project_delivery_plan_versions set version_number=8 where id={q(saved['id'])}",role='postgres')
before=run("select md5((select jsonb_agg(to_jsonb(w)) from public.work_items w)::text||(select jsonb_agg(to_jsonb(o)) from public.pipeline_outputs o)::text||(select jsonb_agg(to_jsonb(c)) from public.project_pipeline_configurations c)::text)").stdout.strip()
run(f"insert into public.project_service_scopes values({q(uid(21))},{q(org)},{q(project)},{q(design)},12,'layout','once','proposed',1);update private.project_setup_state set plan=jsonb_set(plan,'{{contributions}}',(plan->'contributions')||{j([{'service_id':design,'pipeline':'website','cadence':'once'}])}),revision=2;")
delta=value(get());assert delta['draft']['groups'][0]['pipeline_group_id']==group and delta['draft']['groups'][0]['downstream_review_required'];passed('added downstream service retains original group and flags review')
second=value(apply(delta,uid(42)));assert second['version_number']==2 and len(second['snapshot']['groups'][0]['stages'])==4;passed('reviewed additive version expands plan without restarting original work')
after=run("select md5((select jsonb_agg(to_jsonb(w)) from public.work_items w)::text||(select jsonb_agg(to_jsonb(o)) from public.pipeline_outputs o)::text||(select jsonb_agg(to_jsonb(c)) from public.project_pipeline_configurations c)::text)").stdout.strip();assert before==after;passed('completed canonical work/output/configuration histories byte-identical')
assert value(get(version=saved['id']))['selected']['snapshot']==saved['snapshot'];passed('exact prior plan version remains readable and unchanged')
run(f"update public.project_service_scopes set quantity=100,revision=2 where id={q(scope1)}")
large=value(get());assert large['draft']['groups'][0]['contributions'][0]['quantity']==100;passed('large page scope retained without expanding or truncating execution batches')
# Recurring Marketing uses another existing published template; no scheduler or work is created.
mkt_steps=[stage('caption',caption),stage('caption_review',caption,['caption'])]
run(f"insert into public.pipeline_template_publications values({q(uid(50))},{q(org)});insert into public.pipeline_execution_definitions values({q(uid(51))},{q(org)},{q(uid(50))},1,'Monthly Marketing',{j(mkt_steps)});insert into public.pipeline_execution_publications values({q(uid(52))},{q(org)},{q(uid(51))});insert into public.project_service_scopes values({q(uid(22))},{q(org)},{q(project)},{q(caption)},8,'post','monthly','proposed',1);update private.project_setup_state set plan=jsonb_set(plan,'{{contributions}}',(plan->'contributions')||{j([{'service_id':caption,'pipeline':'marketing','cadence':'monthly'}])});")
mixed=value(get());assert {g['kind'] for g in mixed['draft']['groups']}=={'website','marketing'};assert next(g for g in mixed['draft']['groups'] if g['kind']=='marketing')['cadence']=='monthly';passed('independent Website and recurring Marketing plans use exact approved publications')
third=value(apply(mixed,uid(43)));assert len(third['snapshot']['groups'])==2;passed('review creates only missing Marketing group; existing Website retained')
run(f"update public.organization_memberships set status='revoked' where user_id={q(actor)}")
denied(get(request=op));denied(apply(mixed,op));run(f"update public.organization_memberships set status='active',role='project_owner' where user_id={q(actor)};insert into public.project_manager_bindings values({q(uid(70))},{q(org)},{q(project)},{q(actor)},'active');")
pm=value(get());run(f"update public.project_service_scopes set quantity=9,revision=2 where service_id={q(caption)}")
pm=value(get());value(apply(pm,uid(44)));passed('current exact PM can save without organization admin role')
run(f"update public.project_manager_bindings set status='revoked' where id={q(uid(70))}");denied(apply(pm,uid(44)));run(f"update public.organization_memberships set role='operations_admin' where user_id={q(actor)}")
# A duplicate equally suitable publication is a visible mapping ambiguity, never arbitrary selection.
run(f"insert into public.pipeline_execution_definitions values({q(uid(81))},{q(org)},{q(uid(50))},2,'Other Marketing mapping',{j(mkt_steps)});insert into public.pipeline_execution_publications values({q(uid(82))},{q(org)},{q(uid(81))})")
ambiguous=value(get());assert any('ambiguous' in i['planning_issue'] for i in ambiguous['draft']['unmapped']);passed('ambiguous reusable mappings are explicit and never guessed')
run(f"update public.projects set archived_at=now() where id={q(project)}");denied(get());run(f"update public.projects set archived_at=null where id={q(project)}")
def concurrent(sql):return subprocess.Popen(base+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=flags)
def start(sql):
 process=concurrent(sql);process.stdin.write('begin;set local role authenticated;'+claim()+sql+';commit;');process.stdin.close();process.stdin=None;return process
def collect(writers):
 with ThreadPoolExecutor(max_workers=len(writers)) as pool:return list(pool.map(lambda process:(*process.communicate(timeout=20),process.returncode),writers))
same=value(get());same_op=uid(90);writers=[start(apply(same,same_op)) for _ in range(2)];answers=[]
for out,err,status in collect(writers):
 assert status==0,err;answers.append(json.loads(out.splitlines()[-1]))
assert answers[0]['id']==answers[1]['id'];passed('concurrent identical requests settle one immutable plan version')
run(f"update public.project_service_scopes set quantity=101,revision=3 where id={q(scope1)}")
review=value(get());writers=[start(apply(review,uid(n))) for n in [91,92]];results=collect(writers)
assert sorted(r[2] for r in results)==[0,3] and any('40001' in r[1] for r in results);passed('concurrent different deltas reject the stale reviewed parent')
e2=uid(93);run(f"insert into public.engagements values({q(e2)},{q(org)},{q(project)},'Separate exact context','active')")
fresh=value(get(eng=e2));run("create function private.fail_plan_qa() returns trigger language plpgsql as $$begin raise exception 'Owned QA rollback';end$$;create trigger plan_qa_failure before insert on private.project_delivery_plan_versions for each row execute function private.fail_plan_qa()")
r=call(apply(fresh,uid(94),eng=e2),ok=False);assert r.returncode and 'Owned QA rollback' in r.stderr
assert run(f"select count(*) from public.project_pipeline_groups where engagement_id={q(e2)}").stdout.strip()=='0';run('drop trigger plan_qa_failure on private.project_delivery_plan_versions');passed('plan failure atomically rolls back newly created groups and all plan writes')
for n in [95,96]:call(f"select public.create_project_pipeline_group({q(org)},{q(e2)},{q(preset)},'website','Existing {n}',{q(uid(n))})")
amb=value(get(eng=e2));bucket=amb['draft']['groups'][0];assert bucket['choose_group'];denied(apply(amb,uid(97),eng=e2),'22023')
denied(get({bucket['bucket_key']:uid(999)},eng=e2));choice={bucket['bucket_key']:bucket['group_options'][0]['id']};chosen=value(get(choice,eng=e2));version=value(apply(chosen,uid(98),choice,eng=e2));assert version['snapshot']['groups'][0]['pipeline_group_id']==choice[bucket['bucket_key']];passed('manual existing-pipeline choice is exact, scoped and review-bound')
contexts=value(f"select public.get_project_delivery_plan({q(org)},{q(project)})");assert contexts['engagement_id'] is None and len(contexts['engagements'])==2;passed('multiple engagements require explicit selection with no fallback')
run(f"update public.service_catalog set is_active=false where id={q(copy)}")
assert any('unavailable' in c['planning_issue'] for c in value(get())['draft']['unmapped']);run(f"update public.service_catalog set is_active=true where id={q(copy)}");passed('inactive catalogue services cannot acquire an executable mapping')
denied(get(),role='anon');denied(get({'unknown':'new'}),'22023')
# Observe the revocation transaction while it owns the actual PM binding lock.
run(f"update public.organization_memberships set role='project_owner' where user_id={q(actor)};update public.project_manager_bindings set status='active' where id={q(uid(70))};update public.project_service_scopes set quantity=102,revision=4 where id={q(scope1)}")
race=value(get());revoker=subprocess.Popen(base+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=flags)
revoker.stdin.write(f"begin;set application_name='service_plan_revoke';update public.project_manager_bindings set status='revoked' where id={q(uid(70))};select pg_sleep(2);commit;");revoker.stdin.close();revoker.stdin=None
observed=False
for _ in range(50):
 if run("select exists(select 1 from pg_stat_activity where application_name='service_plan_revoke' and wait_event='PgSleep')").stdout.strip()=='t':observed=True;break
 time.sleep(.02)
assert observed;denied(apply(race,uid(100)));out,err=revoker.communicate(timeout=10);assert revoker.returncode==0,err;passed('observed PM binding lock race rejects save after committed revocation')
result={'database':database,'port':port,'data':str(data),'checks':checks,'count':len(checks),'boundary':'Native PG17 exact current source helpers/new migration with synthetic base data; no production/provider acceptance'}
(qa/'verification.json').write_bytes((json.dumps(result,indent=2)+'\n').encode());print(json.dumps(result))
