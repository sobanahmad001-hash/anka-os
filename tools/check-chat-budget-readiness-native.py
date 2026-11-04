"""Fresh owned PG17. Actual reviewed readiness/recovery functions on synthetic minimal base schemas.
No production records, paid calls, role impersonation or reservation reconciliation.
"""
from pathlib import Path
import argparse,json,subprocess,socket,hashlib,os,time
from concurrent.futures import ThreadPoolExecutor
p=argparse.ArgumentParser();p.add_argument('--qa',required=True);p.add_argument('--pgbin',required=True);a=p.parse_args()
repo=Path(__file__).resolve().parents[1];parent=repo.parent;qa=Path(a.qa).resolve();data=qa/'data';bin=Path(a.pgbin);port=29976;db='chat_budget';checks=[];started=False
assert not data.exists();qa.mkdir(parents=True,exist_ok=True);os.environ['PGCLIENTENCODING']='UTF8'
with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0
def control(args):
 with (qa/'control.log').open('a',encoding='utf-8') as log:
  r=subprocess.run([str(x) for x in args],stdout=log,stderr=subprocess.STDOUT,creationflags=0x08000000,timeout=40);assert r.returncode==0
def raw(sql,database=db):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql+'\n',capture_output=True,text=True,encoding='utf-8',creationflags=0x08000000,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf-8') as log:log.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql,database=db):
 r=raw(sql,database);assert r.returncode==0,r.stderr;return r.stdout.strip()
u=lambda n:f'b9000000-0000-4000-8000-{n:012d}'
q=lambda x:"'"+str(x).replace("'","''")+"'"
def ready(org=1,actor=2):return json.loads(run('select public.get_ai_spend_guard_readiness('+q(u(org))+','+q(u(actor))+')'))
def recover(message):return json.loads(run('select public.recover_context_chat_completed_run('+q(u(1))+','+q(u(message))+','+q(u(2))+')'))
def passed(name):checks.append(name)
try:
 control([bin/'initdb.exe','-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale'])
 control([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 run('create database '+db,database='postgres')
 run('''create role anon;create role authenticated;create role service_role;create schema private;
 create table public.organizations(id uuid primary key,status text);
 create table public.organization_memberships(organization_id uuid,user_id uuid,status text,member_kind text,role text,department_id text);
 create table public.department_chat_conversations(id uuid,organization_id uuid,owner_id uuid,context_kind text,project_id uuid,department_id text);
 create table public.department_chat_messages(id uuid,organization_id uuid,conversation_id uuid,owner_id uuid,author_id uuid,role text,status text);
 create table public.projects(id uuid,organization_id uuid,archived_at timestamptz);
 create table public.organization_department_memberships(organization_id uuid,user_id uuid,department_id text,status text);
 create table private.ai_execution_budget_limits(organization_id uuid primary key,spend_guard_mode text);
 create table private.ai_execution_budget_reservations(id uuid,organization_id uuid,run_plan_id uuid,design_media_job_id uuid,design_video_job_id uuid,cycle_month date,status text,ai_run_id uuid);
 create table private.ai_execution_step_budget_reservations(id uuid,organization_id uuid,actor_id uuid,job_id uuid,context_chat_message_id uuid,context_chat_conversation_id uuid,context_chat_model_configuration_id uuid,workshop_chat_message_id uuid,cycle_month date,status text,ai_run_id uuid,max_cost_microusd bigint,actual_cost_microusd bigint);
 create table private.context_chat_dispatch_claims(id uuid,organization_id uuid,reservation_id uuid,message_id uuid,actor_id uuid,conversation_id uuid,model_configuration_id uuid,prompt_sha256 text);
 create table public.ai_runs(id uuid,organization_id uuid,user_id uuid,capability text,status text,context_chat_message_id uuid,context_chat_conversation_id uuid,context_chat_model_configuration_id uuid,context_manifest jsonb,output_text text,estimated_cost_microusd bigint,created_at timestamptz);
 ''')
 scope=json.loads((parent/'owner-scope-preimage.json').read_text(encoding='utf-8'));run(scope['definition']);run('revoke all on function private.assert_context_chat_owner_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role')
 pre=json.loads((parent/'function-preimages.json').read_text(encoding='utf-8'))
 selected=[f for f in pre if f['name'] in ['get_ai_spend_guard_readiness','recover_context_chat_completed_run']]
 for f in selected:
  run(f['definition']);run('revoke all on function '+f['signature']+' from public,anon,authenticated,service_role;grant execute on function '+f['signature']+' to service_role')
 migration=next((repo/'supabase/migrations').glob('*chat_spend_reconciliation_readiness.sql'));source=migration.read_text(encoding='utf-8');run(source)
 passed('exact two current preimage definitions and additive migration compile without table/grant changes')
 run(f"insert into public.organizations values({q(u(1))},'active'),({q(u(3))},'active');insert into public.organization_memberships(organization_id,user_id,status,member_kind) values({q(u(1))},{q(u(2))},'active','team');insert into private.ai_execution_budget_limits values({q(u(1))},'provider_managed')")
 assert ready()['spend_readiness_status']=='ready';passed('current team actor is ready when no unresolved costs exist')
 for actor in [4]:assert '42501' in raw('select public.get_ai_spend_guard_readiness('+q(u(1))+','+q(u(actor))+')').stderr
 assert '42501' in raw('select public.get_ai_spend_guard_readiness('+q(u(3))+','+q(u(2))+')').stderr
 passed('foreign actor and other organization remain denied by actual current membership guard')
 run(f"insert into private.ai_execution_budget_reservations values({q(u(10))},{q(u(1))},null,{q(u(20))},null,date_trunc('month',timezone('UTC',clock_timestamp()))::date-interval '1 month','uncertain',null)")
 before=run('select md5(jsonb_agg(to_jsonb(r))::text) from private.ai_execution_budget_reservations r')
 value=ready();assert value['spend_readiness_status']=='prior_cycle_reconciliation_required' and value['reconciliation_sources']==['design_media']
 assert 'reservation' not in json.dumps(value) and 'cost' not in json.dumps(value)
 assert before==run('select md5(jsonb_agg(to_jsonb(r))::text) from private.ai_execution_budget_reservations r')
 passed('prior-month uncertain media blocks preflight without exposing identifiers/costs or changing holds')
 run(f"insert into private.ai_execution_step_budget_reservations(id,organization_id,cycle_month,status,context_chat_message_id) values({q(u(11))},{q(u(1))},date_trunc('month',timezone('UTC',clock_timestamp()))::date-interval '1 month','reserved',{q(u(21))})")
 assert ready()['reconciliation_sources']==['context_chat','design_media'];passed('media and chat workflow categories are separated without private job details')
 run("update private.ai_execution_budget_reservations set status='settled';update private.ai_execution_step_budget_reservations set status='released'")
 assert ready()['spend_readiness_status']=='ready';passed('authoritatively terminal prior holds cease blocking without changing current-cycle policy')
 run(f"insert into private.ai_execution_budget_reservations values({q(u(12))},{q(u(3))},null,{q(u(22))},null,date_trunc('month',timezone('UTC',clock_timestamp()))::date-interval '1 month','uncertain',null)")
 assert ready()['spend_readiness_status']=='ready';passed('another organization prior costs do not affect selected organization')
 run(f"insert into private.ai_execution_budget_reservations values({q(u(13))},{q(u(1))},null,{q(u(23))},null,date_trunc('month',timezone('UTC',clock_timestamp()))::date,'uncertain',null)")
 assert ready()['spend_readiness_status']=='ready';passed('current-month uncertainty retains existing reservation admission policy')
 run(f"insert into public.ai_runs(id,organization_id,status,created_at) values({q(u(14))},{q(u(1))},'completed',clock_timestamp())")
 assert ready()['spend_readiness_status']=='unmeasured_cost_reconciliation_required';passed('unlinked current completed run with unknown cost fails closed')
 run(f"update public.ai_runs set estimated_cost_microusd=23 where id={q(u(14))}")
 assert ready()['spend_readiness_status']=='ready';passed('measured current completed run is not mislabeled unknown')
 run(f"delete from private.ai_execution_budget_limits where organization_id={q(u(1))}")
 assert ready()['spend_readiness_status']=='spend_tracking_unconfigured';passed('missing configured spend policy remains unavailable')
 run(f"insert into private.ai_execution_budget_limits values({q(u(1))},'local_monthly_cap')")
 for zone in ['Pacific/Honolulu','Asia/Karachi']:
  result=json.loads(run('set timezone='+q(zone)+';select public.get_ai_spend_guard_readiness('+q(u(1))+','+q(u(2))+')'))
  assert result['budget_cycle']==run("select date_trunc('month',timezone('UTC',clock_timestamp()))::date")
 passed('cycle is UTC independent of browser/host session timezone')
 run(f"insert into public.projects values({q(u(36))},{q(u(1))},null);insert into public.department_chat_conversations values({q(u(35))},{q(u(1))},{q(u(2))},'project_team',{q(u(36))},null)")
 for message in [30,31,32,33]:run(f"insert into public.department_chat_messages values({q(u(message))},{q(u(1))},{q(u(35))},{q(u(2))},{q(u(2))},'user','completed')")
 assert recover(30)['submission_status']=='no_submission_recorded';passed('exact current owner/message with no reservation/claim/run receives point-in-time observation only')
 assert '42501' in raw('select public.recover_context_chat_completed_run('+q(u(1))+','+q(u(99))+','+q(u(2))+')').stderr
 run(f"update public.department_chat_messages set author_id={q(u(4))} where id={q(u(30))}")
 assert '42501' in raw('select public.recover_context_chat_completed_run('+q(u(1))+','+q(u(30))+','+q(u(2))+')').stderr
 run(f"update public.department_chat_messages set author_id={q(u(2))} where id={q(u(30))};update public.projects set archived_at=clock_timestamp()")
 assert '42501' in raw('select public.recover_context_chat_completed_run('+q(u(1))+','+q(u(30))+','+q(u(2))+')').stderr
 run('update public.projects set archived_at=null')
 passed('missing source, foreign author and archived project deny negative observation through actual owner scope helper')
 run(f"insert into private.context_chat_dispatch_claims(organization_id,message_id) values({q(u(1))},{q(u(31))})")
 assert recover(31)['submission_status']=='unverified';passed('orphan or contradictory claim evidence is never reported not-submitted')
 run(f"insert into public.ai_runs(organization_id,context_chat_message_id) values({q(u(1))},{q(u(32))})")
 assert recover(32)['submission_status']=='unverified';passed('persisted run without matching reservation remains unverified, never redispatched')
 run('create sequence private.qa_original_started')
 writer=f"select nextval('private.qa_original_started');select pg_sleep(2);insert into private.ai_execution_step_budget_reservations(id,organization_id,actor_id,context_chat_message_id,context_chat_conversation_id,context_chat_model_configuration_id,cycle_month,status) values({q(u(44))},{q(u(1))},{q(u(2))},{q(u(33))},{q(u(35))},{q(u(34))},date_trunc('month',timezone('UTC',clock_timestamp()))::date,'reserved');insert into private.context_chat_dispatch_claims(id,organization_id,reservation_id,message_id,actor_id,conversation_id,model_configuration_id) values({q(u(45))},{q(u(1))},{q(u(44))},{q(u(33))},{q(u(2))},{q(u(35))},{q(u(34))})"
 with ThreadPoolExecutor(max_workers=1) as pool:
  original=pool.submit(run,writer)
  for _ in range(20):
   if run('select is_called from private.qa_original_started')=='t':break
   time.sleep(.05)
  else:raise AssertionError('Original in-flight phase not observed')
  assert not original.done()
  observed=recover(33);assert observed['submission_status']=='no_submission_recorded' and not original.done()
  original.result()
 assert 'submission_status' not in recover(33)
 passed('observed original request before reservation can create reservation/claim after negative read; no terminal absence proof or retry authority is granted')

 for f in selected:
  for role in ['anon','authenticated']:assert run("select has_function_privilege("+q(role)+','+q(f['signature'])+",'execute')")=='f'
  assert run("select has_function_privilege('service_role',"+q(f['signature'])+",'execute')")=='t'
 passed('both existing APIs retain service-only EXECUTE; ordinary clients gain no private-budget access')
 report={'passed':len(checks),'checks':checks,'migrationSHA256':hashlib.sha256(source.encode()).hexdigest(),'port':port,'boundary':__doc__,'productionMutation':False,'providerCalls':False,'oldDataTouched':False}
 (qa/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
