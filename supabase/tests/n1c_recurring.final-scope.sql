-- Delta verification after n1c-recurring-concurrency, using its retained synthetic fixture.
begin;
create function pg_temp.id(text) returns uuid language sql immutable as $$ select md5($1)::uuid $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
  if sqlstate=expected_state then return; end if;
  raise exception 'Expected %, got %: %',expected_state,sqlstate,sqlerrm;
 end;
 raise exception 'Expected rejection but command succeeded';
end; $$;
alter table public.work_items add column linked_page_path text,add column linked_page_key text;
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select public.change_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'),true,
 public.get_recurring_assignment_delegation(pg_temp.id('org-a'),pg_temp.id('verified'),pg_temp.id('version'))->>'token',pg_temp.id('final-approve'));
reset role;
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select public.confirm_recurring_work_period(pg_temp.id('plan'),
 (select effective_start+7 from public.recurring_work_plan_versions where id=pg_temp.id('version')),pg_temp.id('final-period'),'',pg_temp.id('bob'));
select pg_temp.expect_error($q$insert into public.work_items(organization_id,project_id,engagement_id,brand_id,department_id,title,description,work_item_type,priority,status,assignee_id,created_by,start_date,due_date,position,created_via,recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key,linked_page_path)
 select organization_id,project_id,engagement_id,brand_id,department_id,title,description,work_item_type,priority,'not_started',assignee_id,created_by,start_date,due_date,position,created_via,recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key,'/unapproved'
 from public.work_items where created_by=pg_temp.id('bob') and recurring_template_key='one'$q$,'42501');
insert into public.recurring_work_occurrences(id,organization_id,plan_id,plan_version_id,project_id,engagement_id,engagement_service_id,service_id,period_start,period_end,timezone,generated_by)
 select pg_temp.id('malformed-period'),organization_id,plan_id,plan_version_id,project_id,engagement_id,engagement_service_id,service_id,period_start+7,period_end+8,timezone,generated_by
 from public.recurring_work_occurrences where generated_by=pg_temp.id('bob');
select pg_temp.expect_error($q$insert into public.work_items(organization_id,project_id,engagement_id,brand_id,department_id,title,description,work_item_type,priority,status,assignee_id,created_by,start_date,due_date,position,created_via,recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key)
 select organization_id,project_id,engagement_id,brand_id,department_id,title,description,work_item_type,priority,'not_started',assignee_id,created_by,start_date+7,due_date+7,position,created_via,pg_temp.id('malformed-period'),recurring_plan_id,recurring_plan_version_id,recurring_template_key
 from public.work_items where created_by=pg_temp.id('bob') and recurring_template_key='one'$q$,'42501');
reset role;
rollback;
\echo N1-C final recurring scope delta passed: canonical period positive, unapproved page link and malformed period denied.
