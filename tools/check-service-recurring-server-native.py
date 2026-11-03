"""Fresh owned native PostgreSQL: actual recurrence/authority/P5 writers.
Synthetic base records and exact-shape saved plan/configuration/approved-stage seam.
No remote business fixtures or provider calls. Each run preserves its data and logs.
"""
from pathlib import Path
import argparse,ast,json,subprocess,uuid,socket,hashlib,re,os
from concurrent.futures import ThreadPoolExecutor
os.environ['PGCLIENTENCODING']='UTF8'
FIXTURE_BOUNDARY=__doc__
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--scheduler-only',action='store_true');p.add_argument('--compile-only',action='store_true');p.add_argument('--path-conflict-only',action='store_true');a=p.parse_args()
scheduler_fixture=a.scheduler_only or a.path_conflict_only
repo=Path(a.repo).resolve();parent=repo.parent;qa=Path(a.qa).resolve();data=qa/'data';bin=Path(a.pgbin);port=29972;db='recurring_'+uuid.uuid4().hex[:8];flags=0x08000000;checks=[];started=False
assert not data.exists(),'Fresh owned data only';qa.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned port occupied'
def control(args):
 with (qa/'control.log').open('a',encoding='utf-8') as f:
  r=subprocess.run([str(x) for x in args],stdout=f,stderr=subprocess.STDOUT,creationflags=flags,timeout=40);assert r.returncode==0,'See control.log'
def raw(sql,database=None):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',database or db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql+'\n',capture_output=True,text=True,encoding='utf-8',creationflags=flags,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf-8') as f:f.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql,database=None):
 r=raw(sql,database);assert r.returncode==0,r.stderr;return r.stdout.strip()
q=lambda x:"'"+str(x).replace("'","''")+"'"
j=lambda x:q(json.dumps(x))+'::jsonb'
uid=lambda n:f'a2000000-0000-4000-8000-{n:012d}'
def passed(name):checks.append(name)
def read(name):return json.loads((parent/name).read_text(encoding='utf-8'))
def table(t,name=None):
 return 'create table '+(name or t['schema']+'.'+t['name'])+'('+','.join(c['name']+' '+c['type']+(' default '+c['default'] if c.get('default') else '')+(' not null' if c['notnull'] else '') for c in t['columns'])+');'
def function(f):
 sql='set check_function_bodies=off;'+f['definition']+';\n';sig=f['signature'];sql+='revoke all on function '+sig+' from public,anon,authenticated,service_role;\n'
 for role in ['anon','authenticated','service_role']:
  if role+'=X/' in (f.get('acl') or ''):sql+='grant execute on function '+sig+' to '+role+';\n'
 return sql
def call(sql,role='authenticated',who=None,ok=True):
 r=raw('begin;set local role '+role+";select set_config('request.jwt.claim.sub',"+q(who or '')+",true);"+sql+';commit;')
 if ok:assert r.returncode==0,r.stderr
 return r
def value(sql,role='authenticated',who=None):return json.loads(call(sql,role,who).stdout.strip().splitlines()[-1])
def deny(sql,code='42501',role='authenticated',who=None):
 r=call(sql,role,who,False);assert r.returncode!=0 and code in r.stderr,r.stderr
try:
 control([bin/'initdb.exe','-D',data,'-U','postgres','--encoding=UTF8','--no-locale','--auth=trust'])
 control([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 assert Path(run('show data_directory','postgres')).resolve()==data
 run('create database '+db,'postgres')
 tree=ast.parse((repo/'tools/check-project-work-actions-native.py').read_text(encoding='utf-8'))
 bootstrap=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='bootstrap' for t in n.targets))
 bootstrap='\n'.join(x for x in bootstrap.splitlines() if not x.startswith('create table public.engagement_services('))
 run(bootstrap)
 run("alter table auth.users add deleted_at timestamptz;alter table auth.users add banned_until timestamptz;alter table public.projects add owner_id uuid;alter table public.projects add unique(id,organization_id);alter table public.engagements add engagement_type text;alter table public.engagements add unique(id,organization_id);alter table public.engagements add unique(id,project_id,organization_id);alter table public.project_manager_bindings add id uuid default gen_random_uuid() primary key;alter table public.departments add primary key(id);alter table public.service_catalog add name text;alter table public.service_catalog add unit text;alter table public.service_catalog add unique(id,organization_id);alter table private.n1c_assignment_history add delegation_id uuid;")
 ddl=read('table-ddl-preimage-20261103.json');audit=read('runtime-preimage-20261103.json');actors=read('actor-stage-preimage-20261103.json');delegation=read('delegation-preimage-20261103.json')
 run('\n'.join(table(t) for t in ddl['tables']))
 run(table(delegation['authority_request'],'private.n1b_authority_requests'))
 for c in delegation['authority_request']['constraints']:run('alter table private.n1b_authority_requests add constraint '+c['name']+' '+c['definition'])
 constraints=[]
 for foreign in [False,True]:
  for t in ddl['tables']:
   for c in t['constraints'] or []:
    if c['definition'].startswith('FOREIGN')==foreign:constraints.append('alter table '+t['schema']+'.'+t['name']+' add constraint '+c['name']+' '+c['definition']+';')
 run('\n'.join(constraints))
 run("""
 create table public.work_item_dependencies(id uuid primary key default gen_random_uuid(),organization_id uuid,work_item_id uuid,depends_on_work_item_id uuid,created_by uuid,created_at timestamptz default now(),unique(work_item_id,depends_on_work_item_id));
 create table public.project_pipeline_configurations(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,pipeline_group_id uuid,revision integer,definition_publication_id uuid,selected_steps jsonb,selected_steps_sha256 text);
 create table public.pipeline_execution_definitions(id uuid primary key,organization_id uuid,preset_publication_id uuid,steps jsonb,steps_sha256 text);
 create table public.pipeline_execution_publications(id uuid primary key,organization_id uuid,definition_id uuid);
 create table public.living_project_documents(id uuid primary key,organization_id uuid,project_id uuid,source_version bigint);
 create table public.ai_project_memory(id uuid,organization_id uuid,project_id uuid,source_comment_id uuid);
 create table private.service_setup_leaves(organization_id uuid,service_id uuid,legacy_service_id uuid);
 create table private.qa_recurring_stage_reviews(organization_id uuid,configuration_id uuid,review jsonb);
 create function private.current_pipeline_stage_review(p_org uuid,p_configuration uuid) returns jsonb language sql stable set search_path='' as $$select review from private.qa_recurring_stage_reviews where organization_id=p_org and configuration_id=p_configuration$$;
 """)
 all_functions=audit['functions']+ddl['actor_helpers']+[x for x in actors if x['name']!='current_pipeline_stage_review']+delegation['functions']
 for t in ddl['tables']:
  for tr in t['triggers'] or []:
   all_functions.append({'signature':tr['function'],'definition':tr['function_definition'],'acl':'{postgres=X/postgres}'})
 installed=set();install_sql=[]
 for f in all_functions:
  if f['signature'] not in installed:install_sql.append(function(f));installed.add(f['signature'])
 run('\n'.join(install_sql))
 prior=(repo/'supabase/migrations/20261102193312_reviewed_pipeline_work_batches.sql').read_text(encoding='utf-8')
 start=prior.index('create function private.pipeline_work_version_bump_authorized(');end=prior.index('revoke all on function private.pipeline_work_version_bump_authorized',start)
 run(prior[start:end])
 run(';\n'.join(tr['definition'] for t in ddl['tables'] for tr in t['triggers'] or [])+';')
 run("create trigger a_derive before insert or update on public.work_items for each row execute function private.derive_engagement_project_ownership();create trigger b_revision before update on public.work_items for each row execute function private.p5_advance_row_version();create trigger zz_assignment before insert or update on public.work_items for each row execute function private.n1c_guard_assignment();create trigger recurring_provenance before update on public.work_items for each row execute function private.protect_work_item_recurring_provenance();")
 # Synthetic base service permissions; actual function EXECUTE ACLs retained above.
 run('grant usage on schema private to authenticated;grant usage on schema private,auth,public to service_role;grant all on all tables in schema public to service_role;grant all on private.n1c_assignment_history to service_role;grant select on private.n1c_recurring_delegations,private.recurring_scheduler_principals to service_role;')
 migration=next((repo/'supabase/migrations').glob('*reviewed_service_recurring_bridge.sql'));source=migration.read_text(encoding='utf-8');run(source)
 passed('full composed migration compiles against exact sixteen target schemas, existing functions and preimage checks')
 if a.compile_only:
  names=['insert_recurring_plan_version','build_recurring_period_preview','confirm_recurring_work_period','assert_scheduled_recurring_context','execute_recurring_schedule','admit_recurring_schedule','preview_recurring_work_month','n1c_assert_recurring_item','create_recurring_work_plan','create_recurring_work_plan_version','reassign_recurring_plan_template_item','mutate_p5_work_item_dependency','save_work_item_dependency','p5_require_active_actor']
  query="select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'md5',md5(pg_get_functiondef(p.oid)),'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE')) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like '%service_recurring%' or p.proname=any(array["+','.join(q(x) for x in names)+"]))"
  metadata=json.loads(run(query));baseline={x['name']:x for x in audit['functions']};actor_baseline={x['name']:x for x in actors}
  for f in metadata:
   if f['name'] in baseline:assert f['acl']==baseline[f['name']]['acl'],f['name']
   if f['name'] in ['mutate_p5_work_item_dependency','save_work_item_dependency','p5_require_active_actor']:
    assert f['md5']==actor_baseline[f['name']]['md5'] and f['acl']==actor_baseline[f['name']]['acl'],f['name']
   if f['schema']=='private' and 'service_recurring' in f['name']:assert not f['auth'] and not f['service'] and not f['anon'],f['name']
   if f['schema']=='public' and 'service_recurring' in f['name']:assert f['auth'] and not f['service'] and not f['anon'],f['name']
  assert next(f for f in metadata if f['name']=='assert_scheduled_recurring_context')['definer'] is False
  for name in ['create_recurring_work_plan','create_recurring_work_plan_version','reassign_recurring_plan_template_item']:
   assert next(f for f in metadata if f['name']==name)['definer'] is False
  helper=next(f for f in metadata if f['name']=='materialize_service_recurring_edges')
  assert helper['signature'].endswith(',uuid,uuid,text)')
  assert "p_actor_id,'manual'" in source and "p_actor_id,'scheduler'" in source
  assert "machine:=p_execution_path='scheduler'" in source
  passed('final native function metadata preserves all old ACLs, unchanged shared P5 bodies/ACLs, closed private helpers, auth-only new APIs and four retained invoker routines')
  for anchor,end,hours in [('2027-03-08','2027-03-15',167),('2027-11-01','2027-11-08',169)]:
   v=j({'frequency':'weekly','effective_start':anchor,'schedule_definition':{'service_bridge':{'version':1,'cycle_anchor':anchor}}})
   assert run('select private.service_recurring_period_end(jsonb_populate_record(null::public.recurring_work_plan_versions,'+v+'),'+q(anchor)+'::date)='+q(end)+'::date')=='t'
   assert run('select private.recurring_due_instant('+q(end)+"::timestamp,'America/New_York')-private.recurring_due_instant("+q(anchor)+"::timestamp,'America/New_York')=interval '"+str(hours)+" hours'")=='t'
  passed('actual weekly date boundaries span seven local days while New York DST changes UTC duration to167 or169hours')
  report={'passed':len(checks),'checks':checks,'migrationSHA256':hashlib.sha256(source.encode()).hexdigest(),'port':port,'original29690Touched':False,'boundary':FIXTURE_BOUNDARY,'mode':'compile-only-final-composition','functions':metadata}
  (qa/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='functions'}));raise SystemExit(0)
 org,actor,other,project,eng,brand,configuration,publication,definition,group=[uid(n) for n in range(1,11)]
 run(f"insert into auth.users values({q(actor)}),({q(other)});insert into public.organizations values({q(org)},'active');insert into public.organization_memberships values({q(org)},{q(actor)},'team','active','system_owner','content'),({q(org)},{q(other)},'team','active','contributor','content');insert into public.projects(id,organization_id,owner_id) values({q(project)},{q(org)},{q(actor)});insert into public.engagements(id,organization_id,project_id,brand_id,status,engagement_type) values({q(eng)},{q(org)},{q(project)},{q(brand)},'active','retainer');insert into public.departments values('content',{q(org)}),('design',{q(org)}),('marketing',{q(org)});")
 quantity_value=3 if scheduler_fixture else 12;frequency='weekly' if scheduler_fixture else 'monthly';zone='America/New_York' if scheduler_fixture else 'Asia/Karachi'
 scheduler_due=json.loads(run("select jsonb_build_object('local_time',to_char(date_trunc('minute',clock_timestamp()+interval '3 minutes') at time zone 'America/New_York','HH24:MI'),'due',date_trunc('minute',clock_timestamp()+interval '3 minutes'),'period',(date_trunc('minute',clock_timestamp()+interval '3 minutes') at time zone 'America/New_York')::date)")) if scheduler_fixture else None
 start_date=scheduler_due['period'] if scheduler_fixture else '2028-01-31'
 target_date=run("select "+q(start_date)+"::date+300") if scheduler_fixture else '2028-12-01'
 line={'catalogue_version':1,'service_group':'marketing','start_date':start_date,'target_date':target_date,'timezone':zone,'generation_horizon':2,'scope_statement':'Twelve shared social posts monthly','exclusions':'Paid distribution excluded'}
 if scheduler_fixture:line['scope_statement']='Three shared social posts weekly'
 contributions=[];steps=[]
 for i,department in enumerate(['content','design','marketing'],1):
  scope,service,es=uid(100+i),uid(110+i),uid(120+i)
  item={'scope_id':scope,'service_id':service,'quantity':quantity_value,'unit':'posts','cadence':frequency,'pipeline':'marketing','deliverable_key':'social_posts','channels':['instagram','facebook'],'service_line':line}
  contributions.append(item);steps.append({'key':department,'service_id':service,'department_id':department,'depends_on':[] if i==1 else [['content','design','marketing'][i-2]]})
  run(f"insert into public.service_catalog values({q(service)},{q(org)},{q(department)},true,{q(department.title())},'posts');insert into public.engagement_services(id,organization_id,engagement_id,service_id,owner_id,status,activated_by) values({q(es)},{q(org)},{q(eng)},{q(service)},{q(actor)},'active',{q(actor)});insert into public.project_service_scopes(id,organization_id,project_id,service_id,status,scope_statement,exclusions,quantity,owner_id,start_date,target_date,engagement_service_id,created_by,unit,recurrence,source) values({q(scope)},{q(org)},{q(project)},{q(service)},'active',{q(line['scope_statement'])},{q(line['exclusions'])},{quantity_value},{q(actor)},{q(start_date)},{q(target_date)},{q(es)},{q(actor)},'posts',{q(frequency)},'project_setup');")
 selected_scope=contributions[0]['scope_id']
 snapshot={'groups':[{'bucket_key':'fixture-exact-existing-bucket','pipeline_group_id':group,'definition_publication_id':publication,'contributions':contributions}]}
 run(f"insert into private.project_setup_state(organization_id,project_id,plan,updated_by,revision) values({q(org)},{q(project)},{j({'contributions':[{k:v for k,v in x.items() if k!='scope_id'} for x in contributions]})},{q(actor)},1);insert into private.project_delivery_plan_versions(organization_id,project_id,engagement_id,version_number,snapshot,request_id,request_sha256,created_by) values({q(org)},{q(project)},{q(eng)},1,{j(snapshot)},{q(uid(500))},repeat('a',64),{q(actor)});insert into public.pipeline_execution_definitions values({q(definition)},{q(org)},{q(uid(600))},{j(steps)},encode(sha256(convert_to({j(steps)}::text,'UTF8')),'hex'));insert into public.pipeline_execution_publications values({q(publication)},{q(org)},{q(definition)});insert into public.project_pipeline_configurations values({q(configuration)},{q(org)},{q(project)},{q(eng)},{q(group)},1,{q(publication)},{j([x['key'] for x in steps])},encode(sha256(convert_to({j([x['key'] for x in steps])}::text,'UTF8')),'hex'));")
 stage={'review_sha256':'b'*64,'decisions':[{'key':x['key'],'action':'run','quantity':quantity_value} for x in steps],'resolved_artifacts':[]}
 run(f'insert into private.qa_recurring_stage_reviews values({q(org)},{q(configuration)},{j(stage)})')
 if not scheduler_fixture:
  args=','.join(q(x) for x in [org,project,eng,selected_scope])+',null'
  review=value('select public.get_service_recurring_plan_context('+args+')',who=actor)
  assert (review['compiled']['deliverable_count'],review['compiled']['work_card_count'],review['compiled']['dependency_count'])==(12,36,24)
  passed('actual source reader resolves saved groups/pipeline_group_id and service metadata without synthetic bundles or scope metadata fields')
  proposal=review['proposal'];request=uid(700)
  sql='select public.apply_service_recurring_plan('+args+','+j(proposal)+','+q(review['review_sha256'])+','+q(request)+')'
  deny(sql,who=other);passed('wrong current service owner cannot save reviewed plan')
  result=value(sql,who=actor);assert not result['work_created'] and not result['activation_performed'];passed('actual authenticated API and lower writer save immutable 36-template draft with no Work or activation')
  assert value(sql,who=actor)==result;passed('exact request replays original result after head change')
  plan=result['plan_id'];version=result['plan_version_id']
  assert run('select count(*) from public.recurring_schedule_consents')=='0';passed('no scheduler consent inferred')
  call(f'select public.approve_recurring_work_plan_version({q(plan)},{q(version)},\'Reviewed native fixture only\',{q(actor)})',role='service_role')
  call(f'select public.transition_recurring_work_plan({q(plan)},\'active\',\'Local fixture approval\',\'No provider execution\',{q(actor)})',role='service_role')
  generation=f'select public.confirm_recurring_work_period({q(plan)},\'2028-01-31\',{q(uid(710))},\'Explicit native historical fixture\',{q(actor)})'
  deny(generation,role='service_role');passed('actual generation denies missing exact-version PM/admin delegation')
  delegation_review=value(f'select public.get_recurring_assignment_delegation({q(org)},{q(project)},{q(version)})',who=actor)
  value(f'select public.change_recurring_assignment_delegation({q(org)},{q(project)},{q(version)},true,{q(delegation_review["token"])},{q(uid(720))})',who=actor)
  cycle=value(generation,role='service_role');assert len(cycle['work_items'])==36 and cycle['period_end']=='2028-02-29'
  assert run('select count(*) from public.work_item_dependencies')=='24'
  assert run("select count(*) from public.work_items where start_date='2028-01-31' and due_date='2028-02-28' and assignee_id is null")=='36'
  passed('actual owner approval, exact-version delegation and active-plan generation create 36 unassigned cards with 24 canonical P5 DAG edges for 12 deliverables')
  assert value(generation,role='service_role')==cycle;passed('exact generation retry is read-only and preserves original occurrence and cards')
  assert all(' - ' in w['title'] and '\u00c2' not in w['title'] for w in cycle['work_items']);passed('native UTF8 transport preserves reviewed card titles')
  deny('select public.get_service_recurring_plan_context('+args+')',who=uid(999));passed('non-member source read denied')
  deny('select public.get_service_recurring_plan_context('+args+')',role='anon');passed('anonymous bridge API execute denied')
  changed=j({**proposal,'effective_start':'2028-02-29'})
  deny('select public.apply_service_recurring_plan('+args+','+changed+','+q(review['review_sha256'])+','+q(request)+')',code='23505',who=actor);passed('original request cannot be reused for changed payload')
  recover=value('select public.recover_service_recurring_plan('+','.join(q(x) for x in [org,project,eng,request])+')',who=actor)
  assert recover['original_result']==result;passed('read-only recovery returns original actor-owned receipt')
  deny(generation.replace('2028-01-31','2028-03-31').replace(uid(710),uid(711)),code='22023',role='service_role');passed('new cycle beyond finite reviewed horizon denied')
  feb=value(generation.replace('2028-01-31','2028-02-29').replace(uid(710),uid(712)),role='service_role')
  assert feb['period_end']=='2028-03-31' and len(feb['work_items'])==36 and all(x['due_date']=='2028-03-30' for x in feb['work_items']);passed('actual February cycle preserves original January31 anchor into March31')
  assert run('select count(*) from public.work_items')=='72' and run('select count(*) from public.work_item_dependencies')=='48'
  old_history=run("select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.work_items w")
  before_edit=value('select public.get_service_recurring_plan_context('+args+')',who=actor)
  assert before_edit['proposal']['effective_start']=='2028-03-31';passed('next proposal begins after generated history using canonical source anchor')
  for item in contributions:item['quantity']=15
  snapshot['groups'][0]['contributions']=contributions
  run(f"update public.project_service_scopes set quantity=15 where organization_id={q(org)} and project_id={q(project)};update private.project_setup_state set plan={j({'contributions':[{k:v for k,v in x.items() if k!='scope_id'} for x in contributions]})},revision=revision+1 where organization_id={q(org)} and project_id={q(project)};insert into private.project_delivery_plan_versions(organization_id,project_id,engagement_id,version_number,parent_version_id,snapshot,request_id,request_sha256,created_by) select organization_id,project_id,engagement_id,2,id,{j(snapshot)},{q(uid(501))},repeat('c',64),created_by from private.project_delivery_plan_versions where organization_id={q(org)} and project_id={q(project)} and version_number=1;")
  stage['decisions']=[{**x,'quantity':15} for x in stage['decisions']];stage['review_sha256']='c'*64
  run(f'update private.qa_recurring_stage_reviews set review={j(stage)} where configuration_id={q(configuration)};update public.project_pipeline_configurations set revision=2 where id={q(configuration)}')
  stale_apply='select public.apply_service_recurring_plan('+args+','+j(before_edit['proposal'])+','+q(before_edit['review_sha256'])+','+q(uid(730))+')'
  deny(stale_apply,code='40001',who=actor);passed('changed canonical source and exact stage review deny stale save CAS')
  # An existing occurrence is historical recovery even when current source changes.
  assert value(generation,role='service_role')==cycle;passed('source edits preserve original generated cycle and original request recovery')
  current=value('select public.get_service_recurring_plan_context('+args+')',who=actor)
  assert (current['compiled']['deliverable_count'],current['compiled']['work_card_count'],current['compiled']['dependency_count'])==(15,45,30)
  result2=value('select public.apply_service_recurring_plan('+args+','+j(current['proposal'])+','+q(current['review_sha256'])+','+q(uid(731))+')',who=actor)
  assert result2['plan_id']==plan and result2['plan_version_number']==2;passed('edited service intent creates a future immutable version in the same existing plan')
  march_sql=generation.replace('2028-01-31','2028-03-31').replace(uid(710),uid(740))
  deny(march_sql,code='22023',role='service_role');passed('unapproved future draft is never adopted by generation')
  version2=result2['plan_version_id']
  call(f'select public.approve_recurring_work_plan_version({q(plan)},{q(version2)},\'Native future version only\',{q(actor)})',role='service_role')
  deny(march_sql,role='service_role');passed('prior-version delegation does not authorize newly approved version')
  delegation2=value(f'select public.get_recurring_assignment_delegation({q(org)},{q(project)},{q(version2)})',who=actor)
  value(f'select public.change_recurring_assignment_delegation({q(org)},{q(project)},{q(version2)},true,{q(delegation2["token"])},{q(uid(741))})',who=actor)
  march=value(march_sql,role='service_role');assert len(march['work_items'])==45 and march['period_end']=='2028-04-30'
  assert old_history==run("select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.work_items w where start_date<'2028-03-31'");passed('new approved 15-deliverable version generates 45 cards and preserves all previous cards byte-for-byte')
  april_sql=generation.replace('2028-01-31','2028-04-30').replace(uid(710),uid(750))
  baseline_counts=run('select jsonb_build_array((select count(*) from public.work_items),(select count(*) from public.work_item_dependencies),(select count(*) from public.recurring_work_occurrences),(select count(*) from public.recurring_work_generation_attempts))')
  run("create function private.qa_recurring_late_edge() returns trigger language plpgsql as $$begin if exists(select 1 from public.work_items where id=new.work_item_id and start_date='2028-04-30') and (select count(*) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.start_date='2028-04-30')>=2 then raise exception 'Local fixture late edge rejection';end if;return new;end;$$;create trigger qa_late_edge before insert on public.work_item_dependencies for each row execute function private.qa_recurring_late_edge();")
  deny(april_sql,code='P0001',role='service_role')
  assert baseline_counts==run('select jsonb_build_array((select count(*) from public.work_items),(select count(*) from public.work_item_dependencies),(select count(*) from public.recurring_work_occurrences),(select count(*) from public.recurring_work_generation_attempts))');passed('late canonical DAG failure atomically rolls back cards, edges, occurrence and attempt while preserving earlier history')
  run('drop trigger qa_late_edge on public.work_item_dependencies')
  with ThreadPoolExecutor(max_workers=2) as pool:parallel=list(pool.map(lambda _:value(april_sql,role='service_role'),range(2)))
  assert parallel[0]==parallel[1] and len(parallel[0]['work_items'])==45
  assert run("select count(*) from public.recurring_work_occurrences where period_start='2028-04-30'")=='1';passed('observed concurrent exact cycle requests create one occurrence and one set of 45 cards')
  assert run('select count(*) from public.work_items')=='162' and run('select count(*) from public.work_item_dependencies')=='108';passed('four exact cycles retain 54 deliverables as 162 separate departmental cards and 108 scoped edges')
  content_manager,design_manager=uid(800),uid(801)
  run(f"insert into auth.users values({q(content_manager)}),({q(design_manager)});insert into public.organization_memberships values({q(org)},{q(content_manager)},'team','active','department_manager','content'),({q(org)},{q(design_manager)},'team','active','department_manager','design')")
  design_key=run(f"select template_key from public.recurring_work_plan_template_items where plan_version_id={q(version2)} and department_id='design' order by position limit 1")
  deny(f'select public.reassign_recurring_plan_template_item({q(plan)},{q(design_key)},{q(other)},{q(content_manager)})',role='service_role');passed('primary service department manager cannot reassign another contribution department')
  reassigned=value(f'select to_jsonb(public.reassign_recurring_plan_template_item({q(plan)},{q(design_key)},{q(other)},{q(design_manager)}))',role='service_role')
  assert reassigned['version_number']==3
  assert run(f"select count(*) from public.recurring_work_plan_template_items where plan_version_id={q(reassigned['id'])} and default_assignee_id={q(other)} and department_id='design'")=='1'
  assert run('select count(*) from public.work_items')=='162';passed('actual target-department manager reassignment creates only a new unapproved version, preserving generated Work')
  deny(f"select public.create_recurring_work_plan_version({q(plan)},v.title,v.scope,v.frequency,v.timezone,v.effective_start,v.effective_end,'{{}}'::jsonb,{j(current['compiled']['template_items'])},{q(actor)}) from public.recurring_work_plan_versions v where v.id={q(version2)}",code='55000',role='service_role');passed('ordinary lower version writer cannot strip bridge binding into legacy mode')
 elif a.path_conflict_only:
  case_file=repo/'tools/check-service-recurring-path-conflict-cases.py'
  exec(compile(case_file.read_text(encoding='utf-8'),str(case_file),'exec'),globals())
 else:
  case_file=repo/'tools/check-service-recurring-scheduler-cases.py'
  exec(compile(case_file.read_text(encoding='utf-8'),str(case_file),'exec'),globals())
 report={'passed':len(checks),'checks':checks,'migrationSHA256':hashlib.sha256(source.encode()).hexdigest(),'port':port,'original29690Touched':False,'boundary':FIXTURE_BOUNDARY,'mode':'path-conflict-only' if a.path_conflict_only else ('scheduler-only' if a.scheduler_only else 'manual-server')}
 (qa/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=True))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
