-- Anka OS - UW3 Work Item proposal provenance via department chat.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.work_items
  add column created_via text not null default 'manual';

alter table public.work_items
  add constraint work_items_created_via_check
  check (created_via in ('manual', 'ai_chat_proposal', 'automation_rule'));

drop function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid, uuid
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
  p_actor_id uuid,
  p_created_via text default 'manual'
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
      parent_work_item_id, created_via
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
      p_parent_work_item_id,
      coalesce(p_created_via, 'manual')
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
        'parent_work_item_id', v_after.parent_work_item_id,
        'created_via', coalesce(v_after.created_via, 'manual')
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

revoke all on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid, uuid, text
) to service_role;

comment on function public.save_work_item(
  uuid, uuid, text, text, text, text, text, uuid, text, uuid, uuid, uuid,
  date, date, integer, uuid, uuid, text
) is
  'Extended save_work_item for chat-proposed work items while preserving W1/W3 behavior and events.';

comment on column public.work_items.created_via is
  'Where the work item came from: manual, ai_chat_proposal, or automation_rule.';

commit;
