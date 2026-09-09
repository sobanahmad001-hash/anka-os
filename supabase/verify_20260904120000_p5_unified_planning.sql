-- Rollback-only verifier for 20260904120000_p5_unified_planning.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table p5_checks(check_name text primary key, passed boolean not null) on commit drop;
create or replace function pg_temp.p5_check(p_name text, p_passed boolean)
returns void language plpgsql as $$
begin
  if not p_passed then raise exception 'P5 verification failed: %', p_name; end if;
  insert into p5_checks values (p_name, true);
end; $$;

do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  perform pg_temp.p5_check('timezone_columns_exact',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='default_timezone' and data_type='text' and is_nullable='YES')
    and exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='planning_timezone' and data_type='text' and is_nullable='YES')
  );
  perform pg_temp.p5_check('task_row_version_exact',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='row_version' and data_type='bigint' and is_nullable='NO' and column_default='1')
    and exists (select 1 from pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_row_version_positive_check' and pg_get_constraintdef(oid)='CHECK ((row_version > 0))')
  );
  perform pg_temp.p5_check('work_item_row_version_exact',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='work_items' and column_name='row_version' and data_type='bigint' and is_nullable='NO' and column_default='1')
    and exists (select 1 from pg_constraint where conrelid='public.work_items'::regclass and conname='work_items_row_version_positive_check' and pg_get_constraintdef(oid)='CHECK ((row_version > 0))')
  );
  perform pg_temp.p5_check('row_version_triggers_exact',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_p5_advance_task_row_version','trg_p5_advance_work_item_row_version') and tgenabled='O')=2
  );
  perform pg_temp.p5_check('timezone_triggers_exact',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_p5_guard_client_default_timezone','trg_p5_guard_project_planning_timezone') and tgenabled='O')=2
  );
  perform pg_temp.p5_check('iana_validation_uses_postgres_catalog',
    pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%pg_catalog.pg_timezone_names%'
    and pg_get_functiondef('public.set_p5_planning_timezone(uuid,text,uuid,text)'::regprocedure) like '%pg_catalog.pg_timezone_names%'
  );
  perform pg_temp.p5_check('timezone_guard_exact_authority',
    pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%system_owner%'
    and pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%operations_admin%'
    and pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%22023%'
    and pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%organization.status = ''active''%'
  );
  perform pg_temp.p5_check('effective_timezone_dynamic_hierarchy',
    pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%planning_timezone%'
    and pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%default_timezone%'
    and pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%UTC%'
    and pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%engagement_type = ''internal''%'
  );
  foreach v_function in array array[
    'public.set_p5_planning_timezone(uuid,text,uuid,text)'::regprocedure,
    'public.p5_effective_project_timezone(uuid,uuid)'::regprocedure,
    'public.update_p5_project_task(uuid,uuid,bigint,text,uuid,date)'::regprocedure,
    'public.update_p5_work_item(uuid,uuid,bigint,uuid,text,date,date)'::regprocedure,
    'public.move_p5_work_item(uuid,uuid,bigint,text,uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    perform pg_temp.p5_check('security_invoker_' || v_function::text,
      exists(select 1 from pg_proc where oid=v_function and prosecdef=false and proconfig=array['search_path=""'])
    );
    perform pg_temp.p5_check('acl_' || v_function::text,
      has_function_privilege('authenticated', v_function, 'EXECUTE')
      and has_function_privilege('service_role', v_function, 'EXECUTE')
      and not has_function_privilege('anon', v_function, 'EXECUTE')
    );
  end loop;
  perform pg_temp.p5_check('task_rpc_checks_expected_version',
    pg_get_functiondef('public.update_p5_project_task(uuid,uuid,bigint,text,uuid,date)'::regprocedure) like '%row_version <> p_expected_row_version%'
    and pg_get_functiondef('public.update_p5_project_task(uuid,uuid,bigint,text,uuid,date)'::regprocedure) like '%40001%'
    and pg_get_functiondef('public.update_p5_project_task(uuid,uuid,bigint,text,uuid,date)'::regprocedure) like '%public.can_access_task%'
  );
  perform pg_temp.p5_check('work_item_rpc_checks_expected_version',
    pg_get_functiondef('public.update_p5_work_item(uuid,uuid,bigint,uuid,text,date,date)'::regprocedure) like '%row_version <> p_expected_row_version%'
    and pg_get_functiondef('public.update_p5_work_item(uuid,uuid,bigint,uuid,text,date,date)'::regprocedure) like '%40001%'
    and pg_get_functiondef('public.update_p5_work_item(uuid,uuid,bigint,uuid,text,date,date)'::regprocedure) like '%is_team_organization_member%'
  );
  perform pg_temp.p5_check('atomic_move_locks_and_orders',
    pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid)'::regprocedure) like '%order by item.id for update%'
    and pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid)'::regprocedure) like '%position = v_position%'
    and pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid)'::regprocedure) like '%40001%'
  );
end; $$;

create temporary table p5_fixture as
select membership.organization_id, membership.user_id actor_id, project.id project_id,
  project.client_id, task.id task_id, task.row_version task_version,
  item.id work_item_id, item.row_version item_version
from public.organization_memberships membership
join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
join public.projects project on project.organization_id=membership.organization_id and project.archived_at is null
join public.tasks task on task.organization_id=project.organization_id and task.project_id=project.id and task.archived_at is null
join public.work_items item on item.organization_id=project.organization_id and item.project_id=project.id and item.deleted_at is null
where membership.member_kind='team' and membership.status='active'
  and membership.role in ('system_owner','operations_admin')
order by membership.organization_id, project.id, task.id, item.id limit 1;

do $$ begin
  if not exists(select 1 from p5_fixture) then
    raise exception 'P5 verifier requires one active owner/admin with a project containing both canonical work types.';
  end if;
end; $$;

grant select on p5_fixture to authenticated;
grant select, insert on p5_checks to authenticated;
select set_config('request.jwt.claim.sub', (select actor_id::text from p5_fixture), true);
set local role authenticated;

do $$
declare f p5_fixture; v_task public.tasks; v_item public.work_items; v_timezone text;
begin
  select * into f from p5_fixture;
  perform public.set_p5_planning_timezone(f.organization_id, 'project', f.project_id, 'Asia/Karachi');
  select public.p5_effective_project_timezone(f.organization_id, f.project_id) into v_timezone;
  perform pg_temp.p5_check('authorized_timezone_write_and_effective_read', v_timezone='Asia/Karachi');
  begin
    perform public.set_p5_planning_timezone(f.organization_id, 'project', f.project_id, 'Not/A_Real_Zone');
    raise exception 'invalid timezone accepted';
  exception when sqlstate '22023' then
    perform pg_temp.p5_check('invalid_timezone_sqlstate', true);
  end;

  select * into v_task from public.update_p5_project_task(
    f.organization_id, f.task_id, f.task_version,
    (select status from public.tasks where id=f.task_id),
    (select assigned_to from public.tasks where id=f.task_id),
    (select due_date from public.tasks where id=f.task_id)
  );
  perform pg_temp.p5_check('task_version_advances_once', v_task.row_version=f.task_version+1);
  begin
    perform public.update_p5_project_task(f.organization_id, f.task_id, f.task_version, v_task.status, v_task.assigned_to, v_task.due_date);
    raise exception 'stale task write accepted';
  exception when sqlstate '40001' then perform pg_temp.p5_check('stale_task_typed_conflict', true); end;

  select * into v_item from public.update_p5_work_item(
    f.organization_id, f.work_item_id, f.item_version,
    (select assignee_id from public.work_items where id=f.work_item_id),
    (select department_id from public.work_items where id=f.work_item_id),
    (select start_date from public.work_items where id=f.work_item_id),
    (select due_date from public.work_items where id=f.work_item_id)
  );
  perform pg_temp.p5_check('work_item_version_advances_once', v_item.row_version=f.item_version+1);
  begin
    perform public.update_p5_work_item(f.organization_id, f.work_item_id, f.item_version, v_item.assignee_id, v_item.department_id, v_item.start_date, v_item.due_date);
    raise exception 'stale work item write accepted';
  exception when sqlstate '40001' then perform pg_temp.p5_check('stale_work_item_typed_conflict', true); end;
end; $$;

reset role;

do $$
declare missing text[];
begin
  select array_agg(required.name order by required.name) into missing
  from (values
    ('timezone_columns_exact'),('task_row_version_exact'),('work_item_row_version_exact'),
    ('row_version_triggers_exact'),('timezone_triggers_exact'),('iana_validation_uses_postgres_catalog'),
    ('timezone_guard_exact_authority'),('effective_timezone_dynamic_hierarchy'),
    ('security_invoker_set_p5_planning_timezone(uuid,text,uuid,text)'),
    ('acl_set_p5_planning_timezone(uuid,text,uuid,text)'),
    ('security_invoker_p5_effective_project_timezone(uuid,uuid)'),
    ('acl_p5_effective_project_timezone(uuid,uuid)'),
    ('security_invoker_update_p5_project_task(uuid,uuid,bigint,text,uuid,date)'),
    ('acl_update_p5_project_task(uuid,uuid,bigint,text,uuid,date)'),
    ('security_invoker_update_p5_work_item(uuid,uuid,bigint,uuid,text,date,date)'),
    ('acl_update_p5_work_item(uuid,uuid,bigint,uuid,text,date,date)'),
    ('security_invoker_move_p5_work_item(uuid,uuid,bigint,text,uuid)'),
    ('acl_move_p5_work_item(uuid,uuid,bigint,text,uuid)'),
    ('task_rpc_checks_expected_version'),('work_item_rpc_checks_expected_version'),
    ('atomic_move_locks_and_orders'),('authorized_timezone_write_and_effective_read'),
    ('invalid_timezone_sqlstate'),('task_version_advances_once'),('stale_task_typed_conflict'),
    ('work_item_version_advances_once'),('stale_work_item_typed_conflict')
  ) required(name)
  left join p5_checks actual on actual.check_name=required.name and actual.passed
  where actual.check_name is null;
  if missing is not null then raise exception 'Missing P5 checks: %', missing; end if;
end; $$;

select check_name, passed from p5_checks order by check_name;
rollback;
