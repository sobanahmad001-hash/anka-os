begin;

create temporary table qts1_checks (check_name text primary key, passed boolean not null) on commit drop;

do $$
declare
  v_org uuid;
  v_actor uuid;
  v_task public.quick_tasks;
  v_other uuid := gen_random_uuid();
  v_rejected boolean := false;
  v_owner_visible boolean := false;
  v_nonowner_hidden boolean := false;
begin
  select m.organization_id, m.user_id into v_org, v_actor
  from public.organization_memberships m
  where m.member_kind = 'team' and m.status = 'active'
  order by m.created_at limit 1;

  if not found then
    insert into qts1_checks values
      ('owner_can_read_content', false),
      ('non_owner_cannot_read_content', false),
      ('history_is_append_only', false),
      ('create_append_fork_are_atomic', false);
    return;
  end if;

  select * into v_task from public.create_quick_task(v_org, v_actor, 'QTS1 verifier', '{"notes":"private"}'::jsonb);
  perform public.append_quick_task_revision(v_task.id, v_actor, v_task.current_revision_id, 'QTS1 verifier', '{"notes":"private v2"}'::jsonb);
  perform public.fork_quick_task(v_task.id, (select current_revision_id from public.quick_tasks where id = v_task.id), v_actor, 'QTS1 verifier fork');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select
    exists (select 1 from public.quick_tasks where id = v_task.id)
    and exists (select 1 from public.quick_task_revisions where quick_task_id = v_task.id and content ->> 'notes' = 'private v2')
    into v_owner_visible;
  reset role;
  insert into qts1_checks values ('owner_can_read_content', v_owner_visible);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select
    not exists (select 1 from public.quick_tasks where id = v_task.id)
    and not exists (select 1 from public.quick_task_revisions where quick_task_id = v_task.id)
    into v_nonowner_hidden;
  reset role;
  insert into qts1_checks values ('non_owner_cannot_read_content', v_nonowner_hidden);

  begin
    update public.quick_task_revisions set content = '{}'::jsonb where quick_task_id = v_task.id;
  exception when others then v_rejected := sqlerrm like '%append-only%';
  end;
  insert into qts1_checks values ('history_is_append_only', v_rejected);
  insert into qts1_checks values ('create_append_fork_are_atomic',
    (select count(*) = 2 from public.quick_task_revisions where quick_task_id = v_task.id)
    and exists (select 1 from public.quick_tasks where forked_from_quick_task_id = v_task.id)
    and exists (select 1 from public.quick_task_lifecycle_events where quick_task_id = v_task.id and event_type = 'forked_to'));
end;
$$;

select jsonb_build_object(
  'rls_enabled_on_all_tables', (
    select bool_and(relrowsecurity) from pg_class where oid in (
      'public.quick_tasks'::regclass, 'public.quick_task_revisions'::regclass,
      'public.quick_task_lifecycle_events'::regclass
    )
  ),
  'events_are_metadata_only', not exists (
    select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'quick_task_lifecycle_events' and column_name in ('content', 'title', 'body', 'payload')
  ),
  'write_functions_are_service_role_only',
    has_function_privilege('service_role', 'public.create_quick_task(uuid,uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_quick_task(uuid,uuid,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.append_quick_task_revision(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.append_quick_task_revision(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.fork_quick_task(uuid,uuid,uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fork_quick_task(uuid,uuid,uuid,text)', 'EXECUTE'),
  'tenant_safe_composite_foreign_keys', (
    select count(*) = 7 from pg_constraint where conrelid in (
      'public.quick_tasks'::regclass, 'public.quick_task_revisions'::regclass,
      'public.quick_task_lifecycle_events'::regclass
    ) and contype = 'f' and pg_get_constraintdef(oid) like '%organization_id%'
  )
) || (select jsonb_object_agg(check_name, passed order by check_name) from qts1_checks);

rollback;
