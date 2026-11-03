"""Executed only inside the fresh owned server harness with --scheduler-only.
Actual native wall clock, normal approval/delegation/activation and machine entries.
"""
import time

machine,bad_machine=uid(900),uid(901)
run(f"insert into auth.users(id) values({q(machine)}),({q(bad_machine)});insert into private.recurring_scheduler_principals(actor_id,organization_id,enabled) values({q(machine)},{q(org)},true)")
args=','.join(q(x) for x in [org,project,eng,selected_scope])+',null'
context=value('select public.get_service_recurring_plan_context('+args+')',who=actor)
assert (context['compiled']['deliverable_count'],context['compiled']['work_card_count'],context['compiled']['dependency_count'])==(3,9,6)
due=scheduler_due
assert due['period']==start_date,'Run across midnight must use a newly reviewed local source date'
proposal={**context['proposal'],'scheduler':{'enabled':True,'local_time':due['local_time'],'policy':'ret4_v1'}}
review=value('select public.review_service_recurring_plan('+args+','+j(proposal)+')',who=actor)
created=value('select public.apply_service_recurring_plan('+args+','+j(proposal)+','+q(review['review_sha256'])+','+q(uid(910))+')',who=actor)
assert created['scheduler_consent_created'] and not created['activation_performed'] and not created['work_created']
passed('explicit reviewed opt-in alone records native consent; save still creates no Work or activation')
compiled=review['compiled'];plans={};versions={}
for i,name in enumerate(['positive','late','delegation','consent','source_race','source_denied']):
 if i==0:plan=created['plan_id'];version=created['plan_version_id']
 else:
  plan_row=value('select to_jsonb(public.create_recurring_work_plan('+q(context['context']['primary_engagement_service_id'])+','+q(compiled['title'])+','+q(compiled['scope'])+','+q(compiled['frequency'])+','+q(compiled['timezone'])+','+q(compiled['effective_start'])+','+q(compiled['effective_end'])+','+j(compiled['schedule_definition'])+','+j(compiled['template_items'])+','+q(actor)+'))',role='service_role')
  plan=plan_row['id'];version=run('select id from public.recurring_work_plan_versions where plan_id='+q(plan))
 plans[name]=plan;versions[name]=version
 call(f'select public.approve_recurring_work_plan_version({q(plan)},{q(version)},\'Explicit isolated machine fixture\',{q(actor)});select public.transition_recurring_work_plan({q(plan)},\'active\',\'Explicit native fixture only\',\'No provider execution\',{q(actor)})',role='service_role')
 delegation=value(f'select public.get_recurring_assignment_delegation({q(org)},{q(project)},{q(version)})',who=actor)
 value(f'select public.change_recurring_assignment_delegation({q(org)},{q(project)},{q(version)},true,{q(delegation["token"])},{q(uid(920+i))})',who=actor)
passed('real owner approval, exact-version delegation and lifecycle establish six isolated opted-in fixture plans before due time')
def admit(plan,who=machine):return f'select to_jsonb(public.admit_recurring_schedule({q(plan)},{q(start_date)},{q(who)}))'
def execute(admission,who=machine):return f'select public.execute_recurring_schedule({q(admission)},{q(who)})'
def work_count(plan):return int(run('select count(*) from public.work_items where recurring_plan_id='+q(plan)))
deny(admit(plans['positive'],bad_machine),role='service_role')
deny(admit(plans['positive']),role='authenticated',who=actor)
deny(execute(uid(999)),code='P0002',role='service_role')
passed('actual admission/execute entries deny unregistered machine, authenticated caller and nonexistent claim')
assert work_count(plans['positive'])==0
assert json.loads(run('select jsonb_build_object(\'before_due\',clock_timestamp()<'+q(due['due'])+'::timestamptz)'))['before_due'],'Fixture preparation exceeded future due boundary'
deny(admit(plans['positive']),code='55000',role='service_role');passed('normal scheduler admission cannot bypass the actual future wall-clock due window')
for version in versions.values():
 assert run('select approved_at<'+q(due['due'])+'::timestamptz from public.recurring_work_plan_version_approvals where plan_version_id='+q(version))=='t'
bad_definition=json.loads(json.dumps(compiled['schedule_definition']));bad_definition['service_bridge']['dependencies'][0]['depends_on_template_key']='foreign_template'
deny('select public.create_recurring_work_plan_version('+q(plans['positive'])+','+q(compiled['title'])+','+q(compiled['scope'])+','+q(compiled['frequency'])+','+q(compiled['timezone'])+','+q(compiled['effective_start'])+','+q(compiled['effective_end'])+','+j(bad_definition)+','+j(compiled['template_items'])+','+q(actor)+')',code='40001',role='service_role')
passed('normal existing version writer rejects forged template-edge metadata before any machine claim')
assert run("select private.recurring_due_instant('2027-03-14 02:30'::timestamp,'America/New_York')='2027-03-14 07:00+00'::timestamptz")=='t'
assert run("select private.recurring_due_instant('2027-11-07 01:30'::timestamp,'America/New_York')='2027-11-07 05:30+00'::timestamptz")=='t'
assert run("select private.recurring_retry_deadline('2027-03-15 03:58+00'::timestamptz,'2027-03-14','America/New_York')='2027-03-15 04:00+00'::timestamptz")=='t'
passed('actual calendar/deadline helpers choose first valid DST gap second, earliest fold instant and local-midnight retry cap')
remaining=float(run('select greatest(0,extract(epoch from '+q(due['due'])+'::timestamptz-clock_timestamp()))'))
print(json.dumps({'waiting_for_real_due_seconds':round(remaining,2),'fixture_only':True}),flush=True)
while remaining>0:
 time.sleep(min(remaining+0.1,45))
 remaining=float(run('select greatest(0,extract(epoch from '+q(due['due'])+'::timestamptz-clock_timestamp()))'))
admissions={name:value(admit(plan),role='service_role')['id'] for name,plan in plans.items()}
passed('actual clock admits all exact approved opted-in weekly cycles through the normal machine entry')
run(f"insert into private.recurring_scheduler_principals(actor_id,organization_id,enabled) values({q(bad_machine)},{q(org)},true),({q(actor)},{q(org)},true)")
deny(execute(admissions['positive'],bad_machine),role='service_role')
deny(execute(admissions['positive'],actor),role='service_role')
deny(execute(admissions['positive']),role='authenticated',who=actor)
passed('enabled wrong machine and forged human-as-principal inputs still fail actual claim identity checks')
positive=value(execute(admissions['positive']),role='service_role');assert positive['outcome']=='generated',positive
assert work_count(plans['positive'])==9
assert run('select count(*) from public.work_items where recurring_plan_id='+q(plans['positive'])+' and created_by='+q(machine)+' and assignee_id is null')=='9'
assert run('select count(*) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.recurring_plan_id='+q(plans['positive']))=='6'
assert run('select count(*) from public.organization_memberships where user_id='+q(machine))=='0'
assert value(execute(admissions['positive']),role='service_role')['outcome']=='replayed' and work_count(plans['positive'])==9
passed('exact actual non-member machine creates nine scoped cards/six pinned edges once and replays without impersonating a team owner')
pair=json.loads(run('select jsonb_build_object(\'work\',work_item_id,\'predecessor\',depends_on_work_item_id,\'revision\',w.row_version) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.recurring_plan_id='+q(plans['positive'])+' limit 1'))
deny('select public.mutate_p5_work_item_dependency('+q(org)+",'add',"+q(pair['work'])+','+q(pair['predecessor'])+','+str(pair['revision'])+','+q(machine)+')',role='service_role')
deny('select private.materialize_service_recurring_edges(p,v,'+q(positive['occurrence_id'])+','+q(machine)+','+q('manual')+') from public.recurring_work_plans p join public.recurring_work_plan_versions v on v.id=p.approved_version_id where p.id='+q(plans['positive']),role='service_role')
passed('shared public P5 member authority and direct closed helper permissions remain unavailable to machine caller')
run("create function private.qa_machine_late_edge() returns trigger language plpgsql as $$begin if exists(select 1 from public.work_items where id=new.work_item_id and recurring_plan_id="+q(plans['late'])+") and (select count(*) from public.work_item_dependencies d join public.work_items w on w.id=d.work_item_id where w.recurring_plan_id="+q(plans['late'])+")>=2 then raise exception 'Native late machine edge rejection';end if;return new;end;$$;create trigger qa_machine_late before insert on public.work_item_dependencies for each row execute function private.qa_machine_late_edge();")
failed=value(execute(admissions['late']),role='service_role');assert failed['outcome']=='retryable_failure' and failed['error_code']=='P0001',failed
assert work_count(plans['late'])==0 and run('select count(*) from public.recurring_work_occurrences where plan_id='+q(plans['late']))=='0'
assert run('select count(*) from public.recurring_work_generation_attempts where plan_id='+q(plans['late']))=='0'
run('drop trigger qa_machine_late on public.work_item_dependencies')
assert value(execute(admissions['late']),role='service_role')['outcome']=='generated' and work_count(plans['late'])==9
passed('actual machine entry rolls back every card/edge/occurrence/attempt on late DAG failure and retries the unchanged admitted claim once')
def change_delegation(name,enabled,request_number,version=None):
 version=version or versions[name];d=value(f'select public.get_recurring_assignment_delegation({q(org)},{q(project)},{q(version)})',who=actor)
 return value(f'select public.change_recurring_assignment_delegation({q(org)},{q(project)},{q(version)},{str(enabled).lower()},{q(d["token"])},{q(uid(request_number))})',who=actor)
change_delegation('delegation',False,950)
rejected=value(execute(admissions['delegation']),role='service_role');assert rejected['outcome']=='manual_review' and work_count(plans['delegation'])==0
change_delegation('delegation',True,951)
assert value(execute(admissions['delegation']),role='service_role')['outcome']=='manual_review' and work_count(plans['delegation'])==0
recovery=value('select public.confirm_recurring_work_period('+q(plans['delegation'])+','+q(start_date)+','+q(uid(952))+",'',"+q(actor)+')',role='service_role');assert len(recovery['work_items'])==9
passed('withdrawn delegation closes actual machine claim; restoring authority does not reopen it and explicit owner recovery creates once')
consent_args=','.join(q(x) for x in [org,project,eng,selected_scope,plans['consent']])
no_scheduler={**proposal,'scheduler':None}
review2=value('select public.review_service_recurring_plan('+consent_args+','+j(no_scheduler)+')',who=actor)
opted_out=value('select public.apply_service_recurring_plan('+consent_args+','+j(no_scheduler)+','+q(review2['review_sha256'])+','+q(uid(960))+')',who=actor)
assert not opted_out['scheduler_consent_created']
call(f'select public.approve_recurring_work_plan_version({q(plans["consent"])},{q(opted_out["plan_version_id"])},\'Explicit no-scheduler version\',{q(actor)})',role='service_role')
change_delegation('consent',True,961,opted_out['plan_version_id'])
assert value(execute(admissions['consent']),role='service_role')['outcome']=='manual_review' and work_count(plans['consent'])==0
manual=value('select public.confirm_recurring_work_period('+q(plans['consent'])+','+q(start_date)+','+q(uid(962))+",'',"+q(actor)+')',role='service_role');assert len(manual['work_items'])==9
passed('normal newly approved opt-out version invalidates old machine claim without deleting immutable consent and permits explicit manual recovery')
run("create function private.qa_machine_source_pause() returns trigger language plpgsql as $$begin if new.recurring_plan_id="+q(plans['source_race'])+" and new.recurring_template_key="+q(compiled['template_items'][0]['template_key'])+" then perform pg_sleep(8);end if;return new;end;$$;create trigger qa_machine_source_pause before insert on public.work_items for each row execute function private.qa_machine_source_pause();")
with ThreadPoolExecutor(max_workers=2) as pool:
 generating=pool.submit(value,"set local application_name='bridge-machine-race';"+execute(admissions['source_race']),'service_role')
 for _ in range(15):
  if run("select count(*) from pg_stat_activity where application_name='bridge-machine-race' and wait_event='PgSleep'")=='1':break
  time.sleep(0.1)
 else:raise AssertionError('Generation pause was not observed')
 withdrawing=pool.submit(run,"set application_name='bridge-source-withdrawal';update public.service_catalog set is_active=false where id="+q(contributions[0]['service_id']))
 observed=False
 for _ in range(10):
  if run("select count(*) from pg_stat_activity where application_name='bridge-source-withdrawal' and wait_event_type='Lock'")=='1':observed=True;break
  time.sleep(0.1)
 assert observed,'Actual source withdrawal must wait for generation source locks'
 raced=generating.result();withdrawing.result()
assert raced['outcome']=='generated' and work_count(plans['source_race'])==9
assert value(execute(admissions['source_denied']),role='service_role')['outcome']=='manual_review' and work_count(plans['source_denied'])==0
assert value(execute(admissions['source_race']),role='service_role')['outcome']=='manual_review' and work_count(plans['source_race'])==9
passed('observed source-withdrawal lock race serializes after exact generation; withdrawal blocks later claims/replays while preserving original cards')
run('drop trigger qa_machine_source_pause on public.work_items')
