-- N1-C local assignment cutover candidate; not a production release receipt.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Actor claims are accepted only on the existing trusted service RPC lane.
-- Authenticated direct table writes always use auth.uid(), ignoring custom GUCs.
create function private.n1c_actor(p_actor uuid default null) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is not null then
    if p_actor is not null and p_actor <> actor then
      raise exception 'Actor identity mismatch.' using errcode='42501';
    end if;
    return actor;
  end if;
  if current_setting('role', true) <> 'service_role' and current_user <> 'service_role' then
    raise exception 'Verified actor required.' using errcode='42501';
  end if;
  actor := coalesce(p_actor, nullif(current_setting('anka.n1c_actor', true),'')::uuid);
  if actor is null then raise exception 'Verified service actor context required.' using errcode='42501'; end if;
  return actor;
end; $$;
create function private.n1c_set_actor(p_actor uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('anka.n1c_actor', private.n1c_actor(p_actor)::text, true);
end; $$;

create function private.n1c_require_scope(p_org uuid,p_project uuid,p_actor uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare member_role text;
begin
  perform 1 from public.organizations where id=p_org and status='active' for share;
  if not found then raise exception 'Active organization required.' using errcode='42501'; end if;
  select role into member_role from public.organization_memberships
    where organization_id=p_org and user_id=p_actor and member_kind='team' and status='active' for share;
  if not found then raise exception 'Active team actor required.' using errcode='42501'; end if;
  -- Canonical team project visibility is organization membership. This verifies
  -- that source; it does not infer assignment authority from broad read access.
  perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for share;
  if not found then raise exception 'Active same-organization project required.' using errcode='42501'; end if;
  return member_role;
end; $$;
create function private.n1c_can_assign(p_org uuid,p_project uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare member_role text;
begin
  member_role := private.n1c_require_scope(p_org,p_project,p_actor);
  if member_role in ('system_owner','operations_admin','executive') then return true; end if;
  -- No designation, profile title, or unbound legacy project_owner inference.
  perform 1 from public.project_manager_bindings
    where organization_id=p_org and project_id=p_project and user_id=p_actor and status='active' for share;
  return found;
end; $$;

-- A private append-only record complements existing activity/work-item events.
create table private.n1c_assignment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, project_id uuid not null,
  record_kind text not null check(record_kind in ('project_task','engagement_work_item')),
  record_id uuid not null, actor_id uuid not null, previous_assignee_id uuid, assignee_id uuid,
  row_version bigint not null, occurred_at timestamptz not null default clock_timestamp()
);
create index n1c_assignment_record_history on private.n1c_assignment_history(organization_id,record_kind,record_id,occurred_at);
alter table private.n1c_assignment_history enable row level security;
revoke all on private.n1c_assignment_history from public,anon,authenticated,service_role;
create trigger n1c_immutable_assignment_history before update or delete on private.n1c_assignment_history
for each row execute function private.n1b_preserve_receipt();

create function private.n1c_guard_assignment() returns trigger
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
  can_assign := private.n1c_can_assign(new.organization_id,project,actor);
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
    if not can_assign and (new.department_id is distinct from old.department_id
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
-- After existing scope derivation/version triggers, before constraints. Table
-- triggers protect direct inserts/updates as well as all service/alternate RPCs.
create trigger zz_n1c_assignment_guard before insert or update on public.tasks
for each row execute function private.n1c_guard_assignment();
create trigger zz_n1c_assignment_guard before insert or update on public.work_items
for each row execute function private.n1c_guard_assignment();

revoke all on function private.n1c_actor(uuid),private.n1c_set_actor(uuid),
  private.n1c_require_scope(uuid,uuid,uuid),private.n1c_can_assign(uuid,uuid,uuid),
  private.n1c_guard_assignment() from public,anon,authenticated,service_role;
grant execute on function private.n1c_actor(uuid),private.n1c_set_actor(uuid),
  private.n1c_require_scope(uuid,uuid,uuid),private.n1c_can_assign(uuid,uuid,uuid) to service_role;

-- Existing service-only P5 signatures/grants stay unchanged; propagate the
-- authenticated Edge actor to the table guard, never a browser-supplied claim.
create or replace function private.p5_require_active_actor(p_organization_id uuid,p_actor_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform private.n1c_set_actor(p_actor_id);
  perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id
    where o.id=p_organization_id and o.status='active' and m.user_id=p_actor_id and m.member_kind='team' and m.status='active'
    for share of o,m;
  if not found then raise exception 'Active selected organization membership is required.' using errcode='42501'; end if;
end; $$;

-- Preserve the complete legacy save implementation and event logic, but put its
-- service callers (including AI/promotion/automation) through one checked entry.
alter function public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)
  set schema private;
alter function private.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)
  rename to n1c_save_work_item_body;
revoke all on function private.n1c_save_work_item_body(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)
  from public,anon,authenticated;
create function public.save_work_item(
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
  allowed := private.n1c_can_assign(e.organization_id,e.project_id,p_actor_id);
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
revoke all on function public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)
  to service_role;

create function private.n1c_project_capabilities(p_org uuid,p_project uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); assign boolean;
begin
  if actor is null then raise exception 'Authenticated team actor required.' using errcode='42501'; end if;
  assign := private.n1c_can_assign(p_org,p_project,actor);
  return jsonb_build_object('schema_version',1,'organization_id',p_org,'project_id',p_project,'actor_id',actor,
    'assignment_enforced',true,'can_create_unassigned',true,'can_assign',assign,
    'project_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'row_version',t.row_version,
      'can_assign',assign,'can_execute',coalesce(assign or t.user_id=actor or t.assigned_to=actor,false)))
      from public.tasks t where t.organization_id=p_org and t.project_id=p_project and t.archived_at is null),'[]'::jsonb),
    'engagement_work_items',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'row_version',w.row_version,
      'can_assign',assign,'can_execute',coalesce(assign or w.created_by=actor or w.assignee_id=actor,false)))
      from public.work_items w where w.organization_id=p_org and w.project_id=p_project and w.deleted_at is null),'[]'::jsonb));
end; $$;
create function public.get_assignment_capabilities(p_organization_id uuid,p_project_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.n1c_project_capabilities(p_organization_id,p_project_id);
$$;
revoke all on function private.n1c_project_capabilities(uuid,uuid),public.get_assignment_capabilities(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.n1c_project_capabilities(uuid,uuid),public.get_assignment_capabilities(uuid,uuid)
  to authenticated;

-- Keep pre-cutover UI truthful if this assignment-only candidate is installed.
create or replace function public.get_authority_administration(p_organization_id uuid,p_user_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.n1b_read_admin(p_organization_id,p_user_id) || jsonb_build_object('assignment_enforced',true);
$$;
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

  if (private.n1c_can_assign(p_organization_id,v_task.project_id,p_actor_id)
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

  if (private.n1c_can_assign(p_organization_id,v_task.project_id,p_actor_id)
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
