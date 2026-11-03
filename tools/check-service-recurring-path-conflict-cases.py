"""Focused normal-entry proof for the server-owned manual/scheduler path.
Membership insertion is an explicit synthetic fixture control in another session.
"""
import time

machine,conflicted=uid(900),uid(902)
run(f"insert into auth.users(id) values({q(machine)}),({q(conflicted)});insert into private.recurring_scheduler_principals(actor_id,organization_id,enabled) values({q(machine)},{q(org)},true),({q(conflicted)},{q(org)},true)")
args=','.join(q(x) for x in [org,project,eng,selected_scope])+',null'
context=value('select public.get_service_recurring_plan_context('+args+')',who=actor)
manual_proposal={**context['proposal'],'scheduler':None}
manual_review=value('select public.review_service_recurring_plan('+args+','+j(manual_proposal)+')',who=actor)
manual=value('select public.apply_service_recurring_plan('+args+','+j(manual_proposal)+','+q(manual_review['review_sha256'])+','+q(uid(10000))+')',who=actor)
due=scheduler_due
assert due['period']==start_date
schedule={'enabled':True,'local_time':due['local_time'],'policy':'ret4_v1'}
sched_review=value('select public.review_service_recurring_plan('+','.join(q(x) for x in [org,project,eng,selected_scope,manual['plan_id']])+','+j({**manual_proposal,'scheduler':schedule})+')',who=actor)
compiled=sched_review['compiled'];plans={'manual':manual['plan_id']};versions={'manual':manual['plan_version_id']}
for name in ['positive','conflict']:
 result=value('select to_jsonb(public.create_recurring_work_plan('+q(context['context']['primary_engagement_service_id'])+','+q(compiled['title'])+','+q(compiled['scope'])+','+q(compiled['frequency'])+','+q(compiled['timezone'])+','+q(compiled['effective_start'])+','+q(compiled['effective_end'])+','+j(compiled['schedule_definition'])+','+j(compiled['template_items'])+','+q(actor)+'))',role='service_role')
 plans[name]=result['id'];versions[name]=run('select id from public.recurring_work_plan_versions where plan_id='+q(result['id']))
for i,name in enumerate(plans):
 call(f'select public.approve_recurring_work_plan_version({q(plans[name])},{q(versions[name])},\'Explicit isolated path fixture\',{q(actor)});select public.transition_recurring_work_plan({q(plans[name])},\'active\',\'Native path fixture only\',\'No provider execution\',{q(actor)})',role='service_role')
 delegation=value(f'select public.get_recurring_assignment_delegation({q(org)},{q(project)},{q(versions[name])})',who=actor)
 value(f'select public.change_recurring_assignment_delegation({q(org)},{q(project)},{q(versions[name])},true,{q(delegation["token"])},{q(uid(10010+i))})',who=actor)
manual_cycle=value('select public.confirm_recurring_work_period('+q(plans['manual'])+','+q(start_date)+','+q(uid(10020))+",'',"+q(actor)+')',role='service_role')
assert len(manual_cycle['work_items'])==9
assert run('select count(*) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.recurring_plan_id='+q(plans['manual']))=='6'
passed('fixed manual call-site path executes actual owner/P5 guards and produces exactly nine cards/six edges')
assert run("select to_regprocedure('private.materialize_service_recurring_edges(public.recurring_work_plans,public.recurring_work_plan_versions,uuid,uuid)') is null")=='t'
assert run("select has_function_privilege('service_role','private.materialize_service_recurring_edges(public.recurring_work_plans,public.recurring_work_plan_versions,uuid,uuid,text)','EXECUTE') or has_function_privilege('authenticated','private.materialize_service_recurring_edges(public.recurring_work_plans,public.recurring_work_plan_versions,uuid,uuid,text)','EXECUTE')")=='f'
passed('required execution path exists only on the closed five-argument helper; no old fallback signature or client/service EXECUTE')
remaining=float(run('select greatest(0,extract(epoch from '+q(due['due'])+'::timestamptz-clock_timestamp()))'))
print(json.dumps({'waiting_for_real_due_seconds':round(remaining,2),'case':'explicit-path-conflict','fixture_only':True}),flush=True)
while remaining>0:
 time.sleep(min(remaining+0.1,45));remaining=float(run('select greatest(0,extract(epoch from '+q(due['due'])+'::timestamptz-clock_timestamp()))'))
def execute(admission,principal):return 'select public.execute_recurring_schedule('+q(admission)+','+q(principal)+')'
admissions={}
for name,principal in [('positive',machine),('conflict',conflicted)]:
 admissions[name]=value('select to_jsonb(public.admit_recurring_schedule('+q(plans[name])+','+q(start_date)+','+q(principal)+'))',role='service_role')['id']
positive=value(execute(admissions['positive'],machine),role='service_role')
assert positive['outcome']=='generated'
assert run('select count(*) from public.work_items where recurring_plan_id='+q(plans['positive'])+' and created_by='+q(machine))=='9'
assert run('select count(*) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.recurring_plan_id='+q(plans['positive']))=='6'
passed('fixed scheduler call-site path reproduces the exact admitted nonmember principal with nine cards/six pinned edges')
last_key=compiled['template_items'][-1]['template_key']
run('create sequence private.qa_path_guard_reached')
run("create function private.qa_path_last_card_pause() returns trigger language plpgsql as $$begin if new.recurring_plan_id="+q(plans['conflict'])+" and new.recurring_template_key="+q(last_key)+" then perform nextval('private.qa_path_guard_reached');perform pg_sleep(15);end if;return new;end;$$;create trigger zzz_path_last_card_pause before insert on public.work_items for each row execute function private.qa_path_last_card_pause();")
run("create function private.qa_path_dependency_probe() returns trigger language plpgsql as $$declare stack text;begin get diagnostics stack=pg_context;if new.created_by="+q(conflicted)+" and position('save_work_item_dependency' in stack)>0 then raise exception 'Member P5 fallback probe reached' using errcode='PMP01';end if;return new;end;$$;create trigger qa_path_dependency_probe before insert on public.work_item_dependencies for each row execute function private.qa_path_dependency_probe();")
def run_conflict_entry():
 sql="begin;set local role service_role;select set_config('request.jwt.claim.sub','',true);"+execute(admissions['conflict'],conflicted)+';commit;'
 env=os.environ.copy();env['PGAPPNAME']='rc-path-race'
 result=subprocess.run([str(bin/'psql.exe'),'-X','-qAt','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',sql],capture_output=True,text=True,encoding='utf-8',creationflags=0x08000000,timeout=35,env=env)
 with (qa/'conflict-entry.log').open('a',encoding='utf-8') as log:log.write(sql+'\n'+result.stdout+result.stderr+'\n')
 assert result.returncode==0,result.stderr
 return json.loads(result.stdout.strip().splitlines()[-1])
with ThreadPoolExecutor(max_workers=2) as pool:
 generating=pool.submit(run_conflict_entry)
 for _ in range(25):
  if run('select is_called from private.qa_path_guard_reached')=='t':break
  if generating.done():raise AssertionError(('Generation finished before the guard-boundary signal',generating.result()))
  time.sleep(0.1)
 else:raise AssertionError('After-final-card-guard sequence signal not observed')
 assert not generating.done(),'Conflict must be inserted before generation resumes'
 # Separate committed fixture write after the last actual N1C BEFORE guard.
 inserted=pool.submit(run,'insert into public.organization_memberships(organization_id,user_id,member_kind,status,role,department_id) values('+q(org)+','+q(conflicted)+",'team','active','contributor','content')")
 inserted.result()
 assert run('select count(*) from public.organization_memberships where user_id='+q(conflicted))=='1'
 result=generating.result()
assert result['outcome']=='manual_review' and result['error_code']=='42501',result
assert run('select count(*) from public.work_items where recurring_plan_id='+q(plans['conflict']))=='0'
assert run('select count(*) from public.recurring_work_occurrences where plan_id='+q(plans['conflict']))=='0'
assert run('select count(*) from public.recurring_work_generation_attempts where plan_id='+q(plans['conflict']))=='0'
passed('observed membership insertion after final card guard/before edges reasserts scheduler identity and atomically rejects instead of reaching member P5 fallback')
pair=json.loads(run('select jsonb_build_object(\'work\',d.work_item_id,\'predecessor\',d.depends_on_work_item_id,\'revision\',w.row_version) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.recurring_plan_id='+q(plans['positive'])+' limit 1'))
before=run('select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.work_items w')
deny('select public.mutate_p5_work_item_dependency('+q(org)+",'add',"+q(pair['work'])+','+q(pair['predecessor'])+','+str(pair['revision'])+','+q(conflicted)+')',code='PMP01',role='service_role')
assert run('select md5(jsonb_agg(to_jsonb(w) order by id)::text) from public.work_items w')==before
passed('dependency probe demonstrably detects the now-member P5 route, while scheduled conflict never reached it and preserved prior cards')
deny(execute(admissions['conflict'],conflicted),role='service_role')
deny('select private.materialize_service_recurring_edges(p,v,'+q(positive['occurrence_id'])+','+q(conflicted)+",'manual') from public.recurring_work_plans p join public.recurring_work_plan_versions v on v.id=p.approved_version_id where p.id="+q(plans['positive']),role='service_role')
passed('conflicted principal remains denied at normal scheduler entry and cannot forge manual mode through the closed helper')
again=value(execute(admissions['positive'],machine),role='service_role')
assert again['outcome']=='replayed'
assert run('select count(*) from public.work_items where recurring_plan_id='+q(plans['positive']))=='9'
passed('separate valid scheduler claim retains exact replay after the conflict; no duplicate cards or authority fallback')
