-- Anka OS - W1 Work Item Core.
-- Adds one flat, mutable engagement work list. Board rendering, dependencies,
-- automation, custom fields, and artifact-driven status changes are deferred.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  brand_id uuid not null,
  department_id text references public.departments(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 240),
  description text not null default '',
  work_item_type text not null default 'task'
    check (work_item_type in ('task', 'bug', 'request')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'done')),
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  linked_artifact_id uuid,
  linked_artifact_version_id uuid,
  linked_engagement_stage_instance_id uuid,
  start_date date,
  due_date date,
  position integer not null default 0 check (position >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  unique (id, organization_id),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create index idx_work_items_engagement_list
  on public.work_items(organization_id, engagement_id, position, created_at)
  where deleted_at is null;
create index idx_work_items_engagement_fk
  on public.work_items(engagement_id, organization_id);
create index idx_work_items_department_fk
  on public.work_items(department_id);
create index idx_work_items_assignee_fk
  on public.work_items(assignee_id);
create index idx_work_items_created_by_fk
  on public.work_items(created_by);
create index idx_work_items_assignee
  on public.work_items(organization_id, assignee_id, status, due_date)
  where deleted_at is null and assignee_id is not null;
create index idx_work_items_department
  on public.work_items(organization_id, department_id, status, due_date)
  where deleted_at is null and department_id is not null;

alter table public.engagement_events
  drop constraint engagement_events_event_type_check;

alter table public.engagement_events
  add constraint engagement_events_event_type_check
  check (event_type in (
    'engagement_created',
    'service_activated',
    'blueprint_instantiated',
    'artifact_version_created',
    'artifact_approved',
    'design_direction_released',
    'campaign_created',
    'campaign_updated',
    'artifact_draft_proposed_via_chat',
    'stage_status_changed',
    'work_item_created',
    'work_item_status_changed',
    'work_item_assigned'
  ));

alter table public.work_items enable row level security;

create policy "Team can read organization work items"
  on public.work_items for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.work_items from anon, authenticated;
grant select on public.work_items to authenticated;

create or replace function public.save_work_item(
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
  p_actor_id uuid
)
returns public.work_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_engagement public.engagements;
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
      linked_engagement_stage_instance_id, start_date, due_date, position
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
      greatest(coalesce(p_position, 0), 0)
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
        'department_id', v_after.department_id
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

  update public.work_items work_item
  set deleted_at = now(), updated_at = now()
  where work_item.id = v_work_item.id
  returning * into v_work_item;

  return v_work_item;
end;
$$;

revoke all on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid
) from public, anon, authenticated;
revoke all on function public.soft_delete_work_item(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid
) to service_role;
grant execute on function public.soft_delete_work_item(uuid, uuid)
  to service_role;

comment on table public.work_items is
  'W1 flat engagement work list; later Board, dependency, automation, and custom-field phases build on this table.';
comment on column public.work_items.deleted_at is
  'Soft-delete marker. Application removal never hard-deletes a work item.';
comment on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid
) is 'Service-role-only atomic work item validation, mutation, and engagement audit write.';
comment on function public.soft_delete_work_item(uuid, uuid) is
  'Service-role-only W1 soft delete that preserves the row and engagement audit history.';

commit;
