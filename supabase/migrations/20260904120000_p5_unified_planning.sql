-- P5: unified planning with native lifecycles and governed optimistic concurrency.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.clients add column default_timezone text;
alter table public.projects add column planning_timezone text;
alter table public.tasks add column row_version bigint not null default 1;
alter table public.work_items add column row_version bigint not null default 1;
alter table public.tasks add constraint tasks_row_version_positive_check check (row_version > 0);
alter table public.work_items add constraint work_items_row_version_positive_check check (row_version > 0);

-- Refuse to install tenant-covering foreign keys over inconsistent legacy rows.
do $$
begin
  if exists (
    select 1 from public.projects project
    join public.clients client on client.id = project.client_id
    where project.client_id is not null
      and client.organization_id <> project.organization_id
  ) then
    raise exception 'P5 preflight failed: Project and Client organization mismatch.';
  end if;
  if exists (
    select 1 from public.tasks task
    join public.projects project on project.id = task.project_id
    where task.organization_id <> project.organization_id
  ) then
    raise exception 'P5 preflight failed: Project Task and Project organization mismatch.';
  end if;
end; $$;

alter table public.projects
  add constraint projects_client_organization_fkey
  foreign key (client_id, organization_id)
  references public.clients(id, organization_id)
  on delete set null (client_id);

alter table public.tasks
  add constraint tasks_project_organization_fkey
  foreign key (project_id, organization_id)
  references public.projects(id, organization_id)
  on delete cascade;

create index idx_tasks_project_planning_order
  on public.tasks(project_id, due_date asc nulls last, created_at, id)
  where archived_at is null;

create function private.p5_require_active_actor(
  p_organization_id uuid,
  p_actor_id uuid
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1
  from public.organizations organization
  join public.organization_memberships membership
    on membership.organization_id = organization.id
   and membership.user_id = p_actor_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  where organization.id = p_organization_id
    and organization.status = 'active';
  if not found then
    raise insufficient_privilege using message = 'Active selected organization membership is required.';
  end if;
end; $$;

create function private.p5_raise_stale_write(
  p_record_kind text,
  p_record_id uuid,
  p_expected_row_version bigint,
  p_current_row_version bigint
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception '%', jsonb_build_object(
    'code', 'stale_write',
    'recordKind', p_record_kind,
    'recordId', p_record_id,
    'expectedRowVersion', p_expected_row_version,
    'currentRowVersion', p_current_row_version
  )::text using errcode = '40001';
end; $$;

create function private.p5_guard_timezone_write()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_timezone text;
  v_changed boolean;
begin
  if tg_table_name = 'clients' then
    v_timezone := new.default_timezone;
    v_changed := (tg_op = 'INSERT' and new.default_timezone is not null)
      or (tg_op = 'UPDATE' and new.default_timezone is distinct from old.default_timezone);
  elsif tg_table_name = 'projects' then
    v_timezone := new.planning_timezone;
    v_changed := (tg_op = 'INSERT' and new.planning_timezone is not null)
      or (tg_op = 'UPDATE' and new.planning_timezone is distinct from old.planning_timezone);
  else
    raise exception 'Unsupported planning timezone trigger table.' using errcode = '22023';
  end if;
  if not v_changed then return new; end if;
  if coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Planning timezone changes require the governed server command.';
  end if;
  if v_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_timezone
  ) then
    raise exception 'Planning timezone must be a valid IANA timezone.'
      using errcode = '22023';
  end if;
  return new;
end; $$;

create trigger trg_p5_guard_client_default_timezone
before insert or update of default_timezone on public.clients
for each row execute function private.p5_guard_timezone_write();

create trigger trg_p5_guard_project_planning_timezone
before insert or update of planning_timezone on public.projects
for each row execute function private.p5_guard_timezone_write();

create function private.p5_advance_row_version()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.row_version is distinct from old.row_version then
    raise insufficient_privilege using message = 'row_version is managed by the database.';
  end if;
  new.row_version := old.row_version + 1;
  return new;
end; $$;

create trigger trg_p5_advance_task_row_version
before update on public.tasks
for each row execute function private.p5_advance_row_version();

create trigger trg_p5_advance_work_item_row_version
before update on public.work_items
for each row execute function private.p5_advance_row_version();

create function public.p5_effective_project_timezone(
  p_organization_id uuid,
  p_project_id uuid
) returns text
language sql stable security invoker set search_path = ''
as $$
  select case when project.engagement_type = 'internal'
    then coalesce(project.planning_timezone, 'UTC')
    else coalesce(project.planning_timezone, client.default_timezone, 'UTC')
  end
  from public.projects project
  join public.organizations organization
    on organization.id = project.organization_id
   and organization.status = 'active'
  left join public.clients client
    on client.id = project.client_id
   and client.organization_id = project.organization_id
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and public.is_team_organization_member(project.organization_id);
$$;

create function public.set_p5_planning_timezone(
  p_organization_id uuid,
  p_record_kind text,
  p_record_id uuid,
  p_timezone text,
  p_actor_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_timezone text := nullif(trim(coalesce(p_timezone, '')), '');
begin
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
  ) then
    raise insufficient_privilege using message = 'System Owner or Operations Admin authority is required.';
  end if;
  if p_record_kind not in ('client', 'project') then
    raise exception 'Planning timezone target must be client or project.' using errcode = '22023';
  end if;
  if v_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_timezone
  ) then
    raise exception 'Planning timezone must be a valid IANA timezone.' using errcode = '22023';
  end if;
  if p_record_kind = 'client' then
    update public.clients
    set default_timezone = v_timezone
    where id = p_record_id and organization_id = p_organization_id;
  else
    update public.projects
    set planning_timezone = v_timezone
    where id = p_record_id and organization_id = p_organization_id;
  end if;
  if not found then
    raise insufficient_privilege using message = 'Planning timezone target is unavailable.';
  end if;
  return jsonb_build_object(
    'recordKind', p_record_kind,
    'recordId', p_record_id,
    'timezone', v_timezone
  );
end; $$;

create function public.update_p5_project_task(
  p_organization_id uuid,
  p_task_id uuid,
  p_expected_row_version bigint,
  p_status text,
  p_assigned_to uuid,
  p_due_date date,
  p_completion_evidence text,
  p_actor_id uuid
) returns public.tasks
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  -- Organization authorization intentionally precedes record lookup/version disclosure.
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);

  select task.* into v_task
  from public.tasks task
  where task.id = p_task_id
    and task.organization_id = p_organization_id
    and task.archived_at is null
  for update;

  if not found then
    raise insufficient_privilege using message = 'Project Task is unavailable.';
  end if;

  if not (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = p_actor_id
        and membership.member_kind = 'team'
        and membership.status = 'active'
        and membership.role in ('system_owner', 'operations_admin', 'executive')
    )
    or v_task.user_id = p_actor_id
    or v_task.assigned_to = p_actor_id
    or exists (
      select 1 from public.profiles profile
      where profile.id = p_actor_id
        and profile.role = 'department_head'
        and profile.department = v_task.department_id
    )
  ) then
    raise insufficient_privilege using message = 'Project Task is unavailable.';
  end if;

  if p_expected_row_version is null
     or p_expected_row_version <> v_task.row_version then
    perform private.p5_raise_stale_write(
      'project_task', p_task_id, p_expected_row_version, v_task.row_version
    );
  end if;

  if p_assigned_to is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_assigned_to
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Assignee must be an active team member.' using errcode = '23514';
  end if;

  update public.tasks
  set status = p_status,
      assigned_to = p_assigned_to,
      due_date = p_due_date,
      completion_evidence = left(trim(coalesce(p_completion_evidence, '')), 20000)
  where id = v_task.id
  returning * into v_task;
  return v_task;
end; $$;

create function public.transition_p5_project_task(
  p_organization_id uuid,
  p_task_id uuid,
  p_expected_row_version bigint,
  p_status text,
  p_completion_evidence text,
  p_actor_id uuid
) returns public.tasks
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  -- Authorization precedes lookup so foreign IDs and versions cannot be disclosed.
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);

  select task.* into v_task
  from public.tasks task
  where task.id = p_task_id
    and task.organization_id = p_organization_id
    and task.archived_at is null
  for update;
  if not found then
    raise insufficient_privilege using message = 'Project Task is unavailable.';
  end if;

  if not (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = p_actor_id
        and membership.member_kind = 'team'
        and membership.status = 'active'
        and membership.role in ('system_owner', 'operations_admin', 'executive')
    )
    or v_task.user_id = p_actor_id
    or v_task.assigned_to = p_actor_id
    or exists (
      select 1 from public.profiles profile
      where profile.id = p_actor_id
        and profile.role = 'department_head'
        and profile.department = v_task.department_id
    )
  ) then
    raise insufficient_privilege using message = 'Project Task is unavailable.';
  end if;

  if p_expected_row_version is null
     or p_expected_row_version <> v_task.row_version then
    perform private.p5_raise_stale_write(
      'project_task', p_task_id, p_expected_row_version, v_task.row_version
    );
  end if;

  update public.tasks
  set status = p_status,
      completion_evidence = left(trim(coalesce(p_completion_evidence, '')), 20000)
  where id = v_task.id
  returning * into v_task;
  return v_task;
end; $$;

create function public.save_p5_work_item(
  p_organization_id uuid,
  p_work_item_id uuid,
  p_engagement_id uuid,
  p_title text,
  p_description text,
  p_work_item_type text,
  p_priority text,
  p_status text,
  p_assignee_id uuid,
  p_department_id text,
  p_linked_artifact_id uuid,
  p_linked_artifact_version_id uuid,
  p_linked_engagement_stage_instance_id uuid,
  p_start_date date,
  p_due_date date,
  p_position integer,
  p_parent_work_item_id uuid,
  p_actor_id uuid,
  p_expected_row_version bigint,
  p_created_via text default 'manual'
) returns public.work_items
language plpgsql security invoker set search_path = ''
as $$
declare
  v_current public.work_items;
  v_result public.work_items;
begin
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);

  perform 1 from public.engagements engagement
  where engagement.id = p_engagement_id
    and engagement.organization_id = p_organization_id
  for share;
  if not found then
    raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
  end if;

  if p_work_item_id is not null then
    select item.* into v_current
    from public.work_items item
    where item.id = p_work_item_id
      and item.organization_id = p_organization_id
      and item.engagement_id = p_engagement_id
      and item.deleted_at is null
    for update;
    if not found then
      raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
    end if;
    if p_expected_row_version is null
       or p_expected_row_version <> v_current.row_version then
      perform private.p5_raise_stale_write(
        'engagement_work_item', p_work_item_id,
        p_expected_row_version, v_current.row_version
      );
    end if;
  elsif p_expected_row_version is not null then
    raise exception 'New work items cannot supply an expected row version.' using errcode = '22023';
  end if;

  select * into v_result
  from public.save_work_item(
    p_work_item_id, p_engagement_id, p_title, p_description,
    p_work_item_type, p_priority, p_status, p_assignee_id,
    p_department_id, p_linked_artifact_id, p_linked_artifact_version_id,
    p_linked_engagement_stage_instance_id, p_start_date, p_due_date,
    p_position, p_parent_work_item_id, p_actor_id, p_created_via
  );
  return v_result;
end; $$;

create function public.delete_p5_work_item(
  p_organization_id uuid,
  p_work_item_id uuid,
  p_expected_row_version bigint,
  p_actor_id uuid
) returns public.work_items
language plpgsql security invoker set search_path = ''
as $$
declare
  v_item public.work_items;
begin
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);
  select item.* into v_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.deleted_at is null
  for update;
  if not found then
    raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
  end if;
  if p_expected_row_version is null
     or p_expected_row_version <> v_item.row_version then
    perform private.p5_raise_stale_write(
      'engagement_work_item', p_work_item_id,
      p_expected_row_version, v_item.row_version
    );
  end if;
  return public.soft_delete_work_item(p_work_item_id, p_actor_id);
end; $$;

create function public.acknowledge_p5_work_item_flag(
  p_organization_id uuid,
  p_work_item_id uuid,
  p_expected_row_version bigint,
  p_actor_id uuid
) returns public.work_items
language plpgsql security invoker set search_path = ''
as $$
declare
  v_item public.work_items;
begin
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);
  select item.* into v_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.deleted_at is null
  for update;
  if not found then
    raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
  end if;
  if p_expected_row_version is null
     or p_expected_row_version <> v_item.row_version then
    perform private.p5_raise_stale_write(
      'engagement_work_item', p_work_item_id,
      p_expected_row_version, v_item.row_version
    );
  end if;
  return public.acknowledge_work_item_automation_flag(p_work_item_id, p_actor_id);
end; $$;

create function public.mutate_p5_work_item_dependency(
  p_organization_id uuid,
  p_action text,
  p_work_item_id uuid,
  p_depends_on_work_item_id uuid,
  p_expected_row_version bigint,
  p_actor_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_item public.work_items;
  v_dependency public.work_item_dependencies;
begin
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);
  select item.* into v_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.deleted_at is null
  for update;
  if not found then
    raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
  end if;
  if p_expected_row_version is null
     or p_expected_row_version <> v_item.row_version then
    perform private.p5_raise_stale_write(
      'engagement_work_item', p_work_item_id,
      p_expected_row_version, v_item.row_version
    );
  end if;

  if p_action = 'add' then
    v_dependency := public.save_work_item_dependency(
      p_work_item_id, p_depends_on_work_item_id, p_actor_id
    );
  elsif p_action = 'remove' then
    v_dependency := public.remove_work_item_dependency(
      p_work_item_id, p_depends_on_work_item_id, p_actor_id
    );
  else
    raise exception 'Unsupported dependency action.' using errcode = '22023';
  end if;

  update public.work_items
  set updated_at = now()
  where id = p_work_item_id
  returning * into v_item;

  return jsonb_build_object(
    'dependency', to_jsonb(v_dependency),
    'workItem', to_jsonb(v_item)
  );
end; $$;

create function public.move_p5_work_item(
  p_organization_id uuid,
  p_work_item_id uuid,
  p_expected_row_version bigint,
  p_target_status text,
  p_before_work_item_id uuid,
  p_actor_id uuid
) returns setof public.work_items
language plpgsql security invoker set search_path = ''
as $$
declare
  v_item public.work_items;
  v_before_position integer;
  v_ids uuid[];
begin
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);
  if p_target_status not in ('not_started', 'in_progress', 'blocked', 'done') then
    raise exception 'Unsupported Engagement Work Item status.' using errcode = '22023';
  end if;

  select item.* into v_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.deleted_at is null;
  if not found then
    raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || v_item.engagement_id::text || ':p5-order', 0
  ));
  perform 1
  from public.work_items item
  where item.organization_id = p_organization_id
    and item.engagement_id = v_item.engagement_id
    and item.deleted_at is null
  order by item.id
  for update;

  select item.* into v_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.deleted_at is null;
  if not found then
    raise insufficient_privilege using message = 'Engagement Work Item is unavailable.';
  end if;
  if p_expected_row_version is null
     or p_expected_row_version <> v_item.row_version then
    perform private.p5_raise_stale_write(
      'engagement_work_item', p_work_item_id,
      p_expected_row_version, v_item.row_version
    );
  end if;

  select coalesce(
    array_agg(item.id order by item.position, item.created_at, item.id),
    array[]::uuid[]
  ) into v_ids
  from public.work_items item
  where item.organization_id = p_organization_id
    and item.engagement_id = v_item.engagement_id
    and item.status = p_target_status
    and item.deleted_at is null
    and item.id <> p_work_item_id;

  if p_before_work_item_id is null then
    v_ids := array_append(v_ids, p_work_item_id);
  else
    v_before_position := array_position(v_ids, p_before_work_item_id);
    if v_before_position is null then
      raise exception 'The before-item must be in the target column.'
        using errcode = '22023';
    end if;
    v_ids := coalesce(v_ids[1:v_before_position - 1], array[]::uuid[])
      || array[p_work_item_id]
      || coalesce(
        v_ids[v_before_position:array_length(v_ids, 1)],
        array[]::uuid[]
      );
  end if;

  return query
  with desired as (
    select ordered.id, ordered.ordinality::integer * 1000 as position
    from unnest(v_ids) with ordinality as ordered(id, ordinality)
  )
  update public.work_items item
  set status = p_target_status,
      position = desired.position,
      updated_at = now()
  from desired
  where item.id = desired.id
    and item.organization_id = p_organization_id
    and item.engagement_id = v_item.engagement_id
    and (
      item.status is distinct from p_target_status
      or item.position is distinct from desired.position
    )
  returning item.*;
end; $$;

revoke all on function private.p5_require_active_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.p5_raise_stale_write(text, uuid, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function private.p5_guard_timezone_write()
  from public, anon, authenticated, service_role;
revoke all on function private.p5_advance_row_version()
  from public, anon, authenticated, service_role;

grant execute on function private.p5_require_active_actor(uuid, uuid)
  to service_role;
grant execute on function private.p5_raise_stale_write(text, uuid, bigint, bigint)
  to service_role;

revoke all on function public.p5_effective_project_timezone(uuid, uuid)
  from public, anon;
grant execute on function public.p5_effective_project_timezone(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.set_p5_planning_timezone(uuid, text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.update_p5_project_task(uuid, uuid, bigint, text, uuid, date, text, uuid)
  from public, anon, authenticated;
revoke all on function public.transition_p5_project_task(uuid, uuid, bigint, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.save_p5_work_item(uuid, uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid, date, date, integer, uuid, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.delete_p5_work_item(uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.acknowledge_p5_work_item_flag(uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.mutate_p5_work_item_dependency(uuid, text, uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.move_p5_work_item(uuid, uuid, bigint, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.set_p5_planning_timezone(uuid, text, uuid, text, uuid)
  to service_role;
grant execute on function public.update_p5_project_task(uuid, uuid, bigint, text, uuid, date, text, uuid)
  to service_role;
grant execute on function public.transition_p5_project_task(uuid, uuid, bigint, text, text, uuid)
  to service_role;
grant execute on function public.save_p5_work_item(uuid, uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid, date, date, integer, uuid, uuid, bigint, text)
  to service_role;
grant execute on function public.delete_p5_work_item(uuid, uuid, bigint, uuid)
  to service_role;
grant execute on function public.acknowledge_p5_work_item_flag(uuid, uuid, bigint, uuid)
  to service_role;
grant execute on function public.mutate_p5_work_item_dependency(uuid, text, uuid, uuid, bigint, uuid)
  to service_role;
grant execute on function public.move_p5_work_item(uuid, uuid, bigint, text, uuid, uuid)
  to service_role;

comment on column public.clients.default_timezone is
  'Optional IANA timezone inherited dynamically by client projects without an override.';
comment on column public.projects.planning_timezone is
  'Optional IANA timezone override for planning; recurrence retains its immutable plan-version timezone.';
comment on column public.tasks.row_version is
  'Database-managed optimistic concurrency version for canonical Project Task mutations.';
comment on column public.work_items.row_version is
  'Database-managed optimistic concurrency version for canonical Engagement Work Item mutations.';

commit;
