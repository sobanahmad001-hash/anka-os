begin;

create temporary table w1_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_engagement public.engagements;
  v_actor_id uuid;
  v_work_item public.work_items;
  v_non_member_id uuid := gen_random_uuid();
  v_rejected boolean := false;
begin
  select engagement.* into v_engagement
  from public.engagements engagement
  where exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = engagement.organization_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  )
  limit 1;

  if not found then
    insert into w1_runtime_checks values
      ('non_member_assignee_rejected', false),
      ('soft_delete_preserves_row_and_history', false);
    return;
  end if;

  select membership.user_id into v_actor_id
  from public.organization_memberships membership
  where membership.organization_id = v_engagement.organization_id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  limit 1;

  begin
    perform public.save_work_item(
      null, v_engagement.id, 'W1 non-member validation', '', 'task',
      'medium', 'not_started', v_non_member_id, null, null, null, null,
      null, null, 0, v_actor_id
    );
  exception when others then
    v_rejected := sqlerrm like '%Assignee must be an active team member%';
  end;

  insert into w1_runtime_checks values ('non_member_assignee_rejected', v_rejected);

  select * into v_work_item
  from public.save_work_item(
    null, v_engagement.id, 'W1 soft-delete verification', '', 'task',
    'medium', 'not_started', null, null, null, null, null,
    null, null, 0, v_actor_id
  );

  perform public.soft_delete_work_item(v_work_item.id, v_actor_id);

  insert into w1_runtime_checks values (
    'soft_delete_preserves_row_and_history',
    exists (
      select 1 from public.work_items item
      where item.id = v_work_item.id and item.deleted_at is not null
    ) and exists (
      select 1 from public.engagement_events event
      where event.engagement_id = v_engagement.id
        and event.event_type = 'work_item_created'
        and event.payload ->> 'record_id' = v_work_item.id::text
    )
  );
end;
$$;

select jsonb_build_object(
  'exact_w1_columns_exist', (
    select count(*) = 21
      and array_agg(column_name order by ordinal_position) @> array[
        'id', 'organization_id', 'engagement_id', 'brand_id', 'department_id',
        'title', 'description', 'work_item_type', 'priority', 'status',
        'assignee_id', 'created_by', 'linked_artifact_id',
        'linked_artifact_version_id', 'linked_engagement_stage_instance_id',
        'start_date', 'due_date', 'position', 'deleted_at', 'created_at', 'updated_at'
      ]::text[]
    from information_schema.columns
    where table_schema = 'public' and table_name = 'work_items'
  ),
  'rls_and_read_only_browser_boundary',
    (select relrowsecurity from pg_class where oid = 'public.work_items'::regclass)
    and has_table_privilege('authenticated', 'public.work_items', 'SELECT')
    and not has_table_privilege('authenticated', 'public.work_items', 'INSERT')
    and not has_table_privilege('authenticated', 'public.work_items', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.work_items', 'DELETE'),
  'all_work_item_events_allowed', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.engagement_events'::regclass
      and conname = 'engagement_events_event_type_check'
  ) like all (array['%work_item_created%', '%work_item_status_changed%', '%work_item_assigned%']),
  'write_functions_are_service_role_only',
    has_function_privilege('service_role', 'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.soft_delete_work_item(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.soft_delete_work_item(uuid,uuid)', 'EXECUTE'),
  'optional_links_have_no_write_side_effects',
    lower(pg_get_functiondef('public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid)'::regprocedure)) not like '%update public.artifacts%'
    and lower(pg_get_functiondef('public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid)'::regprocedure)) not like '%update public.artifact_versions%'
    and lower(pg_get_functiondef('public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid)'::regprocedure)) not like '%update public.engagement_stage_instances%'
) || (select jsonb_object_agg(check_name, passed) from w1_runtime_checks);

rollback;
