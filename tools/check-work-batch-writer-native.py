"""Fresh owned PG17: actual current actor/P5/assignment/DAG/relation commands.
Synthetic canonical base, published rows and approval/foundation resolver boundaries.
No production, PostgREST, signed-in, provider or scheduler acceptance.
"""
from pathlib import Path
import argparse,ast,json,subprocess,uuid,re,hashlib,socket,copy
from concurrent.futures import ThreadPoolExecutor
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--pgbin',required=True);p.add_argument('--qa',required=True);p.add_argument('--focused',action='store_true');p.add_argument('--safety-only',action='store_true');p.add_argument('--head-only',action='store_true');p.add_argument('--empty-only',action='store_true');p.add_argument('--xid-only',action='store_true');p.add_argument('--edit-concurrency',action='store_true');p.add_argument('--source-locks',action='store_true');a=p.parse_args()
repo=Path(a.repo).resolve();parent=repo.parent;qa=Path(a.qa).resolve();data=qa/'data';bin=Path(a.pgbin);port=29968;db='work_'+uuid.uuid4().hex[:8];flags=0x08000000;checks=[];started=False
assert not data.exists(),'Fresh owned QA only';qa.mkdir(parents=True,exist_ok=True)
with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0,'Owned port occupied'
def server(args):
 with (qa/'server-control.log').open('a',encoding='utf-8') as f:
  r=subprocess.run([str(x) for x in args],stdout=f,stderr=subprocess.STDOUT,creationflags=flags,timeout=40);assert r.returncode==0,'See server-control.log'
def raw(sql,database=None):
 r=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',database or db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=sql,capture_output=True,text=True,encoding='utf-8',creationflags=flags,timeout=30)
 with (qa/'commands.log').open('a',encoding='utf-8') as f:f.write(sql+'\n'+r.stdout+r.stderr+'\n')
 return r
def run(sql,database=None):
 r=raw(sql,database);assert r.returncode==0,r.stderr;return r.stdout.strip()
q=lambda x:"'"+str(x).replace("'","''")+"'"
j=lambda x:q(json.dumps(x,ensure_ascii=False))+'::jsonb'
uid=lambda n:f'e1000000-0000-4000-8000-{n:012d}'
org,actor,other,project,eng,svc,service,definition,publication,config,brand,page,arch,archversion=[uid(i) for i in range(1,15)]
partition={'kind':'engagement','id':eng}
def auth(sql,who=actor,role='authenticated'):return f"begin;set local role {role};set local request.jwt.claim.sub={q(who or '')};"+sql+';commit;'
def value(sql,**kw):return json.loads(run(auth(sql,**kw)).splitlines()[-1])
def denied(sql,code='42501',**kw):
 r=raw(auth(sql,**kw));assert r.returncode and code in r.stderr,r.stderr;checks.append('denied '+code)
def context(ids=(),part=None,cfg=config):return f'select public.get_project_pipeline_work_batch_context({q(org)},{q(project)},{q(eng)},{q(cfg)},{j(part or partition)},array['+','.join(q(x)+'::uuid' for x in ids)+']::uuid[])'
def review(proposal,part=None,cfg=config):return f'select public.review_project_pipeline_work_batch({q(org)},{q(project)},{q(eng)},{q(cfg)},{j(part or partition)},{j(proposal)})'
def apply(proposal,sha,rid,part=None,cfg=config):return f'select public.apply_project_pipeline_work_batch({q(org)},{q(project)},{q(eng)},{q(cfg)},{j(part or partition)},{j(proposal)},{q(sha)},{q(rid)})'
def recover(rid):return f'select public.recover_project_pipeline_work_batch({q(org)},{q(project)},{q(eng)},{q(rid)})'
def passed(name):checks.append(name)
try:
 server([bin/'initdb.exe','-D',data,'-U','postgres','--encoding=UTF8','--no-locale','--auth=trust'])
 server([bin/'pg_ctl.exe','-D',data,'-l',qa/'server.log','-o',f'-p {port} -h 127.0.0.1','-w','start']);started=True
 assert Path(run('show data_directory','postgres')).resolve()==data
 run('create database '+db,'postgres')
 tree=ast.parse((repo/'tools/check-project-work-actions-native.py').read_text(encoding='utf-8'))
 bootstrap=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='bootstrap' for t in n.targets))
 run(bootstrap)
 run("""alter table private.n1c_assignment_history add column delegation_id uuid;
 alter table public.work_items add column linked_page_key text,add column linked_page_path text;
 alter table public.work_items add constraint work_items_created_via_check check(created_via in ('manual','ai_chat_proposal','automation_rule','recurring_plan','quick_task_promotion'));
 create table public.work_item_dependencies(organization_id uuid,work_item_id uuid references public.work_items(id),depends_on_work_item_id uuid references public.work_items(id),created_by uuid,created_at timestamptz default now(),primary key(work_item_id,depends_on_work_item_id));
 alter table public.work_items enable row level security;alter table public.work_item_dependencies enable row level security;
 grant select on public.work_items,public.work_item_dependencies to authenticated;grant all on public.work_items,public.work_item_dependencies to service_role;
 alter table public.artifacts add column project_id uuid,add column brand_id uuid;
 alter table public.artifact_versions add column content jsonb,add column content_checksum text;
 create table public.project_service_scopes(id uuid default gen_random_uuid(),organization_id uuid,project_id uuid,service_id uuid,status text);
 create table public.pipeline_execution_definitions(id uuid primary key,organization_id uuid,steps jsonb,steps_sha256 text,preset_publication_id uuid);
 create table public.pipeline_execution_publications(id uuid primary key,organization_id uuid,definition_id uuid);
 create table public.project_pipeline_groups(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,kind text,preset_publication_id uuid);
 create table public.project_pipeline_configurations(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,definition_publication_id uuid,revision int,selected_steps jsonb,selected_steps_sha256 text,pipeline_group_id uuid,configured_by uuid,request_id uuid);
 create table public.project_pipeline_stage_reviews(id uuid default gen_random_uuid(),organization_id uuid,project_id uuid,engagement_id uuid,configuration_id uuid,request_id uuid,reviewed_by uuid,decisions jsonb,resolved_artifacts jsonb,review_sha256 text,foundation_context jsonb);
 create table public.project_website_pages(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,brand_id uuid,architecture_artifact_id uuid,page_key text);
 create table public.project_campaign_assets(id uuid primary key,organization_id uuid,project_id uuid,brand_id uuid,source_kind text,source_version_id uuid,source_descriptor jsonb,source_reference_checksum text);
 create table public.recurring_work_occurrences(id uuid primary key,organization_id uuid,project_id uuid,engagement_id uuid,engagement_service_id uuid,status text,plan_version_id uuid,period_start date,period_end date,timezone text);
 create table public.tasks(id uuid primary key,organization_id uuid,project_id uuid,department_id text,archived_at timestamptz,status text,row_version bigint,user_id uuid,assigned_to uuid);
 create table public.department_chat_conversations(id uuid primary key,organization_id uuid,project_id uuid,owner_id uuid,context_kind text,state text,archived_at timestamptz);
 create table public.project_context_chat_shares(conversation_id uuid,recipient_id uuid,revoked_at timestamptz);
 create table private.qa_sources(id uuid primary key,available boolean,reference jsonb);
 create table private.qa_foundation(configuration_id uuid primary key,context jsonb);
 create function private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text) returns jsonb language plpgsql as $$declare r jsonb;begin select reference into r from private.qa_sources where id=$3 and available;if r is null then raise exception 'Synthetic exact approval unavailable' using errcode='55000';end if;return r;end;$$;
 create function private.pipeline_foundation_context(uuid,uuid,uuid,uuid,boolean) returns jsonb language sql as $$select context from private.qa_foundation limit 1$$;
 create function private.campaign_asset_source(uuid,uuid,uuid,text,uuid) returns jsonb language sql as $$select private.require_pipeline_approved_artifact($1,$2,$5,null,null)$$;
 """)
 rows=[]
 for name in ['work-batch-runtime-preimage-20261103.json','work-batch-modern-writers-preimage-20261103.json','work-batch-p5-context-preimage-20261103.json','materialization-source-preimage-20261103.json','work-batch-additional-actor-preimage-20261103.json']:
  rows+=json.loads((parent/name).read_text(encoding='utf-8'))
 wanted=['n1c_actor','n1c_set_actor','n1c_require_scope','n1c_can_assign','n1e_exact_project_manager','n1c_can_assign_department','n6_project_configuration_authorized','n1c_save_work_item_body','save_work_item','save_p5_work_item','mutate_p5_work_item_dependency','save_work_item_dependency','p5_require_active_actor','p5_raise_stale_write','p5_advance_row_version','derive_engagement_project_ownership','n1c_guard_assignment','n1b_preserve_receipt','clear_work_item_automation_flag_on_status_change','protect_work_item_recurring_provenance']
 for name in wanted:
  row=next(x for x in rows if re.search(r'(?:^|\.)'+name+r'\(',x['signature']));run(row['definition']);run('revoke all on function '+row['signature']+' from public,anon,authenticated,service_role')
 # Existing closed receipt schema and immutable trigger; no alternate receipt table.
 run("""create table private.project_work_commands(organization_id uuid,project_id uuid,actor_id uuid,request_id uuid,payload jsonb,result jsonb,created_at timestamptz default now(),primary key(organization_id,actor_id,request_id));alter table private.project_work_commands enable row level security;revoke all on private.project_work_commands from public,anon,authenticated,service_role;create trigger immutable_work_command before update or delete on private.project_work_commands for each row execute function private.n1b_preserve_receipt();""")
 run(next(x['definition'] for x in rows if x['signature'].startswith('apply_project_work_command(')))
 relations=(repo/'supabase/migrations/20261030122254_project_asset_relationships.sql').read_text(encoding='utf-8');run(relations)
 stage=(repo/'supabase/migrations/20261102175340_pipeline_foundation_readiness.sql').read_text(encoding='utf-8')
 run(re.search(r'CREATE OR REPLACE FUNCTION private.current_pipeline_stage_review[\s\S]*?\$function\$\s*;',stage).group())
 website=(repo/'supabase/migrations/20261001013000_project_website_page_identity.sql').read_text(encoding='utf-8')
 for name in ['website_architecture_pages','website_approved_source']:
  run(re.search(r'create function private\.'+name+r'[\s\S]*?\$\$;',website).group())
 # Use exact production trigger names/order for the canonical derive/version/assignment paths.
 rights=json.loads((parent/'work-batch-rights-preimage-20261103.json').read_text(encoding='utf-8'))
 for t in next(x for x in rights if x['table_name']=='work_items')['triggers']:
  if 'guard_work_item_page_link' not in t['definition']:run(t['definition'])
 migration=(repo/'supabase/migrations/20261102193312_reviewed_pipeline_work_batches.sql').read_text(encoding='utf-8');run(migration)
 steps=[{'key':'brief','label':'Reviewed brief','kind':'human','department_id':'content','service_id':service,'depends_on':[]},{'key':'draft','label':'Reviewed draft','kind':'human','department_id':'content','service_id':service,'depends_on':['brief']}]
 decisions=[{'key':s['key'],'action':'run','quantity':1,'inputs':[]} for s in steps]
 run(f"insert into auth.users values({q(actor)}),({q(other)});insert into public.organizations values({q(org)},'active');insert into public.organization_memberships values({q(org)},{q(actor)},'team','active','contributor','content'),({q(org)},{q(other)},'team','active','contributor','content');insert into public.projects values({q(project)},{q(org)},null);insert into public.project_manager_bindings values({q(org)},{q(project)},{q(actor)},'active');insert into public.engagements values({q(eng)},{q(org)},{q(project)},{q(brand)},'planning');insert into public.departments values('content',{q(org)});insert into public.service_catalog values({q(service)},{q(org)},'content',true);insert into public.engagement_services values({q(svc)},{q(org)},{q(eng)},{q(service)},'planned');insert into public.project_service_scopes(organization_id,project_id,service_id,status) values({q(org)},{q(project)},{q(service)},'active');insert into public.pipeline_execution_definitions(id,organization_id,steps,steps_sha256) values({q(definition)},{q(org)},{j(steps)},encode(sha256(convert_to({j(steps)}::text,'UTF8')),'hex'));insert into public.pipeline_execution_publications values({q(publication)},{q(org)},{q(definition)});insert into public.project_pipeline_configurations values({q(config)},{q(org)},{q(project)},{q(eng)},{q(publication)},1,{j([{'key':s['key'],'quantity':1} for s in steps])},encode(sha256(convert_to({j([{'key':s['key'],'quantity':1} for s in steps])}::text,'UTF8')),'hex'),null,{q(actor)},{q(uid(100))});insert into public.project_pipeline_stage_reviews(organization_id,project_id,engagement_id,configuration_id,request_id,reviewed_by,decisions,resolved_artifacts,review_sha256) values({q(org)},{q(project)},{q(eng)},{q(config)},{q(uid(100))},{q(actor)},{j(decisions)},'[]',repeat('a',64));")
 proposal={'version':1,'slots':[{'key':s['key'],'instance':1,'action':'create_missing'} for s in steps],'dependencies':[],'asset_links':[]}
 if not a.focused and not a.safety_only and not a.head_only and not a.empty_only and not a.xid_only and not a.edit_concurrency and not a.source_locks:
  denied(context(),who=other);denied(context(),role='anon');denied(context(),role='service_role',who='');denied(context(),who='')
  c=value(context());assert len(c['stages'])==2 and not run('select count(*) from public.work_items')!='0';passed('current exact PM and source reader; no Work or receipt writes from review')
  r=value(review(proposal));rid=str(uuid.uuid4());saved=value(apply(proposal,r['review_sha256'],rid));assert saved['atomic'] and len(saved['bindings'])==2 and len(saved['version_bumps'])==1
  assert sorted(x['row_version'] for x in saved['bindings'])==[1,2];assert run('select count(*) from public.work_item_dependencies')=='1';passed('real P5 CAS dependency under authenticated actor; exact canonical trigger order and transaction-local receipt capability')
  assert value(apply(proposal,r['review_sha256'],rid))==saved and run('select count(*) from public.work_items')=='2';passed('exact original request replay never creates duplicates')
  denied(apply({**proposal,'asset_links':[{'kind':'fake'}]},r['review_sha256'],rid),'23505')
  assert value(recover(rid))['original_result']==saved and value(recover(rid),who=other)=={'status':'not_applied'};passed('read-only original recovery with current actor ownership')
  denied(apply(proposal,r['review_sha256'],str(uuid.uuid4())),'40001')
  # Real current service edit path, as invoked by authenticated Work Edge, preserves provenance.
  item=saved['bindings'][0];wid=item['work_item_id'];row=json.loads(run(f'select to_jsonb(w) from public.work_items w where id={q(wid)}'))
  editargs=[org,wid,eng,'Human edited title','','task','medium','in_progress',None,'content',None,None,None,None,None,0,None,actor,row['row_version'],'manual']
  args=','.join('null' if x is None else str(x) if isinstance(x,int) else q(x) for x in editargs)
  # Actual service_role execution with the real user identity, not forged app role in production.
  run('alter role service_role bypassrls;grant usage on schema private to service_role;grant all on all tables in schema public to service_role;grant execute on function public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text),public.save_p5_work_item(uuid,uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,bigint,text) to service_role')
  for h in rows:
   if 'service_role' in (h.get('proacl') or '') and run('select to_regprocedure('+q(h['signature'])+') is not null')=='t':run('grant execute on function '+h['signature']+' to service_role')
  edited=value('select to_jsonb(public.save_p5_work_item('+args+'))',role='service_role');assert edited['created_via']=='pipeline_plan' and edited['title']=='Human edited title';passed('normal actual P5/N1C service edit preserves pipeline attribution and ordinary creator edit rights')
  # Authenticated direct table and alternate definer writes cannot consume an old capability.
  for expr in ["updated_at=now()","row_version=0","row_version=row_version+1","row_version=row_version+20","row_version=null","created_via='manual'","title='forged'"]:
   denied(f'update public.work_items set {expr} where id={q(wid)}')
  run(f"create function public.qa_alternate_update() returns void language plpgsql security definer set search_path='' as $$begin update public.work_items set updated_at=now() where id={q(wid)};end;$$;grant execute on function public.qa_alternate_update() to authenticated;")
  denied('select public.qa_alternate_update()');denied('select public.qa_alternate_update()',who=other);passed('unexpected definer and non-manager writes have no current transaction receipt capability')
  assert run("select count(*) from private.n1c_assignment_history")=='0' and run("select count(*) from public.engagement_events where event_type<>'work_item_created' and event_type<>'work_item_status_changed'")=='0';passed('batch creates no assignment, activation or execution approvals')
  # Reuse exact IDs after the human edit, never title matching or metadata recreation.
  ctx=value(context());reuse=copy.deepcopy(proposal)
  for choice in reuse['slots']:
   b=next(x for x in ctx['prior_slots'] if x['key']==choice['key']);choice.update(action='use_existing',work_item_id=b['work_item_id'],row_version=b['row_version'])
  rr=value(review(reuse));assert rr['can_apply'];rrid=str(uuid.uuid4());result=value(apply(reuse,rr['review_sha256'],rrid));assert not any(x['created'] for x in result['reviewed_slots']) and run('select count(*) from public.work_items')=='2';passed('explicit reused cards keep title/status/output history and existing edge')
  # Legacy service scope can be absent, but an explicit unaccepted current scope blocks.
  run("update public.project_service_scopes set status='proposed'");denied(context());assert value(recover(rid))['original_result']==saved;run("update public.project_service_scopes set status='active'")
  run("update public.service_catalog set is_active=false");denied(context());assert value(apply(proposal,r['review_sha256'],rid))==saved;run('update public.service_catalog set is_active=true');passed('inactive material blocks new work; original exact outcome survives source changes')
  run(f"update public.project_manager_bindings set status='inactive' where user_id={q(actor)}");denied(context());assert value(recover(rid))['original_result']==saved;run('update public.project_manager_bindings set status=\'active\'');passed('manager revocation blocks new batches without hiding owned historical outcome')
  # Two independent apply requests from the same review: only one may advance the head.
  cr=value(review(reuse));requests=[str(uuid.uuid4()),str(uuid.uuid4())]
  with ThreadPoolExecutor(2) as pool:responses=list(pool.map(lambda req:raw(auth(apply(reuse,cr['review_sha256'],req))),requests))
  assert sorted(x.returncode==0 for x in responses)==[False,True] and any('40001' in x.stderr for x in responses);passed('concurrent reviewed head CAS prevents duplicate independent applies')
  # Late receipt/edge failure removes all creation/history/links and the precomputed receipt.
  c=value(context());replace=copy.deepcopy(reuse)
  for x in replace['slots']:
   b=next(z for z in c['prior_slots'] if z['key']==x['key']);x.clear();x.update(key=b['key'],instance=1,action='create_replacement',previous_work_item_id=b['work_item_id'],previous_row_version=b['row_version'],material_reason='Reviewed replacement retains original cards')
  late=value(review(replace));before=run('select count(*) from public.work_items')
  run("create function private.qa_late_edge_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic late edge failure' using errcode='55000';end;$$;create trigger qa_late before insert on public.work_item_dependencies for each row execute function private.qa_late_edge_failure();")
  denied(apply(replace,late['review_sha256'],uid(900)),'55000');assert run('select count(*) from public.work_items')==before and value(recover(uid(900)))=={'status':'not_applied'};run('drop trigger qa_late on public.work_item_dependencies');passed('late DAG failure rolls back new cards/events/receipt and version changes atomically')
  # Receipt cannot be forged, updated or deleted by any direct client/service grant.
  denied('select * from private.project_work_commands');denied('delete from private.project_work_commands')
  assert run("select has_function_privilege('service_role','public.apply_project_pipeline_work_batch(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid)','execute')")=='f';passed('new RPC auth-only; private source/compiler and receipt stores remain closed')
 elif a.source_locks:
  r=value(review(proposal));seed=value("set local lock_timeout='2300ms';savepoint source_checked;"+apply(proposal,r['review_sha256'],uid(990))+";release savepoint source_checked")
  passed('full xid8 receipt/P5 succeeds with nested lock-budget exception blocks and an explicit caller savepoint')
  # Read and apply restore caller settings rather than widening or leaking their local budget.
  run("create function public.qa_lock_budget() returns jsonb language plpgsql security definer set search_path='' as $$declare c jsonb;begin c:=private.project_pipeline_work_context("+q(org)+","+q(project)+","+q(eng)+","+q(config)+","+j(partition)+",'{}');return jsonb_build_object('timeout',current_setting('lock_timeout'));end;$$;grant execute on function public.qa_lock_budget() to authenticated")
  assert value("set local lock_timeout='2300ms';select public.qa_lock_budget()")['timeout']=='2300ms'
  assert value("set local lock_timeout='75ms';select public.qa_lock_budget()")['timeout']=='75ms'
  passed('source review restores caller lock_timeout exactly and preserves an already stricter timeout')
  # Actual current stage helper SHARE-locks the referenced immutable version before its approval resolver.
  version=uid(991);reference={'artifact_version_id':version,'artifact_type':'content','output_type':'article','approval_id':uid(992)}
  resolved=[{'step_key':'brief','input_key':'source','reference':reference}]
  run(f"insert into public.artifact_versions(id,organization_id,artifact_id) values({q(version)},{q(org)},{q(uid(993))});insert into private.qa_sources values({q(version)},true,{j(reference)});update public.project_pipeline_stage_reviews set resolved_artifacts={j(resolved)}")
  import time
  def await_sleep():
   for _ in range(30):
    if run("select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep'")!='0':return
    time.sleep(.03)
   raise AssertionError('No observed source lock holder')
  before=run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands))")
  with ThreadPoolExecutor(2) as pool:
   holder=pool.submit(run,f"begin;select 1 from public.artifact_versions where id={q(version)} for update;select pg_sleep(1.2);commit;");await_sleep()
   denied(context(),'40001');holder.result()
  assert run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands))")==before
  passed('actual nested current-stage source SHARE contention returns bounded 40001 with zero Work/receipt effects')
  # Late canonical relationship source guard can wait too: enforce bounded rollback after Work/edge/receipt creation.
  ctx=value(context());choices=copy.deepcopy(proposal)
  for x in choices['slots']:
   b=next(z for z in ctx['prior_slots'] if z['key']==x['key']);x.update(action='create_replacement',previous_work_item_id=b['work_item_id'],previous_row_version=b['row_version'],material_reason='Explicit material replacement')
  token=value(review(choices))['review_sha256']
  run("create function private.qa_late_source_lock() returns trigger language plpgsql as $$begin perform 1 from public.artifact_versions for share;return new;end;$$;create trigger qa_late_source before insert on public.work_item_dependencies for each row execute function private.qa_late_source_lock()")
  before=run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands),(select count(*) from public.work_item_dependencies),(select sum(row_version) from public.work_items))")
  # A late-only extra source is outside current-stage source pins, modeling a nested canonical relation guard.
  late=uid(994);run(f"insert into public.artifact_versions(id,organization_id,artifact_id) values({q(late)},{q(org)},{q(uid(993))})")
  with ThreadPoolExecutor(2) as pool:
   holder=pool.submit(run,f"begin;select 1 from public.artifact_versions where id={q(late)} for update;select pg_sleep(1.2);commit;");await_sleep()
   denied(apply(choices,token,uid(995)),'40001');holder.result()
  assert run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands),(select count(*) from public.work_item_dependencies),(select sum(row_version) from public.work_items))")==before and value(recover(uid(995)))=={'status':'not_applied'}
  run('drop trigger qa_late_source on public.work_item_dependencies')
  passed('nested late source wait after canonical creation rolls back cards/edges/versions/receipt and preserves original request for recovery')
 elif a.edit_concurrency:
  first=value(review(proposal));seed=value(apply(proposal,first['review_sha256'],uid(970)))
  wid=seed['bindings'][0]['work_item_id'];row=json.loads(run(f'select to_jsonb(w) from public.work_items w where id={q(wid)}'))
  run('alter role service_role bypassrls;grant usage on schema private to service_role;grant all on all tables in schema public to service_role')
  for h in rows:
   if 'service_role' in (h.get('proacl') or '') and run('select to_regprocedure('+q(h['signature'])+') is not null')=='t':run('grant execute on function '+h['signature']+' to service_role')
  def edit_sql(title,version,work=wid,engagement=eng):
   values=[org,work,engagement,title,'','task','medium','not_started',None,'content',None,None,None,None,None,0,None,actor,version,'manual']
   return 'select to_jsonb(public.save_p5_work_item('+','.join('null' if x is None else str(x) if isinstance(x,int) else q(x) for x in values)+'))'
  import time
  def await_sleep():
   for _ in range(30):
    if run("select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep'")!='0':return
    time.sleep(.03)
   raise AssertionError('No observed instrumented writer sleep')
  # Instrument the original P5 early engagement/Work-lock window, then run the ACTUAL unchanged P5 edit.
  prelude=f"set local lock_timeout='3s';select 1 from public.engagements where id={q(eng)} for share;select 1 from public.work_items where id={q(wid)} for update;select pg_sleep(.8);"
  with ThreadPoolExecutor(2) as pool:
   editing=pool.submit(value,prelude+edit_sql('Concurrent original P5 edit',row['row_version']),role='service_role');await_sleep()
   busy=raw(auth("set local lock_timeout='3s';"+context()));assert busy.returncode and '40001' in busy.stderr,busy.stderr
   edited=editing.result()
  assert edited['created_via']=='pipeline_plan' and edited['row_version']==row['row_version']+1
  passed('original P5 early engagement/Work locks + actual edit: busy batch rejects 40001 without reverse-lock wait; source and edit preserved')
  denied(edit_sql('Stale overwrite',row['row_version']),'40001',role='service_role')
  passed('shared P5 remains byte-unchanged with its original edit rights, stale CAS and provenance')
  # Reverse arrival: ACTUAL batch holds its project/Work locks, then original P5 edit waits and succeeds.
  ctx=value(context());replacement=copy.deepcopy(proposal)
  for x in replacement['slots']:
   b=next(z for z in ctx['prior_slots'] if z['key']==x['key']);x.update(action='create_replacement',previous_work_item_id=b['work_item_id'],previous_row_version=b['row_version'],material_reason='Reviewed replacement retains prior cards')
  reviewed=value(review(replacement))
  run("create function private.qa_pause_batch() returns trigger language plpgsql as $$begin if new.payload->>'action'='pipeline_work_batch_v1' then perform pg_sleep(1.2);end if;return new;end;$$;create trigger qa_pause_batch before insert on private.project_work_commands for each row execute function private.qa_pause_batch()")
  with ThreadPoolExecutor(2) as pool:
   batch=pool.submit(value,"set local lock_timeout='3s';"+apply(replacement,reviewed['review_sha256'],uid(971)));await_sleep()
   editing=pool.submit(value,"set local lock_timeout='3s';"+edit_sql('Edit after real batch',edited['row_version']),role='service_role')
   outcome=batch.result();later=editing.result()
  run('drop trigger qa_pause_batch on private.project_work_commands')
  assert outcome['atomic'] and later['row_version']==edited['row_version']+1 and later['created_via']=='pipeline_plan'
  passed('real batch-first vs actual unchanged P5 edit completes both under bounded lock_timeout, no reverse-lock deadlock')
  # Legacy/new Work creators may already hold engagement SHARE, but do not hold existing Work rows.
  with ThreadPoolExecutor(2) as pool:
   create=pool.submit(value,f"set local lock_timeout='3s';select 1 from public.engagements where id={q(eng)} for share;select pg_sleep(.7);"+edit_sql('Actual unassigned manual create',None,None),role='service_role');await_sleep()
   current=value("set local lock_timeout='3s';"+context());manual=create.result()
  assert manual['created_via']=='manual' and manual['assignee_id'] is None and current['scope']['engagement_id']==eng
  passed('pre-held engagement SHARE normal create path and batch source reader coexist; no shared create-wrapper rewrite')
  # Existing graph mutators may hold rows before the DAG advisory: batch must never wait for it while holding project UPDATE.
  with ThreadPoolExecutor(2) as pool:
   holder=pool.submit(run,f"begin;select pg_advisory_xact_lock(hashtextextended({q(org)}||':'||{q(eng)},0));select pg_sleep(.7);commit;");await_sleep()
   busy=raw(auth(context()));assert busy.returncode and '40001' in busy.stderr,busy.stderr;holder.result()
  passed('busy existing DAG advisory causes bounded 40001 rather than an inverted graph/Work wait')
  # Independent projects remain unblocked: no P5-wide project-setup serialization or organization-wide mutation lock.
  project2,eng2=uid(980),uid(981)
  run(f"insert into public.projects values({q(project2)},{q(org)},null);insert into public.engagements values({q(eng2)},{q(org)},{q(project2)},{q(brand)},'planning')")
  run(f"create function private.qa_pause_edit() returns trigger language plpgsql as $$begin if new.id={q(wid)} then perform pg_sleep(1.2);end if;return new;end;$$;create trigger zy_pause before update on public.work_items for each row execute function private.qa_pause_edit()")
  with ThreadPoolExecutor(2) as pool:
   editing=pool.submit(value,edit_sql('Independent project check',later['row_version']),role='service_role');await_sleep()
   independent=value("set local lock_timeout='500ms';"+edit_sql('Independent normal create',None,None,eng2),role='service_role')
   count_before=run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands))")
   denied(context(),'40001')
   assert run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands))")==count_before
   editing.result()
  run('drop trigger zy_pause on public.work_items')
  assert independent['project_id']==project2
  passed('independent-project actual P5 create succeeds while another project edit is paused; original shared P5 concurrency retained')
  passed('actual P5 edit holds project/Work/engagement first: batch waits only its bounded budget, returns40001 and persists zero batch effects')
  before=run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands))")
  # The new fail-fast route must not alter table/P5 grants or persist partial batch state.
  assert run("select has_table_privilege('authenticated','public.work_items','UPDATE') or has_any_column_privilege('authenticated','public.work_items','UPDATE')")=='f'
  for h in rows:
   if h['signature'].startswith(('save_p5_work_item(','mutate_p5_work_item_dependency(')):
    assert run('select md5(pg_get_functiondef('+q('public.'+h['signature'])+'::regprocedure))')==h['md5']
  passed('both shared P5 bodies/preimages and direct authenticated mutation permissions remain unchanged')
 elif a.xid_only:
  r=value(review(proposal));rid=uid(940)
  saved=value('savepoint allowed;'+apply(proposal,r['review_sha256'],rid)+';release savepoint allowed')
  assert len(saved['version_bumps'])==1 and run('select count(*) from public.work_item_dependencies')=='1'
  assert '_writer_xid8' not in saved and '_writer_xid8' not in r
  marker=run(f"select payload->>'_writer_xid8' from private.project_work_commands where request_id={q(rid)}");assert marker.isdecimal()
  assert value(apply(proposal,r['review_sha256'],rid))==saved
  passed('real authenticated P5 dependency succeeds inside a savepoint with private full xid8 receipt marker; original replay stable')
  target=next(x['work_item_id'] for x in saved['bindings'] if x['key']=='draft');predecessor=next(x['work_item_id'] for x in saved['bindings'] if x['key']=='brief')
  run(f"""create function public.qa_epoch_marker() returns void language plpgsql security definer set search_path='' as $qa$
  declare current_id numeric:=pg_current_xact_id()::text::numeric;version bigint;begin
   select row_version into version from public.work_items where id={q(target)};
   insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result)
   values({q(org)},{q(project)},auth.uid(),gen_random_uuid(),jsonb_build_object('action','pipeline_work_batch_v1','_writer_xid8',(current_id+4294967296)::text),jsonb_build_object('batch_key','qa-epoch','revision',1,'version_bumps',jsonb_build_array(jsonb_build_object('work_item_id',{q(target)},'depends_on_work_item_id',{q(predecessor)},'before',version,'after',version+1))));
   update public.work_items set updated_at=now() where id={q(target)};
  end;$qa$;grant execute on function public.qa_epoch_marker() to authenticated""")
  before=run(f"select row_version from public.work_items where id={q(target)}");denied('select public.qa_epoch_marker()');assert run(f"select row_version from public.work_items where id={q(target)}")==before and run("select count(*) from private.project_work_commands where result->>'batch_key'='qa-epoch'")=='0'
  passed('simulated receipt has identical low 32 bits but different xid8 epoch: exact transition denied and fake receipt rolled back')
  run(f"create function public.qa_old_xid() returns void language plpgsql security definer set search_path='' as $qa$begin update public.work_items set updated_at=now() where id={q(target)};end;$qa$;grant execute on function public.qa_old_xid() to authenticated")
  denied('select public.qa_old_xid()');passed('prior committed full xid8 receipt cannot authorize a later transaction')
  forged=copy.deepcopy(proposal);forged['_writer_xid8']=marker;denied(review(forged),'22023');passed('caller cannot supply the private server transaction marker through proposal')
  # Every prior card remains pinned when the entire new configuration reuses approved outputs.
  version=uid(950);reference={'artifact_version_id':version,'artifact_type':'content','output_type':'article','approval_id':uid(951)}
  reuse_decisions=[{'key':s['key'],'action':'reuse','artifact_version_id':version} for s in steps];references=[{'step_key':s['key'],'input_key':None,'reference':reference} for s in steps]
  run(f"insert into public.artifact_versions(id,organization_id,artifact_id) values({q(version)},{q(org)},{q(uid(952))});insert into private.qa_sources values({q(version)},true,{j(reference)});update public.project_pipeline_stage_reviews set decisions={j(reuse_decisions)},resolved_artifacts={j(references)}")
  choices={'version':1,'slots':[],'dependencies':[],'asset_links':[]};reviewed=value(review(choices));assert len(reviewed['retained'])==2
  kept=value(apply(choices,reviewed['review_sha256'],uid(953)));assert kept['reviewed_slots']==[] and len(kept['bindings'])==2 and len(kept['retained'])==2
  assert run('select count(*) from public.work_items')=='2' and run('select count(*) from public.work_item_dependencies')=='1'
  assert value(apply(choices,reviewed['review_sha256'],uid(953)))==kept and len(value(context())['prior_slots'])==2 and value(recover(rid))['original_result']==saved
  passed('all approved-output reuse preserves previous Work/edge counts and both retained cards; stable replay/context/original history')
 elif a.empty_only:
  version=uid(890);reference={'artifact_version_id':version,'artifact_type':'content','output_type':'article','approval_id':uid(891)}
  reuse_decisions=[{'key':s['key'],'action':'reuse','artifact_version_id':version} for s in steps]
  references=[{'step_key':s['key'],'input_key':None,'reference':reference} for s in steps]
  run(f"insert into public.artifact_versions(id,organization_id,artifact_id) values({q(version)},{q(org)},{q(uid(892))});insert into private.qa_sources values({q(version)},true,{j(reference)});update public.project_pipeline_stage_reviews set decisions={j(reuse_decisions)},resolved_artifacts={j(references)}")
  choices={'version':1,'slots':[],'dependencies':[],'asset_links':[]};reviewed=value(review(choices));assert reviewed['can_apply'] and reviewed['counts']['slots']==0
  saved=value(apply(choices,reviewed['review_sha256'],uid(893)));assert saved['bindings']==[] and saved['reviewed_slots']==[] and run('select count(*) from public.work_items')=='0'
  assert value(apply(choices,reviewed['review_sha256'],uid(893)))==saved and value(recover(uid(893)))['original_result']==saved
  passed('all approved-output reuse creates no placeholder Work; empty bindings remain arrays with exact replay/recovery')
  assert value(context())['prior_slots']==[] and value(context())['receipt_head']['revision']==1
  passed('later source context reads the zero-run receipt without scalar/null array failure')
 elif a.head_only:
  original=uid(880);r=value(review(proposal));seed=value(apply(proposal,r['review_sha256'],original))
  ctx=value(context());assert ctx['receipt_head']['actor_id']==actor and ctx['receipt_head']['revision']==1
  reuse=copy.deepcopy(proposal)
  for choice in reuse['slots']:
   b=next(x for x in ctx['prior_slots'] if x['key']==choice['key']);choice.update(action='use_existing',work_item_id=b['work_item_id'],row_version=b['row_version'])
  first=value(review(reuse));run(f"insert into public.project_manager_bindings values({q(org)},{q(project)},{q(other)},'active')")
  second=value(review(reuse),who=other);result=value(apply(reuse,second['review_sha256'],original),who=other)
  assert result['revision']==2 and result['parent_receipt']['actor_id']==actor
  ctx=value(context());assert ctx['receipt_head']['request_id']==original and ctx['receipt_head']['actor_id']==other and ctx['receipt_head']['revision']==2
  denied(apply(reuse,first['review_sha256'],uid(881)),'40001');assert run('select count(*) from public.work_items')=='2'
  passed('receipt head pins actor+request+revision+review; equal request UUIDs from two managers cannot bypass head CAS')
  assert value(recover(original))['original_result']==seed and value(recover(original),who=other)['original_result']==result
  passed('same UUID remains independently owned and recoverable for its original actor without Work duplication')
 elif a.safety_only:
  seedreview=value(review(proposal));rid=uid(800)
  with ThreadPoolExecutor(2) as pool:both=list(pool.map(lambda _:value(apply(proposal,seedreview['review_sha256'],rid)),range(2)))
  assert both[0]==both[1] and run('select count(*) from public.work_items')=='2';seed=both[0];passed('concurrent identical original request returns one exact immutable outcome and one batch of cards')
  # An alternate trigger reached DURING the legitimate batch still cannot change anything but its receipt-bound transition.
  ctx=value(context());replacement=copy.deepcopy(proposal)
  for x in replacement['slots']:
   b=next(z for z in ctx['prior_slots'] if z['key']==x['key']);x.update(action='create_replacement',previous_work_item_id=b['work_item_id'],previous_row_version=b['row_version'],material_reason='Reviewed replacement preserves original history')
  reviewed=value(review(replacement));before=run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands),(select sum(row_version) from public.work_items))")
  for index,expr in enumerate(["title='unauthorized'","status='done'","assignee_id="+q(other),"updated_at=now()+interval '1 day'","row_version=row_version+9"]):
   run(f"create function private.qa_edge_callback_{index}() returns trigger language plpgsql security definer set search_path='' as $$begin update public.work_items set {expr} where id=new.work_item_id;return new;end;$$;create trigger qa_callback after insert on public.work_item_dependencies for each row execute function private.qa_edge_callback_{index}()")
   denied(apply(replacement,reviewed['review_sha256'],uid(810+index)),'42501')
   assert run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from private.project_work_commands),(select sum(row_version) from public.work_items))")==before
   run('drop trigger qa_callback on public.work_item_dependencies')
  passed('even inside receipt transaction, alternate substantive/timestamp/version writes deny and roll back links/version/receipt')
  # Existing graph cycle check is the final authority, including edges outside the published stage graph.
  ctx=value(context());swapped=copy.deepcopy(proposal)
  for x in swapped['slots']:
   b=next(z for z in ctx['prior_slots'] if z['key']!=x['key']);x.update(action='use_existing',work_item_id=b['work_item_id'],row_version=b['row_version'],material_reason='Explicit existing-card mapping')
  cycle=value(review(swapped));assert cycle['can_apply'];denied(apply(swapped,cycle['review_sha256'],uid(820)),'P0001');assert value(recover(uid(820)))=={'status':'not_applied'};passed('actual canonical DAG writer rejects an existing Work graph cycle and leaves no batch receipt')
  # Source-scope rejection and immutable store protection, never relaxed table/column grants.
  denied(context(cfg=uid(999)));denied(context().replace(q(eng),q(uid(999))))
  assert run("select has_table_privilege('authenticated','public.work_items','UPDATE') or has_any_column_privilege('authenticated','public.work_items','UPDATE')")=='f'
  assert run("select has_table_privilege('authenticated','public.work_item_dependencies','INSERT')")=='f'
  run("create function public.qa_rewrite_receipt() returns void language plpgsql security definer set search_path='' as $$begin update private.project_work_commands set result='{}';end;$$;grant execute on function public.qa_rewrite_receipt() to authenticated")
  denied('select public.qa_rewrite_receipt()');passed('normal table/column and dependency write grants stay closed; even owner-definer cannot rewrite immutable receipts')
  # Current transaction capability is consumed; a metadata-only callback cannot steal another bump after apply.
  run(f"create function public.qa_guc_forgery() returns void language plpgsql security definer set search_path='' as $$begin perform set_config('anka.pipeline_batch','true',true);update public.work_items set updated_at=now() where id={q(seed['bindings'][0]['work_item_id'])};end;$$;grant execute on function public.qa_guc_forgery() to authenticated")
  denied('select public.qa_guc_forgery()');passed('caller-controlled GUC is not provenance or canonical-writer proof')
  # Canonical Marketing asset source checksum is pinned; no new asset or source is manufactured.
  group,preset,assetid,version=uid(830),uid(831),uid(832),uid(833)
  source={'reference_checksum':'d'*64,'artifact_version_id':version}
  run(f"update public.pipeline_execution_definitions set preset_publication_id={q(preset)};insert into public.project_pipeline_groups values({q(group)},{q(org)},{q(project)},{q(eng)},'marketing',{q(preset)});update public.project_pipeline_configurations set pipeline_group_id={q(group)};insert into private.qa_sources values({q(version)},true,{j(source)});insert into public.project_campaign_assets values({q(assetid)},{q(org)},{q(project)},{q(brand)},'artifact_version',{q(version)},'{{}}',repeat('d',64))")
  part={'kind':'campaign_asset','id':assetid};mp=copy.deepcopy(proposal);mp['asset_links']=[{'key':s['key'],'instance':1,'kind':'campaign_asset','id':assetid} for s in steps]
  mr=value(review(mp,part));msaved=value(apply(mp,mr['review_sha256'],uid(834),part));assert len(msaved['relations'])==2;passed('existing canonical Marketing asset uses actual relation writer; synthetic approved-source lower boundary disclosed')
  run("update private.qa_sources set reference=jsonb_set(reference,'{reference_checksum}',to_jsonb(repeat('e',64)))");denied(context(part=part),'55000');run("update private.qa_sources set reference=jsonb_set(reference,'{reference_checksum}',to_jsonb(repeat('d',64)))");passed('registered campaign reference checksum drift blocks review')
  occurrence=uid(840);run(f"insert into public.recurring_work_occurrences values({q(occurrence)},{q(org)},{q(project)},{q(eng)},{q(svc)},'generated',{q(uid(841))},'2026-11-01','2026-12-01','Asia/Karachi')")
  part={'kind':'recurring_occurrence','id':occurrence};assert value(context(part=part))['creation_allowed'] is False;rr=value(review(proposal,part));assert not rr['can_apply'] and all(x['code']=='partition_reuse_only' for x in rr['blockers']);denied(context(ids=[seed['bindings'][0]['work_item_id']],part=part));passed('existing occurrence cannot generate work or adopt a foreign occurrence card; actual recurring creation remains separate')
  # Observe advisory BEFORE engagement: a waiting batch has not locked engagement yet.
  import time
  with ThreadPoolExecutor(2) as pool:
   holder=pool.submit(run,f"begin;select pg_advisory_xact_lock(hashtextextended('project-setup:'||{q(org)}||':'||{q(project)},0));select pg_sleep(2);commit;")
   time.sleep(.25);waiter=pool.submit(value,context(part={'kind':'campaign_asset','id':assetid}))
   waiting=False
   for _ in range(15):
    if run("select count(*) from pg_locks where locktype='advisory' and not granted")!='0':waiting=True;break
    time.sleep(.05)
   assert waiting,'No observed batch advisory wait'
   assert raw(f'begin;select 1 from public.engagements where id={q(eng)} for update nowait;rollback').returncode==0
   holder.result();waiter.result()
  passed('observed project-setup advisory wait before engagement UPDATE lock; no lock-order inference from source alone')
 else:
  # Independent focused source/asset/provenance cases; no repeat of the unchanged compiler suite.
  seedreview=value(review(proposal));seed=value(apply(proposal,seedreview['review_sha256'],uid(700)))
  wid=seed['bindings'][0]['work_item_id']
  # Alternate writers cannot change substantive fields, jump/reset versions or borrow a prior committed receipt.
  for index,expr in enumerate(["row_version=0","row_version=row_version+9","row_version=null","created_via='manual'","title='forged'","assignee_id="+q(other),"project_id="+q(uid(990)),"updated_at=now()"]):
   run(f"create function public.qa_bad_{index}() returns void language plpgsql security definer set search_path='' as $$begin update public.work_items set {expr} where id={q(wid)};end;$$;grant execute on function public.qa_bad_{index}() to authenticated")
   denied(f'select public.qa_bad_{index}()',code='55000' if index==3 else '23514' if index==6 else '42501')
  passed('alternate definer strict metadata/scope/assignment/version denials; committed receipt cannot be reused as a capability')
  # Exact output-source changes invalidate the reviewed hash and preserve historical cards.
  context0=value(context());reuse=copy.deepcopy(proposal)
  for choice in reuse['slots']:
   b=next(x for x in context0['prior_slots'] if x['key']==choice['key']);choice.update(action='use_existing',work_item_id=b['work_item_id'],row_version=b['row_version'])
  priorhash=value(review(reuse))['review_sha256']
  run(f"update public.project_pipeline_stage_reviews set review_sha256=repeat('b',64),foundation_context='{{\"foundation_checksum\":\"new\"}}';insert into private.qa_foundation values({q(config)},'{{\"foundation_checksum\":\"new\"}}')")
  changed=value(review(reuse));assert not changed['can_apply'] and all(x['material_current'] is False for x in changed['slots']);denied(apply(reuse,priorhash,uid(701)),'40001')
  for x in reuse['slots']:x['material_reason']='Retain exact historical card; review new material separately'
  assert value(review(reuse))['can_apply'];passed('foundation change requires explicit keep-history reasons; source pin never silently upgrades')
  # Quantity increase keeps existing slots and adds only explicit missing instances; decreases retain excess cards.
  decisions2=copy.deepcopy(decisions);decisions2[0]['quantity']=2
  selected2=[{'key':'brief','quantity':2},{'key':'draft','quantity':1}]
  run(f"update public.project_pipeline_configurations set selected_steps={j(selected2)},selected_steps_sha256=encode(sha256(convert_to({j(selected2)}::text,'UTF8')),'hex');update public.project_pipeline_stage_reviews set decisions={j(decisions2)}")
  increased=copy.deepcopy(reuse);increased['slots'].append({'key':'brief','instance':2,'action':'create_missing'});increased['dependencies']=[{'key':'draft','instance':1,'depends_on_key':'brief','depends_on_instance':1}]
  rr=value(review(increased));assert rr['can_apply'];grown=value(apply(increased,rr['review_sha256'],uid(702)));assert sum(x['created'] for x in grown['reviewed_slots'])==1 and run('select count(*) from public.work_items')=='3';passed('quantity increase adds only the reviewed missing card with explicit unequal dependency mapping')
  run(f"update public.project_pipeline_configurations set selected_steps={j([{'key':s['key'],'quantity':1} for s in steps])},selected_steps_sha256=encode(sha256(convert_to({j([{'key':s['key'],'quantity':1} for s in steps])}::text,'UTF8')),'hex');update public.project_pipeline_stage_reviews set decisions={j(decisions)}")
  decreased=copy.deepcopy(reuse);rr=value(review(decreased));assert len(rr['retained'])==1;smaller=value(apply(decreased,rr['review_sha256'],uid(703)));assert len(smaller['bindings'])==3 and run('select count(*) from public.work_items')=='3';passed('quantity decrease retains outside-current card and immutable lineage, never delete/cancel')
  # Real Website helper validates canonical page/architecture identity and exact approval reference.
  group=uid(710);preset=uid(711);content={'pages':[{'page_key':'home','slug':'home','title':'Home','page_type':'hub'}]}
  ref={'artifact_id':arch,'artifact_version_id':archversion,'approval_id':uid(712),'content_checksum':'c'*64}
  run(f"update public.pipeline_execution_definitions set preset_publication_id={q(preset)};insert into public.project_pipeline_groups values({q(group)},{q(org)},{q(project)},{q(eng)},'website',{q(preset)});update public.project_pipeline_configurations set pipeline_group_id={q(group)};insert into public.artifacts(id,organization_id,engagement_id,artifact_type,project_id,brand_id) values({q(arch)},{q(org)},{q(eng)},'website_architecture',{q(project)},{q(brand)});insert into public.artifact_versions values({q(archversion)},{q(org)},{q(arch)},{j(content)},encode(sha256(convert_to({j(content)}::text,'UTF8')),'hex'));insert into private.qa_sources values({q(archversion)},true,{j(ref)});insert into public.project_website_pages values({q(page)},{q(org)},{q(project)},{q(eng)},{q(brand)},{q(arch)},'home')")
  part={'kind':'website_page','id':page,'architecture_version_id':archversion}
  wp=copy.deepcopy(proposal);wp['asset_links']=[{'key':s['key'],'instance':1,'kind':'website_page','id':page} for s in steps]
  denied(context(),code='42501');assert value(context(part=part))['partition_source']['page_key']=='home'
  wr=value(review(wp,part));wsaved=value(apply(wp,wr['review_sha256'],uid(713),part));assert len(wsaved['relations'])==2 and run('select count(*) from private.project_asset_relation_revisions')=='2';passed('actual Website page helper and canonical P5+relation writers create typed page links with no new asset identity')
  run(f"update private.qa_sources set available=false where id={q(archversion)}");denied(context(part=part),'55000');assert value(recover(uid(713)))['original_result']==wsaved;run('update private.qa_sources set available=true');passed('stale exact architecture approval blocks new review but original receipt remains recoverable')
  denied(context(part={**part,'id':uid(999)}));denied(context(part={**part,'architecture_version_id':uid(999)}),'55000')
  # Rollback after all dependency/version changes, at the first relationship write.
  wc=value(context(part=part));replacement=copy.deepcopy(wp)
  for x in replacement['slots']:
   b=next(z for z in wc['prior_slots'] if z['key']==x['key']);x.clear();x.update(key=b['key'],instance=1,action='create_replacement',previous_work_item_id=b['work_item_id'],previous_row_version=b['row_version'],material_reason='Explicit new material; retain old page Work')
  wr=value(review(replacement,part));before=run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from public.work_item_dependencies),(select count(*) from private.project_work_commands),(select count(*) from public.engagement_events))")
  run("create function private.qa_reject_relation() returns trigger language plpgsql as $$begin raise exception 'Synthetic final relation failure' using errcode='55000';end;$$;create trigger qa_late_relation before insert on private.project_asset_relation_revisions for each row execute function private.qa_reject_relation()")
  denied(apply(replacement,wr['review_sha256'],uid(714),part),'55000');assert run("select jsonb_build_array((select count(*) from public.work_items),(select count(*) from public.work_item_dependencies),(select count(*) from private.project_work_commands),(select count(*) from public.engagement_events))")==before;assert value(recover(uid(714)))=={'status':'not_applied'};run('drop trigger qa_late_relation on private.project_asset_relation_revisions');passed('late relation failure rolls back cards, P5 versions, DAG, events and precomputed batch receipt')
  # Genuine service Work creation cannot counterfeit pipeline provenance without a batch receipt.
  run('alter role service_role bypassrls;grant usage on schema private to service_role;grant all on all tables in schema public to service_role')
  for h in rows:
   if 'service_role' in (h.get('proacl') or '') and run('select to_regprocedure('+q(h['signature'])+') is not null')=='t':run('grant execute on function '+h['signature']+' to service_role')
  fakeargs=[org,None,eng,'Not batch Work','','task','medium','not_started',None,'content',None,None,None,None,None,0,None,actor,None,'pipeline_plan'];args=','.join('null' if x is None else str(x) if isinstance(x,int) else q(x) for x in fakeargs)
  before=run('select count(*) from public.work_items');denied('select to_jsonb(public.save_p5_work_item('+args+'))',role='service_role');assert run('select count(*) from public.work_items')==before;passed('receipt-backed deferred attribution denies counterfeit source through actual service P5 create')
  # Current published lineage must use template preset, not confuse it with execution publication ID.
  run(f"update public.project_pipeline_groups set preset_publication_id={q(uid(999))}");denied(context(part=part));run(f"update public.project_pipeline_groups set preset_publication_id={q(preset)}");passed('exact group/template publication lineage denied when changed')
  private_checks=run("select bool_or(has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('project_pipeline_work_scope','project_pipeline_work_context','pipeline_work_version_bump_authorized','compile_project_pipeline_work_batch')")
  assert private_checks=='f';passed('new private source, compiler and receipt-capability helpers remain directly uncallable')
 result={'count':len(checks),'checks':checks,'migration_sha256':hashlib.sha256(migration.encode()).hexdigest(),'port':port,'database':db,'boundary':__doc__}
 (qa/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
finally:
 if started:server([bin/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
