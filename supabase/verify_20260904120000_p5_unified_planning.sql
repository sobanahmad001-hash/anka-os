-- Rollback-only verifier for 20260904120000_p5_unified_planning.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create temporary table p5_checks(
  check_name text primary key,
  passed boolean not null
) on commit drop;

create or replace function pg_temp.p5_check(p_name text, p_passed boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_passed, false) then
    raise exception 'P5 verification failed: %', p_name;
  end if;
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
  perform pg_temp.p5_check('row_version_columns_exact',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='row_version' and data_type='bigint' and is_nullable='NO' and column_default='1')
    and exists (select 1 from information_schema.columns where table_schema='public' and table_name='work_items' and column_name='row_version' and data_type='bigint' and is_nullable='NO' and column_default='1')
  );
  perform pg_temp.p5_check('row_version_positive_constraints',
    exists (select 1 from pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_row_version_positive_check' and pg_get_constraintdef(oid)='CHECK ((row_version > 0))')
    and exists (select 1 from pg_constraint where conrelid='public.work_items'::regclass and conname='work_items_row_version_positive_check' and pg_get_constraintdef(oid)='CHECK ((row_version > 0))')
  );
  perform pg_temp.p5_check('tenant_safe_composite_foreign_keys',
    exists (select 1 from pg_constraint where conrelid='public.projects'::regclass and conname='projects_client_organization_fkey' and pg_get_constraintdef(oid)='FOREIGN KEY (client_id, organization_id) REFERENCES clients(id, organization_id) ON DELETE SET NULL (client_id)')
    and exists (select 1 from pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_project_organization_fkey' and pg_get_constraintdef(oid)='FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE')
  );
  perform pg_temp.p5_check('row_version_triggers_exact',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_p5_advance_task_row_version','trg_p5_advance_work_item_row_version') and tgenabled='O')=2
  );
  perform pg_temp.p5_check('timezone_triggers_exact',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_p5_guard_client_default_timezone','trg_p5_guard_project_planning_timezone') and tgenabled='O')=2
  );
  perform pg_temp.p5_check('timezone_guard_covers_clear_and_iana',
    pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%is distinct from old.default_timezone%'
    and pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%is distinct from old.planning_timezone%'
    and pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%pg_catalog.pg_timezone_names%'
    and pg_get_functiondef('private.p5_guard_timezone_write()'::regprocedure) like '%22023%'
  );
  perform pg_temp.p5_check('effective_timezone_dynamic_hierarchy',
    pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%planning_timezone%'
    and pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%default_timezone%'
    and pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%engagement_type = ''internal''%'
    and pg_get_functiondef('public.p5_effective_project_timezone(uuid,uuid)'::regprocedure) like '%UTC%'
  );
  perform pg_temp.p5_check('atomic_move_locks_orders_and_returns_changed_rows',
    pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid,uuid)'::regprocedure) like '%pg_advisory_xact_lock%'
    and pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid,uuid)'::regprocedure) like '%order by item.id%for update%'
    and pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid,uuid)'::regprocedure) like '%before-item%'
    and pg_get_functiondef('public.move_p5_work_item(uuid,uuid,bigint,text,uuid,uuid)'::regprocedure) like '%returning item.*%'
  );

  foreach v_function in array array[
    'public.set_p5_planning_timezone(uuid,text,uuid,text,uuid)'::regprocedure,
    'public.update_p5_project_task(uuid,uuid,bigint,text,uuid,date,text,uuid)'::regprocedure,
    'public.transition_p5_project_task(uuid,uuid,bigint,text,text,uuid)'::regprocedure,
    'public.save_p5_work_item(uuid,uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,bigint,text)'::regprocedure,
    'public.delete_p5_work_item(uuid,uuid,bigint,uuid)'::regprocedure,
    'public.acknowledge_p5_work_item_flag(uuid,uuid,bigint,uuid)'::regprocedure,
    'public.mutate_p5_work_item_dependency(uuid,text,uuid,uuid,bigint,uuid)'::regprocedure,
    'public.move_p5_work_item(uuid,uuid,bigint,text,uuid,uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    perform pg_temp.p5_check('service_only_acl_' || v_function::text,
      has_function_privilege('service_role', v_function, 'EXECUTE')
      and not has_function_privilege('authenticated', v_function, 'EXECUTE')
      and not has_function_privilege('anon', v_function, 'EXECUTE')
      and not has_function_privilege('public', v_function, 'EXECUTE')
    );
    perform pg_temp.p5_check('security_invoker_' || v_function::text,
      exists(select 1 from pg_proc where oid=v_function and prosecdef=false and proconfig=array['search_path=""'])
    );
    perform pg_temp.p5_check('authorization_before_version_' || v_function::text,
      position('p5_require_active_actor' in v_definition) > 0
      and (
        position('p5_raise_stale_write' in v_definition) = 0
        or position('p5_require_active_actor' in v_definition) < position('p5_raise_stale_write' in v_definition)
      )
    );
  end loop;

  foreach v_function in array array[
    'private.p5_require_active_actor(uuid,uuid)'::regprocedure,
    'private.p5_raise_stale_write(text,uuid,bigint,bigint)'::regprocedure
  ] loop
    perform pg_temp.p5_check('helper_service_acl_' || v_function::text,
      has_function_privilege('service_role', v_function, 'EXECUTE')
      and not has_function_privilege('authenticated', v_function, 'EXECUTE')
      and not has_function_privilege('anon', v_function, 'EXECUTE')
      and not has_function_privilege('public', v_function, 'EXECUTE')
    );
  end loop;

  perform pg_temp.p5_check('effective_timezone_read_acl',
    has_function_privilege('authenticated', 'public.p5_effective_project_timezone(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.p5_effective_project_timezone(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.p5_effective_project_timezone(uuid,uuid)', 'EXECUTE')
  );
end; $$;

-- Synthetic tenant fixtures. Every row is transaction-local and rolled back.
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('95000000-0000-0000-0000-000000000101','authenticated','authenticated','p5-owner@example.test','{}','{}',now(),now()),
  ('95000000-0000-0000-0000-000000000102','authenticated','authenticated','p5-other@example.test','{}','{}',now(),now());

insert into public.profiles(id, full_name, role)
values
  ('95000000-0000-0000-0000-000000000101','P5 Owner','member'),
  ('95000000-0000-0000-0000-000000000102','P5 Other','member')
on conflict (id) do update set full_name=excluded.full_name;

insert into public.organizations(id,name,slug,status) values
  ('95000000-0000-0000-0000-000000000001','P5 A','p5-a','active'),
  ('95000000-0000-0000-0000-000000000002','P5 B','p5-b','active');

insert into public.organization_memberships(organization_id,user_id,member_kind,role,status) values
  ('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000101','team','system_owner','active'),
  ('95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000102','team','system_owner','active');

insert into public.clients(id,organization_id,name,company,status,owner_id) values
  ('95000000-0000-0000-0000-000000000201','95000000-0000-0000-0000-000000000001','P5 Client A','P5 Client A','active','95000000-0000-0000-0000-000000000101'),
  ('95000000-0000-0000-0000-000000000202','95000000-0000-0000-0000-000000000002','P5 Client B','P5 Client B','active','95000000-0000-0000-0000-000000000102');

insert into public.agency_clients(
  id,organization_id,legacy_client_id,canonical_client_id,name,status,owner_id,created_by
) values
  ('95000000-0000-0000-0000-000000000211','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000201','95000000-0000-0000-0000-000000000201','P5 Agency Client A','active','95000000-0000-0000-0000-000000000101','95000000-0000-0000-0000-000000000101'),
  ('95000000-0000-0000-0000-000000000212','95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000202','95000000-0000-0000-0000-000000000202','P5 Agency Client B','active','95000000-0000-0000-0000-000000000102','95000000-0000-0000-0000-000000000102');

insert into public.projects(id,organization_id,client_id,name,engagement_type,status,owner_id) values
  ('95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000201','P5 Project A','project','active','95000000-0000-0000-0000-000000000101'),
  ('95000000-0000-0000-0000-000000000302','95000000-0000-0000-0000-000000000001',null,'P5 Internal','internal','active','95000000-0000-0000-0000-000000000101'),
  ('95000000-0000-0000-0000-000000000303','95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000202','P5 Project B','project','active','95000000-0000-0000-0000-000000000102');

insert into public.brands(id,organization_id,client_id,name,status,created_by)
values ('95000000-0000-0000-0000-000000000401','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000211','P5 Brand','active','95000000-0000-0000-0000-000000000101');

insert into public.engagements(
  id,organization_id,client_id,brand_id,legacy_project_id,project_id,name,status,created_by
) values (
  '95000000-0000-0000-0000-000000000501','95000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000211','95000000-0000-0000-0000-000000000401',
  '95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000301',
  'P5 Engagement','active','95000000-0000-0000-0000-000000000101'
);

insert into public.tasks(
  id,organization_id,project_id,user_id,created_by,assigned_to,title,status,due_date
) values (
  '95000000-0000-0000-0000-000000000601','95000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000101',
  '95000000-0000-0000-0000-000000000101','95000000-0000-0000-0000-000000000101',
  'P5 Task','ready','2026-10-10'
);

insert into public.work_items(
  id,organization_id,engagement_id,project_id,brand_id,title,status,position,created_by
) values
  ('95000000-0000-0000-0000-000000000701','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000501','95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000401','P5 Item 1','not_started',1000,'95000000-0000-0000-0000-000000000101'),
  ('95000000-0000-0000-0000-000000000702','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000501','95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000401','P5 Item 2','not_started',2000,'95000000-0000-0000-0000-000000000101'),
  ('95000000-0000-0000-0000-000000000703','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000501','95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000401','P5 Item 3','done',1000,'95000000-0000-0000-0000-000000000101');

grant select, insert on p5_checks to service_role, authenticated;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '95000000-0000-0000-0000-000000000101', true);
set local role service_role;

do $$
declare
  v_task public.tasks;
  v_item public.work_items;
  v_payload jsonb;
  v_message text;
  v_timezone text;
  v_changed integer;
  v_assignee uuid;
  v_due date;
begin
  perform public.set_p5_planning_timezone(
    '95000000-0000-0000-0000-000000000001','client','95000000-0000-0000-0000-000000000201','Asia/Karachi','95000000-0000-0000-0000-000000000101'
  );
  select public.p5_effective_project_timezone('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000301') into v_timezone;
  perform pg_temp.p5_check('client_timezone_dynamic_inheritance', v_timezone='Asia/Karachi');

  perform public.set_p5_planning_timezone(
    '95000000-0000-0000-0000-000000000001','project','95000000-0000-0000-0000-000000000301','Europe/London','95000000-0000-0000-0000-000000000101'
  );
  select public.p5_effective_project_timezone('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000301') into v_timezone;
  perform pg_temp.p5_check('project_timezone_override', v_timezone='Europe/London');

  perform public.set_p5_planning_timezone(
    '95000000-0000-0000-0000-000000000001','project','95000000-0000-0000-0000-000000000301',null,'95000000-0000-0000-0000-000000000101'
  );
  select public.p5_effective_project_timezone('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000301') into v_timezone;
  perform pg_temp.p5_check('governed_timezone_clear_restores_inheritance', v_timezone='Asia/Karachi');
  select public.p5_effective_project_timezone('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000302') into v_timezone;
  perform pg_temp.p5_check('internal_project_defaults_utc', v_timezone='UTC');

  begin
    perform public.set_p5_planning_timezone(
      '95000000-0000-0000-0000-000000000001','project','95000000-0000-0000-0000-000000000301','Not/A_Real_Zone','95000000-0000-0000-0000-000000000101'
    );
    raise exception 'invalid timezone accepted';
  exception when sqlstate '22023' then
    perform pg_temp.p5_check('invalid_timezone_sqlstate_22023', true);
  end;

  begin
    perform public.set_p5_planning_timezone(
      '95000000-0000-0000-0000-000000000001','project','95000000-0000-0000-0000-000000000301','UTC','95000000-0000-0000-0000-000000000102'
    );
    raise exception 'cross-organization actor accepted';
  exception when insufficient_privilege then
    perform pg_temp.p5_check('cross_organization_actor_rejected_before_lookup', true);
  end;

  -- The governed Edge service invokes mutation RPCs with the actor as an
  -- explicit argument; its service credential intentionally has no user sub.
  perform set_config('request.jwt.claim.sub', '', true);

  select * into v_task from public.update_p5_project_task(
    '95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000601',1,
    'in_progress','95000000-0000-0000-0000-000000000101','2026-10-11','first edit','95000000-0000-0000-0000-000000000101'
  );
  perform pg_temp.p5_check('project_task_update_advances_once', v_task.row_version=2);

  v_assignee := v_task.assigned_to;
  v_due := v_task.due_date;
  select * into v_task from public.transition_p5_project_task(
    '95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000601',2,
    'blocked','transition only','95000000-0000-0000-0000-000000000101'
  );
  perform pg_temp.p5_check('task_transition_preserves_nontransition_fields',
    v_task.row_version=3 and v_task.assigned_to=v_assignee and v_task.due_date=v_due and v_task.completion_evidence='transition only'
  );

  begin
    perform public.transition_p5_project_task(
      '95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000601',2,
      'ready','stale','95000000-0000-0000-0000-000000000101'
    );
    raise exception 'stale task accepted';
  exception when sqlstate '40001' then
    get stacked diagnostics v_message = message_text;
    v_payload := v_message::jsonb;
    perform pg_temp.p5_check('stale_task_exact_typed_payload',
      v_payload=jsonb_build_object(
        'code','stale_write','recordKind','project_task','recordId','95000000-0000-0000-0000-000000000601'::uuid,
        'expectedRowVersion',2,'currentRowVersion',3
      )
    );
  end;

  select * into v_item from public.save_p5_work_item(
    '95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000702','95000000-0000-0000-0000-000000000501',
    'P5 Item 2 edited','','task','medium','in_progress',null,null,null,null,null,null,null,2000,null,
    '95000000-0000-0000-0000-000000000101',1,'manual'
  );
  perform pg_temp.p5_check('work_item_save_advances_once', v_item.row_version=2 and v_item.title='P5 Item 2 edited');

  begin
    perform public.save_p5_work_item(
      '95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000702','95000000-0000-0000-0000-000000000501',
      'stale','','task','medium','in_progress',null,null,null,null,null,null,null,2000,null,
      '95000000-0000-0000-0000-000000000101',1,'manual'
    );
    raise exception 'stale work item accepted';
  exception when sqlstate '40001' then
    get stacked diagnostics v_message = message_text;
    v_payload := v_message::jsonb;
    perform pg_temp.p5_check('stale_work_item_exact_typed_payload',
      v_payload=jsonb_build_object(
        'code','stale_write','recordKind','engagement_work_item','recordId','95000000-0000-0000-0000-000000000702'::uuid,
        'expectedRowVersion',1,'currentRowVersion',2
      )
    );
  end;

  select count(*) into v_changed from public.move_p5_work_item(
    '95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000701',1,
    'done','95000000-0000-0000-0000-000000000703','95000000-0000-0000-0000-000000000101'
  );
  perform pg_temp.p5_check('atomic_move_returns_all_changed_rows', v_changed=2);
  perform pg_temp.p5_check('atomic_move_before_item_order',
    (select status='done' and position=1000 from public.work_items where id='95000000-0000-0000-0000-000000000701')
    and (select status='done' and position=2000 from public.work_items where id='95000000-0000-0000-0000-000000000703')
  );

  begin
    update public.tasks set row_version=99 where id='95000000-0000-0000-0000-000000000601';
    raise exception 'caller task row_version write accepted';
  exception when insufficient_privilege then
    perform pg_temp.p5_check('caller_task_row_version_rejected', true);
  end;
  begin
    update public.work_items set row_version=99 where id='95000000-0000-0000-0000-000000000702';
    raise exception 'caller work item row_version write accepted';
  exception when insufficient_privilege then
    perform pg_temp.p5_check('caller_work_item_row_version_rejected', true);
  end;
end; $$;

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '95000000-0000-0000-0000-000000000101', true);
set local role authenticated;

do $$
begin
  begin
    update public.clients
    set default_timezone = null
    where id='95000000-0000-0000-0000-000000000201';
    raise exception 'direct timezone clear accepted';
  exception when insufficient_privilege then
    perform pg_temp.p5_check('direct_authenticated_timezone_clear_rejected', true);
  end;
end; $$;

reset role;

do $$
begin
  begin
    insert into public.projects(id,organization_id,client_id,name,engagement_type,status)
    values (
      '95000000-0000-0000-0000-000000000399','95000000-0000-0000-0000-000000000001',
      '95000000-0000-0000-0000-000000000202','mismatch','project','active'
    );
    raise exception 'cross-tenant Project to Client accepted';
  exception when foreign_key_violation then
    perform pg_temp.p5_check('cross_tenant_project_client_fk_rejected', true);
  end;

  begin
    insert into public.tasks(id,organization_id,project_id,user_id,title,status)
    values (
      '95000000-0000-0000-0000-000000000699','95000000-0000-0000-0000-000000000002',
      '95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000102','mismatch','ready'
    );
    raise exception 'cross-tenant Task to Project accepted';
  exception when foreign_key_violation then
    perform pg_temp.p5_check('cross_tenant_task_project_fk_rejected', true);
  end;
end; $$;

select pg_temp.p5_check('minimum_complete_check_set', count(*) >= 43) from p5_checks;
select check_name, passed from p5_checks order by check_name;
rollback;
