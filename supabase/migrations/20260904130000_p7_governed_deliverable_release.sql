-- P7 - governed exact-version deliverable review, release, and closure.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Fail closed rather than guessing or repairing legacy ownership.
do $$
begin
  if exists (
    select 1 from public.deliverable_versions v
    left join public.deliverables d on d.id = v.deliverable_id
    left join public.projects p on p.id = v.project_id
    left join public.workstreams w on w.id = d.workstream_id
    where d.id is null or p.id is null or w.id is null
       or d.organization_id <> v.organization_id or d.project_id <> v.project_id
       or p.organization_id <> v.organization_id
       or w.organization_id <> v.organization_id or w.project_id <> v.project_id
  ) then
    raise exception 'P7 found inconsistent deliverable-version ownership; manual reconciliation is required.';
  end if;
  if exists (
    select 1 from public.approvals a join public.deliverable_versions v on v.id = a.deliverable_version_id
    where a.organization_id <> v.organization_id or a.project_id <> v.project_id or a.deliverable_id <> v.deliverable_id
  ) then raise exception 'P7 found inconsistent approval ownership; manual reconciliation is required.'; end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.workstreams'::regclass and conname='workstreams_id_project_organization_key') then
    alter table public.workstreams add constraint workstreams_id_project_organization_key unique(id,project_id,organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deliverables'::regclass and conname='deliverables_id_project_workstream_organization_key') then
    alter table public.deliverables add constraint deliverables_id_project_workstream_organization_key unique(id,project_id,workstream_id,organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deliverable_versions'::regclass and conname='deliverable_versions_id_deliverable_project_organization_key') then
    alter table public.deliverable_versions add constraint deliverable_versions_id_deliverable_project_organization_key unique(id,deliverable_id,project_id,organization_id);
  end if;
end;
$$;

alter table public.deliverable_versions
  add column client_approval_required boolean not null default false,
  add column state_version bigint not null default 1,
  add constraint deliverable_versions_state_version_check check(state_version > 0);

create table public.deliverable_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null, deliverable_id uuid not null,
  deliverable_version_id uuid not null, workstream_id uuid not null, client_id uuid,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  nominated_by uuid references auth.users(id) on delete set null,
  status text not null default 'current' check(status in ('current','reassigned','completed')),
  reason text not null default '', assigned_at timestamptz not null default now(), ended_at timestamptz,
  unique(id,organization_id),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key(client_id,organization_id) references public.clients(id,organization_id) on delete restrict,
  foreign key(deliverable_id,project_id,workstream_id,organization_id)
    references public.deliverables(id,project_id,workstream_id,organization_id) on delete restrict,
  foreign key(deliverable_version_id,deliverable_id,project_id,organization_id)
    references public.deliverable_versions(id,deliverable_id,project_id,organization_id) on delete restrict,
  check((status='current' and ended_at is null) or (status<>'current' and ended_at is not null))
);
create unique index deliverable_review_assignments_one_current_idx
  on public.deliverable_review_assignments(deliverable_version_id) where status='current';
create index deliverable_review_assignments_reviewer_idx
  on public.deliverable_review_assignments(organization_id,reviewer_id,status,assigned_at);

create table public.deliverable_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null, deliverable_id uuid not null,
  deliverable_version_id uuid not null, workstream_id uuid not null, client_id uuid,
  event_type text not null check(event_type in (
    'created','submitted','reviewer_assigned','reviewer_reassigned',
    'review_approved','review_changes_required','released','client_approved',
    'client_changes_required','delivered','published','legacy_status_marker'
  )),
  actor_id uuid references auth.users(id) on delete restrict,
  actor_kind text not null check(actor_kind in ('team','client','legacy')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  occurred_at timestamptz not null default now(), unique(id,organization_id),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  foreign key(client_id,organization_id) references public.clients(id,organization_id) on delete restrict,
  foreign key(deliverable_id,project_id,workstream_id,organization_id)
    references public.deliverables(id,project_id,workstream_id,organization_id) on delete restrict,
  foreign key(deliverable_version_id,deliverable_id,project_id,organization_id)
    references public.deliverable_versions(id,deliverable_id,project_id,organization_id) on delete restrict
);
create unique index deliverable_lifecycle_events_terminal_idx
  on public.deliverable_lifecycle_events(deliverable_version_id,event_type)
  where event_type in ('delivered','published','legacy_status_marker');
create index deliverable_lifecycle_events_version_idx
  on public.deliverable_lifecycle_events(organization_id,deliverable_version_id,occurred_at);

create table public.deliverable_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in (
    'create','submit','assign_reviewer','review','release','client_decision','delivered','published'
  )),
  request_id uuid not null,
  payload_checksum text not null check(payload_checksum ~ '^[0-9a-f]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  unique(organization_id,actor_id,action,request_id)
);
create index deliverable_action_requests_created_idx
  on public.deliverable_action_requests(organization_id,created_at);

alter table public.deliverable_review_assignments enable row level security;
alter table public.deliverable_lifecycle_events enable row level security;
alter table public.deliverable_action_requests enable row level security;
create policy "Team can read deliverable review assignments"
  on public.deliverable_review_assignments for select to authenticated
  using(public.is_team_organization_member(organization_id));
create policy "Authorized members can read deliverable lifecycle events"
  on public.deliverable_lifecycle_events for select to authenticated
  using(public.is_team_organization_member(organization_id) or private.is_project_client(project_id));
revoke all on public.deliverable_review_assignments,public.deliverable_lifecycle_events,public.deliverable_action_requests from public,anon,authenticated;
grant select on public.deliverable_review_assignments,public.deliverable_lifecycle_events to authenticated;
grant all on public.deliverable_review_assignments,public.deliverable_lifecycle_events,public.deliverable_action_requests to service_role;

-- The legacy activity trigger used one seeded organization literal. Governed actions
-- must work for the exact project tenant, so preserve its behavior while deriving
-- authorization from the project's organization.
create or replace function private.capture_delivery_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  project_ref uuid;
  target_ref uuid;
  action_name text;
  target_kind text := tg_table_name;
  event_metadata jsonb := '{}'::jsonb;
  recipient uuid;
  notification_type text;
  notification_title text;
  notification_body text;
  project_name text;
  is_authorized boolean := false;
  event_visibility text := 'internal_only';
begin
  if actor is null then
    return new;
  end if;

  if tg_table_name = 'projects' then
    project_ref := coalesce(new.id, old.id);
    target_ref := project_ref;
    action_name := case when tg_op = 'INSERT' then 'project.created' else 'project.updated' end;
    event_metadata := jsonb_build_object('name', new.name, 'status', new.status, 'health', new.health);
  elsif tg_table_name = 'tasks' then
    project_ref := coalesce(new.project_id, old.project_id);
    target_ref := coalesce(new.id, old.id);
    action_name := case
      when tg_op = 'INSERT' then 'task.created'
      when new.assigned_to is distinct from old.assigned_to then 'task.assigned'
      when new.status is distinct from old.status then 'task.status_changed'
      else 'task.updated'
    end;
    event_metadata := jsonb_build_object(
      'title', new.title, 'status', new.status,
      'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
      'assigned_to', new.assigned_to
    );
    if (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
       and new.assigned_to is not null and new.assigned_to <> actor then
      recipient := new.assigned_to;
      notification_type := 'task_assigned';
      notification_title := 'Task assigned';
      notification_body := new.title;
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status
       and new.created_by is not null and new.created_by <> actor then
      recipient := new.created_by;
      notification_type := 'task_status';
      notification_title := 'Task status changed';
      notification_body := new.title || ' is now ' || replace(new.status, '_', ' ');
    end if;
  elsif tg_table_name = 'requests' then
    project_ref := coalesce(new.project_id, old.project_id);
    target_ref := coalesce(new.id, old.id);
    action_name := case
      when tg_op = 'INSERT' and new.request_origin = 'client' then 'client.revision_submitted'
      when tg_op = 'INSERT' then 'request.created'
      when new.owner_id is distinct from old.owner_id then 'request.assigned'
      when new.status is distinct from old.status then 'request.status_changed'
      else 'request.updated'
    end;
    event_metadata := jsonb_build_object(
      'title', new.title, 'request_type', new.request_type,
      'origin', new.request_origin, 'status', new.status,
      'target_deliverable_version_id', new.target_deliverable_version_id
    );
    if new.request_origin = 'client' then
      select owner_id into recipient from public.projects where id = project_ref;
      notification_type := 'client_revision';
      notification_title := 'Client revision received';
      notification_body := new.title;
    elsif (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
       and new.owner_id is not null and new.owner_id <> actor then
      recipient := new.owner_id;
      notification_type := 'request_assigned';
      notification_title := 'Request assigned';
      notification_body := new.title;
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status
       and new.requested_by <> actor then
      recipient := new.requested_by;
      notification_type := 'request_status';
      notification_title := 'Request status changed';
      notification_body := new.title || ' is now ' || replace(new.status, '_', ' ');
    end if;
  elsif tg_table_name = 'deliverable_versions' then
    project_ref := coalesce(new.project_id, old.project_id);
    target_ref := coalesce(new.id, old.id);
    action_name := case
      when tg_op = 'INSERT' then 'deliverable.version_created'
      else 'deliverable.review_status_changed'
    end;
    event_metadata := jsonb_build_object(
      'title', new.title, 'version_number', new.version_number,
      'review_status', new.review_status,
      'previous_review_status', case when tg_op = 'UPDATE' then old.review_status else null end
    );
    if tg_op = 'UPDATE' and new.review_status = 'ready_for_internal_review'
       and new.review_status is distinct from old.review_status then
      select owner_id into recipient from public.projects where id = project_ref;
      notification_type := 'review_required';
      notification_title := 'Internal review required';
      notification_body := new.title || ' · version ' || new.version_number;
    elsif tg_op = 'UPDATE' and new.review_status = 'changes_required'
       and new.review_status is distinct from old.review_status and new.created_by <> actor then
      recipient := new.created_by;
      notification_type := 'review_required';
      notification_title := 'Changes required';
      notification_body := new.title || ' · version ' || new.version_number;
    end if;
  elsif tg_table_name = 'comments' then
    project_ref := new.project_id;
    target_ref := new.id;
    action_name := case when new.client_contact_id is null then 'comment.created' else 'client.message_created' end;
    event_metadata := jsonb_build_object('entity_type', new.entity_type, 'entity_id', new.entity_id);
    if new.client_contact_id is not null then
      select owner_id into recipient from public.projects where id = project_ref;
      notification_type := 'client_message';
      notification_title := 'New client message';
      notification_body := left(new.content, 180);
    end if;
    if new.visibility = 'client_shared' then event_visibility := 'client_visible'; end if;
  else
    return new;
  end if;

  select exists (
    select 1 from public.organization_memberships membership
    where membership.user_id = actor
      and membership.organization_id = (select p.organization_id from public.projects p where p.id = project_ref)
      and membership.member_kind = 'team' and membership.status = 'active'
  ) or exists (
    select 1
    from public.project_client_access access
    join public.client_contacts contact on contact.id = access.client_contact_id
    where access.project_id = project_ref and access.status = 'active'
      and contact.auth_user_id = actor and contact.status = 'active'
  ) into is_authorized;

  if not is_authorized then
    raise exception 'Actor is not authorized for delivery activity capture.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.activity_events (
    project_id, actor_id, action, target_type, target_id, visibility, metadata
  ) values (
    project_ref, actor, action_name, target_kind, target_ref,
    event_visibility, event_metadata
  );

  update public.living_project_documents
  set source_version = source_version + 1,
      internal_projection = jsonb_set(
        jsonb_set(internal_projection, '{latest_event}', jsonb_build_object(
          'action', action_name, 'target_type', target_kind,
          'target_id', target_ref, 'actor_id', actor,
          'metadata', event_metadata, 'occurred_at', now()
        ), true),
        '{last_updated_at}', to_jsonb(now()), true
      ),
      generated_at = now()
  where project_id = project_ref;

  if recipient is not null and recipient <> actor then
    select name into project_name from public.projects where id = project_ref;
    insert into public.notifications (
      user_id, type, title, body, project_id, entity_type, entity_id,
      action_url, metadata
    ) values (
      recipient, notification_type, notification_title, notification_body,
      project_ref, target_kind, target_ref, '/sphere/my-work',
      jsonb_build_object('project_name', project_name, 'action', action_name)
    );
  end if;

  return new;
end;
$$;

create function private.p7_reject_history_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'P7 governance history is append-only.' using errcode='55000'; end; $$;
create trigger trg_deliverable_lifecycle_events_append_only
before update or delete on public.deliverable_lifecycle_events
for each row execute function private.p7_reject_history_mutation();
create trigger trg_deliverable_action_requests_append_only
before update or delete on public.deliverable_action_requests
for each row execute function private.p7_reject_history_mutation();
create trigger trg_approvals_append_only before update or delete on public.approvals
for each row execute function private.p7_reject_history_mutation();

create function private.p7_replay(
  p_org uuid,p_actor uuid,p_action text,p_request uuid,p_checksum text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.deliverable_action_requests%rowtype;
begin
  select * into r from public.deliverable_action_requests
  where organization_id=p_org and actor_id=p_actor and action=p_action and request_id=p_request;
  if not found then return null; end if;
  if r.payload_checksum<>p_checksum then
    raise exception 'Idempotency key was already used with different inputs.' using errcode='23505';
  end if;
  return r.result||jsonb_build_object('idempotent_replay',true);
end; $$;

create function private.p7_record(
  p_org uuid,p_actor uuid,p_action text,p_request uuid,p_checksum text,p_result jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  insert into public.deliverable_action_requests(
    organization_id,actor_id,action,request_id,payload_checksum,result
  ) values(p_org,p_actor,p_action,p_request,p_checksum,p_result);
  return p_result||jsonb_build_object('idempotent_replay',false);
end; $$;

create function private.p7_team(p_org uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(
  select 1 from public.organization_memberships m
  join public.organizations o on o.id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_actor
    and m.member_kind='team' and m.status='active' and o.status='active'
); $$;

create function private.p7_release_authority(p_org uuid,p_project uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(
  select 1 from public.organization_memberships m
  join public.organizations o on o.id=m.organization_id
  join public.projects p on p.id=p_project and p.organization_id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_actor
    and m.member_kind='team' and m.status='active' and o.status='active'
    and (m.role in ('system_owner','operations_admin','executive')
      or (m.role='project_owner' and p.owner_id=p_actor))
); $$;

create function private.p7_assignment_authority(
  p_org uuid,p_project uuid,p_department text,p_actor uuid
) returns boolean language sql stable security definer set search_path='' as $$
select exists(
  select 1 from public.organization_memberships m
  join public.organizations o on o.id=m.organization_id
  join public.projects p on p.id=p_project and p.organization_id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_actor
    and m.member_kind='team' and m.status='active' and o.status='active'
    and (m.role in ('system_owner','operations_admin','executive')
      or (m.role='project_owner' and p.owner_id=p_actor)
      or (m.role='department_manager' and m.department_id=p_department))
); $$;

create function private.p7_eligible_reviewer(
  p_org uuid,p_project uuid,p_department text,
  p_creator uuid,p_owner uuid,p_reviewer uuid
) returns boolean language sql stable security definer set search_path='' as $$
select p_reviewer is distinct from p_creator and p_reviewer is distinct from p_owner
  and exists(
    select 1 from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id
    join public.projects p on p.id=p_project and p.organization_id=m.organization_id
    where m.organization_id=p_org and m.user_id=p_reviewer
      and m.member_kind='team' and m.status='active' and o.status='active'
      and (m.role in ('system_owner','operations_admin','executive')
        or (m.role='project_owner' and p.owner_id=p_reviewer)
        or (m.role='department_manager' and m.department_id=p_department))
  ); $$;

create function private.p7_set_assignment(
  p_org uuid,p_version uuid,p_reviewer uuid,p_actor uuid,p_nominee uuid,p_reason text
) returns public.deliverable_review_assignments
language plpgsql security definer set search_path='' as $$
declare c record; current_row public.deliverable_review_assignments%rowtype; result_row public.deliverable_review_assignments%rowtype;
begin
  select v.project_id,v.deliverable_id,v.created_by,d.owner_id,d.workstream_id,w.department_id,p.client_id
  into c from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_version and v.organization_id=p_org;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if not private.p7_eligible_reviewer(p_org,c.project_id,c.department_id,c.created_by,c.owner_id,p_reviewer) then
    raise exception 'Selected reviewer is ineligible or would self-review this version.' using errcode='42501';
  end if;
  select * into current_row from public.deliverable_review_assignments
  where deliverable_version_id=p_version and status='current' for update;
  if found and current_row.reviewer_id=p_reviewer then return current_row; end if;
  if found then update public.deliverable_review_assignments set status='reassigned',ended_at=now() where id=current_row.id; end if;
  insert into public.deliverable_review_assignments(
    organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
    client_id,reviewer_id,assigned_by,nominated_by,reason
  ) values(p_org,c.project_id,c.deliverable_id,p_version,c.workstream_id,c.client_id,
    p_reviewer,p_actor,p_nominee,left(coalesce(p_reason,''),1000)) returning * into result_row;
  return result_row;
end; $$;

create or replace function private.enforce_deliverable_version_transition()
returns trigger language plpgsql security invoker set search_path='' as $$
declare feature_enabled boolean;
begin
  if old.review_status<>'in_production' and (
    new.version_number is distinct from old.version_number or new.title is distinct from old.title
    or new.change_summary is distinct from old.change_summary or new.file_id is distinct from old.file_id
    or new.preview_metadata is distinct from old.preview_metadata or new.created_by is distinct from old.created_by
  ) then raise exception 'Reviewed deliverable versions are immutable; create a new version.' using errcode='23514'; end if;
  if new.client_approval_required is distinct from old.client_approval_required and old.client_released_at is not null then
    raise exception 'Client approval requirement is immutable after first release.' using errcode='23514';
  end if;
  if new.review_status is distinct from old.review_status
     or new.internal_reviewer_id is distinct from old.internal_reviewer_id
     or new.internal_reviewed_at is distinct from old.internal_reviewed_at
     or new.client_released_at is distinct from old.client_released_at
     or new.client_approval_required is distinct from old.client_approval_required
     or new.state_version is distinct from old.state_version then
    if current_setting('anka.p7_governed_action',true) is distinct from 'allowed' then
      raise exception 'Use a governed deliverable action.' using errcode='42501';
    end if;
    if new.state_version<>old.state_version+1 then
      raise exception 'Deliverable version state must advance exactly once.' using errcode='40001';
    end if;
  end if;
  if new.review_status is distinct from old.review_status and not (
    (old.review_status='in_production' and new.review_status='ready_for_internal_review')
    or (old.review_status='ready_for_internal_review' and new.review_status in ('changes_required','ready_for_client_review'))
    or (old.review_status='ready_for_client_review' and new.review_status='client_reviewing')
    or (old.review_status='client_reviewing' and new.review_status in ('revision_requested','client_approved','delivered_published'))
    or (old.review_status='client_approved' and new.review_status in ('delivered_published','superseded'))
    or (old.review_status='delivered_published' and new.review_status='superseded')
  ) then raise exception 'Invalid deliverable version transition: % -> %',old.review_status,new.review_status using errcode='23514'; end if;
  if new.review_status='client_approved' then
    select coalesce((settings->>'client_approvals_enabled')::boolean,false) into feature_enabled
    from public.organizations where id=new.organization_id;
    if feature_enabled is not true then raise exception 'Client approvals are disabled for this organization.' using errcode='42501'; end if;
  end if;
  return new;
end; $$;

create function private.p7_guard_deliverable_governance()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status is distinct from old.status or new.visibility is distinct from old.visibility
     or new.current_version_id is distinct from old.current_version_id
     or new.client_released_version_id is distinct from old.client_released_version_id then
    if current_setting('anka.p7_governed_action',true) is distinct from 'allowed' then
      raise exception 'Use a governed deliverable action.' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_p7_guard_deliverable_governance before update on public.deliverables
for each row execute function private.p7_guard_deliverable_governance();
drop trigger if exists apply_client_approval_decision on public.approvals;

create function public.get_deliverable_version_capabilities(
  p_organization_id uuid,p_deliverable_version_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; membership record; assigned uuid;
  client_allowed boolean:=false; feature_enabled boolean:=false;
  client_approved boolean:=false; released boolean:=false;
begin
  if actor is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  select v.*,d.owner_id deliverable_owner_id,d.workstream_id,w.department_id,
    p.client_id,p.owner_id project_owner_id into c
  from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  select role,department_id,member_kind into membership from public.organization_memberships
  where organization_id=p_organization_id and user_id=actor and status='active';
  select reviewer_id into assigned from public.deliverable_review_assignments
  where deliverable_version_id=p_deliverable_version_id and status='current';
  select coalesce((settings->>'client_approvals_enabled')::boolean,false) into feature_enabled
  from public.organizations where id=p_organization_id and status='active';
  select exists(select 1 from public.approvals where deliverable_version_id=p_deliverable_version_id and approval_type='client_approval' and decision='approved') into client_approved;
  select exists(select 1 from public.deliverable_lifecycle_events where deliverable_version_id=p_deliverable_version_id and event_type='released') into released;
  select exists(
    select 1 from public.client_contacts contact
    join public.project_client_access access on access.client_contact_id=contact.id
      and access.project_id=c.project_id and access.organization_id=p_organization_id
    where contact.organization_id=p_organization_id and contact.client_id=c.client_id
      and contact.auth_user_id=actor and contact.status='active'
      and contact.portal_role in ('admin','approver') and access.status='active'
      and access.access_role in ('admin','approver')
  ) into client_allowed;
  if not (
    (membership.member_kind='team' and private.p7_team(p_organization_id,actor))
    or (membership.member_kind='client' and client_allowed)
  ) then
    raise exception 'Exact-organization deliverable access required.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'state_version',c.state_version,'assigned_reviewer_id',assigned,
    'client_approval_required',c.client_approval_required,'client_approvals_enabled',feature_enabled,
    'can_submit',c.review_status='in_production' and membership.member_kind='team' and
      (membership.department_id=c.department_id or membership.role in ('system_owner','operations_admin','executive') or (membership.role='project_owner' and c.project_owner_id=actor)),
    'can_assign_reviewer',c.review_status='ready_for_internal_review' and private.p7_assignment_authority(p_organization_id,c.project_id,c.department_id,actor),
    'can_review',c.review_status='ready_for_internal_review' and assigned=actor
      and private.p7_eligible_reviewer(p_organization_id,c.project_id,c.department_id,c.created_by,c.deliverable_owner_id,actor),
    'can_release',c.review_status='ready_for_client_review' and c.client_id is not null and private.p7_release_authority(p_organization_id,c.project_id,actor),
    'can_client_decide',c.review_status='client_reviewing' and feature_enabled and client_allowed and membership.role in ('client_admin','client_approver'),
    'can_mark_delivered',released and c.review_status in ('client_reviewing','client_approved') and private.p7_release_authority(p_organization_id,c.project_id,actor) and not(c.client_approval_required and feature_enabled and not client_approved),
    'can_mark_published',released and c.review_status in ('client_reviewing','client_approved','delivered_published') and private.p7_release_authority(p_organization_id,c.project_id,actor) and not(c.client_approval_required and feature_enabled and not client_approved)
  );
end; $$;

create function public.list_deliverable_reviewer_candidates(
  p_organization_id uuid,p_deliverable_version_id uuid
) returns table(user_id uuid,role text,department_id text,full_name text)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record;
begin
  if not private.p7_team(p_organization_id,actor) then raise exception 'Active team membership required.' using errcode='42501'; end if;
  select v.project_id,v.created_by,d.owner_id,w.department_id,p.owner_id project_owner_id into c
  from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if not exists(
    select 1 from public.organization_memberships m
    where m.organization_id=p_organization_id and m.user_id=actor
      and m.member_kind='team' and m.status='active'
      and (m.department_id=c.department_id or m.role in ('system_owner','operations_admin','executive')
        or (m.role='project_owner' and c.project_owner_id=actor))
  ) then raise exception 'Deliverable submission or assignment authority required.' using errcode='42501'; end if;
  return query select m.user_id,m.role,m.department_id,coalesce(profile.full_name,profile.email,m.user_id::text)
  from public.organization_memberships m left join public.profiles profile on profile.id=m.user_id
  where m.organization_id=p_organization_id and m.member_kind='team' and m.status='active'
    and private.p7_eligible_reviewer(p_organization_id,c.project_id,c.department_id,c.created_by,c.owner_id,m.user_id)
  order by m.role,m.user_id;
end; $$;

create function public.create_governed_deliverable_version(
  p_organization_id uuid,p_deliverable_id uuid,p_title text,p_change_summary text,
  p_file_id uuid,p_preview_metadata jsonb,p_client_approval_required boolean,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); d record; v public.deliverable_versions%rowtype;
  membership record; checksum text; replay jsonb; result jsonb;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object(
    'deliverable_id',p_deliverable_id,'title',trim(coalesce(p_title,'')),
    'change_summary',coalesce(p_change_summary,''),'file_id',p_file_id,
    'preview_metadata',coalesce(p_preview_metadata,'{}'::jsonb),
    'client_approval_required',coalesce(p_client_approval_required,false)
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':create:'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,'create',p_request_id,checksum);
  if replay is not null then return replay; end if;
  if length(trim(coalesce(p_title,''))) not between 1 and 240 then raise exception 'Version title is required.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_preview_metadata,'{}'::jsonb))<>'object' then raise exception 'Preview metadata must be an object.' using errcode='22023'; end if;
  select deliverable.*,w.department_id,p.client_id,p.owner_id project_owner_id into d
  from public.deliverables deliverable
  join public.workstreams w on w.id=deliverable.workstream_id and w.project_id=deliverable.project_id and w.organization_id=deliverable.organization_id
  join public.projects p on p.id=deliverable.project_id and p.organization_id=deliverable.organization_id
  where deliverable.id=p_deliverable_id and deliverable.organization_id=p_organization_id
  for update of deliverable;
  if not found then raise exception 'Deliverable not found in selected organization.' using errcode='P0002'; end if;
  select role,department_id into membership from public.organization_memberships
  where organization_id=p_organization_id and user_id=actor and member_kind='team' and status='active';
  if not private.p7_team(p_organization_id,actor) or not found or not(membership.department_id=d.department_id or membership.role in ('system_owner','operations_admin','executive') or (membership.role='project_owner' and d.project_owner_id=actor)) then
    raise exception 'Deliverable authoring authority required.' using errcode='42501';
  end if;
  if p_file_id is not null and not exists(select 1 from public.files f where f.id=p_file_id and f.organization_id=p_organization_id and f.project_id=d.project_id) then
    raise exception 'File does not belong to the deliverable project.' using errcode='23503';
  end if;
  perform set_config('anka.p7_governed_action','allowed',true);
  insert into public.deliverable_versions(
    organization_id,project_id,deliverable_id,version_number,title,change_summary,
    file_id,preview_metadata,review_status,created_by,client_approval_required
  ) select p_organization_id,d.project_id,p_deliverable_id,coalesce(max(version_number),0)+1,
      trim(p_title),left(coalesce(p_change_summary,''),4000),p_file_id,
      coalesce(p_preview_metadata,'{}'::jsonb),'in_production',actor,coalesce(p_client_approval_required,false)
    from public.deliverable_versions where deliverable_id=p_deliverable_id returning * into v;
  update public.deliverables set current_version_id=v.id,status='in_production'
  where id=p_deliverable_id and organization_id=p_organization_id;
  insert into public.deliverable_lifecycle_events(
    organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
    client_id,event_type,actor_id,actor_kind
  ) values(p_organization_id,v.project_id,p_deliverable_id,v.id,d.workstream_id,d.client_id,'created',actor,'team');
  result:=jsonb_build_object('deliverable_version_id',v.id,'state_version',v.state_version,'review_status',v.review_status);
  return private.p7_record(p_organization_id,actor,'create',p_request_id,checksum,result);
end; $$;

create function public.submit_governed_deliverable_version(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_nominated_reviewer_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; membership record;
  assignment public.deliverable_review_assignments%rowtype; checksum text; replay jsonb; result jsonb; next_version bigint;
begin
  if actor is null or p_request_id is null or p_nominated_reviewer_id is null then raise exception 'Authentication, reviewer, and request id are required.' using errcode='42501'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'reviewer_id',p_nominated_reviewer_id)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':submit:'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,'submit',p_request_id,checksum); if replay is not null then return replay; end if;
  select v.*,d.owner_id deliverable_owner_id,d.workstream_id,w.department_id,p.client_id,p.owner_id project_owner_id into c
  from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before submitting.' using errcode='40001'; end if;
  if c.review_status<>'in_production' then raise exception 'Only in-production versions can be submitted.' using errcode='23514'; end if;
  select role,department_id into membership from public.organization_memberships where organization_id=p_organization_id and user_id=actor and member_kind='team' and status='active';
  if not private.p7_team(p_organization_id,actor) or not found or not(membership.department_id=c.department_id or membership.role in ('system_owner','operations_admin','executive') or (membership.role='project_owner' and c.project_owner_id=actor)) then raise exception 'Submission authority required.' using errcode='42501'; end if;
  assignment:=private.p7_set_assignment(p_organization_id,p_deliverable_version_id,p_nominated_reviewer_id,actor,actor,'Submitter nomination');
  perform set_config('anka.p7_governed_action','allowed',true);
  update public.deliverable_versions set review_status='ready_for_internal_review',state_version=state_version+1
  where id=p_deliverable_version_id returning state_version into next_version;
  update public.deliverables set status='in_review' where id=c.deliverable_id;
  insert into public.deliverable_lifecycle_events(organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,client_id,event_type,actor_id,actor_kind,metadata)
  values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,c.workstream_id,c.client_id,'submitted',actor,'team',jsonb_build_object('reviewer_id',assignment.reviewer_id));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,'state_version',next_version,'review_status','ready_for_internal_review','assigned_reviewer_id',assignment.reviewer_id);
  return private.p7_record(p_organization_id,actor,'submit',p_request_id,checksum,result);
end; $$;

create function public.assign_governed_deliverable_reviewer(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_reviewer_id uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; assignment public.deliverable_review_assignments%rowtype;
  checksum text; replay jsonb; result jsonb; event_name text; next_version bigint;
begin
  if actor is null or p_request_id is null or p_reviewer_id is null then raise exception 'Authentication, reviewer, and request id are required.' using errcode='42501'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'reviewer_id',p_reviewer_id,'reason',coalesce(p_reason,''))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':assign:'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,'assign_reviewer',p_request_id,checksum); if replay is not null then return replay; end if;
  select v.state_version,v.review_status,v.project_id,v.deliverable_id,d.workstream_id,w.department_id,p.client_id into c
  from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before assignment.' using errcode='40001'; end if;
  if c.review_status<>'ready_for_internal_review' then raise exception 'Reviewer can be assigned only during internal review.' using errcode='23514'; end if;
  if not private.p7_assignment_authority(p_organization_id,c.project_id,c.department_id,actor) then raise exception 'Reviewer assignment authority required.' using errcode='42501'; end if;
  event_name:=case when exists(select 1 from public.deliverable_review_assignments where deliverable_version_id=p_deliverable_version_id) then 'reviewer_reassigned' else 'reviewer_assigned' end;
  assignment:=private.p7_set_assignment(p_organization_id,p_deliverable_version_id,p_reviewer_id,actor,null,p_reason);
  perform set_config('anka.p7_governed_action','allowed',true);
  update public.deliverable_versions set state_version=state_version+1 where id=p_deliverable_version_id returning state_version into next_version;
  insert into public.deliverable_lifecycle_events(organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,client_id,event_type,actor_id,actor_kind,metadata)
  values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,c.workstream_id,c.client_id,event_name,actor,'team',jsonb_build_object('reviewer_id',assignment.reviewer_id,'reason',left(coalesce(p_reason,''),1000)));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,'state_version',next_version,'assigned_reviewer_id',assignment.reviewer_id);
  return private.p7_record(p_organization_id,actor,'assign_reviewer',p_request_id,checksum,result);
end; $$;

create function public.review_governed_deliverable_version(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_decision text,p_rationale text,p_checklist_result jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; assignment public.deliverable_review_assignments%rowtype;
  checksum text; replay jsonb; result jsonb; next_status text; next_version bigint;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
  if p_decision not in ('approved','changes_required') then raise exception 'Unsupported review decision.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_checklist_result,'{}'::jsonb))<>'object' then raise exception 'Checklist must be an object.' using errcode='22023'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'decision',p_decision,'rationale',coalesce(p_rationale,''),'checklist',coalesce(p_checklist_result,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':review:'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,'review',p_request_id,checksum); if replay is not null then return replay; end if;
  select v.*,d.owner_id deliverable_owner_id,d.workstream_id,w.department_id,p.client_id into c
  from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before review.' using errcode='40001'; end if;
  if c.review_status<>'ready_for_internal_review' then raise exception 'Version is not awaiting internal review.' using errcode='23514'; end if;
  select * into assignment from public.deliverable_review_assignments where deliverable_version_id=p_deliverable_version_id and status='current' for update;
  if not found or assignment.reviewer_id<>actor
    or not private.p7_eligible_reviewer(p_organization_id,c.project_id,c.department_id,c.created_by,c.deliverable_owner_id,actor) then
    raise exception 'Only the eligible assigned reviewer can decide.' using errcode='42501';
  end if;
  next_status:=case when p_decision='approved' then 'ready_for_client_review' else 'changes_required' end;
  insert into public.approvals(organization_id,project_id,deliverable_id,deliverable_version_id,approval_type,decision,rationale,checklist_result,decided_by)
  values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,'internal_quality',p_decision,left(coalesce(p_rationale,''),4000),coalesce(p_checklist_result,'{}'::jsonb),actor);
  update public.deliverable_review_assignments set status='completed',ended_at=now() where id=assignment.id;
  perform set_config('anka.p7_governed_action','allowed',true);
  update public.deliverable_versions set review_status=next_status,internal_reviewer_id=actor,internal_reviewed_at=now(),state_version=state_version+1
  where id=p_deliverable_version_id returning state_version into next_version;
  update public.deliverables set status=case when p_decision='approved' then 'in_review' else 'revision_requested' end where id=c.deliverable_id;
  insert into public.deliverable_lifecycle_events(organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,client_id,event_type,actor_id,actor_kind,metadata)
  values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,c.workstream_id,c.client_id,case when p_decision='approved' then 'review_approved' else 'review_changes_required' end,actor,'team',jsonb_build_object('rationale',left(coalesce(p_rationale,''),4000)));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,'state_version',next_version,'review_status',next_status);
  return private.p7_record(p_organization_id,actor,'review',p_request_id,checksum,result);
end; $$;

create function public.release_governed_deliverable_version(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_client_approval_required boolean,p_next_action text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; checksum text; replay jsonb; result jsonb; next_version bigint;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'client_approval_required',coalesce(p_client_approval_required,false),'next_action',coalesce(p_next_action,''))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':release:'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,'release',p_request_id,checksum); if replay is not null then return replay; end if;
  select v.*,d.workstream_id,p.client_id,p.name project_name,p.engagement_type,
    p.description project_description,p.health,p.status project_status,p.start_date,p.due_date into c
  from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.workstreams w on w.id=d.workstream_id and w.project_id=v.project_id and w.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before release.' using errcode='40001'; end if;
  if c.review_status<>'ready_for_client_review' or c.client_id is null then raise exception 'Only internally approved client-project versions can be released.' using errcode='23514'; end if;
  if not private.p7_release_authority(p_organization_id,c.project_id,actor) then raise exception 'Release authority required.' using errcode='42501'; end if;
  if not exists(select 1 from public.approvals where deliverable_version_id=p_deliverable_version_id and approval_type='internal_quality' and decision='approved') then raise exception 'Exact-version internal approval required.' using errcode='23514'; end if;
  perform set_config('anka.p7_governed_action','allowed',true);
  insert into public.client_project_projections(
    organization_id,project_id,client_id,project_name,engagement_type,summary,health,
    status,start_date,due_date,next_action,withdrawn_at
  ) values(p_organization_id,c.project_id,c.client_id,c.project_name,c.engagement_type,
    coalesce(c.project_description,''),coalesce(c.health,'unknown'),c.project_status,
    c.start_date,c.due_date,coalesce(nullif(trim(p_next_action),''),'Review the newly released deliverable.'),null)
  on conflict(project_id) do update set project_name=excluded.project_name,
    engagement_type=excluded.engagement_type,summary=excluded.summary,health=excluded.health,
    status=excluded.status,start_date=excluded.start_date,due_date=excluded.due_date,
    next_action=excluded.next_action,withdrawn_at=null;
  insert into public.client_portal_items(
    organization_id,project_id,source_type,source_id,item_type,title,summary,status,
    payload,released_by,withdrawn_at
  ) values(p_organization_id,c.project_id,'deliverable_version',p_deliverable_version_id,
    'deliverable',c.title,coalesce(c.change_summary,''),'ready_for_review',
    jsonb_build_object('deliverable_id',c.deliverable_id,'version_number',c.version_number,
      'file_id',c.file_id,'preview_url',c.preview_metadata->>'preview_url',
      'client_approval_required',coalesce(p_client_approval_required,false)),actor,null)
  on conflict(project_id,source_type,source_id) do update set title=excluded.title,
    summary=excluded.summary,status=excluded.status,payload=excluded.payload,
    released_by=excluded.released_by,released_at=now(),withdrawn_at=null;
  insert into public.approvals(
    organization_id,project_id,deliverable_id,deliverable_version_id,
    approval_type,decision,rationale,decided_by
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    'release','approved','Released through P7 governed action.',actor);
  update public.deliverable_versions set review_status='client_reviewing',
    client_released_at=coalesce(client_released_at,now()),
    client_approval_required=coalesce(p_client_approval_required,false),state_version=state_version+1
  where id=p_deliverable_version_id returning state_version into next_version;
  update public.deliverables set client_released_version_id=p_deliverable_version_id,
    status='client_reviewing',visibility='client_visible' where id=c.deliverable_id;
  insert into public.deliverable_lifecycle_events(
    organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
    client_id,event_type,actor_id,actor_kind,metadata
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    c.workstream_id,c.client_id,'released',actor,'team',
    jsonb_build_object('client_approval_required',coalesce(p_client_approval_required,false)));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,
    'state_version',next_version,'review_status','client_reviewing');
  return private.p7_record(p_organization_id,actor,'release',p_request_id,checksum,result);
end; $$;

create function public.decide_governed_deliverable_version(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_decision text,p_rationale text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; membership record; checksum text;
  replay jsonb; result jsonb; next_status text; next_version bigint;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
  if p_decision not in ('approved','changes_required') then raise exception 'Unsupported client decision.' using errcode='22023'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'decision',p_decision,'rationale',coalesce(p_rationale,''))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':client:'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,'client_decision',p_request_id,checksum); if replay is not null then return replay; end if;
  select v.*,d.workstream_id,p.client_id into c from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before deciding.' using errcode='40001'; end if;
  if c.review_status<>'client_reviewing' then raise exception 'Version is not awaiting a client decision.' using errcode='23514'; end if;
  if not coalesce((select (settings->>'client_approvals_enabled')::boolean from public.organizations where id=p_organization_id and status='active'),false) then raise exception 'Client approvals are disabled.' using errcode='42501'; end if;
  select role,member_kind into membership from public.organization_memberships
  where organization_id=p_organization_id and user_id=actor and status='active';
  if not found or membership.member_kind<>'client' or membership.role not in ('client_admin','client_approver') or not exists(
    select 1 from public.client_contacts contact
    join public.project_client_access access on access.client_contact_id=contact.id
      and access.project_id=c.project_id and access.organization_id=p_organization_id
    where contact.organization_id=p_organization_id and contact.client_id=c.client_id
      and contact.auth_user_id=actor and contact.status='active'
      and contact.portal_role in ('admin','approver') and access.status='active'
      and access.access_role in ('admin','approver')
  ) then raise exception 'Exact-project client approver access required.' using errcode='42501'; end if;
  next_status:=case when p_decision='approved' then 'client_approved' else 'revision_requested' end;
  insert into public.approvals(
    organization_id,project_id,deliverable_id,deliverable_version_id,
    approval_type,decision,rationale,decided_by
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    'client_approval',p_decision,left(coalesce(p_rationale,''),4000),actor);
  perform set_config('anka.p7_governed_action','allowed',true);
  update public.deliverable_versions set review_status=next_status,state_version=state_version+1
  where id=p_deliverable_version_id returning state_version into next_version;
  update public.deliverables set status=case when p_decision='approved' then 'client_approved' else 'revision_requested' end where id=c.deliverable_id;
  update public.client_portal_items set status=next_status
  where project_id=c.project_id and source_type='deliverable_version'
    and source_id=p_deliverable_version_id and withdrawn_at is null;
  insert into public.deliverable_lifecycle_events(
    organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
    client_id,event_type,actor_id,actor_kind,metadata
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    c.workstream_id,c.client_id,case when p_decision='approved' then 'client_approved' else 'client_changes_required' end,
    actor,'client',jsonb_build_object('rationale',left(coalesce(p_rationale,''),4000)));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,
    'state_version',next_version,'review_status',next_status);
  return private.p7_record(p_organization_id,actor,'client_decision',p_request_id,checksum,result);
end; $$;

create function private.p7_terminal_event(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,
  p_event_type text,p_metadata jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c record; checksum text; replay jsonb; result jsonb;
  feature_enabled boolean; approved boolean; next_version bigint;
begin
  if actor is null or p_request_id is null then raise exception 'Authentication and request id are required.' using errcode='42501'; end if;
  if p_event_type not in ('delivered','published') then raise exception 'Unsupported terminal event.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_metadata,'{}'::jsonb))<>'object' then raise exception 'Event metadata must be an object.' using errcode='22023'; end if;
  checksum:=encode(extensions.digest(convert_to(jsonb_build_object('version_id',p_deliverable_version_id,'expected_state_version',p_expected_state_version,'event_type',p_event_type,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':'||p_event_type||':'||p_request_id::text,0));
  replay:=private.p7_replay(p_organization_id,actor,p_event_type,p_request_id,checksum); if replay is not null then return replay; end if;
  select v.*,d.workstream_id,p.client_id into c from public.deliverable_versions v
  join public.deliverables d on d.id=v.deliverable_id and d.project_id=v.project_id and d.organization_id=v.organization_id
  join public.projects p on p.id=v.project_id and p.organization_id=v.organization_id
  where v.id=p_deliverable_version_id and v.organization_id=p_organization_id for update of v;
  if not found then raise exception 'Exact deliverable version not found.' using errcode='P0002'; end if;
  if c.state_version<>p_expected_state_version then raise exception 'Deliverable version changed; reload before closure.' using errcode='40001'; end if;
  if not private.p7_release_authority(p_organization_id,c.project_id,actor) then raise exception 'Release authority required.' using errcode='42501'; end if;
  if not exists(select 1 from public.deliverable_lifecycle_events where deliverable_version_id=p_deliverable_version_id and event_type='released') then raise exception 'Exact version must be released first.' using errcode='23514'; end if;
  if exists(select 1 from public.deliverable_lifecycle_events where deliverable_version_id=p_deliverable_version_id and event_type=p_event_type) then raise exception 'This exact terminal event is already recorded; reuse the original request id.' using errcode='23505'; end if;
  select coalesce((settings->>'client_approvals_enabled')::boolean,false) into feature_enabled from public.organizations where id=p_organization_id and status='active';
  select exists(select 1 from public.approvals where deliverable_version_id=p_deliverable_version_id and approval_type='client_approval' and decision='approved') into approved;
  if c.client_approval_required and feature_enabled and not approved then raise exception 'Exact-version client approval is required before closure.' using errcode='23514'; end if;
  if c.review_status not in ('client_reviewing','client_approved','delivered_published') then raise exception 'Version is not eligible for closure evidence.' using errcode='23514'; end if;
  perform set_config('anka.p7_governed_action','allowed',true);
  update public.deliverable_versions set review_status='delivered_published',state_version=state_version+1
  where id=p_deliverable_version_id returning state_version into next_version;
  update public.deliverables set status='delivered_published' where id=c.deliverable_id;
  update public.client_portal_items set status='delivered_published'
  where project_id=c.project_id and source_type='deliverable_version'
    and source_id=p_deliverable_version_id and withdrawn_at is null;
  insert into public.deliverable_lifecycle_events(
    organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
    client_id,event_type,actor_id,actor_kind,metadata
  ) values(p_organization_id,c.project_id,c.deliverable_id,p_deliverable_version_id,
    c.workstream_id,c.client_id,p_event_type,actor,'team',coalesce(p_metadata,'{}'::jsonb));
  result:=jsonb_build_object('deliverable_version_id',p_deliverable_version_id,
    'state_version',next_version,'review_status','delivered_published','event_type',p_event_type);
  return private.p7_record(p_organization_id,actor,p_event_type,p_request_id,checksum,result);
end; $$;

create function public.mark_governed_deliverable_delivered(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,p_metadata jsonb,p_request_id uuid
) returns jsonb language sql security definer set search_path='' as $$
select private.p7_terminal_event($1,$2,$3,'delivered',$4,$5); $$;
create function public.mark_governed_deliverable_published(
  p_organization_id uuid,p_deliverable_version_id uuid,p_expected_state_version bigint,p_metadata jsonb,p_request_id uuid
) returns jsonb language sql security definer set search_path='' as $$
select private.p7_terminal_event($1,$2,$3,'published',$4,$5); $$;

-- Legacy merged status means delivered plus an explicit legacy marker; it never
-- manufactures a publication fact.
insert into public.deliverable_lifecycle_events(
  organization_id,project_id,deliverable_id,deliverable_version_id,workstream_id,
  client_id,event_type,actor_id,actor_kind,metadata,occurred_at
)
select v.organization_id,v.project_id,v.deliverable_id,v.id,d.workstream_id,p.client_id,
  e.event_type,null,'legacy',jsonb_build_object('source_status','delivered_published'),v.created_at
from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id
join public.projects p on p.id=v.project_id
cross join(values('delivered'::text),('legacy_status_marker'::text)) e(event_type)
where v.review_status='delivered_published' on conflict do nothing;

revoke insert,update,delete on public.deliverable_versions from authenticated;
revoke insert,update,delete on public.approvals from authenticated;
revoke insert,update,delete on public.client_portal_items from authenticated;

revoke all on function private.p7_reject_history_mutation() from public,anon,authenticated;
revoke all on function private.p7_replay(uuid,uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function private.p7_record(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.p7_team(uuid,uuid) from public,anon,authenticated;
revoke all on function private.p7_release_authority(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.p7_assignment_authority(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function private.p7_eligible_reviewer(uuid,uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.p7_set_assignment(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.p7_guard_deliverable_governance() from public,anon,authenticated;
revoke all on function private.p7_terminal_event(uuid,uuid,bigint,text,jsonb,uuid) from public,anon,authenticated;

revoke all on function public.get_deliverable_version_capabilities(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_deliverable_reviewer_candidates(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_governed_deliverable_version(uuid,uuid,text,text,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.submit_governed_deliverable_version(uuid,uuid,bigint,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.assign_governed_deliverable_reviewer(uuid,uuid,bigint,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.review_governed_deliverable_version(uuid,uuid,bigint,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.release_governed_deliverable_version(uuid,uuid,bigint,boolean,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.decide_governed_deliverable_version(uuid,uuid,bigint,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mark_governed_deliverable_delivered(uuid,uuid,bigint,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mark_governed_deliverable_published(uuid,uuid,bigint,jsonb,uuid) from public,anon,authenticated,service_role;

grant execute on function public.get_deliverable_version_capabilities(uuid,uuid) to authenticated;
grant execute on function public.list_deliverable_reviewer_candidates(uuid,uuid) to authenticated;
grant execute on function public.create_governed_deliverable_version(uuid,uuid,text,text,uuid,jsonb,boolean,uuid) to authenticated;
grant execute on function public.submit_governed_deliverable_version(uuid,uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.assign_governed_deliverable_reviewer(uuid,uuid,bigint,uuid,text,uuid) to authenticated;
grant execute on function public.review_governed_deliverable_version(uuid,uuid,bigint,text,text,jsonb,uuid) to authenticated;
grant execute on function public.release_governed_deliverable_version(uuid,uuid,bigint,boolean,text,uuid) to authenticated;
grant execute on function public.decide_governed_deliverable_version(uuid,uuid,bigint,text,text,uuid) to authenticated;
grant execute on function public.mark_governed_deliverable_delivered(uuid,uuid,bigint,jsonb,uuid) to authenticated;
grant execute on function public.mark_governed_deliverable_published(uuid,uuid,bigint,jsonb,uuid) to authenticated;

comment on table public.deliverable_action_requests is 'P7 content-free exact-replay/conflict ledger for governed deliverable actions.';
comment on table public.deliverable_lifecycle_events is 'P7 append-only exact-version lifecycle evidence; delivered and published are independent facts.';
commit;
