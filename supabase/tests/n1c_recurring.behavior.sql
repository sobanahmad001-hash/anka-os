begin;
insert into private.recurring_scheduler_principals(actor_id,organization_id,enabled) values(pg_temp.id('machine'),pg_temp.id('org-a'),true);
insert into public.recurring_work_plans(id,organization_id,project_id,engagement_id,engagement_service_id,service_id,status_changed_by,created_by)
values(pg_temp.id('plan'),pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('eng-1'),pg_temp.id('service'),pg_temp.id('catalog'),pg_temp.id('bob'),pg_temp.id('bob'));
insert into public.recurring_work_plan_versions(id,organization_id,plan_id,version_number,title,frequency,timezone,effective_start,schedule_definition,created_by)
values(pg_temp.id('version'),pg_temp.id('org-a'),pg_temp.id('plan'),1,'Delegation fixture','weekly','UTC',(clock_timestamp() at time zone 'UTC')::date,
 jsonb_build_object('scheduler',jsonb_build_object('enabled',true,'local_time',to_char(clock_timestamp() at time zone 'UTC','HH24:MI'),'policy','ret4_v1')),pg_temp.id('bob'));
insert into public.recurring_work_plan_template_items(organization_id,plan_id,plan_version_id,template_key,title,department_id,default_assignee_id,position,created_by)
values(pg_temp.id('org-a'),pg_temp.id('plan'),pg_temp.id('version'),'one','One','design',pg_temp.id('bob'),0,pg_temp.id('bob')),
(pg_temp.id('org-a'),pg_temp.id('plan'),pg_temp.id('version'),'two','Two','design',pg_temp.id('alice'),1,pg_temp.id('bob'));
insert into public.recurring_work_plan_version_approvals(organization_id,plan_id,plan_version_id,approved_by,approved_at)
values(pg_temp.id('org-a'),pg_temp.id('plan'),pg_temp.id('version'),pg_temp.id('alice'),clock_timestamp()-interval '1 hour');
update public.recurring_work_plans set status='approved',approved_version_id=pg_temp.id('version') where id=pg_temp.id('plan');
update public.recurring_work_plans set status='active',status_changed_at=clock_timestamp()-interval '1 hour' where id=pg_temp.id('plan');
create function pg_temp.delegate(enabled boolean,request text) returns jsonb language sql as $$
 select public.change_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'),enabled,
 public.get_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'))->>'token',pg_temp.id(request));
$$;
create function pg_temp.admit() returns public.recurring_schedule_admissions language sql as $$
 select public.admit_recurring_schedule(pg_temp.id('plan'),(clock_timestamp() at time zone 'UTC')::date,pg_temp.id('machine'));
$$;
create function pg_temp.execute_schedule() returns jsonb language sql as $$
 select public.execute_recurring_schedule((select id from public.recurring_schedule_admissions where plan_id=pg_temp.id('plan')),pg_temp.id('machine'));
$$;
create function pg_temp.manual() returns jsonb language sql as $$
 select public.confirm_recurring_work_period(pg_temp.id('plan'),(clock_timestamp() at time zone 'UTC')::date,pg_temp.id('manual-request'),'',pg_temp.id('bob'));
$$;
select pg_temp.check_true((select count(*)=0 from private.n1c_recurring_delegations),'no historical delegation backfill');
set role service_role;
select pg_temp.expect_error('select pg_temp.admit()','42501');
select pg_temp.expect_error('select pg_temp.manual()','42501');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('bob')::text,true);
select pg_temp.expect_error($q$select pg_temp.delegate(true,'self-approval')$q$,'42501');
select pg_temp.expect_error('select * from private.n1c_recurring_delegations','42501');
select set_config('request.jwt.claim.sub',pg_temp.id('elevated')::text,true);
select pg_temp.expect_error($q$select pg_temp.delegate(true,'executive-other-project')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.id('alice')::text,true);
do $$
declare token text; receipt jsonb; again jsonb;
begin
 token:=public.get_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'))->>'token';
 receipt:=public.change_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'),true,token,pg_temp.id('approve'));
 again:=public.change_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'),true,token,pg_temp.id('approve'));
 perform pg_temp.check_true(receipt->>'delegation_id'=again->>'delegation_id' and (again->>'replayed')::boolean,'delegation replay stable');
 perform pg_temp.expect_error(format('select public.change_recurring_assignment_delegation(%L,%L,%L,false,%L,%L)',
 pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'),token,pg_temp.id('approve')),'23505');
 perform pg_temp.expect_error(format('select public.change_recurring_assignment_delegation(%L,%L,%L,false,%L,%L)',
 pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'),token,pg_temp.id('stale')),'40001');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$update public.recurring_work_plan_template_items set default_assignee_id=null$q$,'55000');
select pg_temp.expect_error($q$insert into public.recurring_work_plan_template_items(organization_id,plan_id,plan_version_id,template_key,title,department_id,position,created_by) values(pg_temp.id('org-a'),pg_temp.id('plan'),pg_temp.id('version'),'extra','Extra','design',2,pg_temp.id('bob'))$q$,'55000');
set role service_role;
select pg_temp.admit();
reset role;
savepoint admitted;
set role service_role;
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='generated','registered machine reproduces delegated payload');
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='replayed','scheduler retry replays same occurrence');
select pg_temp.expect_error($q$insert into public.work_items(organization_id,project_id,engagement_id,brand_id,department_id,title,description,work_item_type,priority,status,assignee_id,created_by,start_date,due_date,position,created_via,recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key)
 select organization_id,project_id,engagement_id,brand_id,department_id,title,description,work_item_type,priority,'not_started',pg_temp.id('alice'),created_by,start_date,due_date,position,created_via,recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key from public.work_items where recurring_template_key='one'$q$,'42501');
select pg_temp.expect_error($q$insert into public.work_items(organization_id,project_id,engagement_id,brand_id,title,created_by,assignee_id) values(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('eng-1'),gen_random_uuid(),'Unapproved',pg_temp.id('machine'),pg_temp.id('bob'))$q$,'42501');
select private.n1c_set_actor(pg_temp.id('machine'));
select pg_temp.expect_error($q$update public.work_items set title='Machine edited'$q$,'42501');
reset role;
select pg_temp.check_true((select count(*)=2 and bool_and(created_by=pg_temp.id('machine')) from public.work_items),'machine identity retained, no duplicate work');
select pg_temp.check_true((select count(*)=2 and bool_and(delegation_id is not null and actor_id=pg_temp.id('machine')) from private.n1c_assignment_history),'delegation provenance on each assignment');
select pg_temp.check_true((select count(*)=1 from public.recurring_work_occurrences),'one occurrence');
select pg_temp.check_true((select count(*)=1 from public.recurring_work_generation_attempts),'one request receipt');
rollback to admitted;
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select pg_temp.delegate(false,'withdraw');
reset role;
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='manual_review','withdrawn delegation fails closed');
select pg_temp.check_true(pg_temp.execute_schedule()->>'required_action' is not null,'actionable manual review state');
reset role;
select pg_temp.check_true((select count(*)=0 from public.work_items),'withdrawal writes no business rows');
rollback to admitted;
update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp() where user_id=pg_temp.id('alice');
set role service_role;
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='manual_review','approver PM revocation invalidates execution');
reset role;
insert into public.project_manager_bindings(organization_id,project_id,user_id,source) values(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('alice'),'explicit');
select pg_temp.expect_error($q$select private.n1c_require_recurring_delegation(pg_temp.id('plan'),pg_temp.id('version'))$q$,'42501');
rollback to admitted;
update public.organization_memberships set status='revoked' where user_id=pg_temp.id('bob');
set role service_role;
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='manual_review','assignee revocation invalidates execution');
reset role;
rollback to admitted;
update private.recurring_scheduler_principals set enabled=false where actor_id=pg_temp.id('machine');
set role service_role;
select pg_temp.expect_error('select pg_temp.execute_schedule()','42501');
reset role;
rollback to admitted;
update public.projects set archived_at=now() where id=pg_temp.id('verified');
set role service_role;
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='manual_review','archived project invalidates delegation');
reset role;
rollback to admitted;
insert into public.recurring_work_plan_versions(id,organization_id,plan_id,version_number,title,frequency,timezone,effective_start,created_by)
 values(pg_temp.id('version-two'),pg_temp.id('org-a'),pg_temp.id('plan'),2,'Changed assignments','weekly','UTC',(clock_timestamp() at time zone 'UTC')::date,pg_temp.id('bob'));
insert into public.recurring_work_plan_template_items(organization_id,plan_id,plan_version_id,template_key,title,department_id,default_assignee_id,position,created_by)
 values(pg_temp.id('org-a'),pg_temp.id('plan'),pg_temp.id('version-two'),'one','One','design',pg_temp.id('alice'),0,pg_temp.id('bob'));
insert into public.recurring_work_plan_version_approvals(organization_id,plan_id,plan_version_id,approved_by)
 values(pg_temp.id('org-a'),pg_temp.id('plan'),pg_temp.id('version-two'),pg_temp.id('alice'));
select pg_temp.expect_error($q$select private.n1c_require_recurring_delegation(pg_temp.id('plan'),pg_temp.id('version-two'))$q$,'42501');
set role service_role;
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='manual_review','changed applicable version does not inherit delegation');
reset role;
rollback to admitted;
set role service_role;
select pg_temp.manual();
select pg_temp.manual();
select pg_temp.check_true(pg_temp.execute_schedule()->>'outcome'='replayed','manual/scheduled collision shares original occurrence');
reset role;
select pg_temp.check_true((select count(*)=2 and bool_and(created_by=pg_temp.id('bob')) from public.work_items),'manual owner reproduces approved assignments without becoming manager');
select pg_temp.check_true((select count(*)=1 from public.recurring_work_occurrences),'manual retries remain single occurrence');
select pg_temp.expect_error('delete from private.n1c_recurring_delegations','42501');
rollback;
\echo N1-C recurring delegation behavior passed.
