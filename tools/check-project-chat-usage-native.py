"""Isolated PG17 policy checks: actual captured reserve/claim/model/owner functions,
synthetic minimal base tables and auth.uid fixture. No production business writes,
provider calls, live activation, complete RLS or authenticated app acceptance.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse,json,subprocess,os,socket,time,hashlib
p=argparse.ArgumentParser();p.add_argument('--qa',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--preimages',required=True);p.add_argument('--policy-preimages',required=True);a=p.parse_args()
repo=Path(__file__).resolve().parents[1];parent=Path(a.preimages);qa=Path(a.qa);data=qa/'data';bin=Path(a.pgbin);port=29982;started=False;checks=[]
assert not data.exists();qa.mkdir(parents=True,exist_ok=True);os.environ['PGCLIENTENCODING']='UTF8'
with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0
def control(args):
 with (qa/'control.log').open('a',encoding='utf-8') as log:
  r=subprocess.run([str(x) for x in args],stdout=log,stderr=subprocess.STDOUT,creationflags=0x08000000,timeout=40);assert r.returncode==0
def raw(sql):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql+'\n',capture_output=True,text=True,encoding='utf-8',creationflags=0x08000000,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf-8') as log:log.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql):
 r=raw(sql);assert r.returncode==0,r.stderr;return r.stdout.strip()
u=lambda n:'8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25' if n==1 else f'bb000000-0000-4000-8000-{n:012d}'
q=lambda x:'null' if x is None else "'"+str(x).replace("'","''")+"'"
def actor(sql,who=2):return "set qa.actor="+q(u(who))+';'+sql
def preview(cap=100,seconds=3600,who=2):return json.loads(run(actor(f'select public.preview_project_chat_allowance({q(u(1))},{q(u(3))},{q(u(4))},{cap},{seconds})',who)))
def apply(req,action,cap=None,seconds=None,review=None,policy=None,who=2):
 return actor('select public.apply_project_chat_allowance('+','.join([q(u(1)),q(u(req)),q(action),q(u(3)) if action=='activate' else 'null',q(u(4)) if action=='activate' else 'null',str(cap) if cap is not None else 'null',str(seconds) if seconds is not None else 'null',q(review),q(policy)])+')',who)
def reserve(message,cost=40,who=2,conversation=5):return 'select public.reserve_context_chat_budget('+','.join(map(q,[u(1),u(conversation),u(message),u(4),u(who)]))+','+str(cost)+')'
def claim(message,request):return 'select public.claim_context_chat_dispatch('+','.join(map(q,[u(1),u(message),u(2),u(request),'a'*64]))+')'
def context(cost=0,project=3,who=2,model=4):return json.loads(run('select private.project_chat_allowance_context('+','.join(map(q,[u(1),u(who),u(project),u(model)]))+','+str(cost)+')'))
def denied(sql,code):assert code in raw(sql).stderr
def passed(name):checks.append(name)
try:
 control([bin/'initdb.exe','-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale'])
 control([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 run('''create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.actor',true),'')::uuid$$;
 create table public.organizations(id uuid primary key,status text);
 create table public.organization_memberships(organization_id uuid,user_id uuid,status text,member_kind text,role text,department_id text);
 create table public.projects(id uuid,organization_id uuid,archived_at timestamptz);
 create table public.organization_department_memberships(organization_id uuid,user_id uuid,department_id text,status text);
 create table public.department_chat_conversations(id uuid,organization_id uuid,owner_id uuid,context_kind text,project_id uuid,department_id text,state text);
 create table public.department_chat_messages(id uuid,organization_id uuid,conversation_id uuid,owner_id uuid,author_id uuid,role text,status text);
 create table public.context_chat_organization_models(id uuid,organization_id uuid,connector_connection_id uuid,model_id text,revoked_at timestamptz);
 create table public.integration_connections(id uuid,organization_id uuid,provider text,status text,archived_at timestamptz,secret_name text,public_config jsonb);
 create table public.integration_connection_engagements(connection_id uuid,organization_id uuid);
 create table public.integration_connection_departments(connection_id uuid,organization_id uuid);
 create table private.ai_execution_budget_limits(organization_id uuid primary key,monthly_limit_microusd bigint,configured_at timestamptz default clock_timestamp(),spend_guard_mode text);
 create table private.ai_execution_budget_reservations(id uuid primary key,organization_id uuid,actor_id uuid,run_plan_id uuid,design_media_job_id uuid,design_video_job_id uuid,cycle_month date,status text,actual_cost_microusd bigint,ai_run_id uuid,max_cost_microusd bigint);
 create table private.ai_execution_step_budget_reservations(id uuid primary key default gen_random_uuid(),organization_id uuid,actor_id uuid,context_chat_message_id uuid,context_chat_conversation_id uuid,context_chat_model_configuration_id uuid,cycle_month date,status text,actual_cost_microusd bigint,ai_run_id uuid,max_cost_microusd bigint,unique(organization_id,context_chat_message_id));
 create table private.ai_execution_step_budget_events(id uuid default gen_random_uuid(),reservation_id uuid,organization_id uuid,transition text,evidence text not null default '',actual_cost_microusd bigint);
 create table private.context_chat_dispatch_claims(id uuid default gen_random_uuid(),organization_id uuid,reservation_id uuid unique,conversation_id uuid,message_id uuid,model_configuration_id uuid,actor_id uuid,dispatch_request_id uuid,prompt_sha256 text);
 create table public.ai_runs(id uuid,organization_id uuid,status text,estimated_cost_microusd bigint,created_at timestamptz);
 create table private.design_media_generation_jobs(id uuid,organization_id uuid,actor_id uuid,status text,request jsonb,provider_receipt jsonb,quote_id uuid,claim_id uuid,created_at timestamptz);
 create table private.design_media_quotes(id uuid,organization_id uuid,actor_id uuid,price_basis text,request_checksum text);
 create table private.design_media_test_debits(reservation_id uuid,organization_id uuid,job_id uuid,actor_id uuid,amount_microusd bigint,created_at timestamptz);
 create table private.design_media_test_budgets(organization_id uuid,estimated_risk_accepted_by uuid,estimated_risk_accepted_at timestamptz,estimated_valid_until timestamptz);
 ''')
 audit=json.loads((parent/'prospective-policy-preimage.json').read_text(encoding='utf-8'))
 run('alter table private.ai_execution_budget_limits enable row level security;revoke all on private.ai_execution_budget_limits from public,anon,authenticated,service_role')
 for f in audit['functions']:
  run(f['definition']);run('revoke all on function public.'+f['signature']+' from public,anon,authenticated,service_role;grant execute on function public.'+f['signature']+' to service_role')
 run(json.loads((parent/'owner-scope-preimage.json').read_text(encoding='utf-8'))['definition'])
 migration=next((repo/'supabase/migrations').glob('*project_chat_prospective_allowance.sql'));source=migration.read_text(encoding='utf-8');run(source)
 passed('exact captured reserve/claim/model plus actual owner guard and local migration compile')
 run(f"""insert into public.organizations values({q(u(1))},'active');
 insert into public.organization_memberships values({q(u(1))},{q(u(2))},'active','team','system_owner',null),({q(u(1))},{q(u(9))},'active','team','operations_admin',null);
 insert into public.projects values({q(u(3))},{q(u(1))},null),({q(u(8))},{q(u(1))},null);
 insert into public.integration_connections values({q(u(6))},{q(u(1))},'openai','verified',null,'FIXTURE_NO_CREDENTIAL','{{"model_id":"fixture-text"}}');
 insert into public.context_chat_organization_models values({q(u(4))},{q(u(1))},{q(u(6))},'fixture-text',null);
 insert into public.department_chat_conversations values({q(u(5))},{q(u(1))},{q(u(2))},'project_team',{q(u(3))},null,'active'),({q(u(7))},{q(u(1))},{q(u(2))},'department_private',null,'design','active');
 insert into private.ai_execution_budget_limits(organization_id,spend_guard_mode) values({q(u(1))},'provider_managed');
 insert into private.ai_execution_budget_reservations values({q(u(10))},{q(u(1))},{q(u(2))},null,{q(u(11))},null,date_trunc('month',timezone('UTC',clock_timestamp()))::date-interval '1 month','uncertain',null,null,999);
 insert into private.design_media_generation_jobs values({q(u(11))},{q(u(1))},{q(u(2))},'ready','{{"provider":"higgsfield"}}','{{"state":"provider_completed","requestId":"synthetic"}}',{q(u(12))},{q(u(13))},clock_timestamp()-interval '10 days');
 insert into private.design_media_quotes values({q(u(12))},{q(u(1))},{q(u(2))},'estimated','fixture');
 insert into private.design_media_test_debits values({q(u(10))},{q(u(1))},{q(u(11))},{q(u(2))},999,clock_timestamp()-interval '10 days');
 insert into private.design_media_test_budgets values({q(u(1))},{q(u(2))},clock_timestamp()-interval '11 days',clock_timestamp()-interval '9 days');""")
 for n in range(20,40):run(f"insert into public.department_chat_messages values({q(u(n))},{q(u(1))},{q(u(5))},{q(u(2))},{q(u(2))},'user','completed')")

 # Actual current functions are installed over the retained allowance baseline.
 current=json.loads(Path(a.policy_preimages).read_text(encoding='utf-8'))
 for f in current:
  run(f['definition'])
  sig=f['signature'] if '.' in f['signature'] else f['schema']+'.'+f['signature']
  run('revoke all on function '+sig+' from public,anon,authenticated,service_role')
  if f['schema']=='public':run('grant execute on function '+sig+' to service_role')
 run("alter table public.organizations add column name text;update public.organizations set name='Anka Sphere';")
 run("alter table private.ai_execution_step_budget_reservations add column outcome_evidence text not null default '',add column reconciled_at timestamptz;")
 run("alter table public.ai_runs add column user_id uuid,add column capability text,add column context_chat_conversation_id uuid,add column context_chat_message_id uuid,add column context_chat_model_configuration_id uuid;")
 run(f"""insert into public.organizations values({q(u(101))},'active','Other organization');
 insert into public.organization_memberships values({q(u(101))},{q(u(2))},'active','team','system_owner',null);
 insert into public.projects values({q(u(102))},{q(u(101))},null);
 insert into public.integration_connections values({q(u(103))},{q(u(101))},'openai','verified',null,'FIXTURE_NO_CREDENTIAL','{{"model_id":"fixture-text"}}');
 insert into public.context_chat_organization_models values({q(u(104))},{q(u(101))},{q(u(103))},'fixture-text',null);
 insert into private.ai_execution_budget_limits(organization_id,spend_guard_mode,monthly_limit_microusd) values({q(u(101))},'local_monthly_cap',1);
 insert into public.department_chat_conversations values({q(u(105))},{q(u(101))},{q(u(2))},'project_team',{q(u(102))},null,'active');
 insert into public.department_chat_messages values({q(u(106))},{q(u(101))},{q(u(105))},{q(u(2))},{q(u(2))},'user','completed');
 update private.ai_execution_budget_limits set spend_guard_mode='local_monthly_cap',monthly_limit_microusd=1 where organization_id={q(u(1))};
 insert into public.ai_runs(id,organization_id,status,estimated_cost_microusd,created_at) values({q(u(199))},{q(u(1))},'completed',null,clock_timestamp());""")
 historical=run("select md5(jsonb_agg(to_jsonb(r) order by id)::text) from private.ai_execution_budget_reservations r")
 migration=next((repo/'supabase/migrations').glob('*project_chat_usage_only_policy.sql'));source=migration.read_text(encoding='utf-8')
 run(f"insert into public.organizations values({q(u(900))},'active','Anka Sphere')")
 denied(source,'P0001')
 assert run("select count(*) from information_schema.columns where table_schema='private' and table_name='ai_execution_budget_limits' and column_name='project_chat_spend_mode'")=='0'
 run(f"delete from public.organizations where id={q(u(900))}")
 passed('ambiguous business scope aborts entire additive migration without leaving a column')
 run(source)
 passed('actual current preimages and additive scoped migration compile with default guarded for other organization')
 def policy(project=3,who=2,model=4,conversation=None):
  return "select public.read_project_chat_spend_policy("+','.join(map(q,[u(1),u(who),u(model),u(conversation) if conversation else None,u(project) if project else None]))+")"
 assert json.loads(run(policy()))['mode']=='usage_only'
 assert json.loads(run(policy(conversation=5)))['mode']=='usage_only'
 assert json.loads(run(policy(project=None,conversation=7)))['mode']=='guarded'
 denied(policy(project=999),'42501');denied(policy(model=999),'23514');denied(policy(project=8,conversation=5),'42501')
 passed('normal policy reader validates canonical project/model/conversation and never reclassifies private department chat')
 for role in ['anon','authenticated']:
  assert run(f"select has_function_privilege('{role}','public.read_project_chat_spend_policy(uuid,uuid,uuid,uuid,uuid)','execute')")=='f'
 assert run("select has_function_privilege('service_role','public.read_project_chat_spend_policy(uuid,uuid,uuid,uuid,uuid)','execute')")=='t'
 assert run("select has_function_privilege('service_role','private.project_chat_usage_only_context(uuid,uuid,uuid,uuid)','execute')")=='f'
 passed('new public RPC service-only; private invoker helper directly closed')
 first=json.loads(run(reserve(20)));assert first['status']=='reserved'
 assert run(f"select max_cost_microusd from private.ai_execution_step_budget_reservations where context_chat_message_id={q(u(20))}")=='40'
 assert run("select evidence from private.ai_execution_step_budget_events")=='project_chat_usage_only'
 assert json.loads(run(reserve(20)))['idempotent_replay'];denied(reserve(20,cost=41),'23505')
 passed('new scoped text records exact reservation above cap despite old uncertain and current unknown costs; replay immutable')
 denied(reserve(21,who=9),'42501')
 run(f"update public.context_chat_organization_models set revoked_at=now() where id={q(u(4))}")
 denied(reserve(21),'23514');run(f"update public.context_chat_organization_models set revoked_at=null where id={q(u(4))}")
 run(f"update public.projects set archived_at=now() where id={q(u(3))}")
 denied(reserve(21),'42501');run(f"update public.projects set archived_at=null where id={q(u(3))}")
 passed('nonowner, revoked model and archived project denied at normal reservation entry')
 run(f"insert into public.department_chat_messages values({q(u(120))},{q(u(1))},{q(u(7))},{q(u(2))},{q(u(2))},'user','completed')")
 denied(reserve(120,conversation=7),'55000')
 other='select public.reserve_context_chat_budget('+','.join(map(q,[u(101),u(105),u(106),u(104),u(2)]))+',40)'
 denied(other,'22003')
 passed('private department unknown-cost gate and other organization monthly cap remain unchanged')
 assert json.loads(run(claim(20,220)))['must_not_submit']==False
 assert json.loads(run(claim(20,220)))['must_not_submit']==True
 denied(claim(20,221),'23505')
 passed('one dispatch claim; exact original recovery is check-only and different identity denied')
 run(reserve(22))
 run(f"update private.ai_execution_budget_limits set project_chat_spend_mode='guarded' where organization_id={q(u(1))}")
 denied(claim(22,222),'55000')
 run(f"update private.ai_execution_budget_limits set project_chat_spend_mode='usage_only' where organization_id={q(u(1))}")
 assert json.loads(run(claim(22,222)))['must_not_submit']==False
 passed('policy withdrawal between reservation and claim denies dispatch; explicit current policy required')
 run(reserve(23))
 with ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(lambda _:json.loads(run(claim(23,223))),range(2)))
 assert sorted(x['must_not_submit'] for x in results)==[False,True]
 assert run(f"select count(*) from private.context_chat_dispatch_claims where message_id={q(u(23))}")=='1'
 passed('observed duplicate claim race yields exactly one submit authority')
 with ThreadPoolExecutor(max_workers=2) as pool:
  withdrawal=pool.submit(run,f"set application_name='usage-policy-withdraw';begin;update private.ai_execution_budget_limits set project_chat_spend_mode='guarded' where organization_id={q(u(1))};select pg_sleep(1.5);commit;")
  for _ in range(80):
   if run("select count(*) from pg_stat_activity where application_name='usage-policy-withdraw' and wait_event='PgSleep'")=='1':break
   time.sleep(.01)
  else:raise AssertionError('withdrawal lock not observed')
  request=pool.submit(raw,reserve(24))
  observed=False
  for _ in range(80):
   if run("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%select public.reserve_context_chat_budget(%'")!='0':observed=True;break
   time.sleep(.01)
  withdrawal.result();result=request.result()
 assert observed and '55000' in result.stderr
 assert run(f"select count(*) from private.ai_execution_step_budget_reservations where context_chat_message_id={q(u(24))}")=='0'
 run(f"update private.ai_execution_budget_limits set project_chat_spend_mode='usage_only' where organization_id={q(u(1))}")
 passed('observed withdrawal-vs-reservation lock race rechecks policy after waiting and makes no stale reservation')
 run(f"""insert into public.ai_runs(id,organization_id,user_id,status,capability,estimated_cost_microusd,created_at,context_chat_conversation_id,context_chat_message_id,context_chat_model_configuration_id)
 values({q(u(300))},{q(u(1))},{q(u(2))},'completed','context_chat_answer',7,clock_timestamp(),{q(u(5))},{q(u(20))},{q(u(4))});""")
 settle='select public.reconcile_context_chat_budget('+','.join(map(q,[u(1),u(20),'settled']))+',7,'+q(u(300))+",'Synthetic verified token-rate usage')"
 assert json.loads(run(settle))['status']=='settled'
 assert json.loads(run(settle))['idempotent_replay']==True
 denied(settle.replace(',7,',',8,'),'23505')
 assert run(f"select actual_cost_microusd from private.ai_execution_step_budget_reservations where context_chat_message_id={q(u(20))}")=='7'
 passed('actual reconciler records calculated usage against exact audited run and immutable idempotent settlement')
 unknown='select public.reconcile_context_chat_budget('+','.join(map(q,[u(1),u(22),'uncertain']))+",null,null,'Synthetic response unknown')"
 assert json.loads(run(unknown))['status']=='uncertain'
 denied(claim(22,999),'23505')
 assert json.loads(run(reserve(25)))['status']=='reserved'
 assert run(f"select count(*) from private.ai_execution_step_budget_reservations where context_chat_message_id={q(u(22))} and status='uncertain' and actual_cost_microusd is null")=='1'
 passed('unknown outcome remains unknown without duplicate submission while separate new usage request can proceed')
 result=raw('begin;'+reserve(26)+';'+claim(26,226)+';select 1/0;commit;')
 assert result.returncode!=0
 assert run(f"select count(*) from private.ai_execution_step_budget_reservations where context_chat_message_id={q(u(26))}")=='0'
 passed('late transaction failure rolls reservation/event/claim back atomically')
 assert run("select md5(jsonb_agg(to_jsonb(r) order by id)::text) from private.ai_execution_budget_reservations r")==historical
 assert run(f"select count(*) from public.ai_runs where id={q(u(199))} and estimated_cost_microusd is null")=='1'
 passed('historical uncertain liabilities and unmeasured completed costs remain byte-identical/unresolved')
 report={'passed':len(checks),'checks':checks,'boundary':__doc__,'productionMutation':False,'providerCalls':False}
 (qa/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
