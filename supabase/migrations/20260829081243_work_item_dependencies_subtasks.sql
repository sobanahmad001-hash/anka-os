-- Anka OS - W3 Dependencies and one-level subtasks.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.work_items
  add column parent_work_item_id uuid;

alter table public.work_items
  add constraint work_items_parent_fk
  foreign key (parent_work_item_id, organization_id)
  references public.work_items(id, organization_id)
  on delete set null (parent_work_item_id);

alter table public.work_items
  add constraint work_items_no_self_parent
  check (parent_work_item_id is distinct from id);

create index idx_work_items_parent_fk
  on public.work_items(organization_id, parent_work_item_id)
  where parent_work_item_id is not null;

create table public.work_item_dependencies (
  organization_id uuid not null,
  work_item_id uuid not null,
  depends_on_work_item_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (work_item_id, depends_on_work_item_id),
  foreign key (work_item_id, organization_id)
    references public.work_items(id, organization_id) on delete cascade,
  foreign key (depends_on_work_item_id, organization_id)
    references public.work_items(id, organization_id) on delete cascade,
  check (work_item_id <> depends_on_work_item_id)
);

create index idx_work_item_dependencies_target_fk
  on public.work_item_dependencies(organization_id, depends_on_work_item_id);
create index idx_work_item_dependencies_created_by_fk
  on public.work_item_dependencies(created_by);

alter table public.work_item_dependencies enable row level security;

create policy "Team can read organization work item dependencies"
  on public.work_item_dependencies for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.work_item_dependencies from anon, authenticated;
grant select on public.work_item_dependencies to authenticated;
grant select, insert, delete on public.work_item_dependencies to service_role;

drop function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid
);

create function public.save_work_item(
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
  p_actor_id uuid
)
returns public.work_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_engagement public.engagements;
  v_parent public.work_items;
  v_before public.work_items;
  v_after public.work_items;
begin
  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.id = p_engagement_id;

  if not found then
    raise exception 'Engagement not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_engagement.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  if p_assignee_id is not null and not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_engagement.organization_id
      and membership.user_id = p_assignee_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Assignee must be an active team member of this organization.';
  end if;

  if p_parent_work_item_id is not null then
    select parent.* into v_parent
    from public.work_items parent
    where parent.id = p_parent_work_item_id
      and parent.organization_id = v_engagement.organization_id
      and parent.engagement_id = v_engagement.id
      and parent.deleted_at is null
    for share;

    if not found then
      raise exception 'Parent work item does not belong to this engagement.';
    end if;

    if p_parent_work_item_id = p_work_item_id then
      raise exception 'A work item cannot be its own parent.';
    end if;

    if v_parent.parent_work_item_id is not null then
      raise exception 'Subtasks may only be one level deep.';
    end if;

    if p_work_item_id is not null and exists (
      select 1
      from public.work_items child
      where child.organization_id = v_engagement.organization_id
        and child.parent_work_item_id = p_work_item_id
        and child.deleted_at is null
    ) then
      raise exception 'A work item with subtasks cannot become a subtask.';
    end if;
  end if;

  if p_linked_artifact_id is not null and not exists (
    select 1
    from public.artifacts artifact
    where artifact.id = p_linked_artifact_id
      and artifact.organization_id = v_engagement.organization_id
      and artifact.engagement_id = v_engagement.id
  ) then
    raise exception 'Linked artifact does not belong to this engagement.';
  end if;

  if p_linked_artifact_version_id is not null and not exists (
    select 1
    from public.artifact_versions version
    join public.artifacts artifact
      on artifact.id = version.artifact_id
     and artifact.organization_id = version.organization_id
    where version.id = p_linked_artifact_version_id
      and version.organization_id = v_engagement.organization_id
      and artifact.engagement_id = v_engagement.id
      and (p_linked_artifact_id is null or artifact.id = p_linked_artifact_id)
  ) then
    raise exception 'Linked artifact version does not belong to this engagement or artifact.';
  end if;

  if p_linked_engagement_stage_instance_id is not null and not exists (
    select 1
    from public.engagement_stage_instances stage
    where stage.id = p_linked_engagement_stage_instance_id
      and stage.organization_id = v_engagement.organization_id
      and stage.engagement_id = v_engagement.id
  ) then
    raise exception 'Linked stage does not belong to this engagement.';
  end if;

  if p_work_item_id is null then
    insert into public.work_items (
      organization_id, engagement_id, brand_id, department_id, title,
      description, work_item_type, priority, status, assignee_id, created_by,
      linked_artifact_id, linked_artifact_version_id,
      linked_engagement_stage_instance_id, start_date, due_date, position,
      parent_work_item_id
    ) values (
      v_engagement.organization_id,
      v_engagement.id,
      v_engagement.brand_id,
      p_department_id,
      left(trim(coalesce(p_title, '')), 240),
      left(coalesce(p_description, ''), 20000),
      coalesce(p_work_item_type, 'task'),
      coalesce(p_priority, 'medium'),
      coalesce(p_status, 'not_started'),
      p_assignee_id,
      p_actor_id,
      p_linked_artifact_id,
      p_linked_artifact_version_id,
      p_linked_engagement_stage_instance_id,
      p_start_date,
      p_due_date,
      greatest(coalesce(p_position, 0), 0),
      p_parent_work_item_id
    ) returning * into v_after;

    insert into public.engagement_events (
      organization_id, engagement_id, event_type, actor_id, payload
    ) values (
      v_after.organization_id,
      v_after.engagement_id,
      'work_item_created',
      p_actor_id,
      jsonb_build_object(
        'record_type', 'work_item',
        'record_id', v_after.id,
        'action', 'created',
        'status', v_after.status,
        'assignee_id', v_after.assignee_id,
        'department_id', v_after.department_id,
        'parent_work_item_id', v_after.parent_work_item_id
      )
    );

    if v_after.assignee_id is not null then
      insert into public.engagement_events (
        organization_id, engagement_id, event_type, actor_id, payload
      ) values (
        v_after.organization_id,
        v_after.engagement_id,
        'work_item_assigned',
        p_actor_id,
        jsonb_build_object(
          'record_type', 'work_item',
          'record_id', v_after.id,
          'action', 'assigned',
          'previous_assignee_id', null,
          'assignee_id', v_after.assignee_id
        )
      );
    end if;
  else
    select work_item.* into v_before
    from public.work_items work_item
    where work_item.id = p_work_item_id
      and work_item.organization_id = v_engagement.organization_id
      and work_item.engagement_id = v_engagement.id
      and work_item.deleted_at is null
    for update;

    if not found then
      raise exception 'Active work item not found.';
    end if;

    update public.work_items work_item
    set department_id = p_department_id,
        title = left(trim(coalesce(p_title, '')), 240),
        description = left(coalesce(p_description, ''), 20000),
        work_item_type = coalesce(p_work_item_type, 'task'),
        priority = coalesce(p_priority, 'medium'),
        status = coalesce(p_status, 'not_started'),
        assignee_id = p_assignee_id,
        linked_artifact_id = p_linked_artifact_id,
        linked_artifact_version_id = p_linked_artifact_version_id,
        linked_engagement_stage_instance_id = p_linked_engagement_stage_instance_id,
        start_date = p_start_date,
        due_date = p_due_date,
        position = greatest(coalesce(p_position, 0), 0),
        parent_work_item_id = p_parent_work_item_id,
        updated_at = now()
    where work_item.id = v_before.id
    returning * into v_after;

    if v_before.status is distinct from v_after.status then
      insert into public.engagement_events (
        organization_id, engagement_id, event_type, actor_id, payload
      ) values (
        v_after.organization_id,
        v_after.engagement_id,
        'work_item_status_changed',
        p_actor_id,
        jsonb_build_object(
          'record_type', 'work_item',
          'record_id', v_after.id,
          'action', 'status_changed',
          'previous_status', v_before.status,
          'status', v_after.status
        )
      );
    end if;

    if v_before.assignee_id is distinct from v_after.assignee_id then
      insert into public.engagement_events (
        organization_id, engagement_id, event_type, actor_id, payload
      ) values (
        v_after.organization_id,
        v_after.engagement_id,
        'work_item_assigned',
        p_actor_id,
        jsonb_build_object(
          'record_type', 'work_item',
          'record_id', v_after.id,
          'action', case when v_after.assignee_id is null then 'unassigned' else 'assigned' end,
          'previous_assignee_id', v_before.assignee_id,
          'assignee_id', v_after.assignee_id
        )
      );
    end if;
  end if;

  return v_after;
end;
$$;

create or replace function public.soft_delete_work_item(
  p_work_item_id uuid,
  p_actor_id uuid
)
returns public.work_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_work_item public.work_items;
begin
  select work_item.* into v_work_item
  from public.work_items work_item
  where work_item.id = p_work_item_id
    and work_item.deleted_at is null
  for update;

  if not found then
    raise exception 'Active work item not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_work_item.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  update public.work_items child
  set parent_work_item_id = null,
      updated_at = now()
  where child.organization_id = v_work_item.organization_id
    and child.parent_work_item_id = v_work_item.id;

  update public.work_items work_item
  set deleted_at = now(), updated_at = now()
  where work_item.id = v_work_item.id
  returning * into v_work_item;

  return v_work_item;
end;
$$;

create function public.save_work_item_dependency(
  p_work_item_id uuid,
  p_depends_on_work_item_id uuid,
  p_actor_id uuid
)
returns public.work_item_dependencies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_work_item public.work_items;
  v_dependency public.work_items;
  v_after public.work_item_dependencies;
  v_cycle_exists boolean;
begin
  select item.* into v_work_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.deleted_at is null;

  if not found then
    raise exception 'Active work item not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_work_item.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  select item.* into v_dependency
  from public.work_items item
  where item.id = p_depends_on_work_item_id
    and item.organization_id = v_work_item.organization_id
    and item.engagement_id = v_work_item.engagement_id
    and item.deleted_at is null;

  if not found then
    raise exception 'Dependency must be an active work item in the same engagement.';
  end if;

  if p_work_item_id = p_depends_on_work_item_id then
    raise exception 'A work item cannot depend on itself.';
  end if;

  -- Serialize graph mutations per engagement so two concurrent inserts cannot
  -- both pass cycle detection against the same pre-insert snapshot.
  perform pg_advisory_xact_lock(
    hashtextextended(v_work_item.organization_id::text || ':' || v_work_item.engagement_id::text, 0)
  );

  with recursive reachable(id) as (
    select dependency.depends_on_work_item_id
    from public.work_item_dependencies dependency
    join public.work_items target
      on target.id = dependency.depends_on_work_item_id
     and target.organization_id = dependency.organization_id
     and target.deleted_at is null
    where dependency.work_item_id = p_depends_on_work_item_id
      and dependency.organization_id = v_work_item.organization_id
    union
    select dependency.depends_on_work_item_id
    from public.work_item_dependencies dependency
    join reachable on dependency.work_item_id = reachable.id
    join public.work_items target
      on target.id = dependency.depends_on_work_item_id
     and target.organization_id = dependency.organization_id
     and target.deleted_at is null
    where dependency.organization_id = v_work_item.organization_id
  )
  select exists (
    select 1 from reachable where id = p_work_item_id
  ) into v_cycle_exists;

  if v_cycle_exists then
    raise exception 'Dependency would create a cycle.';
  end if;

  insert into public.work_item_dependencies (
    organization_id, work_item_id, depends_on_work_item_id, created_by
  ) values (
    v_work_item.organization_id,
    v_work_item.id,
    v_dependency.id,
    p_actor_id
  )
  returning * into v_after;

  return v_after;
end;
$$;

create function public.remove_work_item_dependency(
  p_work_item_id uuid,
  p_depends_on_work_item_id uuid,
  p_actor_id uuid
)
returns public.work_item_dependencies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dependency public.work_item_dependencies;
begin
  select dependency.* into v_dependency
  from public.work_item_dependencies dependency
  where dependency.work_item_id = p_work_item_id
    and dependency.depends_on_work_item_id = p_depends_on_work_item_id;

  if not found then
    raise exception 'Work item dependency not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_dependency.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  delete from public.work_item_dependencies dependency
  where dependency.work_item_id = v_dependency.work_item_id
    and dependency.depends_on_work_item_id = v_dependency.depends_on_work_item_id;

  return v_dependency;
end;
$$;

revoke all on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.soft_delete_work_item(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.save_work_item_dependency(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.remove_work_item_dependency(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid, uuid
) to service_role;
grant execute on function public.soft_delete_work_item(uuid, uuid)
  to service_role;
grant execute on function public.save_work_item_dependency(uuid, uuid, uuid)
  to service_role;
grant execute on function public.remove_work_item_dependency(uuid, uuid, uuid)
  to service_role;

comment on column public.work_items.parent_work_item_id is
  'Optional W3 one-level parent. save_work_item prevents nesting beneath a subtask.';
comment on table public.work_item_dependencies is
  'W3 directed dependency edges. work_item_id is blocked by depends_on_work_item_id.';
comment on function public.save_work_item_dependency(uuid, uuid, uuid) is
  'Service-role-only dependency creation with active-team authorization and recursive cycle prevention.';
comment on function public.remove_work_item_dependency(uuid, uuid, uuid) is
  'Service-role-only dependency removal with active-team authorization.';

commit;
