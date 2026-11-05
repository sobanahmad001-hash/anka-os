"""Isolated PG17 policy checks: actual captured reserve/claim/model/owner functions,
synthetic minimal base tables and auth.uid fixture. No production business writes,
provider calls, live activation, complete RLS or authenticated app acceptance.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse,json,subprocess,os,socket,time,hashlib
p=argparse.ArgumentParser();p.add_argument('--qa',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--preimages',required=True);a=p.parse_args()
repo=Path(__file__).resolve().parents[1];parent=Path(a.preimages);qa=Path(a.qa);data=qa/'data';bin=Path(a.pgbin);port=29980;started=False;checks=[]
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
u=lambda n:f'bb000000-0000-4000-8000-{n:012d}'
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

 migration=next((repo/'supabase/migrations').glob('*new_project_chat_allowance_readiness.sql'));source=migration.read_text(encoding='utf-8');run(source)
 def fresh(cost=40,project=3,who=2,model=4):
  return 'select public.read_new_project_chat_allowance('+','.join(map(q,[u(1),u(who),u(project),u(model)]))+','+str(cost)+')'
 assert json.loads(run(fresh()))['status']=='inactive';passed('new project inactive before explicit owner activation')
 denied(fresh(who=9),'42501');denied(fresh(project=999),'42501');denied(fresh(model=999),'23514');passed('nonowner and foreign project/model denied at normal entry')
 assert run("select has_function_privilege('authenticated','public.read_new_project_chat_allowance(uuid,uuid,uuid,uuid,bigint)','execute')")=='f'
 assert run("select has_function_privilege('anon','public.read_new_project_chat_allowance(uuid,uuid,uuid,uuid,bigint)','execute')")=='f'
 assert run("select has_function_privilege('service_role','public.read_new_project_chat_allowance(uuid,uuid,uuid,uuid,bigint)','execute')")=='t';passed('service-only execute and empty search path preserved')
 before=run("select count(*) from public.department_chat_conversations");v=preview();policy=json.loads(run(apply(100,'activate',100,3600,v['review_hash'])))['action'];pid=policy['policy_id']
 assert json.loads(run(fresh()))['status']=='available';assert json.loads(run(fresh(101)))['status']=='exhausted';passed('after explicit activation maximum hold and exposure use unchanged predicate')
 run('delete from public.department_chat_messages;delete from public.department_chat_conversations')
 assert json.loads(run(fresh()))['status']=='available';assert run('select count(*) from public.department_chat_conversations')=='0';assert run('select count(*) from private.ai_execution_step_budget_reservations')=='0';passed('project read succeeds without any conversation and creates no messages/reservations')
 assert json.loads(run(fresh(project=8)))['status']=='inactive';passed('other current project cannot reuse activated policy')
 run("update private.design_media_quotes set request_checksum='changed'")
 assert json.loads(run(fresh()))['status']=='source_changed';run("update private.design_media_quotes set request_checksum='fixture'");passed('source changes remain blocked')
 run("update public.organization_memberships set role='operations_admin' where user_id="+q(u(2)))
 denied(fresh(),'42501');run("update public.organization_memberships set role='system_owner' where user_id="+q(u(2)));passed('current owner revocation denies project read')
 run("update public.projects set archived_at=now() where id="+q(u(3)));denied(fresh(),'42501');run("update public.projects set archived_at=null");passed('project archival denies project read')
 run(apply(101,'revoke',policy=pid));assert json.loads(run(fresh()))['status']=='inactive';passed('explicit revocation remains unavailable')
 report={'passed':len(checks),'checks':checks,'boundary':__doc__,'productionMutation':False,'providerCalls':False}
 (qa/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
