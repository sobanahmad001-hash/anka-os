-- Explicit version/payload-bound assignment delegation; no historical enrollment.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table private.n1c_recurring_delegations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null,plan_id uuid not null,plan_version_id uuid not null,
 approved_by uuid not null,approved_at timestamptz not null default clock_timestamp(),
 approval_basis text not null check(approval_basis in ('organization_admin','project_manager')),
 approved_binding_id uuid references public.project_manager_bindings(id) on delete restrict,
 check((approval_basis='organization_admin' and approved_binding_id is null) or (approval_basis='project_manager' and approved_binding_id is not null)),
 payload jsonb not null,status text not null default 'active' check(status in ('active','revoked')),
 revoked_by uuid,revoked_at timestamptz,
 check((status='active' and revoked_by is null and revoked_at is null) or
   (status='revoked' and revoked_by is not null and revoked_at is not null and revoked_at>=approved_at)),
 foreign key(plan_version_id,plan_id,organization_id) references public.recurring_work_plan_versions(id,plan_id,organization_id) on delete restrict,
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create unique index n1c_recurring_delegation_active on private.n1c_recurring_delegations(plan_version_id) where status='active';
create index n1c_recurring_delegation_version on private.n1c_recurring_delegations(plan_version_id,plan_id,organization_id);
create index n1c_recurring_delegation_project on private.n1c_recurring_delegations(project_id,organization_id);
create index n1c_recurring_delegation_binding on private.n1c_recurring_delegations(approved_binding_id) where approved_binding_id is not null;
alter table private.n1c_recurring_delegations enable row level security;
revoke all on private.n1c_recurring_delegations from public,anon,authenticated,service_role;
create trigger n1c_delegation_history before update or delete on private.n1c_recurring_delegations
 for each row execute function private.n1c_preserve_participation();
alter table private.n1c_assignment_history add column delegation_id uuid references private.n1c_recurring_delegations(id) on delete restrict;
create index n1c_assignment_history_delegation on private.n1c_assignment_history(delegation_id) where delegation_id is not null;

create function private.n1c_can_delegate(p_org uuid,p_project uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare actor_role text;
begin
 actor_role:=private.n1c_require_scope(p_org,p_project,p_actor);
 if actor_role in ('system_owner','operations_admin') then return true; end if;
 perform 1 from public.project_manager_bindings where organization_id=p_org and project_id=p_project
   and user_id=p_actor and status='active' for share;
 return found;
end; $$;
create function private.n1c_recurring_payload(p_version uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',to_jsonb(v),'templates',coalesce(
   (select jsonb_agg(to_jsonb(t) order by t.template_key) from public.recurring_work_plan_template_items t
    where t.plan_version_id=v.id and t.organization_id=v.organization_id and t.plan_id=v.plan_id),'[]'::jsonb))
 from public.recurring_work_plan_versions v where v.id=p_version;
$$;
create function private.n1c_seal_approved_templates() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.recurring_work_plan_versions where id=new.plan_version_id for update;
 if exists(select 1 from public.recurring_work_plan_version_approvals where plan_version_id=new.plan_version_id) then
   raise exception 'Approved templates are sealed. Create and approve a new version.' using errcode='55000';
 end if;
 return new;
end; $$;
create trigger n1c_seal_approved_templates before insert on public.recurring_work_plan_template_items
 for each row execute function private.n1c_seal_approved_templates();
-- Approval and template insertion serialize on the immutable version row.
create function private.n1c_lock_approved_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.recurring_work_plan_versions where id=new.plan_version_id for update;
 return new;
end; $$;
create trigger n1c_lock_approved_version before insert on public.recurring_work_plan_version_approvals
 for each row execute function private.n1c_lock_approved_version();

create function private.n1c_delegation_snapshot(p_version uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('payload',private.n1c_recurring_payload(p_version),'history',
  coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from private.n1c_recurring_delegations d where d.plan_version_id=p_version),'[]'::jsonb));
$$;
create function private.n1c_read_delegation(p_org uuid,p_project uuid,p_version uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare allowed boolean; snapshot jsonb; p public.recurring_work_plans;
begin
 if auth.uid() is null then raise exception 'Authenticated actor required.' using errcode='42501'; end if;
 allowed:=private.n1c_can_delegate(p_org,p_project,auth.uid());
 if p_version is null then
   return jsonb_build_object('organization_id',p_org,'project_id',p_project,'can_manage',allowed,'versions',
     coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'version_number',v.version_number,'plan_id',v.plan_id) order by v.created_at,v.id)
      from public.recurring_work_plan_versions v join public.recurring_work_plans p on p.id=v.plan_id
      where p.organization_id=p_org and p.project_id=p_project and v.organization_id=p_org),'[]'::jsonb));
 end if;
 select p0.* into p from public.recurring_work_plans p0 join public.recurring_work_plan_versions v on v.plan_id=p0.id
   where v.id=p_version and v.organization_id=p_org and p0.organization_id=p_org and p0.project_id=p_project for share of p0;
 if not found then raise exception 'Same-project version required.' using errcode='42501'; end if;
 snapshot:=private.n1c_delegation_snapshot(p_version);
 return jsonb_build_object('organization_id',p_org,'project_id',p_project,'plan_version_id',p_version,'can_manage',allowed,
   'approved_version',exists(select 1 from public.recurring_work_plan_version_approvals where plan_version_id=p_version),
   'token',md5(snapshot::text),'snapshot',snapshot);
end; $$;
create function private.n1c_change_delegation(p_org uuid,p_project uuid,p_version uuid,p_enabled boolean,p_token text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.recurring_work_plans; snapshot jsonb; command jsonb;
 receipt private.n1b_authority_requests; result jsonb; record_id uuid; item public.recurring_work_plan_template_items;
 basis text; binding uuid;
begin
 if actor is null then raise exception 'Authenticated actor required.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('n1b-admin:'||p_org::text,0));
 if not private.n1c_can_delegate(p_org,p_project,actor) then raise exception 'Current same-project PM or organization admin required.' using errcode='42501'; end if;
 if p_enabled is null or p_token is null or p_request is null then raise exception 'Complete delegation command required.' using errcode='22023'; end if;
 select p0.* into p from public.recurring_work_plans p0 join public.recurring_work_plan_versions v on v.plan_id=p0.id
   where v.id=p_version and v.organization_id=p_org and p0.organization_id=p_org and p0.project_id=p_project for share of p0;
 if not found then raise exception 'Same-project version required.' using errcode='42501'; end if;
 command:=jsonb_build_object('domain','recurring_assignment_delegation','project_id',p_project,'version_id',p_version,'enabled',p_enabled,'token',p_token);
 select * into receipt from private.n1b_authority_requests where organization_id=p_org and actor_id=actor and request_id=p_request;
 if found then
   if receipt.request_payload is distinct from command then raise exception 'Request ID conflict.' using errcode='23505'; end if;
   return receipt.result||jsonb_build_object('replayed',true);
 end if;
 perform 1 from public.recurring_work_plan_versions where id=p_version for share;
 snapshot:=private.n1c_delegation_snapshot(p_version);
 if md5(snapshot::text)<>p_token then raise exception 'Delegation changed. Reload before editing.' using errcode='40001'; end if;
 if p_enabled then
   if p.status in ('ended','archived') or not exists(select 1 from public.recurring_work_plan_version_approvals where plan_version_id=p_version) then
     raise exception 'Approved available plan version required before assignment delegation.' using errcode='55000';
   end if;
   for item in select * from public.recurring_work_plan_template_items where plan_version_id=p_version order by id loop
     perform 1 from public.departments where id=item.department_id and organization_id=p_org;
     if not found then raise exception 'Same-organization template department required.' using errcode='42501'; end if;
     if item.default_assignee_id is not null then
       perform 1 from public.organization_memberships where organization_id=p_org and user_id=item.default_assignee_id
         and status='active' and member_kind='team' for share;
       if not found then raise exception 'Eligible assignment required.' using errcode='42501'; end if;
     end if;
   end loop;
   if exists(select 1 from public.organization_memberships where organization_id=p_org and user_id=actor and status='active'
     and member_kind='team' and role in ('system_owner','operations_admin')) then basis:='organization_admin';
   else
     basis:='project_manager';
     select id into strict binding from public.project_manager_bindings where organization_id=p_org and project_id=p_project and user_id=actor and status='active';
   end if;
   insert into private.n1c_recurring_delegations(organization_id,project_id,plan_id,plan_version_id,approved_by,payload,approval_basis,approved_binding_id)
    values(p_org,p_project,p.id,p_version,actor,snapshot->'payload',basis,binding) returning id into record_id;
 else
   update private.n1c_recurring_delegations set status='revoked',revoked_at=clock_timestamp(),revoked_by=actor
    where plan_version_id=p_version and organization_id=p_org and project_id=p_project and status='active' returning id into record_id;
   if not found then raise exception 'Active delegation required.' using errcode='42501'; end if;
 end if;
 result:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'plan_version_id',p_version,'delegation_id',record_id,'request_id',p_request,'replayed',false);
 insert into private.n1b_authority_requests(organization_id,actor_id,request_id,request_payload,result) values(p_org,actor,p_request,command,result);
 return result;
end; $$;
create function public.get_recurring_assignment_delegation(p_organization_id uuid,p_project_id uuid,p_plan_version_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.n1c_read_delegation(p_organization_id,p_project_id,p_plan_version_id);
$$;
create function public.change_recurring_assignment_delegation(p_organization_id uuid,p_project_id uuid,p_plan_version_id uuid,p_enabled boolean,p_expected_token text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.n1c_change_delegation(p_organization_id,p_project_id,p_plan_version_id,p_enabled,p_expected_token,p_request_id);
$$;
revoke all on function private.n1c_can_delegate(uuid,uuid,uuid),private.n1c_recurring_payload(uuid),
 private.n1c_seal_approved_templates(),private.n1c_lock_approved_version(),private.n1c_delegation_snapshot(uuid),
 private.n1c_read_delegation(uuid,uuid,uuid),private.n1c_change_delegation(uuid,uuid,uuid,boolean,text,uuid),
 public.get_recurring_assignment_delegation(uuid,uuid,uuid),public.change_recurring_assignment_delegation(uuid,uuid,uuid,boolean,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.n1c_read_delegation(uuid,uuid,uuid),private.n1c_change_delegation(uuid,uuid,uuid,boolean,text,uuid),
 public.get_recurring_assignment_delegation(uuid,uuid,uuid),public.change_recurring_assignment_delegation(uuid,uuid,uuid,boolean,text,uuid) to authenticated;

create function private.n1c_require_recurring_delegation(p_plan uuid,p_version uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.recurring_work_plans; d private.n1c_recurring_delegations; item public.recurring_work_plan_template_items;
begin
 select * into p from public.recurring_work_plans where id=p_plan for share;
 if not found or p.status<>'active' then raise exception 'Active recurring plan required.' using errcode='55000'; end if;
 perform 1 from public.recurring_work_plan_versions where id=p_version and plan_id=p.id and organization_id=p.organization_id for share;
 if not found or not exists(select 1 from public.recurring_work_plan_version_approvals
   where plan_version_id=p_version and plan_id=p.id and organization_id=p.organization_id) then
   raise exception 'Approved recurring version required.' using errcode='55000';
 end if;
 select * into d from private.n1c_recurring_delegations where plan_version_id=p_version and plan_id=p.id
   and organization_id=p.organization_id and project_id=p.project_id and status='active' for share;
 if not found then raise exception 'Assignment delegation missing or withdrawn. A current same-project PM or organization admin must explicitly approve this version.' using errcode='42501'; end if;
 if d.payload is distinct from private.n1c_recurring_payload(p_version) then
   raise exception 'Approved assignment payload changed. Create a new version and obtain fresh delegation.' using errcode='42501';
 end if;
 if not private.n1c_can_delegate(p.organization_id,p.project_id,d.approved_by) then
   raise exception 'Delegation approver no longer has current PM/admin authority. Withdraw and approve a new delegation.' using errcode='42501';
 end if;
 if d.approval_basis='project_manager' then
   perform 1 from public.project_manager_bindings where id=d.approved_binding_id and organization_id=p.organization_id
     and project_id=p.project_id and user_id=d.approved_by and status='active' for share;
   if not found then raise exception 'Original PM binding withdrawn. Fresh delegation required.' using errcode='42501'; end if;
 elsif not exists(select 1 from public.organization_memberships where organization_id=p.organization_id and user_id=d.approved_by
   and member_kind='team' and status='active' and role in ('system_owner','operations_admin')) then
   raise exception 'Original organization-admin authority withdrawn. Fresh delegation required.' using errcode='42501';
 end if;
 for item in select * from public.recurring_work_plan_template_items where plan_version_id=p_version order by id loop
   perform 1 from public.departments where id=item.department_id and organization_id=p.organization_id;
   if not found then raise exception 'Template department scope changed.' using errcode='42501'; end if;
   if item.default_assignee_id is not null then
     perform 1 from public.organization_memberships where organization_id=p.organization_id and user_id=item.default_assignee_id
       and status='active' and member_kind='team' for share;
     if not found then raise exception 'Delegated assignee is no longer eligible.' using errcode='42501'; end if;
   end if;
 end loop;
 return d.id;
end; $$;
revoke all on function private.n1c_require_recurring_delegation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.n1c_require_recurring_delegation(uuid,uuid) to service_role;

create function private.n1c_assert_recurring_item(w public.work_items,p_actor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.recurring_work_plans; v public.recurring_work_plan_versions; o public.recurring_work_occurrences;
 t public.recurring_work_plan_template_items; a public.recurring_schedule_admissions; delegation uuid; applicable uuid;
begin
 if current_setting('role',true)<>'service_role' or auth.uid() is not null then
   raise exception 'Recurring reproduction requires verified server actor.' using errcode='42501';
 end if;
 select * into p from public.recurring_work_plans where id=w.recurring_plan_id and organization_id=w.organization_id and project_id=w.project_id for share;
 if not found then raise exception 'Recurring plan scope mismatch.' using errcode='42501'; end if;
 delegation:=private.n1c_require_recurring_delegation(p.id,w.recurring_plan_version_id);
 select * into v from public.recurring_work_plan_versions where id=w.recurring_plan_version_id and plan_id=p.id and organization_id=p.organization_id;
 select * into o from public.recurring_work_occurrences where id=w.recurring_occurrence_id and plan_id=p.id
   and plan_version_id=v.id and organization_id=p.organization_id and project_id=p.project_id
   and engagement_id=p.engagement_id and engagement_service_id=p.engagement_service_id and service_id=p.service_id and generated_by=p_actor;
 if not found then raise exception 'Immutable occurrence/actor scope mismatch.' using errcode='42501'; end if;
 if o.timezone is distinct from v.timezone or o.period_end is distinct from private.recurring_period_end(v.frequency,v.effective_start,o.period_start) then
   raise exception 'Canonical occurrence period required.' using errcode='42501';
 end if;
 select version.id into applicable from public.recurring_work_plan_versions version
   join public.recurring_work_plan_version_approvals approval on approval.plan_version_id=version.id
   where version.plan_id=p.id and version.organization_id=p.organization_id and version.effective_start<=o.period_start
     and (version.effective_end is null or version.effective_end>=o.period_start)
   order by version.effective_start desc,version.version_number desc limit 1;
 if applicable is distinct from v.id then raise exception 'Applicable recurring version changed.' using errcode='55000'; end if;
 perform private.assert_scheduled_recurring_context(p,v);
 if exists(select 1 from public.organization_memberships where user_id=p_actor) then
   perform private.n1c_require_scope(p.organization_id,p.project_id,p_actor);
   perform private.assert_recurring_generation_actor(p,p_actor);
 else
   perform private.assert_recurring_scheduler(p_actor,p.organization_id);
   select * into a from public.recurring_schedule_admissions where organization_id=p.organization_id and plan_id=p.id
     and plan_version_id=v.id and period_start=o.period_start and actor_id=p_actor;
   if not found or a.plan_status_changed_at is distinct from p.status_changed_at or not private.recurring_execution_open(clock_timestamp(),a.retry_deadline,a.period_start,a.timezone)
     or exists(select 1 from public.recurring_schedule_executions where admission_id=a.id and outcome='manual_review') then
     raise exception 'Current admitted scheduler occurrence required.' using errcode='55000';
   end if;
 end if;
 select * into t from public.recurring_work_plan_template_items where plan_version_id=v.id and plan_id=p.id
   and organization_id=p.organization_id and template_key=w.recurring_template_key;
 if not found or w.created_via<>'recurring_plan' or w.created_by is distinct from p_actor
   or w.engagement_id is distinct from p.engagement_id or w.status<>'not_started' or w.row_version<>1
   or w.department_id is distinct from t.department_id or w.assignee_id is distinct from t.default_assignee_id
   or w.title is distinct from t.title or w.description is distinct from t.description
   or w.work_item_type is distinct from t.work_item_type or w.priority is distinct from t.priority
   or w.start_date is distinct from o.period_start+t.start_offset_days or w.due_date is distinct from o.period_start+t.due_offset_days
   or w.position is distinct from t.position or w.parent_work_item_id is not null or w.deleted_at is not null
   or w.linked_artifact_id is not null or w.linked_artifact_version_id is not null or w.linked_engagement_stage_instance_id is not null
   or to_jsonb(w)->>'linked_page_path' is not null or to_jsonb(w)->>'linked_page_key' is not null
   or w.automation_flagged_at is not null or w.automation_flagged_by_rule_id is not null then
   raise exception 'Only the exact approved initial recurring template may be reproduced.' using errcode='42501';
 end if;
 perform 1 from public.engagements where id=p.engagement_id and organization_id=p.organization_id and brand_id=w.brand_id;
 if not found then raise exception 'Recurring brand scope mismatch.' using errcode='42501'; end if;
 return delegation;
end; $$;
revoke all on function private.n1c_assert_recurring_item(public.work_items,uuid) from public,anon,authenticated,service_role;

create or replace function private.n1c_guard_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid; project uuid; assignee uuid; previous_assignee uuid; creator uuid;
  can_assign boolean; delegation uuid; prior jsonb; next_row jsonb; is_task boolean := tg_table_name='tasks';
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
  if not is_task and tg_op='INSERT' and next_row->>'recurring_occurrence_id' is not null then
    delegation := private.n1c_assert_recurring_item(new,actor);
    can_assign := true; -- exact initial template only; no update or general machine grant
  else
    can_assign := private.n1c_can_assign_department(new.organization_id,project,new.department_id,actor);
  end if;
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
    insert into private.n1c_assignment_history(organization_id,project_id,record_kind,record_id,actor_id,previous_assignee_id,assignee_id,row_version,delegation_id)
    values(new.organization_id,project,case when is_task then 'project_task' else 'engagement_work_item' end,new.id,actor,previous_assignee,assignee,
      case when tg_op='INSERT' then new.row_version else old.row_version+1 end,delegation);
  end if;
  return new;
end; $$;
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
  perform private.n1c_require_recurring_delegation(v_plan.id,v_version.id);
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
    perform private.n1c_require_recurring_delegation(p.id,v.id);
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
    v_result := jsonb_build_object('outcome',v_outcome,'admission_id',a.id,'error_code',v_code,'required_action',case when v_code='42501' then 'Review current PM/admin assignment delegation and assignee eligibility for this exact plan version; withdraw stale delegation and explicitly approve again.' else 'Review plan, service, version and admission window before manual recovery.' end);
  end;
  insert into public.recurring_schedule_executions(admission_id,organization_id,outcome,error_code,occurrence_id)
    values(a.id,a.organization_id,v_outcome,v_code,case when v_outcome in ('generated','replayed') then o.id end);
  return v_result;
end;
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
      perform private.n1c_require_recurring_delegation(v_plan.id,(v_preview->>'plan_version_id')::uuid);
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
commit;
