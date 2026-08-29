-- Anka OS - W5 Automation Rules.
-- Adds a closed organization-scoped rule library and reacts to the existing
-- engagement event stream. due_date_arrived remains stored but unscheduled in W5.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  trigger_type text not null
    check (trigger_type in (
      'work_item_status_changed',
      'artifact_approved',
      'design_direction_released',
      'due_date_arrived'
    )),
  condition_status text,
  action_type text not null
    check (action_type in ('move_status', 'notify_assignee')),
  action_target_status text,
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (trigger_type = 'due_date_arrived' or condition_status is null),
  check (
    action_target_status is null
    or action_target_status in ('not_started', 'in_progress', 'blocked', 'done')
  ),
  check (action_type <> 'move_status' or action_target_status is not null)
);

create index idx_automation_rules_enabled_trigger
  on public.automation_rules(organization_id, trigger_type, created_at, id)
  where enabled;
create index idx_automation_rules_created_by
  on public.automation_rules(created_by);

alter table public.work_items
  add column automation_flagged_at timestamptz,
  add column automation_flagged_by_rule_id uuid;

alter table public.work_items
  add constraint work_items_automation_flag_rule_fk
  foreign key (automation_flagged_by_rule_id, organization_id)
  references public.automation_rules(id, organization_id)
  on delete set null (automation_flagged_by_rule_id);

alter table public.work_items
  add constraint work_items_automation_flag_pair_check
  check (
    (automation_flagged_at is null and automation_flagged_by_rule_id is null)
    or (automation_flagged_at is not null and automation_flagged_by_rule_id is not null)
  );

create index idx_work_items_automation_flags
  on public.work_items(organization_id, assignee_id, automation_flagged_at desc)
  where automation_flagged_at is not null and deleted_at is null;

alter table public.automation_rules enable row level security;

create policy "Team can read organization automation rules"
  on public.automation_rules for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can create organization automation rules"
  on public.automation_rules for insert to authenticated
  with check (
    public.is_team_organization_member(organization_id)
    and created_by = (select auth.uid())
  );

create policy "Team can toggle organization automation rules"
  on public.automation_rules for update to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));

revoke all on public.automation_rules from anon, authenticated;
grant select, insert on public.automation_rules to authenticated;
grant update(enabled) on public.automation_rules to authenticated;
grant all on public.automation_rules to service_role;

-- Any status change, automatic or manual, resolves an earlier in-app flag.
create or replace function private.clear_work_item_automation_flag_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.automation_flagged_at := null;
    new.automation_flagged_by_rule_id := null;
  elsif new.automation_flagged_by_rule_id is null then
    -- Also keeps the pair valid when a deleted rule invokes its FK action.
    new.automation_flagged_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.clear_work_item_automation_flag_on_status_change()
  from public, anon, authenticated, service_role;

create trigger trg_work_items_clear_automation_flag
before update on public.work_items
for each row execute function private.clear_work_item_automation_flag_on_status_change();

-- Opening a detail panel acknowledges a flag only for the assigned team member.
create or replace function public.acknowledge_work_item_automation_flag(
  p_work_item_id uuid,
  p_actor_id uuid
)
returns public.work_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.work_items;
begin
  select item.* into v_item
  from public.work_items item
  where item.id = p_work_item_id
    and item.deleted_at is null;

  if not found then
    raise exception 'Work item not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_item.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  update public.work_items item
  set automation_flagged_at = null,
      automation_flagged_by_rule_id = null
  where item.id = p_work_item_id
    and item.assignee_id = p_actor_id
    and item.automation_flagged_at is not null
  returning item.* into v_item;

  if not found then
    return null;
  end if;

  return v_item;
end;
$$;

revoke all on function public.acknowledge_work_item_automation_flag(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_work_item_automation_flag(uuid, uuid)
  to service_role;

-- save_work_item remains unchanged. Automation sets transaction-local context;
-- this listener annotates the existing audit event before it is stored.
create or replace function private.mark_automation_work_item_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_triggered_by text := nullif(current_setting('anka.automation_triggered_by', true), '');
  v_rule_id text := nullif(current_setting('anka.automation_rule_id', true), '');
begin
  if new.event_type = 'work_item_status_changed'
     and v_triggered_by = 'automation_rule'
     and v_rule_id is not null then
    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
      'triggered_by', v_triggered_by,
      'automation_rule_id', v_rule_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.mark_automation_work_item_event()
  from public, anon, authenticated, service_role;

create trigger trg_engagement_events_mark_automation
before insert on public.engagement_events
for each row execute function private.mark_automation_work_item_event();

create or replace function private.apply_automation_rules_from_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.automation_rules;
  v_item public.work_items;
  v_actor_id uuid;
begin
  if new.event_type not in (
    'work_item_status_changed',
    'artifact_approved',
    'design_direction_released'
  ) then
    return new;
  end if;

  -- An automated save emits another status event. Its marker stops recursion and
  -- prevents chained rules from making manual control unpredictable.
  if new.payload ->> 'triggered_by' = 'automation_rule' then
    return new;
  end if;

  for v_rule in
    select rule.*
    from public.automation_rules rule
    where rule.organization_id = new.organization_id
      and rule.trigger_type = new.event_type
      and rule.enabled
    order by rule.created_at, rule.id
  loop
    select coalesce(
      (
        select new.actor_id
        where new.actor_id is not null
          and exists (
            select 1 from public.organization_memberships membership
            where membership.organization_id = new.organization_id
              and membership.user_id = new.actor_id
              and membership.member_kind = 'team'
              and membership.status = 'active'
          )
      ),
      (
        select v_rule.created_by
        where exists (
          select 1 from public.organization_memberships membership
          where membership.organization_id = new.organization_id
            and membership.user_id = v_rule.created_by
            and membership.member_kind = 'team'
            and membership.status = 'active'
        )
      ),
      (
        select membership.user_id
        from public.organization_memberships membership
        where membership.organization_id = new.organization_id
          and membership.member_kind = 'team'
          and membership.status = 'active'
        order by membership.user_id
        limit 1
      )
    ) into v_actor_id;

    if v_actor_id is null then
      continue;
    end if;

    for v_item in
      select item.*
      from public.work_items item
      where item.organization_id = new.organization_id
        and item.engagement_id = new.engagement_id
        and item.deleted_at is null
        and (
          (
            new.event_type = 'work_item_status_changed'
            and item.id = nullif(new.payload ->> 'record_id', '')::uuid
          )
          or (
            new.event_type = 'artifact_approved'
            and (
              item.linked_artifact_id = nullif(new.payload ->> 'record_id', '')::uuid
              or item.linked_artifact_version_id = nullif(new.payload ->> 'version_id', '')::uuid
            )
          )
          or (
            new.event_type = 'design_direction_released'
            and item.linked_artifact_version_id is not null
            and exists (
              select 1
              from public.design_direction_versions direction_version
              join public.design_directions direction
                on direction.id = direction_version.direction_id
               and direction.organization_id = direction_version.organization_id
              join public.design_workshop_context_versions context_version
                on context_version.session_id = direction.session_id
               and context_version.organization_id = direction.organization_id
              where direction_version.id = nullif(new.payload ->> 'version_id', '')::uuid
                and direction_version.organization_id = new.organization_id
                and context_version.artifact_version_id = item.linked_artifact_version_id
            )
          )
        )
      order by item.id
      for update of item
    loop
      if v_rule.action_type = 'notify_assignee' then
        if v_item.assignee_id is not null then
          update public.work_items item
          set automation_flagged_at = now(),
              automation_flagged_by_rule_id = v_rule.id
          where item.id = v_item.id;
        end if;
      elsif v_rule.action_type = 'move_status'
            and v_item.status is distinct from v_rule.action_target_status then
        perform set_config('anka.automation_triggered_by', 'automation_rule', true);
        perform set_config('anka.automation_rule_id', v_rule.id::text, true);

        perform public.save_work_item(
          p_work_item_id => v_item.id,
          p_engagement_id => v_item.engagement_id,
          p_title => v_item.title,
          p_description => v_item.description,
          p_work_item_type => v_item.work_item_type,
          p_priority => v_item.priority,
          p_status => v_rule.action_target_status,
          p_assignee_id => v_item.assignee_id,
          p_department_id => v_item.department_id,
          p_linked_artifact_id => v_item.linked_artifact_id,
          p_linked_artifact_version_id => v_item.linked_artifact_version_id,
          p_linked_engagement_stage_instance_id => v_item.linked_engagement_stage_instance_id,
          p_start_date => v_item.start_date,
          p_due_date => v_item.due_date,
          p_position => v_item.position,
          p_parent_work_item_id => v_item.parent_work_item_id,
          p_actor_id => v_actor_id
        );

        perform set_config('anka.automation_triggered_by', '', true);
        perform set_config('anka.automation_rule_id', '', true);
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

revoke execute on function private.apply_automation_rules_from_event()
  from public, anon, authenticated, service_role;

create trigger trg_engagement_events_apply_automation
after insert on public.engagement_events
for each row execute function private.apply_automation_rules_from_event();

-- One built-in behavior is expressed as two records because trigger_type is
-- intentionally single-valued. Existing organizations receive both rules.
with organization_creators as (
  select distinct on (membership.organization_id)
    membership.organization_id,
    membership.user_id
  from public.organization_memberships membership
  where membership.member_kind = 'team'
    and membership.status = 'active'
  order by membership.organization_id, membership.user_id
)
insert into public.automation_rules (
  organization_id,
  name,
  trigger_type,
  action_type,
  action_target_status,
  enabled,
  created_by
)
select
  creator.organization_id,
  seed.name,
  seed.trigger_type,
  'move_status',
  'done',
  true,
  creator.user_id
from organization_creators creator
cross join (
  values
    ('Auto-advance approved artifact work', 'artifact_approved'),
    ('Auto-advance released design work', 'design_direction_released')
) as seed(name, trigger_type);

comment on table public.automation_rules is
  'W5 fixed organization automation library. due_date_arrived is stored but its scheduled execution is deferred.';
comment on column public.work_items.automation_flagged_at is
  'In-app W5 assignee flag. Cleared when the assignee opens detail or when status changes.';

commit;
