-- M03 date-only Marketing scheduling with exact replay and dependency guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table private.m03_schedule_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  record_kind text not null check(record_kind in ('project_task','engagement_work_item')),
  record_id uuid not null,
  expected_row_version bigint not null check(expected_row_version>0),
  start_date date,
  due_date date not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  resulting_row_version bigint not null check(resulting_row_version>0),
  created_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key(engagement_id,organization_id) references public.engagements(id,organization_id) on delete restrict
);
create index m03_schedule_record_idx on private.m03_schedule_requests(organization_id,record_kind,record_id,created_at desc);
alter table private.m03_schedule_requests enable row level security;
revoke all on private.m03_schedule_requests from public,anon,authenticated,service_role;
grant select,insert on private.m03_schedule_requests to service_role;
create trigger m03_schedule_requests_immutable before update or delete on private.m03_schedule_requests
for each row execute function private.p7_reject_history_mutation();

create function public.schedule_marketing_calendar_entry(
  p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid,
  p_record_kind text,p_record_id uuid,p_expected_row_version bigint,
  p_start_date date,p_due_date date,p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  prior private.m03_schedule_requests%rowtype;
  target_task public.tasks%rowtype;
  target_work public.work_items%rowtype;
  upstream_task public.tasks%rowtype;
  upstream_work public.work_items%rowtype;
  dependency record;
  effective_start date;
  resulting_version bigint;
begin
  perform private.n1c_set_actor(p_actor_id);
  perform private.n1c_require_scope(p_organization_id,p_project_id,p_actor_id);
  if p_engagement_id is null or p_request_id is null or p_record_id is null
    or p_record_kind is null or p_record_kind not in ('project_task','engagement_work_item')
    or p_expected_row_version is null or p_expected_row_version<1
    or p_due_date is null or (p_start_date is not null and p_start_date>p_due_date)
    or (p_record_kind='project_task' and p_start_date is not null) then
    raise exception 'Complete date-only Marketing schedule required' using errcode='22023';
  end if;
  perform 1 from public.engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id
    and e.project_id=p_project_id for share;
  if not found then raise exception 'Exact project engagement required' using errcode='42501'; end if;
  perform 1 from public.engagement_services es join public.service_catalog sc
    on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id
      and es.status='active' and sc.is_active and sc.department_id='marketing' for share of es,sc;
  if not found then raise exception 'Active Marketing service required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m03-schedule:'||p_organization_id::text||':'||p_project_id::text,0));
  select * into prior from private.m03_schedule_requests where request_id=p_request_id;
  if found then
    if prior.organization_id is distinct from p_organization_id or prior.project_id is distinct from p_project_id
      or prior.engagement_id is distinct from p_engagement_id or prior.record_kind is distinct from p_record_kind
      or prior.record_id is distinct from p_record_id or prior.expected_row_version is distinct from p_expected_row_version
      or prior.start_date is distinct from p_start_date or prior.due_date is distinct from p_due_date
      or prior.actor_id is distinct from p_actor_id then
      raise exception 'Request ID already used with different schedule inputs' using errcode='23505';
    end if;
    -- A replay receipt is returned only while the actor retains execution authority.
    if p_record_kind='project_task' then
      select * into target_task from public.tasks where id=p_record_id and organization_id=p_organization_id
        and project_id=p_project_id and department_id='marketing' and archived_at is null for share;
      if not found or (private.n1c_can_assign_department(p_organization_id,p_project_id,'marketing',p_actor_id)
        or target_task.user_id=p_actor_id or target_task.assigned_to=p_actor_id) is not true then
        raise exception 'Marketing task execution authority required' using errcode='42501';
      end if;
    else
      select * into target_work from public.work_items where id=p_record_id and organization_id=p_organization_id
        and project_id=p_project_id and engagement_id=p_engagement_id and department_id='marketing'
        and deleted_at is null for share;
      if not found or (private.n1c_can_assign_department(p_organization_id,p_project_id,'marketing',p_actor_id)
        or target_work.created_by=p_actor_id or target_work.assignee_id=p_actor_id) is not true then
        raise exception 'Marketing work execution authority required' using errcode='42501';
      end if;
    end if;
    return jsonb_build_object('request_id',p_request_id,'record_kind',p_record_kind,'record_id',p_record_id,
      'row_version',prior.resulting_row_version,'replayed',true);
  end if;
  if p_record_kind='project_task' then
    select * into target_task from public.tasks where id=p_record_id and organization_id=p_organization_id
      and project_id=p_project_id and department_id='marketing' and archived_at is null for update;
    if not found or (private.n1c_can_assign_department(p_organization_id,p_project_id,'marketing',p_actor_id)
      or target_task.user_id=p_actor_id or target_task.assigned_to=p_actor_id) is not true then
      raise exception 'Marketing task execution authority required' using errcode='42501';
    end if;
    if target_task.row_version<>p_expected_row_version then
      perform private.p5_raise_stale_write(p_record_kind,p_record_id,p_expected_row_version,target_task.row_version);
    end if;
    if target_task.status in ('done','cancelled') then
      raise exception 'Completed or cancelled task cannot be rescheduled' using errcode='23514';
    end if;
    for dependency in select d.depends_on_task_id from public.task_dependencies d
      where d.organization_id=p_organization_id and d.project_id=p_project_id and d.task_id=p_record_id loop
      select * into upstream_task from public.tasks where id=dependency.depends_on_task_id
        and organization_id=p_organization_id and project_id=p_project_id and archived_at is null for share;
      if not found or (upstream_task.status not in ('done','cancelled')
        and (upstream_task.due_date is null or upstream_task.due_date>p_due_date)) then
        raise exception 'Task dependency date conflict; refresh before scheduling' using errcode='23514';
      end if;
    end loop;
    update public.tasks set due_date=p_due_date where id=p_record_id returning row_version into resulting_version;
  else
    select * into target_work from public.work_items where id=p_record_id and organization_id=p_organization_id
      and project_id=p_project_id and engagement_id=p_engagement_id and department_id='marketing'
      and deleted_at is null for update;
    if not found or (private.n1c_can_assign_department(p_organization_id,p_project_id,'marketing',p_actor_id)
      or target_work.created_by=p_actor_id or target_work.assignee_id=p_actor_id) is not true then
      raise exception 'Marketing work execution authority required' using errcode='42501';
    end if;
    if target_work.row_version<>p_expected_row_version then
      perform private.p5_raise_stale_write(p_record_kind,p_record_id,p_expected_row_version,target_work.row_version);
    end if;
    if target_work.status in ('done','completed','cancelled') then
      raise exception 'Completed or cancelled work cannot be rescheduled' using errcode='23514';
    end if;
    effective_start:=coalesce(p_start_date,p_due_date);
    for dependency in select d.depends_on_work_item_id from public.work_item_dependencies d
      where d.organization_id=p_organization_id and d.work_item_id=p_record_id loop
      select * into upstream_work from public.work_items where id=dependency.depends_on_work_item_id
        and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id
        and deleted_at is null for share;
      if not found or (upstream_work.status not in ('completed','cancelled','done')
        and (upstream_work.due_date is null or upstream_work.due_date>effective_start)) then
        raise exception 'Work dependency date conflict; refresh before scheduling' using errcode='23514';
      end if;
    end loop;
    update public.work_items set start_date=p_start_date,due_date=p_due_date
      where id=p_record_id returning row_version into resulting_version;
  end if;
  insert into private.m03_schedule_requests(request_id,organization_id,project_id,engagement_id,
    record_kind,record_id,expected_row_version,start_date,due_date,actor_id,resulting_row_version)
  values(p_request_id,p_organization_id,p_project_id,p_engagement_id,p_record_kind,p_record_id,
    p_expected_row_version,p_start_date,p_due_date,p_actor_id,resulting_version);
  return jsonb_build_object('request_id',p_request_id,'record_kind',p_record_kind,'record_id',p_record_id,
    'row_version',resulting_version,'replayed',false);
end;
$$;
revoke all on function public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)
  to service_role;
commit;
