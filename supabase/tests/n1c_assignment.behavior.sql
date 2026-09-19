begin;
create function pg_temp.save_item(actor text, assignee text default null, via text default 'manual', item uuid default null)
returns public.work_items language sql as $$
  select public.save_work_item(item,pg_temp.id('eng-1'),'Work','Description','task','medium','not_started',
    case when assignee is null then null else pg_temp.id(assignee) end,'design',null,null,null,null,null,0,null,pg_temp.id(actor),via);
$$;
create function pg_temp.edit_task(actor text, assignee text, next_status text default 'backlog', expected bigint default null)
returns public.tasks language sql as $$
  select public.update_p5_project_task(pg_temp.id('org-a'),pg_temp.id('n1c-task'),
    coalesce(expected,(select row_version from public.tasks where id=pg_temp.id('n1c-task'))),next_status,
    case when assignee is null then null else pg_temp.id(assignee) end,null,'evidence',pg_temp.id(actor));
$$;
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('bob')::text,true);
insert into public.tasks(id,project_id,user_id,created_by) values(pg_temp.id('n1c-task'),pg_temp.id('verified'),pg_temp.id('bob'),pg_temp.id('bob'));
select pg_temp.check_true((select assigned_to is null and assigned_by is null from public.tasks where id=pg_temp.id('n1c-task')),'contributor creates unassigned direct task');
select pg_temp.expect_error($q$insert into public.tasks(project_id,user_id,created_by,assigned_to) values(pg_temp.id('verified'),pg_temp.id('bob'),pg_temp.id('bob'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.expect_error($q$update public.tasks set assigned_to=pg_temp.id('bob') where id=pg_temp.id('n1c-task')$q$,'42501');
select pg_temp.expect_error($q$insert into public.tasks(project_id,user_id,created_by) values(pg_temp.id('verified'),pg_temp.id('alice'),pg_temp.id('alice'))$q$,'42501');
select pg_temp.expect_error($q$insert into public.tasks(project_id,user_id,created_by) values(pg_temp.id('foreign-project'),pg_temp.id('bob'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.expect_error($q$select pg_temp.save_item('owner','bob')$q$,'42501');
select pg_temp.expect_error($q$select private.n1c_set_actor(pg_temp.id('owner'))$q$,'42501');
-- Arbitrary client GUC is ignored; actor comes from auth.uid.
select set_config('anka.n1c_actor',pg_temp.id('owner')::text,true);
select pg_temp.expect_error($q$insert into public.tasks(project_id,user_id,created_by,assigned_to) values(pg_temp.id('verified'),pg_temp.id('bob'),pg_temp.id('bob'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.check_true((public.get_assignment_capabilities(pg_temp.id('org-a'),pg_temp.id('verified'))->>'can_assign')::boolean=false,'Contributor Executive designation grants nothing');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('anka.n1c_actor','',true);
set role service_role;
select pg_temp.expect_error($q$select pg_temp.edit_task('bob','bob')$q$,'42501');
select pg_temp.edit_task('alice','bob');
select pg_temp.check_true((select assigned_to=pg_temp.id('bob') and assigned_by=pg_temp.id('alice') from public.tasks where id=pg_temp.id('n1c-task')),'exact-project PM assignment + provenance');
select pg_temp.edit_task('bob','bob','ready');
select pg_temp.check_true((select status='ready' and row_version=3 from public.tasks where id=pg_temp.id('n1c-task')),'assigned execution remains versioned');
select pg_temp.expect_error($q$select pg_temp.edit_task('bob','alice','ready')$q$,'42501');
select pg_temp.expect_error($q$select pg_temp.edit_task('bob',null,'ready')$q$,'42501');
select pg_temp.expect_error($q$select pg_temp.edit_task('bob','bob','in_progress',1)$q$,'40001');
select pg_temp.expect_error($q$select pg_temp.edit_task('title-only','bob','in_progress')$q$,'42501');
select pg_temp.edit_task('elevated','alice','ready');
select pg_temp.edit_task('owner','bob','ready');
select pg_temp.expect_error($q$select pg_temp.edit_task('owner','foreign','ready')$q$,'23514');
-- Real common save wrapper used by alternate entry points, across their exact provenance modes.
do $$
declare via text; item public.work_items;
begin
  foreach via in array array['manual','ai_chat_proposal','quick_task_promotion','automation_rule','recurring_plan'] loop
    perform pg_temp.expect_error(format('select pg_temp.save_item(%L,%L,%L)','bob','bob',via),'42501');
    item := pg_temp.save_item('bob',null,via);
    perform pg_temp.check_true(item.assignee_id is null and item.created_by=pg_temp.id('bob'),'alternate provenance unassigned and actor retained');
  end loop;
  item := pg_temp.save_item('alice','bob');
  perform pg_temp.expect_error(format('select pg_temp.save_item(%L,%L,%L,%L)','bob','alice','manual',item.id),'42501');
  perform pg_temp.save_item('bob','bob','manual',item.id);
  perform pg_temp.expect_error(format('select pg_temp.save_item(%L,%L,%L,%L)','title-only','bob','manual',item.id),'42501');
  -- P5 still checks row version before the common save.
  perform pg_temp.expect_error(format('select public.save_p5_work_item(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,null,null,null,null,null,0,null,%L,1,%L)',
    pg_temp.id('org-a'),item.id,pg_temp.id('eng-1'),'Work','Description','task','medium','not_started',pg_temp.id('bob'),'design',pg_temp.id('bob'),'manual'),'40001');
end $$;
-- Naked privileged updates cannot rely on stale/missing actor identity.
select set_config('anka.n1c_actor','',true);
select pg_temp.expect_error($q$update public.tasks set assigned_to=pg_temp.id('alice') where id=pg_temp.id('n1c-task')$q$,'42501');
select private.n1c_set_actor(pg_temp.id('bob'));
select pg_temp.expect_error($q$update public.tasks set assigned_to=pg_temp.id('alice') where id=pg_temp.id('n1c-task')$q$,'42501');
select pg_temp.expect_error($q$update public.tasks set project_id=pg_temp.id('verified-2') where id=pg_temp.id('n1c-task')$q$,'42501');
select pg_temp.expect_error($q$update public.tasks set user_id=pg_temp.id('alice') where id=pg_temp.id('n1c-task')$q$,'42501');
select pg_temp.expect_error($q$insert into public.work_items(organization_id,project_id,engagement_id,brand_id,title,created_by,assignee_id) values(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('eng-1'),gen_random_uuid(),'Generator',pg_temp.id('bob'),pg_temp.id('bob'))$q$,'42501');
select pg_temp.expect_error($q$insert into public.work_items(organization_id,project_id,engagement_id,brand_id,title,created_by,assignee_id) values(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('eng-1'),gen_random_uuid(),'Scheduler',pg_temp.id('machine'),pg_temp.id('bob'))$q$,'42501');
-- Explicit PM is limited to that exact project, regardless of role title.
select private.n1c_set_actor(pg_temp.id('alice'));
select pg_temp.expect_error($q$insert into public.tasks(organization_id,project_id,user_id,created_by,assigned_to) values(pg_temp.id('org-a'),pg_temp.id('conflict'),pg_temp.id('alice'),pg_temp.id('alice'),pg_temp.id('bob'))$q$,'42501');
reset role;
-- Exercise the real event automation function, not a mock provenance label.
insert into public.automation_rules(organization_id,created_by,trigger_type,enabled,action_type,action_target_status)
values(pg_temp.id('org-a'),pg_temp.id('owner'),'work_item_status_changed',true,'move_status','blocked');
insert into public.automation_rules(organization_id,created_by,trigger_type,enabled,action_type,action_target_status,created_at)
values(pg_temp.id('org-a'),pg_temp.id('owner'),'work_item_status_changed',true,'move_status','done',now()+interval '1 second');
set role service_role;
do $$
declare item public.work_items;
begin
  item := pg_temp.save_item('alice','bob');
  perform public.save_work_item(item.id,item.engagement_id,item.title,item.description,item.work_item_type,item.priority,
    'in_progress',item.assignee_id,item.department_id,null,null,null,null,null,0,null,pg_temp.id('bob'),'manual');
  perform pg_temp.check_true((select status='done' and assignee_id=pg_temp.id('bob') from public.work_items where id=item.id),
    'real automation keeps assignment and permitted execution actor');
  perform pg_temp.expect_error(format('insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload) values(%L,%L,%L,%L,%L::jsonb)',
    item.organization_id,item.engagement_id,'work_item_status_changed',pg_temp.id('title-only'),
    jsonb_build_object('record_id',item.id)),'42501');
end $$;
reset role;
delete from public.automation_rules;
select pg_temp.check_true((select count(*)=3 from private.n1c_assignment_history where record_kind='project_task'),'append-only task assignment history excludes failed writes');
select pg_temp.expect_error('delete from private.n1c_assignment_history','42501');
update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp() where user_id=pg_temp.id('alice');
set role service_role;
select pg_temp.expect_error($q$select pg_temp.edit_task('alice','alice','ready')$q$,'42501');
reset role;
update public.organization_memberships set status='revoked' where user_id=pg_temp.id('bob');
set role service_role;
select pg_temp.expect_error($q$select pg_temp.edit_task('bob','bob','in_progress')$q$,'42501');
reset role;
rollback;
\echo N1-C assignment behavior passed.
