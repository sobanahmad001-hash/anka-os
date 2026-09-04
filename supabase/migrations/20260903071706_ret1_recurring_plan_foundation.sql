-- RET1: recurring-plan foundation only. No occurrence generation or scheduling.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.engagement_services
  add constraint engagement_services_id_engagement_service_org_key
  unique (id, engagement_id, service_id, organization_id);

create table public.recurring_work_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  engagement_id uuid not null,
  engagement_service_id uuid not null,
  service_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'active', 'paused', 'ended', 'archived')),
  approved_version_id uuid,
  status_reason text not null default '',
  status_impact text not null default '',
  status_changed_by uuid not null references auth.users(id) on delete restrict,
  status_changed_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_plans_engagement_project_org_fk
    foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id) on delete restrict,
  constraint recurring_plans_service_scope_fk
    foreign key (engagement_service_id, engagement_id, service_id, organization_id)
    references public.engagement_services(id, engagement_id, service_id, organization_id) on delete restrict,
  unique (id, organization_id),
  check (status = 'draft' or approved_version_id is not null)
);

create table public.recurring_work_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id uuid not null,
  version_number integer not null check (version_number > 0),
  title text not null check (length(trim(title)) between 1 and 240),
  scope text not null default '',
  frequency text not null check (frequency in ('weekly', 'monthly')),
  timezone text not null check (length(trim(timezone)) between 1 and 100),
  effective_start date not null,
  effective_end date,
  schedule_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(schedule_definition) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint recurring_versions_plan_org_fk
    foreign key (plan_id, organization_id) references public.recurring_work_plans(id, organization_id) on delete restrict,
  unique (plan_id, version_number),
  unique (id, plan_id, organization_id),
  check (effective_end is null or effective_end >= effective_start)
);

create table public.recurring_work_plan_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  template_key text not null check (template_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  title text not null check (length(trim(title)) between 1 and 240),
  description text not null default '',
  work_item_type text not null default 'task' check (work_item_type in ('task', 'bug', 'request')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  department_id text not null references public.departments(id) on delete restrict,
  default_assignee_id uuid references auth.users(id) on delete restrict,
  start_offset_days integer not null default 0 check (start_offset_days >= 0),
  due_offset_days integer not null default 0 check (due_offset_days >= start_offset_days),
  acceptance_criteria text not null default '',
  position integer not null check (position >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint recurring_template_version_plan_org_fk
    foreign key (plan_version_id, plan_id, organization_id)
    references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict,
  unique (plan_version_id, template_key),
  unique (plan_version_id, position)
);

create table public.recurring_work_plan_version_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_note text not null default '',
  approved_at timestamptz not null default now(),
  constraint recurring_approvals_version_plan_org_fk
    foreign key (plan_version_id, plan_id, organization_id)
    references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict,
  unique (plan_version_id)
);

alter table public.recurring_work_plans
  add constraint recurring_work_plans_approved_version_fk
  foreign key (approved_version_id, id, organization_id)
  references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict;

create index idx_recurring_work_plans_engagement_project_org_fk on public.recurring_work_plans(engagement_id, project_id, organization_id);
create index idx_recurring_work_plans_service_scope_fk on public.recurring_work_plans(engagement_service_id, engagement_id, service_id, organization_id);
create index idx_recurring_work_plans_org_status on public.recurring_work_plans(organization_id, status, updated_at desc);
create index idx_recurring_work_plans_created_by_fk on public.recurring_work_plans(created_by);
create index idx_recurring_work_plans_status_changed_by_fk on public.recurring_work_plans(status_changed_by);
create index idx_recurring_work_plans_approved_version_fk on public.recurring_work_plans(approved_version_id, id, organization_id) where approved_version_id is not null;
create index idx_recurring_work_plan_versions_plan_org_fk on public.recurring_work_plan_versions(plan_id, organization_id);
create index idx_recurring_work_plan_versions_created_by_fk on public.recurring_work_plan_versions(created_by);
create index idx_recurring_template_items_version_plan_org_fk on public.recurring_work_plan_template_items(plan_version_id, plan_id, organization_id);
create index idx_recurring_template_items_department_fk on public.recurring_work_plan_template_items(department_id);
create index idx_recurring_template_items_assignee_fk on public.recurring_work_plan_template_items(default_assignee_id) where default_assignee_id is not null;
create index idx_recurring_template_items_created_by_fk on public.recurring_work_plan_template_items(created_by);
create index idx_recurring_approvals_version_plan_org_fk on public.recurring_work_plan_version_approvals(plan_version_id, plan_id, organization_id);
create index idx_recurring_approvals_approved_by_fk on public.recurring_work_plan_version_approvals(approved_by);

create or replace function private.validate_recurring_plan_timezone()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names() zone where zone.name = new.timezone) then
    raise exception 'Timezone must be a valid IANA timezone name.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger validate_recurring_plan_timezone before insert or update of timezone
on public.recurring_work_plan_versions for each row execute function private.validate_recurring_plan_timezone();

create or replace function private.protect_recurring_plan_content()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Recurring plan versions, template items, and approvals are append-only.' using errcode = '55000';
end;
$$;

create trigger protect_recurring_plan_versions before update or delete on public.recurring_work_plan_versions
for each row execute function private.protect_recurring_plan_content();
create trigger protect_recurring_plan_template_items before update or delete on public.recurring_work_plan_template_items
for each row execute function private.protect_recurring_plan_content();
create trigger protect_recurring_plan_version_approvals before update or delete on public.recurring_work_plan_version_approvals
for each row execute function private.protect_recurring_plan_content();

create or replace function private.protect_recurring_plan_header()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Recurring plans cannot be deleted.' using errcode = '55000'; end if;
  if new.organization_id <> old.organization_id or new.project_id <> old.project_id
    or new.engagement_id <> old.engagement_id or new.engagement_service_id <> old.engagement_service_id
    or new.service_id <> old.service_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'Recurring plan ownership is immutable.' using errcode = '55000';
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status = 'approved')
    or (old.status = 'approved' and new.status in ('active', 'ended'))
    or (old.status = 'active' and new.status in ('paused', 'ended'))
    or (old.status = 'paused' and new.status in ('active', 'ended'))
    or (old.status = 'ended' and new.status = 'archived')
  ) then raise exception 'Unsupported recurring plan lifecycle transition.' using errcode = '22023'; end if;
  return new;
end;
$$;

create trigger protect_recurring_plan_header before update or delete on public.recurring_work_plans
for each row execute function private.protect_recurring_plan_header();

create or replace function private.assert_recurring_plan_actor(p_organization_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
  ) then raise exception 'Active organization team membership is required.' using errcode = '42501'; end if;
end;
$$;

create or replace function private.insert_recurring_plan_version(
  p_plan public.recurring_work_plans, p_title text, p_scope text, p_frequency text,
  p_timezone text, p_effective_start date, p_effective_end date,
  p_schedule_definition jsonb, p_template_items jsonb, p_actor_id uuid
)
returns public.recurring_work_plan_versions language plpgsql security invoker set search_path = '' as $$
declare
  v_version public.recurring_work_plan_versions;
  v_item jsonb;
  v_department_id text;
begin
  select service.department_id into v_department_id from public.service_catalog service
  where service.id = p_plan.service_id and service.organization_id = p_plan.organization_id;
  if coalesce(jsonb_typeof(p_template_items), '') <> 'array' or jsonb_array_length(p_template_items) = 0 then
    raise exception 'At least one template item is required.' using errcode = '22023';
  end if;
  insert into public.recurring_work_plan_versions (
    organization_id, plan_id, version_number, title, scope, frequency, timezone,
    effective_start, effective_end, schedule_definition, created_by
  ) values (
    p_plan.organization_id, p_plan.id,
    coalesce((select max(plan_version.version_number) + 1 from public.recurring_work_plan_versions plan_version where plan_version.plan_id = p_plan.id), 1),
    trim(p_title), coalesce(p_scope, ''), p_frequency, trim(p_timezone),
    p_effective_start, p_effective_end, coalesce(p_schedule_definition, '{}'::jsonb), p_actor_id
  ) returning * into v_version;
  for v_item in select value from jsonb_array_elements(p_template_items) loop
    if nullif(v_item->>'default_assignee_id', '') is not null and not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_plan.organization_id
        and membership.user_id = (v_item->>'default_assignee_id')::uuid
        and membership.member_kind = 'team' and membership.status = 'active'
    ) then raise exception 'Template assignees must be active organization team members.' using errcode = '42501'; end if;
    insert into public.recurring_work_plan_template_items (
      organization_id, plan_id, plan_version_id, template_key, title, description,
      work_item_type, priority, department_id, default_assignee_id,
      start_offset_days, due_offset_days, acceptance_criteria, position, created_by
    ) values (
      p_plan.organization_id, p_plan.id, v_version.id, trim(v_item->>'template_key'), trim(v_item->>'title'),
      coalesce(v_item->>'description', ''), coalesce(nullif(v_item->>'work_item_type', ''), 'task'),
      coalesce(nullif(v_item->>'priority', ''), 'medium'), v_department_id,
      nullif(v_item->>'default_assignee_id', '')::uuid,
      coalesce((v_item->>'start_offset_days')::integer, 0), coalesce((v_item->>'due_offset_days')::integer, 0),
      coalesce(v_item->>'acceptance_criteria', ''), (v_item->>'position')::integer, p_actor_id
    );
  end loop;
  return v_version;
end;
$$;

create or replace function public.create_recurring_work_plan(
  p_engagement_service_id uuid, p_title text, p_scope text, p_frequency text,
  p_timezone text, p_effective_start date, p_effective_end date,
  p_schedule_definition jsonb, p_template_items jsonb, p_actor_id uuid
)
returns public.recurring_work_plans language plpgsql security invoker set search_path = '' as $$
declare
  v_service public.engagement_services;
  v_engagement public.engagements;
  v_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
begin
  select * into v_service from public.engagement_services where id = p_engagement_service_id for share;
  if not found then raise exception 'Activated service not found.' using errcode = 'P0002'; end if;
  select * into v_engagement from public.engagements where id = v_service.engagement_id for share;
  if v_engagement.engagement_type <> 'retainer' then
    raise exception 'Recurring plans are limited to retainer engagements in RET1.' using errcode = '22023';
  end if;
  perform private.assert_recurring_plan_actor(v_service.organization_id, p_actor_id);
  if v_service.owner_id is distinct from p_actor_id then
    raise exception 'Only the activated service owner can draft a recurring plan.' using errcode = '42501';
  end if;
  if v_service.status not in ('planned', 'active', 'on_hold') then
    raise exception 'The activated service cannot accept a recurring plan in its current status.' using errcode = '22023';
  end if;
  insert into public.recurring_work_plans (
    organization_id, project_id, engagement_id, engagement_service_id, service_id, status_changed_by, created_by
  ) values (
    v_service.organization_id, v_engagement.project_id, v_service.engagement_id,
    v_service.id, v_service.service_id, p_actor_id, p_actor_id
  ) returning * into v_plan;
  v_version := private.insert_recurring_plan_version(
    v_plan, p_title, p_scope, p_frequency, p_timezone, p_effective_start,
    p_effective_end, p_schedule_definition, p_template_items, p_actor_id
  );
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_created', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id, 'version_number', v_version.version_number));
  return v_plan;
end;
$$;

create or replace function public.create_recurring_work_plan_version(
  p_plan_id uuid, p_title text, p_scope text, p_frequency text,
  p_timezone text, p_effective_start date, p_effective_end date,
  p_schedule_definition jsonb, p_template_items jsonb, p_actor_id uuid
)
returns public.recurring_work_plan_versions language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.recurring_work_plans;
  v_owner_id uuid;
  v_version public.recurring_work_plan_versions;
begin
  select * into v_plan from public.recurring_work_plans where id = p_plan_id for update;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_plan_actor(v_plan.organization_id, p_actor_id);
  select owner_id into v_owner_id from public.engagement_services where id = v_plan.engagement_service_id;
  if v_owner_id is distinct from p_actor_id then
    raise exception 'Only the current activated service owner can draft a plan version.' using errcode = '42501';
  end if;
  if v_plan.status in ('ended', 'archived') then
    raise exception 'Ended or archived recurring plans cannot receive new versions.' using errcode = '22023';
  end if;
  if v_plan.approved_version_id is not null and exists (
    select 1
    from public.recurring_work_plan_template_items current_item
    join jsonb_array_elements(p_template_items) proposed_item
      on proposed_item->>'template_key' = current_item.template_key
    where current_item.plan_version_id = v_plan.approved_version_id
      and current_item.default_assignee_id is distinct from nullif(proposed_item->>'default_assignee_id', '')::uuid
  ) then
    raise exception 'Existing template reassignment requires the service department manager.' using errcode = '42501';
  end if;
  v_version := private.insert_recurring_plan_version(
    v_plan, p_title, p_scope, p_frequency, p_timezone, p_effective_start,
    p_effective_end, p_schedule_definition, p_template_items, p_actor_id
  );
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_version_created', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id, 'version_number', v_version.version_number));
  return v_version;
end;
$$;

create or replace function public.approve_recurring_work_plan_version(
  p_plan_id uuid, p_plan_version_id uuid, p_approval_note text, p_actor_id uuid
)
returns public.recurring_work_plans language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
  v_project_owner_id uuid;
begin
  select * into v_plan from public.recurring_work_plans where id = p_plan_id for update;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_plan_actor(v_plan.organization_id, p_actor_id);
  select owner_id into v_project_owner_id from public.projects
  where id = v_plan.project_id and organization_id = v_plan.organization_id;
  if v_project_owner_id is distinct from p_actor_id then
    raise exception 'Only the canonical project owner can approve a recurring plan version.' using errcode = '42501';
  end if;
  select * into v_version from public.recurring_work_plan_versions
  where id = p_plan_version_id and plan_id = v_plan.id and organization_id = v_plan.organization_id;
  if not found then raise exception 'Recurring plan version not found.' using errcode = 'P0002'; end if;
  if v_plan.status in ('ended', 'archived') then
    raise exception 'Ended or archived recurring plans cannot approve versions.' using errcode = '22023';
  end if;
  insert into public.recurring_work_plan_version_approvals (
    organization_id, plan_id, plan_version_id, approved_by, approval_note
  ) values (v_plan.organization_id, v_plan.id, v_version.id, p_actor_id, coalesce(p_approval_note, ''));
  update public.recurring_work_plans set
    approved_version_id = v_version.id,
    status = case when status = 'draft' then 'approved' else status end,
    status_reason = case when status = 'draft' then coalesce(p_approval_note, '') else status_reason end,
    status_impact = case when status = 'draft' then '' else status_impact end,
    status_changed_by = case when status = 'draft' then p_actor_id else status_changed_by end,
    status_changed_at = case when status = 'draft' then now() else status_changed_at end,
    updated_at = now()
  where id = v_plan.id returning * into v_plan;
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_version_approved', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id, 'version_number', v_version.version_number));
  return v_plan;
end;
$$;

create or replace function public.reassign_recurring_plan_template_item(
  p_plan_id uuid, p_template_key text, p_assignee_id uuid, p_actor_id uuid
)
returns public.recurring_work_plan_versions language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.recurring_work_plans;
  v_current public.recurring_work_plan_versions;
  v_version public.recurring_work_plan_versions;
  v_department_id text;
  v_template_items jsonb;
begin
  select * into v_plan from public.recurring_work_plans where id = p_plan_id for update;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_plan_actor(v_plan.organization_id, p_actor_id);
  if v_plan.status in ('draft', 'ended', 'archived') or v_plan.approved_version_id is null then
    raise exception 'Only an approved, active, or paused plan can be reassigned.' using errcode = '22023';
  end if;
  select service.department_id into v_department_id from public.service_catalog service
  where service.id = v_plan.service_id and service.organization_id = v_plan.organization_id;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_plan.organization_id and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and membership.role = 'department_manager' and membership.department_id = v_department_id
  ) then
    raise exception 'Only the service department manager can reassign a recurring template item.' using errcode = '42501';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_plan.organization_id and membership.user_id = p_assignee_id
      and membership.member_kind = 'team' and membership.status = 'active'
  ) then raise exception 'The assignee must be an active organization team member.' using errcode = '42501'; end if;
  select * into v_current from public.recurring_work_plan_versions
  where id = v_plan.approved_version_id and plan_id = v_plan.id;
  if not exists (
    select 1 from public.recurring_work_plan_template_items item
    where item.plan_version_id = v_current.id and item.template_key = p_template_key
  ) then raise exception 'Recurring template item not found.' using errcode = 'P0002'; end if;
  select jsonb_agg(jsonb_build_object(
    'template_key', item.template_key, 'title', item.title, 'description', item.description,
    'work_item_type', item.work_item_type, 'priority', item.priority,
    'default_assignee_id', case when item.template_key = p_template_key then p_assignee_id else item.default_assignee_id end,
    'start_offset_days', item.start_offset_days, 'due_offset_days', item.due_offset_days,
    'acceptance_criteria', item.acceptance_criteria, 'position', item.position
  ) order by item.position) into v_template_items
  from public.recurring_work_plan_template_items item where item.plan_version_id = v_current.id;
  v_version := private.insert_recurring_plan_version(
    v_plan, v_current.title, v_current.scope, v_current.frequency, v_current.timezone,
    v_current.effective_start, v_current.effective_end, v_current.schedule_definition,
    v_template_items, p_actor_id
  );
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_version_created', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id,
      'version_number', v_version.version_number, 'change_type', 'internal_reassignment',
      'template_key', p_template_key, 'assignee_id', p_assignee_id));
  return v_version;
end;
$$;

create or replace function public.transition_recurring_work_plan(
  p_plan_id uuid, p_status text, p_reason text, p_impact text, p_actor_id uuid
)
returns public.recurring_work_plans language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.recurring_work_plans;
  v_project_owner_id uuid;
  v_previous_status text;
begin
  select * into v_plan from public.recurring_work_plans where id = p_plan_id for update;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_plan_actor(v_plan.organization_id, p_actor_id);
  select owner_id into v_project_owner_id from public.projects
  where id = v_plan.project_id and organization_id = v_plan.organization_id;
  if v_project_owner_id is distinct from p_actor_id then
    raise exception 'Only the canonical project owner can change recurring plan lifecycle.' using errcode = '42501';
  end if;
  if p_status = 'approved' then
    raise exception 'Approve a specific immutable version instead.' using errcode = '22023';
  end if;
  if p_status in ('paused', 'ended', 'archived') and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required for pause, end, or archive.' using errcode = '22023';
  end if;
  v_previous_status := v_plan.status;
  update public.recurring_work_plans set status = p_status, status_reason = coalesce(p_reason, ''),
    status_impact = coalesce(p_impact, ''), status_changed_by = p_actor_id,
    status_changed_at = now(), updated_at = now()
  where id = v_plan.id returning * into v_plan;
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_status_changed', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'from_status', v_previous_status, 'to_status', v_plan.status,
      'reason', v_plan.status_reason, 'impact', v_plan.status_impact));
  return v_plan;
end;
$$;

alter table public.engagement_events drop constraint engagement_events_event_type_check;
alter table public.engagement_events add constraint engagement_events_event_type_check
check (event_type in (
  'engagement_created', 'service_activated', 'blueprint_instantiated',
  'artifact_version_created', 'artifact_approved', 'design_direction_released',
  'campaign_created', 'campaign_updated', 'artifact_draft_proposed_via_chat',
  'stage_status_changed', 'work_item_created', 'work_item_status_changed', 'work_item_assigned',
  'recurring_plan_created', 'recurring_plan_version_created',
  'recurring_plan_version_approved', 'recurring_plan_status_changed'
));

alter table public.recurring_work_plans enable row level security;
alter table public.recurring_work_plan_versions enable row level security;
alter table public.recurring_work_plan_template_items enable row level security;
alter table public.recurring_work_plan_version_approvals enable row level security;

create policy "Team can read organization recurring plans"
  on public.recurring_work_plans for select to authenticated
  using ((select public.is_team_organization_member(organization_id)));
create policy "Team can read organization recurring plan versions"
  on public.recurring_work_plan_versions for select to authenticated
  using ((select public.is_team_organization_member(organization_id)));
create policy "Team can read organization recurring plan template items"
  on public.recurring_work_plan_template_items for select to authenticated
  using ((select public.is_team_organization_member(organization_id)));
create policy "Team can read organization recurring plan approvals"
  on public.recurring_work_plan_version_approvals for select to authenticated
  using ((select public.is_team_organization_member(organization_id)));

revoke all on public.recurring_work_plans from public, anon, authenticated, service_role;
revoke all on public.recurring_work_plan_versions from public, anon, authenticated, service_role;
revoke all on public.recurring_work_plan_template_items from public, anon, authenticated, service_role;
revoke all on public.recurring_work_plan_version_approvals from public, anon, authenticated, service_role;
grant select on public.recurring_work_plans, public.recurring_work_plan_versions,
  public.recurring_work_plan_template_items, public.recurring_work_plan_version_approvals to authenticated;
grant select, insert, update on public.recurring_work_plans to service_role;
grant select, insert on public.recurring_work_plan_versions,
  public.recurring_work_plan_template_items, public.recurring_work_plan_version_approvals to service_role;

revoke all on function public.create_recurring_work_plan(uuid, text, text, text, text, date, date, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.create_recurring_work_plan_version(uuid, text, text, text, text, date, date, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.approve_recurring_work_plan_version(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.reassign_recurring_plan_template_item(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.transition_recurring_work_plan(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_recurring_work_plan(uuid, text, text, text, text, date, date, jsonb, jsonb, uuid) to service_role;
grant execute on function public.create_recurring_work_plan_version(uuid, text, text, text, text, date, date, jsonb, jsonb, uuid) to service_role;
grant execute on function public.approve_recurring_work_plan_version(uuid, uuid, text, uuid) to service_role;
grant execute on function public.reassign_recurring_plan_template_item(uuid, text, uuid, uuid) to service_role;
grant execute on function public.transition_recurring_work_plan(uuid, text, text, text, uuid) to service_role;

revoke all on function private.validate_recurring_plan_timezone() from public, anon, authenticated;
revoke all on function private.protect_recurring_plan_content() from public, anon, authenticated;
revoke all on function private.protect_recurring_plan_header() from public, anon, authenticated;
revoke all on function private.assert_recurring_plan_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function private.insert_recurring_plan_version(public.recurring_work_plans, text, text, text, text, date, date, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.validate_recurring_plan_timezone() to service_role;
grant execute on function private.protect_recurring_plan_content() to service_role;
grant execute on function private.protect_recurring_plan_header() to service_role;
grant execute on function private.assert_recurring_plan_actor(uuid, uuid) to service_role;
grant execute on function private.insert_recurring_plan_version(public.recurring_work_plans, text, text, text, text, date, date, jsonb, jsonb, uuid) to service_role;

comment on column public.recurring_work_plan_versions.schedule_definition is
  'Stored recurrence detail only. RET1 does not interpret this object or generate occurrences.';
comment on column public.recurring_work_plan_template_items.start_offset_days is
  'Stored template offset only. RET1 does not calculate occurrence dates.';
comment on column public.recurring_work_plan_template_items.due_offset_days is
  'Stored template offset only. RET1 does not calculate occurrence dates.';

commit;
