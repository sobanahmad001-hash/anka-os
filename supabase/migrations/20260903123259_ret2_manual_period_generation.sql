-- Anka OS - RET2 manual recurring period generation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.recurring_work_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  engagement_service_id uuid not null,
  service_id uuid not null,
  period_start date not null,
  period_end date not null,
  timezone text not null,
  status text not null default 'generated' check (status in ('generated')),
  generated_by uuid not null references auth.users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  past_period_reason text not null default '',
  constraint recurring_occurrences_plan_org_fk
    foreign key (plan_id, organization_id)
    references public.recurring_work_plans(id, organization_id) on delete restrict,
  constraint recurring_occurrences_version_plan_org_fk
    foreign key (plan_version_id, plan_id, organization_id)
    references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict,
  constraint recurring_occurrences_engagement_project_org_fk
    foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id) on delete restrict,
  constraint recurring_occurrences_service_scope_fk
    foreign key (engagement_service_id, engagement_id, service_id, organization_id)
    references public.engagement_services(id, engagement_id, service_id, organization_id) on delete restrict,
  unique (organization_id, plan_id, period_start),
  unique (id, plan_id, plan_version_id, organization_id),
  unique (id, organization_id),
  check (period_end > period_start),
  check (length(trim(timezone)) between 1 and 100),
  check (length(past_period_reason) <= 2000)
);

create table public.recurring_work_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  occurrence_id uuid not null,
  request_key uuid not null,
  requested_period_start date not null,
  outcome text not null check (outcome in ('generated', 'replayed')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint recurring_attempts_occurrence_scope_fk
    foreign key (occurrence_id, plan_id, plan_version_id, organization_id)
    references public.recurring_work_occurrences(id, plan_id, plan_version_id, organization_id) on delete restrict,
  unique (organization_id, request_key),
  check (completed_at >= requested_at)
);

alter table public.work_items
  add column recurring_occurrence_id uuid,
  add column recurring_plan_id uuid,
  add column recurring_plan_version_id uuid,
  add column recurring_template_key text;

alter table public.work_items
  add constraint work_items_recurring_provenance_all_or_none_check
  check (
    (recurring_occurrence_id is null and recurring_plan_id is null
      and recurring_plan_version_id is null and recurring_template_key is null)
    or
    (recurring_occurrence_id is not null and recurring_plan_id is not null
      and recurring_plan_version_id is not null and recurring_template_key is not null)
  ),
  add constraint work_items_recurring_occurrence_scope_fk
  foreign key (recurring_occurrence_id, recurring_plan_id, recurring_plan_version_id, organization_id)
  references public.recurring_work_occurrences(id, plan_id, plan_version_id, organization_id) on delete restrict,
  add constraint work_items_recurring_version_scope_fk
  foreign key (recurring_plan_version_id, recurring_plan_id, organization_id)
  references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict;

create unique index work_items_recurring_template_unique
  on public.work_items(recurring_occurrence_id, recurring_template_key)
  where recurring_occurrence_id is not null;
create index idx_recurring_occurrences_plan_org_fk
  on public.recurring_work_occurrences(plan_id, organization_id);
create index idx_recurring_occurrences_version_plan_org_fk
  on public.recurring_work_occurrences(plan_version_id, plan_id, organization_id);
create index idx_recurring_occurrences_engagement_project_org_fk
  on public.recurring_work_occurrences(engagement_id, project_id, organization_id);
create index idx_recurring_occurrences_service_scope_fk
  on public.recurring_work_occurrences(engagement_service_id, engagement_id, service_id, organization_id);
create index idx_recurring_occurrences_period
  on public.recurring_work_occurrences(organization_id, period_start, status, plan_id);
create index idx_recurring_occurrences_generated_by_fk
  on public.recurring_work_occurrences(generated_by);
create index idx_recurring_attempts_occurrence_scope_fk
  on public.recurring_work_generation_attempts(occurrence_id, plan_id, plan_version_id, organization_id);
create index idx_recurring_attempts_actor_fk
  on public.recurring_work_generation_attempts(actor_id);
create index idx_work_items_recurring_occurrence_fk
  on public.work_items(recurring_occurrence_id, recurring_plan_id, recurring_plan_version_id, organization_id)
  where recurring_occurrence_id is not null;
create index idx_work_items_recurring_version_fk
  on public.work_items(recurring_plan_version_id, recurring_plan_id, organization_id)
  where recurring_plan_version_id is not null;

alter table public.work_items drop constraint work_items_created_via_check;
alter table public.work_items add constraint work_items_created_via_check
  check (created_via in ('manual', 'ai_chat_proposal', 'automation_rule', 'recurring_plan'));

create or replace function private.protect_recurring_generation_records()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Recurring occurrences and generation attempts are append-only.' using errcode = '55000';
end;
$$;

create trigger protect_recurring_occurrences before update or delete on public.recurring_work_occurrences
for each row execute function private.protect_recurring_generation_records();
create trigger protect_recurring_generation_attempts before update or delete on public.recurring_work_generation_attempts
for each row execute function private.protect_recurring_generation_records();

create or replace function private.protect_work_item_recurring_provenance()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.recurring_occurrence_id is distinct from old.recurring_occurrence_id
    or new.recurring_plan_id is distinct from old.recurring_plan_id
    or new.recurring_plan_version_id is distinct from old.recurring_plan_version_id
    or new.recurring_template_key is distinct from old.recurring_template_key
    or new.created_via is distinct from old.created_via then
    raise exception 'Work item creation provenance is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger protect_work_item_recurring_provenance before update of
  recurring_occurrence_id, recurring_plan_id, recurring_plan_version_id,
  recurring_template_key, created_via on public.work_items
for each row execute function private.protect_work_item_recurring_provenance();

create or replace function private.recurring_month_anchor(p_anchor date, p_month_offset integer)
returns date language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_month date;
  v_last_day integer;
begin
  v_month := (date_trunc('month', p_anchor)::date + make_interval(months => p_month_offset))::date;
  v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::integer;
  return v_month + (least(extract(day from p_anchor)::integer, v_last_day) - 1);
end;
$$;

create or replace function private.recurring_period_end(
  p_frequency text, p_anchor date, p_period_start date
)
returns date language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_month_offset integer;
begin
  if p_frequency = 'weekly' then
    if p_period_start < p_anchor or mod(p_period_start - p_anchor, 7) <> 0 then
      raise exception 'Period start is not a canonical weekly plan anchor.' using errcode = '22023';
    end if;
    return p_period_start + 7;
  end if;
  if p_frequency = 'monthly' then
    v_month_offset := (extract(year from p_period_start)::integer - extract(year from p_anchor)::integer) * 12
      + extract(month from p_period_start)::integer - extract(month from p_anchor)::integer;
    if v_month_offset < 0 or private.recurring_month_anchor(p_anchor, v_month_offset) <> p_period_start then
      raise exception 'Period start is not a canonical monthly plan anchor.' using errcode = '22023';
    end if;
    return private.recurring_month_anchor(p_anchor, v_month_offset + 1);
  end if;
  raise exception 'Unsupported recurring frequency.' using errcode = '22023';
end;
$$;

create or replace function private.assert_recurring_generation_actor(
  p_plan public.recurring_work_plans, p_actor_id uuid
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_recurring_plan_actor(p_plan.organization_id, p_actor_id);
  if not exists (
    select 1 from public.engagement_services service
    where service.id = p_plan.engagement_service_id
      and service.organization_id = p_plan.organization_id
      and service.owner_id = p_actor_id
  ) then
    raise exception 'Only the current activated service owner can generate a recurring period.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.build_recurring_period_preview(
  p_plan_id uuid, p_period_start date, p_past_period_reason text, p_actor_id uuid
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
  v_engagement public.engagements;
  v_service public.engagement_services;
  v_catalog public.service_catalog;
  v_period_end date;
  v_local_today date;
  v_reasons text[] := array[]::text[];
  v_items jsonb := '[]'::jsonb;
begin
  if p_period_start is null then raise exception 'Period start is required.' using errcode = '22023'; end if;
  select * into v_plan from public.recurring_work_plans where id = p_plan_id;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_generation_actor(v_plan, p_actor_id);

  select version.* into v_version
  from public.recurring_work_plan_versions version
  join public.recurring_work_plan_version_approvals approval on approval.plan_version_id = version.id
  where version.plan_id = v_plan.id and version.organization_id = v_plan.organization_id
    and version.effective_start <= p_period_start
    and (version.effective_end is null or version.effective_end >= p_period_start)
  order by version.effective_start desc, version.version_number desc
  limit 1;

  if not found then
    v_reasons := array_append(v_reasons, 'no_approved_effective_version');
    return jsonb_build_object('eligible', false, 'reasons', to_jsonb(v_reasons),
      'plan_id', v_plan.id, 'period_start', p_period_start);
  end if;

  begin
    v_period_end := private.recurring_period_end(v_version.frequency, v_version.effective_start, p_period_start);
  exception when sqlstate '22023' then
    v_reasons := array_append(v_reasons, 'period_start_is_not_canonical');
  end;

  select * into v_engagement from public.engagements
  where id = v_plan.engagement_id and project_id = v_plan.project_id and organization_id = v_plan.organization_id;
  select * into v_service from public.engagement_services
  where id = v_plan.engagement_service_id and engagement_id = v_plan.engagement_id
    and service_id = v_plan.service_id and organization_id = v_plan.organization_id;
  select * into v_catalog from public.service_catalog
  where id = v_plan.service_id and organization_id = v_plan.organization_id;

  if v_plan.status <> 'active' then v_reasons := array_append(v_reasons, 'plan_not_active'); end if;
  if v_engagement.engagement_type <> 'retainer' then v_reasons := array_append(v_reasons, 'engagement_not_retainer'); end if;
  if v_engagement.status <> 'active' then v_reasons := array_append(v_reasons, 'engagement_not_active'); end if;
  if v_service.status <> 'active' then v_reasons := array_append(v_reasons, 'engagement_service_not_active'); end if;
  if not coalesce(v_catalog.is_active, false) then v_reasons := array_append(v_reasons, 'service_catalog_not_active'); end if;
  if exists (
    select 1 from public.recurring_work_plan_template_items item
    where item.plan_version_id = v_version.id and item.default_assignee_id is not null
      and not exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = v_plan.organization_id
          and membership.user_id = item.default_assignee_id
          and membership.member_kind = 'team' and membership.status = 'active'
      )
  ) then v_reasons := array_append(v_reasons, 'template_assignee_not_active'); end if;

  v_local_today := (now() at time zone v_version.timezone)::date;
  if p_period_start < v_local_today and length(trim(coalesce(p_past_period_reason, ''))) = 0 then
    v_reasons := array_append(v_reasons, 'past_period_reason_required');
  end if;
  if length(coalesce(p_past_period_reason, '')) > 2000 then
    v_reasons := array_append(v_reasons, 'past_period_reason_too_long');
  end if;
  if exists (
    select 1 from public.recurring_work_occurrences occurrence
    where occurrence.organization_id = v_plan.organization_id
      and occurrence.plan_id = v_plan.id and occurrence.period_start = p_period_start
  ) then v_reasons := array_append(v_reasons, 'period_already_generated'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'template_key', item.template_key, 'title', item.title, 'description', item.description,
    'work_item_type', item.work_item_type, 'priority', item.priority,
    'assignee_id', item.default_assignee_id, 'department_id', item.department_id,
    'start_date', p_period_start + item.start_offset_days,
    'due_date', p_period_start + item.due_offset_days,
    'acceptance_criteria', item.acceptance_criteria, 'position', item.position
  ) order by item.position, item.id), '[]'::jsonb) into v_items
  from public.recurring_work_plan_template_items item where item.plan_version_id = v_version.id;

  return jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
    'organization_id', v_plan.organization_id, 'plan_id', v_plan.id,
    'plan_version_id', v_version.id, 'version_number', v_version.version_number,
    'frequency', v_version.frequency, 'timezone', v_version.timezone,
    'period_start', p_period_start, 'period_end', v_period_end,
    'local_today', v_local_today, 'template_items', v_items
  );
end;
$$;

create or replace function public.preview_recurring_work_period(
  p_plan_id uuid, p_period_start date, p_past_period_reason text, p_actor_id uuid
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.build_recurring_period_preview(
    p_plan_id, p_period_start, p_past_period_reason, p_actor_id
  );
$$;

create or replace function public.confirm_recurring_work_period(
  p_plan_id uuid, p_period_start date, p_request_key uuid,
  p_past_period_reason text, p_actor_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.recurring_work_plans;
  v_preview jsonb;
  v_occurrence public.recurring_work_occurrences;
  v_existing_attempt public.recurring_work_generation_attempts;
  v_engagement public.engagements;
  v_item public.recurring_work_plan_template_items;
  v_work_item public.work_items;
  v_work_items jsonb;
  v_outcome text := 'generated';
begin
  if p_request_key is null then raise exception 'Request key is required.' using errcode = '22023'; end if;
  select * into v_plan from public.recurring_work_plans where id = p_plan_id;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_generation_actor(v_plan, p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended(v_plan.organization_id::text || ':' || v_plan.id::text || ':' || p_period_start::text, 0));

  select * into v_existing_attempt from public.recurring_work_generation_attempts
  where organization_id = v_plan.organization_id and request_key = p_request_key;
  if found then
    if v_existing_attempt.plan_id <> v_plan.id or v_existing_attempt.requested_period_start <> p_period_start then
      raise exception 'Request key was already used for a different recurring period.' using errcode = '22023';
    end if;
    select * into v_occurrence from public.recurring_work_occurrences where id = v_existing_attempt.occurrence_id;
  else
    select * into v_occurrence from public.recurring_work_occurrences
    where organization_id = v_plan.organization_id and plan_id = v_plan.id and period_start = p_period_start;
    if found then
      v_outcome := 'replayed';
      insert into public.recurring_work_generation_attempts (
        organization_id, plan_id, plan_version_id, occurrence_id, request_key,
        requested_period_start, outcome, actor_id
      ) values (
        v_occurrence.organization_id, v_occurrence.plan_id, v_occurrence.plan_version_id,
        v_occurrence.id, p_request_key, p_period_start, v_outcome, p_actor_id
      );
    else
      v_preview := private.build_recurring_period_preview(
        p_plan_id, p_period_start, p_past_period_reason, p_actor_id
      );
      if not coalesce((v_preview->>'eligible')::boolean, false) then
        raise exception 'Recurring period is not eligible: %', v_preview->'reasons' using errcode = '22023';
      end if;
      select * into v_engagement from public.engagements where id = v_plan.engagement_id;
      insert into public.recurring_work_occurrences (
        organization_id, plan_id, plan_version_id, project_id, engagement_id,
        engagement_service_id, service_id, period_start, period_end, timezone,
        generated_by, past_period_reason
      ) values (
        v_plan.organization_id, v_plan.id, (v_preview->>'plan_version_id')::uuid,
        v_plan.project_id, v_plan.engagement_id, v_plan.engagement_service_id,
        v_plan.service_id, p_period_start, (v_preview->>'period_end')::date,
        v_preview->>'timezone', p_actor_id, trim(coalesce(p_past_period_reason, ''))
      ) returning * into v_occurrence;

      for v_item in select * from public.recurring_work_plan_template_items
        where plan_version_id = v_occurrence.plan_version_id order by position, id
      loop
        insert into public.work_items (
          organization_id, project_id, engagement_id, brand_id, department_id,
          title, description, work_item_type, priority, status, assignee_id,
          created_by, start_date, due_date, position, created_via,
          recurring_occurrence_id, recurring_plan_id, recurring_plan_version_id,
          recurring_template_key
        ) values (
          v_plan.organization_id, v_plan.project_id, v_plan.engagement_id,
          v_engagement.brand_id, v_item.department_id, v_item.title, v_item.description,
          v_item.work_item_type, v_item.priority, 'not_started', v_item.default_assignee_id,
          p_actor_id, p_period_start + v_item.start_offset_days,
          p_period_start + v_item.due_offset_days, v_item.position, 'recurring_plan',
          v_occurrence.id, v_plan.id, v_occurrence.plan_version_id, v_item.template_key
        ) returning * into v_work_item;

        insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
        values (v_plan.organization_id, v_plan.engagement_id, 'work_item_created', p_actor_id,
          jsonb_build_object(
            'record_type', 'work_item', 'record_id', v_work_item.id, 'action', 'created',
            'status', v_work_item.status, 'assignee_id', v_work_item.assignee_id,
            'department_id', v_work_item.department_id, 'parent_work_item_id', null,
            'created_via', 'recurring_plan', 'recurring_plan_id', v_plan.id,
            'recurring_plan_version_id', v_occurrence.plan_version_id,
            'recurring_occurrence_id', v_occurrence.id, 'recurring_template_key', v_item.template_key,
            'period_start', v_occurrence.period_start, 'period_end', v_occurrence.period_end,
            'request_key', p_request_key
          ));
        if v_work_item.assignee_id is not null then
          insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
          values (v_plan.organization_id, v_plan.engagement_id, 'work_item_assigned', p_actor_id,
            jsonb_build_object(
              'record_type', 'work_item', 'record_id', v_work_item.id, 'action', 'assigned',
              'previous_assignee_id', null, 'assignee_id', v_work_item.assignee_id,
              'created_via', 'recurring_plan', 'recurring_occurrence_id', v_occurrence.id
            ));
        end if;
      end loop;

      insert into public.recurring_work_generation_attempts (
        organization_id, plan_id, plan_version_id, occurrence_id, request_key,
        requested_period_start, outcome, actor_id
      ) values (
        v_occurrence.organization_id, v_occurrence.plan_id, v_occurrence.plan_version_id,
        v_occurrence.id, p_request_key, p_period_start, v_outcome, p_actor_id
      );
      insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
      values (v_plan.organization_id, v_plan.engagement_id, 'recurring_period_generated', p_actor_id,
        jsonb_build_object(
          'plan_id', v_plan.id, 'plan_version_id', v_occurrence.plan_version_id,
          'occurrence_id', v_occurrence.id, 'period_start', v_occurrence.period_start,
          'period_end', v_occurrence.period_end, 'timezone', v_occurrence.timezone,
          'request_key', p_request_key, 'created_via', 'recurring_plan'
        ));
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', work_item.id, 'template_key', work_item.recurring_template_key,
    'title', work_item.title, 'start_date', work_item.start_date,
    'due_date', work_item.due_date, 'assignee_id', work_item.assignee_id
  ) order by work_item.position, work_item.id), '[]'::jsonb) into v_work_items
  from public.work_items work_item where work_item.recurring_occurrence_id = v_occurrence.id;

  return jsonb_build_object(
    'outcome', case when v_existing_attempt.id is not null then v_existing_attempt.outcome else v_outcome end,
    'occurrence_id', v_occurrence.id, 'plan_id', v_occurrence.plan_id,
    'plan_version_id', v_occurrence.plan_version_id, 'period_start', v_occurrence.period_start,
    'period_end', v_occurrence.period_end, 'timezone', v_occurrence.timezone,
    'work_items', v_work_items
  );
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
  'recurring_plan_version_approved', 'recurring_plan_status_changed',
  'recurring_period_generated'
));

alter table public.recurring_work_occurrences enable row level security;
alter table public.recurring_work_generation_attempts enable row level security;
create policy "Team can read organization recurring occurrences"
  on public.recurring_work_occurrences for select to authenticated
  using ((select public.is_team_organization_member(organization_id)));
create policy "Team can read organization recurring generation attempts"
  on public.recurring_work_generation_attempts for select to authenticated
  using ((select public.is_team_organization_member(organization_id)));

revoke all on public.recurring_work_occurrences from public, anon, authenticated, service_role;
revoke all on public.recurring_work_generation_attempts from public, anon, authenticated, service_role;
grant select on public.recurring_work_occurrences, public.recurring_work_generation_attempts to authenticated;
grant select, insert on public.recurring_work_occurrences, public.recurring_work_generation_attempts to service_role;

revoke all on function public.preview_recurring_work_period(uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.confirm_recurring_work_period(uuid, date, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.preview_recurring_work_period(uuid, date, text, uuid) to service_role;
grant execute on function public.confirm_recurring_work_period(uuid, date, uuid, text, uuid) to service_role;
revoke all on function private.protect_recurring_generation_records() from public, anon, authenticated;
revoke all on function private.protect_work_item_recurring_provenance() from public, anon, authenticated;
revoke all on function private.recurring_month_anchor(date, integer) from public, anon, authenticated;
revoke all on function private.recurring_period_end(text, date, date) from public, anon, authenticated;
revoke all on function private.assert_recurring_generation_actor(public.recurring_work_plans, uuid) from public, anon, authenticated;
revoke all on function private.build_recurring_period_preview(uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function private.protect_recurring_generation_records() to service_role;
grant execute on function private.protect_work_item_recurring_provenance() to service_role;
grant execute on function private.recurring_month_anchor(date, integer) to service_role;
grant execute on function private.recurring_period_end(text, date, date) to service_role;
grant execute on function private.assert_recurring_generation_actor(public.recurring_work_plans, uuid) to service_role;
grant execute on function private.build_recurring_period_preview(uuid, date, text, uuid) to service_role;

comment on table public.recurring_work_occurrences is
  'RET2 append-only manual period snapshots. Periods are plan-aligned local date windows and freeze one approved version.';
comment on table public.recurring_work_generation_attempts is
  'RET2 append-only successful confirmation/replay provenance. Failed generation transactions leave no partial records.';
comment on column public.recurring_work_occurrences.period_end is
  'Exclusive local-date boundary for the half-open occurrence window.';
comment on column public.recurring_work_occurrences.timezone is
  'Immutable IANA timezone copied from the approved plan version used for this occurrence.';
comment on function public.preview_recurring_work_period(uuid, date, text, uuid) is
  'Service-role-only, read-only RET2 preview for one canonical manual period.';
comment on function public.confirm_recurring_work_period(uuid, date, uuid, text, uuid) is
  'Service-role-only atomic RET2 confirmation; serializes by plan/period and replays existing IDs.';

commit;
