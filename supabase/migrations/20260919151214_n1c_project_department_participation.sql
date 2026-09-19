-- Explicit project/department participation. No inferred or automatic backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.project_department_participation(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,project_id uuid not null,department_id text not null,
  status text not null default 'active' check(status in ('active','revoked')),
  created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
  revoked_by uuid,revoked_at timestamptz,
  check((status='active' and revoked_by is null and revoked_at is null)
    or (status='revoked' and revoked_by is not null and revoked_at is not null and revoked_at>=created_at)),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key(department_id,organization_id) references public.departments(id,organization_id) on delete restrict
);
create unique index n1c_participation_active on public.project_department_participation(organization_id,project_id,department_id) where status='active';
create index n1c_participation_department on public.project_department_participation(department_id,organization_id);
alter table public.project_department_participation enable row level security;
revoke all on public.project_department_participation from public,anon,authenticated,service_role;
grant select,update(status) on public.project_department_participation to service_role;

create function private.n1c_preserve_participation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' or (tg_op='UPDATE' and (old.status<>'active' or new.status<>'revoked'
    or to_jsonb(new)-array['status','revoked_by','revoked_at'] is distinct from to_jsonb(old)-array['status','revoked_by','revoked_at'])) then
    raise exception 'Participation history is immutable except revocation.' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function private.n1c_preserve_participation() from public,anon,authenticated,service_role;
create trigger n1c_participation_history before update or delete on public.project_department_participation
for each row execute function private.n1c_preserve_participation();

create function private.n1c_participation_snapshot(p_org uuid,p_project uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
  from public.project_department_participation p where p.organization_id=p_org and p.project_id=p_project;
$$;
create function private.n1c_read_participation(p_org uuid,p_project uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare records jsonb;
begin
  perform private.n1b_require_admin(p_org);
  perform 1 from public.projects where id=p_project and organization_id=p_org for share;
  if not found then raise exception 'Same-organization project required.' using errcode='42501'; end if;
  records := private.n1c_participation_snapshot(p_org,p_project);
  return jsonb_build_object('organization_id',p_org,'project_id',p_project,'records',records,'token',md5(records::text));
end; $$;
create function private.n1c_change_participation(p_org uuid,p_project uuid,p_department text,p_enabled boolean,p_token text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; records jsonb; payload jsonb; receipt private.n1b_authority_requests; result jsonb; record_id uuid;
begin
  actor := private.n1b_require_admin(p_org);
  if p_enabled is null or p_token is null or p_request is null then raise exception 'Complete participation command required.' using errcode='22023'; end if;
  perform 1 from public.projects where id=p_project and organization_id=p_org and (archived_at is null or not p_enabled) for share;
  if not found then raise exception 'Same-organization available project required.' using errcode='42501'; end if;
  perform 1 from public.departments where id=p_department and organization_id=p_org for share;
  if not found then raise exception 'Same-organization department required.' using errcode='42501'; end if;
  payload := jsonb_build_object('domain','project_department_participation','project_id',p_project,'department_id',p_department,'enabled',p_enabled,'token',p_token);
  select * into receipt from private.n1b_authority_requests where organization_id=p_org and actor_id=actor and request_id=p_request;
  if found then
    if receipt.request_payload is distinct from payload then raise exception 'Request ID conflict.' using errcode='23505'; end if;
    return receipt.result || jsonb_build_object('replayed',true);
  end if;
  records := private.n1c_participation_snapshot(p_org,p_project);
  if md5(records::text)<>p_token then raise exception 'Participation changed. Reload before editing.' using errcode='40001'; end if;
  if p_enabled then
    insert into public.project_department_participation(organization_id,project_id,department_id,created_by)
      values(p_org,p_project,p_department,actor) returning id into record_id;
  else
    update public.project_department_participation set status='revoked',revoked_at=clock_timestamp(),revoked_by=actor
      where organization_id=p_org and project_id=p_project and department_id=p_department and status='active' returning id into record_id;
    if not found then raise exception 'Active participation record required.' using errcode='42501'; end if;
  end if;
  result := jsonb_build_object('organization_id',p_org,'project_id',p_project,'record_id',record_id,'request_id',p_request,'replayed',false);
  insert into private.n1b_authority_requests(organization_id,actor_id,request_id,request_payload,result) values(p_org,actor,p_request,payload,result);
  return result;
end; $$;
create function public.get_project_department_participation(p_organization_id uuid,p_project_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.n1c_read_participation(p_organization_id,p_project_id);
$$;
create function public.change_project_department_participation(p_organization_id uuid,p_project_id uuid,p_department_id text,p_enabled boolean,p_expected_token text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.n1c_change_participation(p_organization_id,p_project_id,p_department_id,p_enabled,p_expected_token,p_request_id);
$$;
revoke all on function private.n1c_participation_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.n1c_read_participation(uuid,uuid),private.n1c_change_participation(uuid,uuid,text,boolean,text,uuid),
  public.get_project_department_participation(uuid,uuid),public.change_project_department_participation(uuid,uuid,text,boolean,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.n1c_read_participation(uuid,uuid),private.n1c_change_participation(uuid,uuid,text,boolean,text,uuid),
  public.get_project_department_participation(uuid,uuid),public.change_project_department_participation(uuid,uuid,text,boolean,text,uuid)
  to authenticated;

create function private.n1c_can_assign_department(p_org uuid,p_project uuid,p_department text,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if private.n1c_can_assign(p_org,p_project,p_actor) then return true; end if;
  -- Current canonical organization role + department, never profile title or
  -- arbitrary multi-department affiliation, establishes head scope.
  perform 1 from public.organization_memberships where organization_id=p_org and user_id=p_actor
    and status='active' and member_kind='team' and role='department_manager' and department_id=p_department for share;
  if not found then return false; end if;
  perform 1 from public.project_department_participation where organization_id=p_org and project_id=p_project
    and department_id=p_department and status='active' for share;
  return found;
end; $$;
revoke all on function private.n1c_can_assign_department(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.n1c_can_assign_department(uuid,uuid,text,uuid) to service_role;
create or replace function private.n1c_guard_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid; project uuid; assignee uuid; previous_assignee uuid; creator uuid;
  can_assign boolean; prior jsonb; next_row jsonb; is_task boolean := tg_table_name='tasks';
begin
  next_row := to_jsonb(new);
  if tg_op='UPDATE' and current_setting('role',true)='authenticated' then
    raise exception 'Use a versioned server command for Project Task changes.' using errcode='42501';
  end if;
  -- Existing service commands reindex peer rows and annotate automation flags.
  -- These metadata-only writes cannot change assignment, scope or execution.
  if tg_op='UPDATE' and current_setting('role',true)='service_role'
    and (next_row - array['row_version','updated_at','position','automation_flagged_at','automation_flagged_by_rule_id'])
      = (to_jsonb(old) - array['row_version','updated_at','position','automation_flagged_at','automation_flagged_by_rule_id']) then
    return new;
  end if;
  project := new.project_id;
  if not is_task then
    select e.project_id into project from public.engagements e
      where e.id=new.engagement_id and e.organization_id=new.organization_id for share;
    if project is null or (new.project_id is not null and new.project_id<>project) then
      raise exception 'Canonical engagement/project mismatch.' using errcode='42501';
    end if;
  end if;
  creator := (next_row->>'created_by')::uuid;
  actor := private.n1c_actor(case when tg_op='INSERT' and auth.uid() is null then creator else null end);
  can_assign := private.n1c_can_assign_department(new.organization_id,project,new.department_id,actor);
  if new.department_id is not null and not exists(
    select 1 from public.departments where id=new.department_id and organization_id=new.organization_id
  ) then raise exception 'Same-organization department required.' using errcode='42501'; end if;
  assignee := (next_row->>case when is_task then 'assigned_to' else 'assignee_id' end)::uuid;
  if tg_op='INSERT' then
    if creator is distinct from actor or (is_task and (next_row->>'user_id')::uuid is distinct from actor) then
      raise exception 'Creator must match verified actor.' using errcode='42501';
    end if;
  else
    prior := to_jsonb(old);
    previous_assignee := (prior->>case when is_task then 'assigned_to' else 'assignee_id' end)::uuid;
    if new.organization_id is distinct from old.organization_id
      or new.project_id is distinct from old.project_id
      or creator is distinct from (prior->>'created_by')::uuid
      or next_row->'user_id' is distinct from prior->'user_id'
      or next_row->'engagement_id' is distinct from prior->'engagement_id'
      or next_row->'created_at' is distinct from prior->'created_at' then
      raise exception 'Work identity and canonical scope are immutable.' using errcode='42501';
    end if;
    if (not can_assign or not private.n1c_can_assign_department(old.organization_id,old.project_id,old.department_id,actor)) and (new.department_id is distinct from old.department_id
      or next_row->'workstream_id' is distinct from prior->'workstream_id') then
      raise exception 'Scoped assignment authority required for handoff.' using errcode='42501';
    end if;
    -- Assignment does not grant review/release rights. Existing creators and
    -- assignees retain execution edits; unrelated contributors cannot edit.
    if not can_assign and creator is distinct from actor and previous_assignee is distinct from actor then
      raise exception 'Assigned execution or existing creator authority required.' using errcode='42501';
    end if;
  end if;
  if (tg_op='INSERT' and assignee is not null)
    or (tg_op='UPDATE' and assignee is distinct from previous_assignee) then
    if not can_assign then raise exception 'Scoped assignment authority required; contributors create unassigned.' using errcode='42501'; end if;
  end if;
  if assignee is not null and (tg_op='INSERT' or assignee is distinct from previous_assignee) then
    perform 1 from public.organization_memberships where organization_id=new.organization_id
      and user_id=assignee and member_kind='team' and status='active' for share;
    if not found then raise exception 'Active same-organization assignee required.' using errcode='42501'; end if;
  end if;
  if is_task then
    if tg_op='INSERT' or assignee is distinct from previous_assignee then
      new.assigned_by := case when assignee is not null then actor else null end;
    elsif new.assigned_by is distinct from old.assigned_by then
      raise exception 'Assignment provenance is database-managed.' using errcode='42501';
    end if;
  end if;
  if (tg_op='INSERT' and assignee is not null) or (tg_op='UPDATE' and assignee is distinct from previous_assignee) then
    insert into private.n1c_assignment_history(organization_id,project_id,record_kind,record_id,actor_id,previous_assignee_id,assignee_id,row_version)
    values(new.organization_id,project,case when is_task then 'project_task' else 'engagement_work_item' end,new.id,actor,previous_assignee,assignee,
      case when tg_op='INSERT' then new.row_version else old.row_version+1 end);
  end if;
  return new;
end; $$;
create or replace function public.save_work_item(
  p_work_item_id uuid,p_engagement_id uuid,p_title text,p_description text,p_work_item_type text,p_priority text,
  p_status text,p_assignee_id uuid,p_department_id text,p_linked_artifact_id uuid,p_linked_artifact_version_id uuid,
  p_linked_engagement_stage_instance_id uuid,p_start_date date,p_due_date date,p_position integer,
  p_parent_work_item_id uuid,p_actor_id uuid,p_created_via text default 'manual'
) returns public.work_items language plpgsql security invoker set search_path='' as $$
declare item public.work_items; e public.engagements; allowed boolean;
  prior_actor text := current_setting('anka.n1c_actor',true);
begin
  perform private.n1c_set_actor(p_actor_id);
  select * into e from public.engagements where id=p_engagement_id for share;
  if not found then raise exception 'Engagement unavailable.' using errcode='42501'; end if;
  allowed := private.n1c_can_assign_department(e.organization_id,e.project_id,p_department_id,p_actor_id);
  if p_work_item_id is null then
    if p_assignee_id is not null and not allowed then
      raise exception 'Contributors create unassigned work items.' using errcode='42501';
    end if;
  else
    select * into item from public.work_items where id=p_work_item_id and organization_id=e.organization_id
      and engagement_id=e.id and project_id=e.project_id and deleted_at is null for update;
    if not found then raise exception 'Work item unavailable.' using errcode='42501'; end if;
    if not allowed and p_assignee_id is distinct from item.assignee_id then
      raise exception 'Scoped assignment authority required.' using errcode='42501';
    end if;
    if not allowed and item.created_by is distinct from p_actor_id and item.assignee_id is distinct from p_actor_id then
      raise exception 'Assigned execution or existing creator authority required.' using errcode='42501';
    end if;
  end if;
  item := private.n1c_save_work_item_body(p_work_item_id,p_engagement_id,p_title,p_description,p_work_item_type,p_priority,
    p_status,p_assignee_id,p_department_id,p_linked_artifact_id,p_linked_artifact_version_id,p_linked_engagement_stage_instance_id,
    p_start_date,p_due_date,p_position,p_parent_work_item_id,p_actor_id,p_created_via);
  perform set_config('anka.n1c_actor',coalesce(prior_actor,''),true);
  return item;
end; $$;
create or replace function private.n1c_project_capabilities(p_org uuid,p_project uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); assign boolean;
begin
  if actor is null then raise exception 'Authenticated team actor required.' using errcode='42501'; end if;
  assign := private.n1c_can_assign(p_org,p_project,actor);
  return jsonb_build_object('schema_version',1,'organization_id',p_org,'project_id',p_project,'actor_id',actor,
    'assignment_enforced',true,'can_create_unassigned',true,'can_assign',assign,
    'assignable_departments',coalesce((select jsonb_agg(d.id order by d.id) from public.departments d
      where d.organization_id=p_org and private.n1c_can_assign_department(p_org,p_project,d.id,actor)),'[]'::jsonb),
    'project_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'row_version',t.row_version,
      'can_handoff',assign,'can_assign',private.n1c_can_assign_department(p_org,p_project,t.department_id,actor),'can_execute',coalesce(private.n1c_can_assign_department(p_org,p_project,t.department_id,actor) or t.user_id=actor or t.assigned_to=actor,false)))
      from public.tasks t where t.organization_id=p_org and t.project_id=p_project and t.archived_at is null),'[]'::jsonb),
    'engagement_work_items',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'row_version',w.row_version,
      'can_handoff',assign,'can_assign',private.n1c_can_assign_department(p_org,p_project,w.department_id,actor),'can_execute',coalesce(private.n1c_can_assign_department(p_org,p_project,w.department_id,actor) or w.created_by=actor or w.assignee_id=actor,false)))
      from public.work_items w where w.organization_id=p_org and w.project_id=p_project and w.deleted_at is null),'[]'::jsonb));
end; $$;
create or replace function public.update_p5_project_task(
  p_organization_id uuid,
  p_task_id uuid,
  p_expected_row_version bigint,
  p_status text,
  p_assigned_to uuid,
  p_due_date date,
  p_completion_evidence text,
  p_actor_id uuid
) returns public.tasks
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  -- Organization authorization intentionally precedes record lookup/version disclosure.
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);

  select task.* into v_task
  from public.tasks task
  where task.id = p_task_id
    and task.organization_id = p_organization_id
    and task.archived_at is null
  for update;

  if not found then
    raise insufficient_privilege using message = 'Project Task is unavailable.';
  end if;

  if (private.n1c_can_assign_department(p_organization_id,v_task.project_id,v_task.department_id,p_actor_id)
    or v_task.user_id=p_actor_id or v_task.assigned_to=p_actor_id) is not true then
    raise exception 'Scoped task authority required.' using errcode='42501';
  end if;

  if p_expected_row_version is null
     or p_expected_row_version <> v_task.row_version then
    perform private.p5_raise_stale_write(
      'project_task', p_task_id, p_expected_row_version, v_task.row_version
    );
  end if;

  if p_assigned_to is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_assigned_to
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Assignee must be an active team member.' using errcode = '23514';
  end if;

  update public.tasks
  set status = p_status,
      assigned_to = p_assigned_to,
      due_date = p_due_date,
      completion_evidence = left(trim(coalesce(p_completion_evidence, '')), 20000)
  where id = v_task.id
  returning * into v_task;
  return v_task;
end; $$;
create or replace function public.transition_p5_project_task(
  p_organization_id uuid,
  p_task_id uuid,
  p_expected_row_version bigint,
  p_status text,
  p_completion_evidence text,
  p_actor_id uuid
) returns public.tasks
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  -- Authorization precedes lookup so foreign IDs and versions cannot be disclosed.
  perform private.p5_require_active_actor(p_organization_id, p_actor_id);

  select task.* into v_task
  from public.tasks task
  where task.id = p_task_id
    and task.organization_id = p_organization_id
    and task.archived_at is null
  for update;
  if not found then
    raise insufficient_privilege using message = 'Project Task is unavailable.';
  end if;

  if (private.n1c_can_assign_department(p_organization_id,v_task.project_id,v_task.department_id,p_actor_id)
    or v_task.user_id=p_actor_id or v_task.assigned_to=p_actor_id) is not true then
    raise exception 'Scoped task authority required.' using errcode='42501';
  end if;

  if p_expected_row_version is null
     or p_expected_row_version <> v_task.row_version then
    perform private.p5_raise_stale_write(
      'project_task', p_task_id, p_expected_row_version, v_task.row_version
    );
  end if;

  update public.tasks
  set status = p_status,
      completion_evidence = left(trim(coalesce(p_completion_evidence, '')), 20000)
  where id = v_task.id
  returning * into v_task;
  return v_task;
end; $$;
commit;
