-- P5: connected planning without collapsing the two canonical work systems.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.clients add column default_timezone text;
alter table public.projects add column planning_timezone text;
alter table public.tasks add column row_version bigint not null default 1;
alter table public.work_items add column row_version bigint not null default 1;
alter table public.tasks add constraint tasks_row_version_positive_check check (row_version > 0);
alter table public.work_items add constraint work_items_row_version_positive_check check (row_version > 0);

create or replace function private.p5_guard_timezone_write()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_timezone text := case tg_table_name
    when 'clients' then new.default_timezone
    when 'projects' then new.planning_timezone
  end;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'clients' and new.default_timezone is not distinct from old.default_timezone then return new; end if;
    if tg_table_name = 'projects' and new.planning_timezone is not distinct from old.planning_timezone then return new; end if;
  elsif v_timezone is null then
    return new;
  end if;
  if not exists (select 1 from public.organizations organization where organization.id = new.organization_id and organization.status = 'active')
     or not public.has_organization_role(new.organization_id, array['system_owner', 'operations_admin']) then
    raise exception 'Planning timezone changes require system owner or operations admin authority.' using errcode = '42501';
  end if;
  if v_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_timezone
  ) then
    raise exception 'Planning timezone must be a valid IANA timezone.' using errcode = '22023';
  end if;
  return new;
end; $$;

create trigger trg_p5_guard_client_default_timezone
before insert or update of default_timezone on public.clients
for each row execute function private.p5_guard_timezone_write();
create trigger trg_p5_guard_project_planning_timezone
before insert or update of planning_timezone on public.projects
for each row execute function private.p5_guard_timezone_write();

create or replace function private.p5_advance_row_version()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.row_version is distinct from old.row_version then
    raise exception 'row_version is managed by the database.' using errcode = '42501';
  end if;
  new.row_version := old.row_version + 1;
  return new;
end; $$;

create trigger trg_p5_advance_task_row_version before update on public.tasks
for each row execute function private.p5_advance_row_version();
create trigger trg_p5_advance_work_item_row_version before update on public.work_items
for each row execute function private.p5_advance_row_version();

create or replace function public.set_p5_planning_timezone(
  p_organization_id uuid, p_record_kind text, p_record_id uuid, p_timezone text
) returns text language plpgsql security invoker set search_path = ''
as $$
declare v_timezone text := nullif(trim(p_timezone), '');
begin
  if p_record_kind not in ('client', 'project') then
    raise exception 'Planning timezone record kind must be client or project.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations organization where organization.id = p_organization_id and organization.status = 'active')
     or not public.has_organization_role(p_organization_id, array['system_owner', 'operations_admin']) then
    raise exception 'Planning timezone changes require system owner or operations admin authority.' using errcode = '42501';
  end if;
  if v_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_timezone
  ) then
    raise exception 'Planning timezone must be a valid IANA timezone.' using errcode = '22023';
  end if;
  if p_record_kind = 'client' then
    update public.clients set default_timezone = v_timezone
    where id = p_record_id and organization_id = p_organization_id;
  else
    update public.projects set planning_timezone = v_timezone
    where id = p_record_id and organization_id = p_organization_id;
  end if;
  if not found then raise exception 'Planning timezone target was not found.' using errcode = 'P0002'; end if;
  return v_timezone;
end; $$;

create or replace function public.p5_effective_project_timezone(
  p_organization_id uuid, p_project_id uuid
) returns text language sql stable security invoker set search_path = ''
as $$
  select case when project.engagement_type = 'internal'
    then coalesce(project.planning_timezone, 'UTC')
    else coalesce(project.planning_timezone, client.default_timezone, 'UTC')
  end
  from public.projects project
  join public.organizations organization
    on organization.id = project.organization_id and organization.status = 'active'
  left join public.clients client on client.id = project.client_id
    and client.organization_id = project.organization_id
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and public.is_team_organization_member(project.organization_id);
$$;

create or replace function public.update_p5_project_task(
  p_organization_id uuid, p_task_id uuid, p_expected_row_version bigint,
  p_status text, p_assigned_to uuid, p_due_date date
) returns public.tasks language plpgsql security invoker set search_path = ''
as $$
declare v_task public.tasks;
begin
  select task.* into v_task from public.tasks task
  where task.id = p_task_id and task.organization_id = p_organization_id for update;
  if not found
     or not exists (select 1 from public.organizations organization where organization.id = p_organization_id and organization.status = 'active')
     or not public.can_access_task(p_task_id) then
    raise exception 'Project Task is unavailable.' using errcode = '42501';
  end if;
  if v_task.row_version <> p_expected_row_version then
    raise exception 'Project Task changed since it was loaded.' using errcode = '40001';
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_assigned_to
      and membership.member_kind = 'team' and membership.status = 'active'
  ) then raise exception 'Assignee must be an active team member.' using errcode = '23514'; end if;
  update public.tasks set status = p_status, assigned_to = p_assigned_to, due_date = p_due_date
  where id = v_task.id returning * into v_task;
  return v_task;
end; $$;

create or replace function public.update_p5_work_item(
  p_organization_id uuid, p_work_item_id uuid, p_expected_row_version bigint,
  p_assignee_id uuid, p_department_id text, p_start_date date, p_due_date date
) returns public.work_items language plpgsql security invoker set search_path = ''
as $$
declare v_item public.work_items;
begin
  select item.* into v_item from public.work_items item
  where item.id = p_work_item_id and item.organization_id = p_organization_id
    and item.deleted_at is null for update;
  if not found
     or not exists (select 1 from public.organizations organization where organization.id = p_organization_id and organization.status = 'active')
     or not public.is_team_organization_member(p_organization_id) then
    raise exception 'Engagement Work Item is unavailable.' using errcode = '42501';
  end if;
  if v_item.row_version <> p_expected_row_version then
    raise exception 'Engagement Work Item changed since it was loaded.' using errcode = '40001';
  end if;
  if p_due_date is not null and p_start_date is not null and p_due_date < p_start_date then
    raise exception 'Due date cannot be before start date.' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id and membership.user_id = p_assignee_id
      and membership.member_kind = 'team' and membership.status = 'active'
  ) then raise exception 'Assignee must be an active team member.' using errcode = '23514'; end if;
  if p_department_id is not null and not exists (
    select 1 from public.departments department
    where department.id = p_department_id and department.organization_id = p_organization_id
  ) then raise exception 'Department must belong to the active organization.' using errcode = '23514'; end if;
  update public.work_items set assignee_id = p_assignee_id, department_id = p_department_id,
    start_date = p_start_date, due_date = p_due_date, updated_at = now()
  where id = v_item.id returning * into v_item;
  return v_item;
end; $$;

create or replace function public.move_p5_work_item(
  p_organization_id uuid, p_work_item_id uuid, p_expected_row_version bigint,
  p_target_status text, p_before_work_item_id uuid default null
) returns public.work_items language plpgsql security invoker set search_path = ''
as $$
declare
  v_item public.work_items;
  v_ids uuid[];
  v_before_position integer;
  v_id uuid;
  v_position integer := 0;
begin
  if p_target_status not in ('not_started', 'in_progress', 'blocked', 'done') then
    raise exception 'Unsupported Engagement Work Item status.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations organization where organization.id = p_organization_id and organization.status = 'active')
     or not public.is_team_organization_member(p_organization_id) then
    raise exception 'Active team membership is required.' using errcode = '42501';
  end if;
  perform 1 from public.work_items item
  where item.organization_id = p_organization_id
    and item.engagement_id = (
      select candidate.engagement_id from public.work_items candidate
      where candidate.id = p_work_item_id and candidate.organization_id = p_organization_id
    )
    and item.deleted_at is null order by item.id for update;
  select item.* into v_item from public.work_items item
  where item.id = p_work_item_id and item.organization_id = p_organization_id
    and item.deleted_at is null;
  if not found then raise exception 'Engagement Work Item is unavailable.' using errcode = '42501'; end if;
  if v_item.row_version <> p_expected_row_version then
    raise exception 'Engagement Work Item changed since it was loaded.' using errcode = '40001';
  end if;
  select coalesce(array_agg(item.id order by item.position, item.created_at, item.id), array[]::uuid[])
  into v_ids from public.work_items item
  where item.organization_id = p_organization_id and item.engagement_id = v_item.engagement_id
    and item.status = p_target_status and item.deleted_at is null and item.id <> p_work_item_id;
  if p_before_work_item_id is null then
    v_ids := array_append(v_ids, p_work_item_id);
  else
    v_before_position := array_position(v_ids, p_before_work_item_id);
    if v_before_position is null then
      raise exception 'The before-item must be in the target column.' using errcode = '22023';
    end if;
    v_ids := coalesce(v_ids[1:v_before_position - 1], array[]::uuid[])
      || array[p_work_item_id]
      || coalesce(v_ids[v_before_position:array_length(v_ids, 1)], array[]::uuid[]);
  end if;
  foreach v_id in array v_ids loop
    v_position := v_position + 1000;
    update public.work_items set status = p_target_status, position = v_position, updated_at = now()
    where id = v_id and (status is distinct from p_target_status or position is distinct from v_position);
  end loop;
  select item.* into v_item from public.work_items item where item.id = p_work_item_id;
  return v_item;
end; $$;

revoke all on function private.p5_guard_timezone_write() from public, anon, authenticated;
revoke all on function private.p5_advance_row_version() from public, anon, authenticated;
grant execute on function private.p5_guard_timezone_write() to service_role;
grant execute on function private.p5_advance_row_version() to service_role;

revoke all on function public.set_p5_planning_timezone(uuid, text, uuid, text) from public, anon;
revoke all on function public.p5_effective_project_timezone(uuid, uuid) from public, anon;
revoke all on function public.update_p5_project_task(uuid, uuid, bigint, text, uuid, date) from public, anon;
revoke all on function public.update_p5_work_item(uuid, uuid, bigint, uuid, text, date, date) from public, anon;
revoke all on function public.move_p5_work_item(uuid, uuid, bigint, text, uuid) from public, anon;
grant execute on function public.set_p5_planning_timezone(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.p5_effective_project_timezone(uuid, uuid) to authenticated, service_role;
grant execute on function public.update_p5_project_task(uuid, uuid, bigint, text, uuid, date) to authenticated, service_role;
grant execute on function public.update_p5_work_item(uuid, uuid, bigint, uuid, text, date, date) to authenticated, service_role;
grant execute on function public.move_p5_work_item(uuid, uuid, bigint, text, uuid) to authenticated, service_role;

comment on column public.clients.default_timezone is
  'Optional IANA timezone inherited dynamically by client projects without an override.';
comment on column public.projects.planning_timezone is
  'Optional IANA timezone override for non-recurring planning; recurrence retains its immutable plan-version timezone.';
comment on column public.tasks.row_version is
  'Database-managed optimistic concurrency version for canonical Project Task mutations.';
comment on column public.work_items.row_version is
  'Database-managed optimistic concurrency version for canonical Engagement Work Item mutations.';

commit;
