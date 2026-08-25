-- Anka Sphere OS - Phase 2 / Migration 8
-- Canonical activity capture, living-record updates, and recipient-only notifications.

begin;

alter table public.notifications
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict,
  add column if not exists project_id uuid
    references public.projects(id) on delete cascade,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists action_url text,
  add column if not exists read_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists archived_at timestamptz;

update public.notifications
set organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
where organization_id is null;

update public.notifications set read_at = created_at where read = true and read_at is null;

alter table public.notifications
  alter column organization_id set default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid,
  alter column organization_id set not null,
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'info', 'task_assigned', 'task_status', 'request_assigned',
    'request_status', 'review_required', 'client_revision',
    'client_message', 'project_update', 'system'
  ));

create index if not exists idx_notifications_recipient_unread
  on public.notifications(user_id, created_at desc)
  where read = false and archived_at is null;
create index if not exists idx_notifications_project
  on public.notifications(project_id, created_at desc)
  where project_id is not null and archived_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Users can delete own notifications" on public.notifications;
drop policy if exists "Authenticated users can create notifications" on public.notifications;

create policy "Recipients can read own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id and archived_at is null);

create policy "Recipients can update own notification state"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id and archived_at is null)
  with check ((select auth.uid()) = user_id);

revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

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
      and membership.organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
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

revoke all on function private.capture_delivery_activity()
  from public, anon, authenticated;
grant execute on function private.capture_delivery_activity()
  to service_role;

drop policy if exists "Team can record activity events" on public.activity_events;
revoke insert on public.activity_events from authenticated;

drop trigger if exists trg_capture_project_activity on public.projects;
drop trigger if exists trg_record_project_activity on public.projects;
create trigger trg_record_project_activity
after insert or update of status, health, owner_id, due_date on public.projects
for each row execute function private.capture_delivery_activity();

drop trigger if exists trg_capture_task_activity on public.tasks;
create trigger trg_capture_task_activity
after insert or update of status, assigned_to, due_date on public.tasks
for each row execute function private.capture_delivery_activity();

drop trigger if exists trg_capture_request_activity on public.requests;
create trigger trg_capture_request_activity
after insert or update of status, owner_id, resolution on public.requests
for each row execute function private.capture_delivery_activity();

drop trigger if exists trg_capture_deliverable_version_activity on public.deliverable_versions;
create trigger trg_capture_deliverable_version_activity
after insert or update of review_status on public.deliverable_versions
for each row execute function private.capture_delivery_activity();

drop trigger if exists trg_capture_comment_activity on public.comments;
create trigger trg_capture_comment_activity
after insert on public.comments
for each row execute function private.capture_delivery_activity();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

commit;
