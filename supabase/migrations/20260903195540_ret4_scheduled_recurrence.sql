-- RET4: opt-in scheduled recurrence. No identity, secret or Cron job is provisioned.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.recurring_scheduler_principals (
  actor_id uuid primary key references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  unique (actor_id, organization_id)
);
create index recurring_scheduler_principals_org_idx on private.recurring_scheduler_principals(organization_id);
alter table private.recurring_scheduler_principals enable row level security;
revoke all on private.recurring_scheduler_principals from public, anon, authenticated, service_role;
grant select on private.recurring_scheduler_principals to service_role;

create or replace function private.validate_recurring_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Legacy arbitrary metadata and {} are never consent. Only a new explicit opt-in counts.
  if new.schedule_definition ? 'scheduler' then
    if jsonb_typeof(new.schedule_definition->'scheduler') <> 'object'
       or new.schedule_definition->'scheduler' <> jsonb_build_object(
         'enabled', true, 'local_time', new.schedule_definition->'scheduler'->>'local_time',
         'policy', 'ret4_v1')
       or coalesce(new.schedule_definition->'scheduler'->>'local_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Schedule requires explicit enabled=true, local_time HH:MM and policy ret4_v1.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_recurring_schedule before insert on public.recurring_work_plan_versions
for each row execute function private.validate_recurring_schedule();

-- Records whether schedule consent was validated by RET4. No existing version is enrolled.
create table public.recurring_schedule_consents (
  plan_version_id uuid primary key,
  plan_id uuid not null,
  organization_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (plan_version_id, plan_id, organization_id)
    references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict
);
create or replace function private.record_recurring_schedule_consent()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.schedule_definition ? 'scheduler' then
    insert into public.recurring_schedule_consents(plan_version_id, plan_id, organization_id)
    values (new.id, new.plan_id, new.organization_id);
  end if;
  return new;
end;
$$;
create trigger record_recurring_schedule_consent after insert on public.recurring_work_plan_versions
for each row execute function private.record_recurring_schedule_consent();

create or replace function private.recurring_due_instant(p_local timestamp, p_timezone text)
returns timestamptz language plpgsql stable security invoker set search_path = '' as $$
declare v_guess timestamptz; v_result timestamptz;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names() where name = p_timezone) then
    raise exception 'Invalid IANA timezone.' using errcode = '22023';
  end if;
  v_guess := p_local at time zone p_timezone;
  -- Enumerate offsets around the date; choose the earliest matching instant on a fold.
  select min(candidate) into v_result from (
    select (p_local - ((sample at time zone p_timezone) - (sample at time zone 'UTC'))) at time zone 'UTC' candidate
    from generate_series(v_guess - interval '3 days', v_guess + interval '3 days', interval '6 hours') sample
  ) offsets where candidate at time zone p_timezone = p_local;
  if v_result is not null then return v_result; end if;
  -- A gap has no matching instant. Find its first valid local second, not a shifted minute.
  select instant into v_result
  from generate_series(v_guess - interval '26 hours', v_guess + interval '26 hours', interval '1 second') instant
  where instant at time zone p_timezone >= p_local
  order by instant at time zone p_timezone, instant limit 1;
  if v_result is null then raise exception 'Local date cannot be resolved.'; end if;
  return v_result;
end;
$$;

create or replace function private.recurring_retry_deadline(p_admitted timestamptz, p_period date, p_timezone text)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select least(p_admitted + interval '15 minutes',
    private.recurring_due_instant((p_period + 1)::timestamp, p_timezone));
$$;

create table public.recurring_schedule_admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  period_start date not null,
  timezone text not null,
  due_at timestamptz not null,
  admitted_at timestamptz not null,
  retry_deadline timestamptz not null,
  plan_status_changed_at timestamptz not null,
  actor_id uuid not null,
  unique (organization_id, plan_id, period_start),
  unique (id, organization_id),
  foreign key (plan_version_id, plan_id, organization_id)
    references public.recurring_work_plan_versions(id, plan_id, organization_id) on delete restrict,
  foreign key (actor_id, organization_id)
    references private.recurring_scheduler_principals(actor_id, organization_id) on delete restrict,
  check (admitted_at >= due_at and admitted_at < due_at + interval '5 minutes'),
  check (retry_deadline > admitted_at and retry_deadline <= admitted_at + interval '15 minutes')
);

-- Pure predicates make exact boundary behavior verifiable without a caller-set
-- RPC clock. Runtime entry points always supply clock_timestamp().
create or replace function private.recurring_admission_open(
  p_now timestamptz,p_due timestamptz,p_period date,p_timezone text,
  p_approved timestamptz,p_status_changed timestamptz)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(p_approved < p_due and p_status_changed < p_due
    and p_now >= p_due and p_now < p_due + interval '5 minutes'
    and (p_now at time zone p_timezone)::date = p_period,false);
$$;
create or replace function private.recurring_execution_open(
  p_now timestamptz,p_deadline timestamptz,p_period date,p_timezone text)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(p_now < p_deadline and (p_now at time zone p_timezone)::date = p_period,false);
$$;
revoke all on function private.recurring_admission_open(timestamptz,timestamptz,date,text,timestamptz,timestamptz),
private.recurring_execution_open(timestamptz,timestamptz,date,text) from public,anon,authenticated;
grant execute on function private.recurring_admission_open(timestamptz,timestamptz,date,text,timestamptz,timestamptz),
private.recurring_execution_open(timestamptz,timestamptz,date,text) to service_role;
create index recurring_schedule_admission_version_idx on public.recurring_schedule_admissions(plan_version_id, plan_id, organization_id);
create index recurring_schedule_admission_actor_idx on public.recurring_schedule_admissions(actor_id, organization_id);

create table public.recurring_schedule_executions (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null,
  organization_id uuid not null,
  attempted_at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome in ('generated', 'replayed', 'retryable_failure', 'manual_review')),
  error_code text,
  occurrence_id uuid,
  foreign key (admission_id, organization_id) references public.recurring_schedule_admissions(id, organization_id) on delete restrict,
  foreign key (occurrence_id, organization_id) references public.recurring_work_occurrences(id, organization_id) on delete restrict
);
create index recurring_schedule_execution_admission_idx on public.recurring_schedule_executions(admission_id, organization_id);
create index recurring_schedule_execution_occurrence_idx on public.recurring_schedule_executions(occurrence_id, organization_id);

create or replace function private.assert_recurring_scheduler(p_actor uuid, p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.recurring_scheduler_principals
    where actor_id = p_actor and organization_id = p_org and enabled for share;
  if not found or exists(select 1 from public.organization_memberships where user_id = p_actor) then
    raise exception 'Authorized machine scheduler required.' using errcode = '42501';
  end if;
  perform 1 from auth.users where id = p_actor and deleted_at is null
    and (banned_until is null or banned_until <= clock_timestamp()) for share;
  if not found then raise exception 'Active machine account required.' using errcode = '42501'; end if;
  perform 1 from public.organizations where id = p_org and status = 'active' for share;
  if not found then raise exception 'Active organization required.' using errcode = '42501'; end if;
end;
$$;
-- Admin-approved narrow gate: caller identity is verified by the Edge endpoint,
-- not supplied by a browser. The migration owner retains ownership. No table
-- access or mutable registry privilege is granted to the runtime role.
revoke all on function private.assert_recurring_scheduler(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.assert_recurring_scheduler(uuid,uuid) to service_role;

-- Locks the eligibility rows through commit. Never invokes the human owner RPC as a machine.
create or replace function private.assert_scheduled_recurring_context(
  p_plan public.recurring_work_plans, p_version public.recurring_work_plan_versions)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_assignee uuid;
begin
  if p_plan.status <> 'active' then raise exception 'Plan inactive.' using errcode = '55000'; end if;
  perform 1 from public.engagements where id=p_plan.engagement_id and project_id=p_plan.project_id
    and organization_id=p_plan.organization_id and status='active' and engagement_type='retainer' for share;
  if not found then raise exception 'Retainer inactive.' using errcode = '55000'; end if;
  perform 1 from public.engagement_services where id=p_plan.engagement_service_id and engagement_id=p_plan.engagement_id
    and service_id=p_plan.service_id and organization_id=p_plan.organization_id and status='active' for share;
  if not found then raise exception 'Service inactive.' using errcode = '55000'; end if;
  perform 1 from public.service_catalog where id=p_plan.service_id and organization_id=p_plan.organization_id and is_active for share;
  if not found then raise exception 'Catalog inactive.' using errcode = '55000'; end if;
  for v_assignee in select distinct default_assignee_id from public.recurring_work_plan_template_items
    where plan_version_id=p_version.id and default_assignee_id is not null order by default_assignee_id
  loop
    perform 1 from public.organization_memberships where organization_id=p_plan.organization_id
      and user_id=v_assignee and status='active' and member_kind='team' for share;
    if not found then raise exception 'Assignee inactive.' using errcode = '55000'; end if;
  end loop;
end;
$$;

create or replace function public.admit_recurring_schedule(p_plan_id uuid, p_period_start date, p_actor_id uuid)
returns public.recurring_schedule_admissions language plpgsql security invoker set search_path = '' as $$
declare v_plan public.recurring_work_plans; v_version public.recurring_work_plan_versions;
  v_admission public.recurring_schedule_admissions; v_due timestamptz; v_now timestamptz; v_approved timestamptz;
begin
  select * into strict v_plan from public.recurring_work_plans where id=p_plan_id;
  perform private.assert_recurring_scheduler(p_actor_id, v_plan.organization_id);
  perform pg_advisory_xact_lock(hashtextextended(v_plan.organization_id::text || ':' || v_plan.id::text || ':' || p_period_start::text, 0));
  select * into strict v_plan from public.recurring_work_plans where id=p_plan_id for share;
  select * into v_admission from public.recurring_schedule_admissions
    where organization_id=v_plan.organization_id and plan_id=p_plan_id and period_start=p_period_start;
  if found then
    if v_admission.actor_id <> p_actor_id then raise exception 'Admission actor mismatch.' using errcode='42501'; end if;
    return v_admission; -- No new admission or extension; execute enforces the saved deadline.
  end if;
  select version.* into v_version from public.recurring_work_plan_versions version
    join public.recurring_work_plan_version_approvals approval on approval.plan_version_id=version.id
    where version.plan_id=p_plan_id and version.organization_id=v_plan.organization_id
      and version.effective_start<=p_period_start and (version.effective_end is null or version.effective_end>=p_period_start)
    order by version.effective_start desc, version.version_number desc limit 1;
  if not found or not exists(select 1 from public.recurring_schedule_consents where plan_version_id=v_version.id)
    then raise exception 'No explicitly opted-in approved schedule.' using errcode='55000'; end if;
  perform private.recurring_period_end(v_version.frequency, v_version.effective_start, p_period_start);
  v_due := private.recurring_due_instant(p_period_start + (v_version.schedule_definition->'scheduler'->>'local_time')::time, v_version.timezone);
  select approved_at into strict v_approved from public.recurring_work_plan_version_approvals where plan_version_id=v_version.id;
  v_now := clock_timestamp();
  if not private.recurring_admission_open(v_now,v_due,p_period_start,v_version.timezone,v_approved,v_plan.status_changed_at) then
    raise exception 'Due admission window missed or not yet open; manual recovery only.' using errcode='55000';
  end if;
  perform private.assert_scheduled_recurring_context(v_plan, v_version);
  v_now := clock_timestamp();
  if not private.recurring_admission_open(v_now,v_due,p_period_start,v_version.timezone,v_approved,v_plan.status_changed_at)
    then raise exception 'Admission window closed.' using errcode='55000'; end if;
  insert into public.recurring_schedule_admissions(organization_id,plan_id,plan_version_id,period_start,timezone,
    due_at,admitted_at,retry_deadline,plan_status_changed_at,actor_id)
  values(v_plan.organization_id,v_plan.id,v_version.id,p_period_start,v_version.timezone,v_due,v_now,
    private.recurring_retry_deadline(v_now,p_period_start,v_version.timezone),v_plan.status_changed_at,p_actor_id)
  returning * into v_admission;
  return v_admission;
end;
$$;

create or replace function public.execute_recurring_schedule(p_admission_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.recurring_schedule_admissions; p public.recurring_work_plans; v public.recurring_work_plan_versions;
  o public.recurring_work_occurrences; item public.recurring_work_plan_template_items; w public.work_items;
  v_brand uuid; v_code text; v_outcome text; v_event jsonb; v_result jsonb;
begin
  select * into strict a from public.recurring_schedule_admissions where id=p_admission_id;
  perform private.assert_recurring_scheduler(p_actor_id,a.organization_id);
  if a.actor_id <> p_actor_id then raise exception 'Admission actor mismatch.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.organization_id::text || ':' || a.plan_id::text || ':' || a.period_start::text,0));
  select * into strict p from public.recurring_work_plans where id=a.plan_id for share;
  -- A subtransaction rolls back every business write if any insert or final deadline check fails.
  begin
    if not private.recurring_execution_open(clock_timestamp(),a.retry_deadline,a.period_start,a.timezone)
      or p.status_changed_at <> a.plan_status_changed_at
      or exists(select 1 from public.recurring_schedule_executions where admission_id=a.id and outcome='manual_review') then
      raise exception 'Execution closed; manual review required.' using errcode='55000';
    end if;
    select version.* into v from public.recurring_work_plan_versions version
      join public.recurring_work_plan_version_approvals approval on approval.plan_version_id=version.id
      where version.plan_id=p.id and version.organization_id=p.organization_id
        and version.effective_start<=a.period_start and (version.effective_end is null or version.effective_end>=a.period_start)
      order by version.effective_start desc,version.version_number desc limit 1;
    if v.id is distinct from a.plan_version_id then raise exception 'Applicable version changed.' using errcode='55000'; end if;
    perform private.assert_scheduled_recurring_context(p,v);
    select * into o from public.recurring_work_occurrences where organization_id=a.organization_id and plan_id=a.plan_id and period_start=a.period_start;
    if found then v_outcome := 'replayed';
    else
      v_outcome := 'generated';
      select brand_id into strict v_brand from public.engagements where id=p.engagement_id;
      insert into public.recurring_work_occurrences(organization_id,plan_id,plan_version_id,project_id,engagement_id,
        engagement_service_id,service_id,period_start,period_end,timezone,generated_by,past_period_reason)
      values(p.organization_id,p.id,v.id,p.project_id,p.engagement_id,p.engagement_service_id,p.service_id,
        a.period_start,private.recurring_period_end(v.frequency,v.effective_start,a.period_start),a.timezone,p_actor_id,'')
      returning * into o;
      v_event := jsonb_build_object('execution_source','recurring_scheduler','scheduler_actor_id',p_actor_id,
        'admission_id',a.id,'due_at',a.due_at,'admitted_at',a.admitted_at,'retry_deadline',a.retry_deadline,
        'plan_id',p.id,'plan_version_id',v.id,'occurrence_id',o.id,'period_start',a.period_start,'period_end',o.period_end,
        'timezone',a.timezone,'request_key',a.id,'created_via','recurring_plan');
      for item in select * from public.recurring_work_plan_template_items where plan_version_id=v.id order by position,id
      loop
        insert into public.work_items(organization_id,project_id,engagement_id,brand_id,department_id,title,description,
          work_item_type,priority,status,assignee_id,created_by,start_date,due_date,position,created_via,
          recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key)
        values(p.organization_id,p.project_id,p.engagement_id,v_brand,item.department_id,item.title,item.description,
          item.work_item_type,item.priority,'not_started',item.default_assignee_id,p_actor_id,
          a.period_start+item.start_offset_days,a.period_start+item.due_offset_days,item.position,'recurring_plan',
          o.id,p.id,v.id,item.template_key) returning * into w;
        insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
        values(p.organization_id,p.engagement_id,'work_item_created',p_actor_id,v_event || jsonb_build_object(
          'record_type','work_item','record_id',w.id,'action','created','status',w.status,'assignee_id',w.assignee_id,
          'department_id',w.department_id,'parent_work_item_id',null,'recurring_plan_id',p.id,
          'recurring_plan_version_id',v.id,'recurring_occurrence_id',o.id,'recurring_template_key',item.template_key));
        if w.assignee_id is not null then
          insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
          values(p.organization_id,p.engagement_id,'work_item_assigned',p_actor_id,v_event || jsonb_build_object(
            'record_type','work_item','record_id',w.id,'action','assigned','previous_assignee_id',null,'assignee_id',w.assignee_id));
        end if;
      end loop;
      insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
      values(p.organization_id,p.engagement_id,'recurring_period_generated',p_actor_id,v_event);
    end if;
    if not exists(select 1 from public.recurring_work_generation_attempts where organization_id=a.organization_id and request_key=a.id) then
      insert into public.recurring_work_generation_attempts(organization_id,plan_id,plan_version_id,occurrence_id,
        request_key,requested_period_start,outcome,actor_id)
      values(a.organization_id,a.plan_id,o.plan_version_id,o.id,a.id,a.period_start,v_outcome,p_actor_id);
    end if;
    perform private.assert_recurring_scheduler(p_actor_id,a.organization_id);
    if not private.recurring_execution_open(clock_timestamp(),a.retry_deadline,a.period_start,a.timezone)
      then raise exception 'Deadline closed before completion.' using errcode='55000'; end if;
    v_result := jsonb_build_object('outcome',v_outcome,'admission_id',a.id,'occurrence_id',o.id,'plan_version_id',o.plan_version_id);
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
    v_outcome := case when v_code in ('55000','42501') then 'manual_review' else 'retryable_failure' end;
    v_result := jsonb_build_object('outcome',v_outcome,'admission_id',a.id,'error_code',v_code);
  end;
  insert into public.recurring_schedule_executions(admission_id,organization_id,outcome,error_code,occurrence_id)
    values(a.id,a.organization_id,v_outcome,v_code,case when v_outcome in ('generated','replayed') then o.id end);
  return v_result;
end;
$$;

alter table public.recurring_schedule_consents enable row level security;
alter table public.recurring_schedule_admissions enable row level security;
alter table public.recurring_schedule_executions enable row level security;
create policy "Team reads schedule consents" on public.recurring_schedule_consents for select to authenticated
using ((select public.is_team_organization_member(organization_id)));
create policy "Team reads schedule admissions" on public.recurring_schedule_admissions for select to authenticated
using ((select public.is_team_organization_member(organization_id)));
create policy "Team reads schedule executions" on public.recurring_schedule_executions for select to authenticated
using ((select public.is_team_organization_member(organization_id)));
revoke all on public.recurring_schedule_consents,public.recurring_schedule_admissions,public.recurring_schedule_executions from public,anon,authenticated,service_role;
grant select on public.recurring_schedule_consents,public.recurring_schedule_admissions,public.recurring_schedule_executions to authenticated;
grant select,insert on public.recurring_schedule_consents,public.recurring_schedule_admissions,public.recurring_schedule_executions to service_role;
create trigger protect_schedule_consents before update or delete on public.recurring_schedule_consents
for each row execute function private.protect_recurring_generation_records();
create trigger protect_schedule_admissions before update or delete on public.recurring_schedule_admissions
for each row execute function private.protect_recurring_generation_records();
create trigger protect_schedule_executions before update or delete on public.recurring_schedule_executions
for each row execute function private.protect_recurring_generation_records();

revoke all on function private.validate_recurring_schedule(),private.record_recurring_schedule_consent(),
private.recurring_due_instant(timestamp,text),private.recurring_retry_deadline(timestamptz,date,text),
private.assert_recurring_scheduler(uuid,uuid),private.assert_scheduled_recurring_context(public.recurring_work_plans,public.recurring_work_plan_versions),
public.admit_recurring_schedule(uuid,date,uuid),public.execute_recurring_schedule(uuid,uuid) from public,anon,authenticated;
grant execute on function private.validate_recurring_schedule(),private.record_recurring_schedule_consent(),
private.recurring_due_instant(timestamp,text),private.recurring_retry_deadline(timestamptz,date,text),
private.assert_recurring_scheduler(uuid,uuid),private.assert_scheduled_recurring_context(public.recurring_work_plans,public.recurring_work_plan_versions),
public.admit_recurring_schedule(uuid,date,uuid),public.execute_recurring_schedule(uuid,uuid) to service_role;
commit;
