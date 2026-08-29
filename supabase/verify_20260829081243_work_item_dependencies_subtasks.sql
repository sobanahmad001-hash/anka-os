begin;

create temporary table w3_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_engagement public.engagements;
  v_actor_id uuid;
  v_parent public.work_items;
  v_child public.work_items;
  v_a public.work_items;
  v_b public.work_items;
  v_c public.work_items;
  v_rejected boolean;
begin
  select engagement.* into v_engagement
  from public.engagements engagement
  where exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = engagement.organization_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  )
  limit 1;

  if not found then
    insert into w3_runtime_checks values
      ('two_level_subtask_rejected', false),
      ('three_hop_dependency_cycle_rejected', false),
      ('soft_delete_unparents_direct_child', false);
    return;
  end if;

  select membership.user_id into v_actor_id
  from public.organization_memberships membership
  where membership.organization_id = v_engagement.organization_id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  limit 1;

  select * into v_parent from public.save_work_item(
    null, v_engagement.id, 'W3 parent verification', '', 'task', 'medium',
    'not_started', null, null, null, null, null, null, null, 0, null, v_actor_id
  );
  select * into v_child from public.save_work_item(
    null, v_engagement.id, 'W3 child verification', '', 'task', 'medium',
    'not_started', null, null, null, null, null, null, null, 0, v_parent.id, v_actor_id
  );

  v_rejected := false;
  begin
    perform public.save_work_item(
      null, v_engagement.id, 'W3 rejected grandchild', '', 'task', 'medium',
      'not_started', null, null, null, null, null, null, null, 0, v_child.id, v_actor_id
    );
  exception when others then
    v_rejected := sqlerrm like '%one level deep%';
  end;
  insert into w3_runtime_checks values ('two_level_subtask_rejected', v_rejected);

  select * into v_a from public.save_work_item(
    null, v_engagement.id, 'W3 cycle A', '', 'task', 'medium', 'not_started',
    null, null, null, null, null, null, null, 0, null, v_actor_id
  );
  select * into v_b from public.save_work_item(
    null, v_engagement.id, 'W3 cycle B', '', 'task', 'medium', 'not_started',
    null, null, null, null, null, null, null, 0, null, v_actor_id
  );
  select * into v_c from public.save_work_item(
    null, v_engagement.id, 'W3 cycle C', '', 'task', 'medium', 'not_started',
    null, null, null, null, null, null, null, 0, null, v_actor_id
  );

  perform public.save_work_item_dependency(v_a.id, v_b.id, v_actor_id);
  perform public.save_work_item_dependency(v_b.id, v_c.id, v_actor_id);
  v_rejected := false;
  begin
    perform public.save_work_item_dependency(v_c.id, v_a.id, v_actor_id);
  exception when others then
    v_rejected := sqlerrm like '%create a cycle%';
  end;
  insert into w3_runtime_checks values ('three_hop_dependency_cycle_rejected', v_rejected);

  perform public.soft_delete_work_item(v_parent.id, v_actor_id);
  insert into w3_runtime_checks values (
    'soft_delete_unparents_direct_child',
    exists (
      select 1 from public.work_items item
      where item.id = v_parent.id and item.deleted_at is not null
    ) and exists (
      select 1 from public.work_items item
      where item.id = v_child.id and item.parent_work_item_id is null and item.deleted_at is null
    )
  );
end;
$$;

select jsonb_build_object(
  'parent_fk_nulls_only_parent_column', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.work_items'::regclass
      and conname = 'work_items_parent_fk'
  ) like '%ON DELETE SET NULL (parent_work_item_id)%',
  'dependency_rls_and_read_only_browser_boundary',
    (select relrowsecurity from pg_class where oid = 'public.work_item_dependencies'::regclass)
    and has_table_privilege('authenticated', 'public.work_item_dependencies', 'SELECT')
    and not has_table_privilege('authenticated', 'public.work_item_dependencies', 'INSERT')
    and not has_table_privilege('authenticated', 'public.work_item_dependencies', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.work_item_dependencies', 'DELETE'),
  'dependency_writes_are_service_role_only',
    has_function_privilege('service_role', 'public.save_work_item_dependency(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.save_work_item_dependency(uuid,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.remove_work_item_dependency(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.remove_work_item_dependency(uuid,uuid,uuid)', 'EXECUTE')
) || (select jsonb_object_agg(check_name, passed) from w3_runtime_checks);

rollback;
