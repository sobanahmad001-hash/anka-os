"""Isolated PG17 policy checks: actual captured reserve/claim/model/owner functions,
synthetic minimal base tables and auth.uid fixture. No production business writes,
provider calls, live activation, complete RLS or authenticated app acceptance.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse,json,subprocess,os,socket,time,hashlib
p=argparse.ArgumentParser();p.add_argument('--qa',required=True);p.add_argument('--pgbin',required=True);a=p.parse_args()
repo=Path(__file__).resolve().parents[1];parent=repo.parent;qa=Path(a.qa);data=qa/'data';bin=Path(a.pgbin);port=29978;started=False;checks=[]
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
 old=run('select jsonb_agg(to_jsonb(r))::text from private.ai_execution_budget_reservations r')
 denied(reserve(20),'55000');passed('provider-managed tracking alone still rejects unresolved historical hold')
 denied(actor('select public.preview_project_chat_allowance('+','.join(map(q,[u(1),u(3),u(4)]))+',100,3600)',9),'42501')
 v=preview();policy=json.loads(run(apply(100,'activate',100,3600,v['review_hash'])))['action'];pid=policy['policy_id']
 assert context()['status']=='available' and context(project=8)['status']=='inactive' and context(who=9)['status']=='inactive'
 passed('explicit current authenticated owner setup and exact project/actor/model scope; admin is not implicit owner')
 assert json.loads(run(apply(100,'activate',100,3600,v['review_hash'])))['idempotent_replay']
 denied(apply(100,'activate',101,3600,v['review_hash']),'23505');passed('same owner request replays once; changed payload rejected')
 with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda n:raw(reserve(n,60)),[20,21]))
 assert sum(r.returncode==0 for r in results)==1
 assert context()['remaining_microusd']==40
 succeeded=20 if results[0].returncode==0 else 21
 run(reserve(succeeded,60));assert context()['remaining_microusd']==40
 passed('concurrent reservations atomically enforce separate text cap and exact replay adds no debit')
 claim_result=json.loads(run(claim(succeeded,150)));assert claim_result['status']=='claimed'
 assert json.loads(run(claim(succeeded,150)))['must_not_submit']
 run(apply(101,'revoke',policy=pid));assert context()['status']=='inactive'
 assert json.loads(run(claim(succeeded,150)))['must_not_submit']
 passed('claim first then revocation preserves original must-not-submit claim replay')
 run("update private.ai_execution_step_budget_reservations set status='settled',actual_cost_microusd=13")
 v=preview(seconds=60);policy=json.loads(run(apply(102,'activate',100,60,v['review_hash'])))['action'];pid=policy['policy_id']
 run(reserve(22,40));run(apply(103,'revoke',policy=pid));denied(claim(22,151),'55000')
 passed('revocation first denies unused reservation dispatch without releasing historical or new liability')
 # Remove only synthetic new holds to isolate later test cases, never production.
 run('delete from private.context_chat_dispatch_claims;delete from private.ai_execution_step_budget_events;delete from private.ai_execution_step_budget_reservations')
 v=preview(seconds=60);run(apply(104,'activate',100,60,v['review_hash']));run(reserve(23,40))
 run("update private.design_media_quotes set request_checksum='changed'");assert context()['status']=='source_changed';denied(claim(23,152),'55000')
 run("update private.design_media_quotes set request_checksum='fixture'");passed('source fingerprint CAS rejects changed original evidence before new claim')
 run('update private.ai_execution_step_budget_reservations set status=\'uncertain\'');assert context()['remaining_microusd']==60
 run('update private.ai_execution_step_budget_reservations set status=\'settled\',actual_cost_microusd=13');assert context()['remaining_microusd']==87
 run('update private.ai_execution_step_budget_reservations set actual_cost_microusd=null');assert context()['status']=='unmeasured_current_cost'
 passed('uncertain new text retains its ceiling; settled actual used only when measured; unknown cost fails closed')
 assert old==run('select jsonb_agg(to_jsonb(r))::text from private.ai_execution_budget_reservations r')
 passed('old uncertain actual-NULL financial row remains exactly unchanged across setup/reserve/claim/revoke')
 denied("update private.ai_execution_budget_limits set project_chat_allowance_actions=null",'55000')
 denied("update private.ai_execution_budget_limits set project_chat_allowance_actions='[]'",'55000')
 denied('delete from private.ai_execution_budget_limits','55000');denied('truncate private.ai_execution_budget_limits','55000')
 run('update private.ai_execution_budget_limits set configured_at=clock_timestamp()')
 passed('policy history cannot clear/replace/delete/truncate; unrelated budget update preserves exact history')
 for role in ['anon','service_role']:assert run("select has_function_privilege("+q(role)+",'public.apply_project_chat_allowance(uuid,uuid,text,uuid,uuid,bigint,integer,text,uuid)','execute')")=='f'
 assert run("select has_function_privilege('authenticated','public.apply_project_chat_allowance(uuid,uuid,text,uuid,uuid,bigint,integer,text,uuid)','execute')")=='t'
 passed('activation RPC is authenticated-only; service and anonymous clients gain no activation authority')
 # Further cases reuse only this fresh synthetic data; no old QA is reset.
 active=json.loads(run('select project_chat_allowance_actions->-1 from private.ai_execution_budget_limits'))
 run(apply(105,'revoke',policy=active['policy_id']))
 run('delete from private.ai_execution_step_budget_events;delete from private.ai_execution_step_budget_reservations')
 def activate(req):
  v=preview();return json.loads(run(apply(req,'activate',100,3600,v['review_hash'])))['action']['policy_id']
 for first,number in [('claim',24),('revoke',25)]:
  policy_id=activate(110+number);run(reserve(number,40));seq='private.qa_started_'+str(number);run('create sequence '+seq)
  first_sql=claim(number,200+number) if first=='claim' else apply(210+number,'revoke',policy=policy_id)
  second_sql=apply(220+number,'revoke',policy=policy_id) if first=='claim' else claim(number,200+number)
  first_sql='begin;select 1 from private.ai_execution_budget_limits for update;select nextval('+q(seq)+');select pg_sleep(3);'+first_sql+';commit;'
  with ThreadPoolExecutor(max_workers=2) as pool:
   one=pool.submit(raw,first_sql)
   for _ in range(15):
    if run('select is_called from '+seq)=='t':break
    time.sleep(.03)
   else:raise AssertionError('First budget lock not observed')
   two=pool.submit(raw,"set application_name='qa_waiting_policy';"+second_sql)
   observed=False
   for _ in range(15):
    if run("select count(*) from pg_stat_activity where application_name='qa_waiting_policy' and wait_event_type='Lock'")!='0':observed=True;break
    time.sleep(.03)
   assert observed,'Second policy action did not observably wait on budget lock'
   result_one=one.result();result_two=two.result();assert result_one.returncode==0,result_one.stderr
   if first=='claim':assert result_two.returncode==0,result_two.stderr
   else:assert '55000' in result_two.stderr
  run("update private.ai_execution_step_budget_reservations set status='settled',actual_cost_microusd=10")
 passed('observed budget-row lock waits in both claim-first/revocation-first races; linearized claim replay never redispatches')
 policy_id=activate(160);run(reserve(26,40))
 # Expired persisted action is a synthetic boundary fixture; current predicate
 # and claim bodies run unchanged, without waiting a minute or altering clocks.
 run("update private.ai_execution_budget_limits set project_chat_allowance_actions=project_chat_allowance_actions||jsonb_build_array((project_chat_allowance_actions->-1)||jsonb_build_object('expires_at',clock_timestamp()-interval '1 second'))")
 assert context()['status']=='inactive';denied(claim(26,226),'55000')
 passed('persisted expired policy fails current predicate and unused dispatch claim; no clock override or production expiry change')
 run('delete from private.ai_execution_step_budget_events;delete from private.ai_execution_step_budget_reservations')
 v=preview();policy_id=json.loads(run(apply(161,'activate',100,3600,v['review_hash'])))['action']['policy_id']
 run("update public.projects set archived_at=clock_timestamp() where id="+q(u(3)));assert context()['status']=='scope_changed'
 denied(reserve(27),'42501');run('update public.projects set archived_at=null')
 run("update public.context_chat_organization_models set revoked_at=clock_timestamp()")
 denied(reserve(27),'23514');run('update public.context_chat_organization_models set revoked_at=null')
 run("insert into public.ai_runs values("+q(u(300))+','+q(u(1))+",'completed',null,clock_timestamp())")
 assert context()['status']=='unmeasured_current_cost';denied(reserve(27),'55000');run('delete from public.ai_runs')
 run('insert into private.ai_execution_step_budget_reservations(id,organization_id,actor_id,cycle_month,status,max_cost_microusd) values('+q(u(301))+','+q(u(1))+','+q(u(2))+",date_trunc('month',timezone('UTC',clock_timestamp()))::date,'uncertain',20)")
 assert context()['status']=='unrelated_current_hold';denied(reserve(27),'55000');run('delete from private.ai_execution_step_budget_reservations')
 denied(reserve(27,40,conversation=7),'42501')
 passed('archived project, revoked model, unknown current run, unrelated current uncertainty and private Design scope remain denied')
 # Exact scoped service readiness uses the same predicate and cost argument.
 read='select public.read_project_chat_allowance('+','.join(map(q,[u(1),u(2),u(5),u(4)]))+',40)'
 assert json.loads(run(read))['status']=='available';run(reserve(28,70));assert json.loads(run(read))['status']=='exhausted';denied(reserve(29,40),'55000')
 passed('scoped preflight and actual reserve share exact prospective amount/exposure predicate')
 run(f"insert into public.department_chat_conversations values({q(u(38))},{q(u(1))},{q(u(2))},'project_team',{q(u(8))},null,'active');update public.department_chat_messages set conversation_id={q(u(38))} where id={q(u(30))};insert into public.department_chat_messages values({q(u(40))},{q(u(1))},{q(u(7))},{q(u(2))},{q(u(2))},'user','completed')")
 denied(reserve(30,10,conversation=38),'55000');denied(reserve(40,10,conversation=7),'55000')
 run(f"insert into public.context_chat_organization_models values({q(u(14))},{q(u(1))},{q(u(6))},'fixture-text',null)")
 denied(reserve(31,10).replace(q(u(4)),q(u(14))),'55000')
 passed('valid other-project, private Design and differently configured approved model requests cannot use this project allowance')
 run('insert into private.ai_execution_step_budget_reservations(id,organization_id,actor_id,cycle_month,status,max_cost_microusd) values('+q(u(302))+','+q(u(1))+','+q(u(2))+",date_trunc('month',timezone('UTC',clock_timestamp()))::date-interval '1 month','uncertain',20)")
 prior_step=json.loads(run('select private.project_chat_prior_cost_snapshot('+q(u(1))+','+q(u(2))+')'))
 assert prior_step=={'eligible':False,'reason':'unrelated_prior_hold'}
 assert context()['status']=='source_changed';assert json.loads(run(read))['status']=='source_changed';denied(reserve(29,10),'55000')
 run('delete from private.ai_execution_step_budget_reservations where id='+q(u(302)))
 passed('older step holds are ineligible at the shared source snapshot, never reclassified as current or as eligible Design media')
 run(apply(162,'revoke',policy=policy_id));run("update private.ai_execution_step_budget_reservations set status='settled',actual_cost_microusd=10")
 for offset,cap in enumerate([80479,80480,80481]):
  v=preview(cap=cap);policy_id=json.loads(run(apply(180+offset,'activate',cap,3600,v['review_hash'])))['action']['policy_id']
  full_read=read.replace(',40)',',80480)');value=json.loads(run(full_read))
  if cap<80480:
   assert value['status']=='exhausted';denied(reserve(32+offset,80480),'55000')
  else:
   assert value['status']=='available';run(reserve(32+offset,80480));assert context()['remaining_microusd']==cap-80480
   run(claim(32+offset,280+offset));assert context()['remaining_microusd']==cap-80480
   assert json.loads(run(claim(32+offset,280+offset)))['must_not_submit']
   run("update private.ai_execution_step_budget_reservations set status='settled',actual_cost_microusd=13 where context_chat_message_id="+q(u(32+offset)))
  run(apply(190+offset,'revoke',policy=policy_id))
 passed('Sol full-turn threshold at cap80479/80480/80481 agrees in scoped read/reserve; claim and replay never double-count their own hold')
 # Synthetic prefix fills only this test history to the boundary. Trigger still
 # enforces one append at a time and the owner RPC must reserve revocation space.
 run("do $$ begin while (select jsonb_array_length(project_chat_allowance_actions) from private.ai_execution_budget_limits)<62 loop update private.ai_execution_budget_limits set project_chat_allowance_actions=project_chat_allowance_actions||jsonb_build_array(jsonb_build_object('action','revoke','fixture',true,'request_id',gen_random_uuid()));end loop;end;$$")
 v=preview();policy_id=json.loads(run(apply(170,'activate',100,3600,v['review_hash'])))['action']['policy_id']
 assert run('select jsonb_array_length(project_chat_allowance_actions) from private.ai_execution_budget_limits')=='63'
 run(apply(171,'revoke',policy=policy_id));assert run('select jsonb_array_length(project_chat_allowance_actions) from private.ai_execution_budget_limits')=='64'
 assert json.loads(run(apply(171,'revoke',policy=policy_id)))['idempotent_replay'];denied(apply(171,'activate',100,3600,v['review_hash']),'23505')
 denied(actor('select public.preview_project_chat_allowance('+','.join(map(q,[u(1),u(3),u(4)]))+',100,3600)'),'54000')
 passed('activation at action63 reserves immediate action64 revocation; exact replay remains available at full history; new setup fails closed')
 assert old==run('select jsonb_agg(to_jsonb(r))::text from private.ai_execution_budget_reservations r')
 passed('historical actual-NULL financial row still exactly unchanged after all policy and boundary cases')
 owned='select public.read_owned_project_chat_allowance('+','.join(map(q,[u(1),u(3),u(4)]))+')'
 assert json.loads(run(actor(owned)))['status']=='revoked'
 assert json.loads(run(actor(owned.replace(q(u(3)),q(u(8))))))['status']=='none'
 denied(actor(owned,9),'42501')
 assert 'source_hash' not in json.loads(run(actor(owned)))
 passed('owner can read scoped revocation metadata even when allowance is exhausted/history full; foreign scope and non-owner denied without old source identifiers')
 denied('set role authenticated;update private.ai_execution_budget_limits set project_chat_allowance_actions=\'[]\'','42501')
 denied('set role anon;'+owned,'42501')
 assert json.loads(run(actor('set role authenticated;'+owned)))['status']=='revoked'
 passed('ordinary authenticated owner reads only definer-guarded metadata; authenticated and anonymous callers cannot manufacture budget-row actions')
 run(f"""insert into public.organizations values({q(u(50))},'active');
 insert into public.organization_memberships values({q(u(50))},{q(u(2))},'active','team','system_owner',null);
 insert into public.projects values({q(u(51))},{q(u(50))},null);
 insert into public.integration_connections values({q(u(53))},{q(u(50))},'openai','verified',null,'FIXTURE_NO_CREDENTIAL','{{"model_id":"fixture-text"}}');
 insert into public.context_chat_organization_models values({q(u(52))},{q(u(50))},{q(u(53))},'fixture-text',null);
 insert into public.department_chat_conversations values({q(u(54))},{q(u(50))},{q(u(2))},'project_team',{q(u(51))},null,'active');
 insert into public.department_chat_messages values({q(u(55))},{q(u(50))},{q(u(54))},{q(u(2))},{q(u(2))},'user','completed');
 insert into private.ai_execution_budget_limits(organization_id,spend_guard_mode) values({q(u(50))},'provider_managed');""")
 ordinary=json.loads(run('select public.read_project_chat_allowance('+','.join(map(q,[u(50),u(2),u(54),u(52)]))+',80480)'))
 assert ordinary['status']=='not_required'
 ordinary_reserve=json.loads(run('select public.reserve_context_chat_budget('+','.join(map(q,[u(50),u(54),u(55),u(52),u(2)]))+',20490)'))
 assert ordinary_reserve['max_cost_microusd']==20490
 assert json.loads(run('select public.claim_context_chat_dispatch('+','.join(map(q,[u(50),u(55),u(2),u(56),'b'*64]))+')'))['status']=='claimed'
 assert run('select evidence from private.ai_execution_step_budget_events where organization_id='+q(u(50)))==''
 passed('ordinary project with no historical holds needs no policy and keeps its exact smaller hold through actual read/reserve/claim')
 report={'passed':len(checks),'checks':checks,'migrationSHA256':hashlib.sha256(source.encode()).hexdigest(),'boundary':__doc__,'productionMutation':False,'providerCalls':False,'remaining':['Studio consumer integration','full deployed schema/ACL and signed-in acceptance']}
 (qa/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
finally:
 if started:control([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
