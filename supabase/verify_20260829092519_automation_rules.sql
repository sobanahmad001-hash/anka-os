-- W5 runtime verification. Run after applying 20260829092519_automation_rules.sql.
-- All writes are wrapped in a transaction and rolled back.

begin;

do $$
declare
  v_org_id uuid;
  v_actor_id uuid;
  v_engagement public.engagements;
  v_artifact public.artifacts;
  v_item public.work_items;
  v_rule public.automation_rules;
  v_event public.engagement_events;
begin
  select membership.organization_id, membership.user_id
  into v_org_id, v_actor_id
  from public.organization_memberships membership
  where membership.member_kind = 'team'
    and membership.status = 'active'
  order by membership.organization_id, membership.user_id
  limit 1;

  if v_actor_id is null then
    raise exception 'W5 verification requires one active team member.';
  end if;

  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.organization_id = v_org_id
  order by engagement.created_at
  limit 1;

  if v_engagement.id is null then
    raise exception 'W5 verification requires one engagement.';
  end if;

  insert into public.artifacts (
    organization_id, engagement_id, brand_id, artifact_type, title, created_by
  ) values (
    v_org_id, v_engagement.id, v_engagement.brand_id,
    'content', 'W5 rollback verification artifact', v_actor_id
  ) returning * into v_artifact;

  select rule.* into v_rule
  from public.automation_rules rule
  where rule.organization_id = v_org_id
    and rule.trigger_type = 'artifact_approved'
    and rule.action_type = 'move_status'
    and rule.enabled
  order by rule.created_at, rule.id
  limit 1;

  if v_rule.id is null then
    raise exception 'W5 built-in artifact rule was not seeded.';
  end if;

  select saved.* into v_item
  from public.save_work_item(
    null, v_engagement.id, 'W5 rollback verification work item', '',
    'task', 'medium', 'in_progress', v_actor_id, null,
    v_artifact.id, null, null, null, null, 0, null, v_actor_id
  ) saved;

  insert into public.engagement_events (
    organization_id, engagement_id, event_type, actor_id, payload
  ) values (
    v_org_id, v_engagement.id, 'artifact_approved', v_actor_id,
    jsonb_build_object(
      'record_type', 'artifact',
      'record_id', v_artifact.id,
      'version_id', null,
      'action', 'approved'
    )
  );

  select item.* into v_item from public.work_items item where item.id = v_item.id;
  if v_item.status <> 'done' then
    raise exception 'Artifact approval did not auto-advance the linked work item.';
  end if;

  select event.* into v_event
  from public.engagement_events event
  where event.event_type = 'work_item_status_changed'
    and event.payload ->> 'record_id' = v_item.id::text
    and event.payload ->> 'triggered_by' = 'automation_rule'
    and event.payload ->> 'automation_rule_id' = v_rule.id::text
  order by event.occurred_at desc
  limit 1;

  if v_event.id is null then
    raise exception 'Automation audit marker or rule id is missing.';
  end if;

  select saved.* into v_item
  from public.save_work_item(
    v_item.id, v_item.engagement_id, v_item.title, v_item.description,
    v_item.work_item_type, v_item.priority, 'in_progress', v_item.assignee_id,
    v_item.department_id, v_item.linked_artifact_id,
    v_item.linked_artifact_version_id,
    v_item.linked_engagement_stage_instance_id, v_item.start_date,
    v_item.due_date, v_item.position, v_item.parent_work_item_id, v_actor_id
  ) saved;

  if v_item.status <> 'in_progress' then
    raise exception 'Manual status change after automation was blocked.';
  end if;
end
$$;

select
  to_regclass('public.automation_rules') is not null as automation_rules_exists,
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'automation_rules'
      and policyname = 'Team can read organization automation rules'
  ) as organization_rls_exists,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.engagement_events'::regclass
      and tgname = 'trg_engagement_events_apply_automation'
      and not tgisinternal
  ) as event_listener_exists,
  exists (
    select 1 from public.automation_rules
    where trigger_type = 'artifact_approved'
      and action_type = 'move_status'
      and enabled
  ) as artifact_rule_seeded,
  exists (
    select 1 from public.automation_rules
    where trigger_type = 'design_direction_released'
      and action_type = 'move_status'
      and enabled
  ) as design_rule_seeded,
  obj_description('public.automation_rules'::regclass) like '%scheduled execution is deferred%'
    as due_date_deferral_documented;

rollback;
