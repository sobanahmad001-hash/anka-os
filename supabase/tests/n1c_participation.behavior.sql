begin;
-- No inferred participation from existing PMs, memberships, ownership or visibility.
select pg_temp.check_true((select count(*)=0 from public.project_department_participation),'no inferred participation');
update public.organization_memberships set role='department_manager',department_id='design' where user_id=pg_temp.id('title-only');
create function pg_temp.participate(dept text, enabled boolean, request text) returns jsonb language sql as $$
 select public.change_project_department_participation(pg_temp.id('org-a'),pg_temp.id('verified'),dept,enabled,
   public.get_project_department_participation(pg_temp.id('org-a'),pg_temp.id('verified'))->>'token',pg_temp.id(request));
$$;
create function pg_temp.work(actor text, dept text, assignee text, item uuid default null) returns public.work_items language sql as $$
 select public.save_work_item(item,pg_temp.id('eng-1'),'Work','Description','task','medium','not_started',
   pg_temp.id(assignee),dept,null,null,null,null,null,0,null,pg_temp.id(actor),'manual');
$$;
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('title-only')::text,true);
select pg_temp.expect_error($q$select pg_temp.participate('design',true,'head-self-enable')$q$,'42501');
select pg_temp.check_true(public.get_assignment_capabilities(pg_temp.id('org-a'),pg_temp.id('verified'))->'assignable_departments'='[]'::jsonb,'head cannot use broad project read');
select set_config('request.jwt.claim.sub',pg_temp.id('alice')::text,true);
select pg_temp.expect_error($q$select pg_temp.participate('design',true,'pm-self-enable')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select pg_temp.expect_error($q$select pg_temp.participate('foreign',true,'foreign-dept')$q$,'42501');
select pg_temp.expect_error($q$select public.get_project_department_participation(pg_temp.id('org-a'),pg_temp.id('foreign-project'))$q$,'42501');
do $$
declare token text; first jsonb; replay jsonb;
begin
 token := public.get_project_department_participation(pg_temp.id('org-a'),pg_temp.id('verified'))->>'token';
 first := public.change_project_department_participation(pg_temp.id('org-a'),pg_temp.id('verified'),'design',true,token,pg_temp.id('include'));
 replay := public.change_project_department_participation(pg_temp.id('org-a'),pg_temp.id('verified'),'design',true,token,pg_temp.id('include'));
 perform pg_temp.check_true(first->>'record_id'=replay->>'record_id' and (replay->>'replayed')::boolean,'identical replay retains record');
 perform pg_temp.expect_error(format('select public.change_project_department_participation(%L,%L,%L,true,%L,%L)',
 pg_temp.id('org-a'),pg_temp.id('verified'),'content',token,pg_temp.id('include')),'23505');
 perform pg_temp.expect_error(format('select public.change_project_department_participation(%L,%L,%L,true,%L,%L)',
 pg_temp.id('org-a'),pg_temp.id('verified'),'content',token,pg_temp.id('stale')),'40001');
end $$;
select pg_temp.expect_error('select * from public.project_department_participation','42501');
select set_config('request.jwt.claim.sub',pg_temp.id('title-only')::text,true);
select pg_temp.check_true(public.get_assignment_capabilities(pg_temp.id('org-a'),pg_temp.id('verified'))->'assignable_departments'='["design"]'::jsonb,'only explicit own department assignable');
insert into public.tasks(id,project_id,department_id,user_id,created_by,assigned_to)
values(pg_temp.id('head-task'),pg_temp.id('verified'),'design',pg_temp.id('title-only'),pg_temp.id('title-only'),pg_temp.id('bob'));
select pg_temp.expect_error($q$insert into public.tasks(project_id,department_id,user_id,created_by,assigned_to) values(pg_temp.id('conflict'),'design',pg_temp.id('title-only'),pg_temp.id('title-only'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.expect_error($q$insert into public.tasks(project_id,department_id,user_id,created_by,assigned_to) values(pg_temp.id('verified'),'content',pg_temp.id('title-only'),pg_temp.id('title-only'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.check_true((public.get_assignment_capabilities(pg_temp.id('org-a'),pg_temp.id('verified'))->'project_tasks'->0->>'can_assign')::boolean
 and not (public.get_assignment_capabilities(pg_temp.id('org-a'),pg_temp.id('verified'))->'project_tasks'->0->>'can_handoff')::boolean,'head assignment is not cross-department handoff');
reset role;
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select pg_temp.expect_error($q$update public.project_department_participation set status='revoked'$q$,'23514');
select pg_temp.expect_error($q$insert into public.project_department_participation(organization_id,project_id,department_id,created_by) values(pg_temp.id('org-a'),pg_temp.id('verified'),'content',pg_temp.id('owner'))$q$,'42501');
select public.update_p5_project_task(pg_temp.id('org-a'),pg_temp.id('head-task'),1,'backlog',pg_temp.id('alice'),null,'',pg_temp.id('title-only'));
do $$
declare own public.work_items; other public.work_items;
begin
 own := pg_temp.work('title-only','design','bob');
 perform pg_temp.expect_error($q$select pg_temp.work('title-only','content','bob')$q$,'42501');
 other := pg_temp.work('alice','content','bob');
 perform pg_temp.expect_error(format('select pg_temp.work(%L,%L,%L,%L)','title-only','design','bob',other.id),'42501');
 perform pg_temp.expect_error(format('select pg_temp.work(%L,%L,%L,%L)','title-only','content','bob',own.id),'42501');
end $$;
reset role;
-- Role changes are current even when compatibility affiliation and inclusion remain.
update public.organization_memberships set role='contributor' where user_id=pg_temp.id('title-only');
set role service_role;
select pg_temp.expect_error($q$select pg_temp.work('title-only','design','bob')$q$,'42501');
reset role;
update public.organization_memberships set role='department_manager',status='revoked' where user_id=pg_temp.id('title-only');
set role service_role;
select pg_temp.expect_error($q$select pg_temp.work('title-only','design','bob')$q$,'42501');
reset role;
update public.organization_memberships set status='active' where user_id=pg_temp.id('title-only');
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('ops')::text,true);
select pg_temp.participate('design',false,'revoke');
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.check_true((select count(*)=1 and bool_and(status='revoked') from public.project_department_participation),'revocation retains history');
select pg_temp.expect_error('delete from public.project_department_participation','42501');
set role service_role;
select pg_temp.expect_error($q$select pg_temp.work('title-only','design','bob')$q$,'42501');
select pg_temp.work('alice','content','bob');
reset role;
rollback;
\echo N1-C explicit participation behavior passed.
