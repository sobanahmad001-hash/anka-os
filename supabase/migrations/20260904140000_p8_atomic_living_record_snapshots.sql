-- TEMPORARY ORDERING: rename after P5/P7 migration identities are fixed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fail closed before adding tenant-chain constraints.
do $$
begin
  if exists (
    select 1
    from public.living_project_documents document
    join public.projects project on project.id = document.project_id
    where document.organization_id <> project.organization_id
  ) then
    raise exception 'P8 preflight: living project document tenant mismatch';
  end if;
  if exists (
    select 1
    from public.living_project_document_snapshots snapshot
    left join public.living_project_documents document
      on document.id = snapshot.living_project_document_id
    left join public.projects project on project.id = snapshot.project_id
    where document.id is null or project.id is null
      or snapshot.organization_id <> document.organization_id
      or snapshot.project_id <> document.project_id
      or snapshot.organization_id <> project.organization_id
  ) then
    raise exception 'P8 preflight: living project snapshot tenant/project/document mismatch';
  end if;
end;
$$;

alter table public.living_project_documents
  add constraint living_project_documents_id_project_organization_key
  unique (id, project_id, organization_id);
alter table public.living_project_documents
  add constraint living_project_documents_project_organization_fkey
  foreign key (project_id, organization_id)
  references public.projects(id, organization_id) on delete cascade;

alter table public.living_project_document_snapshots
  add constraint living_project_snapshots_id_organization_key
  unique (id, organization_id);
alter table public.living_project_document_snapshots
  add constraint living_project_snapshots_document_project_organization_fkey
  foreign key (living_project_document_id, project_id, organization_id)
  references public.living_project_documents(id, project_id, organization_id) on delete restrict;
alter table public.living_project_document_snapshots
  add constraint living_project_snapshots_project_organization_fkey
  foreign key (project_id, organization_id)
  references public.projects(id, organization_id) on delete restrict;

create table private.living_project_snapshot_requests (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, requested_by, request_id),
  foreign key (snapshot_id, organization_id)
    references public.living_project_document_snapshots(id, organization_id) on delete restrict
);
alter table private.living_project_snapshot_requests enable row level security;
revoke all on table private.living_project_snapshot_requests from public, anon, authenticated, service_role;

create function private.build_living_project_snapshot_projection(
  p_organization_id uuid,
  p_project_id uuid,
  p_projection_kind text,
  p_source_version bigint,
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_projection jsonb;
begin
  select project.* into strict v_project
  from public.projects project
  where project.id = p_project_id and project.organization_id = p_organization_id;

  if p_projection_kind = 'internal' then
    select jsonb_build_object(
      'schema_version', 1,
      'projection_kind', 'internal',
      'generated_at', p_generated_at,
      'source_version', p_source_version,
      'project', jsonb_strip_nulls(jsonb_build_object(
        'id', v_project.id, 'name', v_project.name, 'engagement_type', v_project.engagement_type,
        'status', v_project.status, 'health', v_project.health, 'priority', v_project.priority,
        'start_date', v_project.start_date, 'due_date', v_project.due_date,
        'description', v_project.description, 'scope_statement', v_project.scope_statement,
        'exclusions', v_project.exclusions, 'client_id', v_project.client_id, 'owner_id', v_project.owner_id
      )),
      'progress', jsonb_build_object(
        'workstreams', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.workstreams row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'tasks', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.tasks row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'milestones', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.milestones row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'deliverables', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.deliverables row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'requests', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.requests row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb)
      ),
      'workstreams', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'department_id', row.department_id, 'name', row.name,
        'status', row.status, 'owner_id', row.owner_id
      )) order by row.created_at, row.id) from public.workstreams row
        where row.organization_id = p_organization_id and row.project_id = p_project_id), '[]'::jsonb),
      'tasks', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'workstream_id', row.workstream_id, 'title', row.title,
        'description', row.description, 'status', row.status, 'priority', row.priority,
        'due_date', row.due_date, 'assigned_to', row.assigned_to,
        'acceptance_criteria', row.acceptance_criteria, 'completion_evidence', row.completion_evidence
      )) order by row.created_at, row.id) from public.tasks row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'dependencies', coalesce((select jsonb_agg(jsonb_strip_nulls(to_jsonb(row)) order by row.created_at, row.id)
        from public.task_dependencies row
        join public.tasks task on task.id = row.task_id
          and task.organization_id = row.organization_id and task.project_id = p_project_id
        join public.tasks prerequisite on prerequisite.id = row.depends_on_task_id
          and prerequisite.organization_id = row.organization_id and prerequisite.project_id = p_project_id
        where row.organization_id = p_organization_id), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'name', row.name, 'description', row.description, 'status', row.status,
        'target_date', row.target_date, 'completed_at', row.completed_at
      )) order by row.position::text, row.id) from public.milestones row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'research', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'workstream_id', row.workstream_id, 'research_type', row.research_type,
        'title', row.title, 'question', row.question, 'findings', row.findings,
        'recommendation', row.recommendation, 'sources', row.sources,
        'confidence', row.confidence, 'status', row.status
      )) order by row.updated_at desc nulls last, row.id) from public.research_records row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', deliverable.id, 'workstream_id', deliverable.workstream_id, 'title', deliverable.title,
        'deliverable_type', deliverable.deliverable_type, 'status', deliverable.status,
        'due_date', deliverable.due_date, 'versions', coalesce((select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', version.id, 'version_number', version.version_number, 'title', version.title,
            'change_summary', version.change_summary, 'review_status', version.review_status,
            'created_at', version.created_at
          )) order by version.version_number::text, version.id)
          from public.deliverable_versions version
          where version.organization_id = p_organization_id
            and version.project_id = p_project_id and version.deliverable_id = deliverable.id
        ), '[]'::jsonb)
      )) order by deliverable.updated_at desc nulls last, deliverable.id) from public.deliverables deliverable
        where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
          and deliverable.archived_at is null), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'request_type', row.request_type, 'request_origin', row.request_origin,
        'title', row.title, 'requested_output', row.requested_output, 'status', row.status,
        'priority', row.priority, 'required_by', row.required_by, 'owner_id', row.owner_id
      )) order by row.updated_at desc nulls last, row.id) from public.requests row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(event.payload order by event.occurred_at desc, event.id desc)
        from (select row.id, row.occurred_at, jsonb_strip_nulls(jsonb_build_object(
          'id', row.id, 'action', row.action, 'target_type', row.target_type,
          'target_id', row.target_id, 'metadata', row.metadata,
          'summary', initcap(replace(replace(row.action, '_', ' '), '.', ' ')),
          'actor_id', row.actor_id, 'occurred_at', row.occurred_at
        )) payload from public.activity_events row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
        order by row.occurred_at desc, row.id desc limit 50) event), '[]'::jsonb),
      'recent_activity_is_complete', false
    ) into v_projection;
  elsif p_projection_kind = 'client' then
    select jsonb_build_object(
      'schema_version', 1,
      'projection_kind', 'client',
      'generated_at', p_generated_at,
      'source_version', p_source_version,
      'project', jsonb_strip_nulls(jsonb_build_object(
        'id', v_project.id, 'name', v_project.name, 'engagement_type', v_project.engagement_type,
        'status', v_project.status, 'health', v_project.health, 'priority', v_project.priority,
        'start_date', v_project.start_date, 'due_date', v_project.due_date,
        'summary', v_project.client_summary
      )),
      'progress', jsonb_build_object(
        'visible_workstreams', (select count(*) from public.workstreams row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.client_visible = true),
        'completed_milestones', (select count(*) from public.milestones row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.archived_at is null and row.status = 'completed'
            and row.visibility in ('client_visible', 'client_restricted')),
        'released_deliverables', (select count(*) from public.deliverables deliverable
          where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
            and deliverable.archived_at is null and exists (
              select 1 from public.deliverable_versions version
              join public.client_portal_items portal
                on portal.organization_id = version.organization_id
               and portal.project_id = version.project_id
               and portal.source_type = 'deliverable_version'
               and portal.source_id = version.id and portal.withdrawn_at is null
              where version.organization_id = p_organization_id and version.project_id = p_project_id
                and version.deliverable_id = deliverable.id
                and version.review_status in ('client_reviewing', 'revision_requested', 'client_approved', 'delivered_published')
            )),
        'open_client_requests', (select count(*) from public.requests row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.archived_at is null and row.visibility = 'client_visible'
            and row.status not in ('completed', 'declined', 'withdrawn'))
      ),
      'workstreams', coalesce((select jsonb_agg(jsonb_build_object(
        'name', row.name, 'status', row.status
      ) order by row.created_at, row.id) from public.workstreams row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.client_visible = true), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', row.name, 'description', row.description, 'status', row.status,
        'target_date', row.target_date, 'completed_at', row.completed_at
      )) order by row.position::text, row.id) from public.milestones row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null and row.visibility in ('client_visible', 'client_restricted')), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', deliverable.id, 'title', deliverable.title, 'deliverable_type', deliverable.deliverable_type,
        'status', deliverable.status, 'due_date', deliverable.due_date,
        'versions', versions.items
      )) order by deliverable.updated_at desc nulls last, deliverable.id)
        from public.deliverables deliverable
        cross join lateral (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', version.id, 'version_number', version.version_number, 'title', version.title,
            'change_summary', version.change_summary, 'review_status', version.review_status,
            'released_at', portal.released_at
          )) order by version.version_number::text, version.id) items
          from public.deliverable_versions version
          join public.client_portal_items portal
            on portal.organization_id = version.organization_id
           and portal.project_id = version.project_id
           and portal.source_type = 'deliverable_version'
           and portal.source_id = version.id and portal.withdrawn_at is null
          where version.organization_id = p_organization_id and version.project_id = p_project_id
            and version.deliverable_id = deliverable.id
            and version.review_status in ('client_reviewing', 'revision_requested', 'client_approved', 'delivered_published')
        ) versions
        where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
          and deliverable.archived_at is null and versions.items is not null), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'request_type', row.request_type, 'title', row.title, 'status', row.status,
        'priority', row.priority, 'required_by', row.required_by, 'resolution_summary', row.resolution
      )) order by row.updated_at desc nulls last, row.id) from public.requests row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null and row.visibility = 'client_visible'), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(event.payload order by event.occurred_at desc, event.id desc)
        from (select row.id, row.occurred_at, jsonb_strip_nulls(jsonb_build_object(
          'action', row.action,
          'summary', initcap(replace(replace(row.action, '_', ' '), '.', ' ')), 'occurred_at', row.occurred_at
        )) payload from public.activity_events row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.visibility = 'client_visible'
        order by row.occurred_at desc, row.id desc limit 25) event), '[]'::jsonb),
      'recent_activity_is_complete', false
    ) into v_projection;
  else
    raise exception 'Projection kind must be internal or client.' using errcode = '22023';
  end if;
  return v_projection;
end;
$$;

create function private.preserve_living_project_snapshot(
  p_organization_id uuid,
  p_project_id uuid,
  p_living_project_document_id uuid,
  p_projection_kind text,
  p_expected_source_version bigint,
  p_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_owner uuid;
  v_document public.living_project_documents%rowtype;
  v_existing_request private.living_project_snapshot_requests%rowtype;
  v_snapshot public.living_project_document_snapshots%rowtype;
  v_generated_at timestamptz := statement_timestamp();
  v_reason text := trim(coalesce(p_reason, 'Manual reporting checkpoint'));
  v_payload_sha256 text;
  v_projection jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  if p_organization_id is null or p_project_id is null or p_living_project_document_id is null
    or p_request_id is null or p_expected_source_version is null then
    raise exception 'Organization, project, document, request, and source version are required.' using errcode = '22023';
  end if;
  if p_projection_kind not in ('internal', 'client') or p_expected_source_version < 1 then
    raise exception 'Invalid projection kind or source version.' using errcode = '22023';
  end if;
  if length(v_reason) = 0 or length(v_reason) > 500 then
    raise exception 'Snapshot reason must contain 1 to 500 characters.' using errcode = '22023';
  end if;

  perform 1 from public.organizations organization
  where organization.id = p_organization_id and organization.status = 'active'
  for share;
  if not found then raise exception 'Active selected organization required.' using errcode = '42501'; end if;

  select membership.role into v_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id and membership.user_id = v_actor
    and membership.member_kind = 'team' and membership.status = 'active'
  for share;
  if not found then raise exception 'Active team membership required.' using errcode = '42501'; end if;

  select project.owner_id into v_owner
  from public.projects project
  where project.id = p_project_id and project.organization_id = p_organization_id
  for share;
  if not found then raise exception 'Project is outside the selected organization.' using errcode = '42501'; end if;
  if v_role not in ('system_owner', 'operations_admin', 'executive')
    and not (v_role = 'project_owner' and v_owner = v_actor) then
    raise exception 'Snapshot preservation requires organization authority or the assigned project owner.' using errcode = '42501';
  end if;

  select document.* into v_document
  from public.living_project_documents document
  where document.id = p_living_project_document_id
    and document.project_id = p_project_id and document.organization_id = p_organization_id
  for update;
  if not found then raise exception 'Living project document chain mismatch.' using errcode = '42501'; end if;
  v_payload_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'project_id', p_project_id,
    'living_project_document_id', p_living_project_document_id,
    'projection_kind', p_projection_kind, 'expected_source_version', p_expected_source_version,
    'reason', v_reason
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_actor::text || ':' || p_request_id::text, 0));

  select request.* into v_existing_request
  from private.living_project_snapshot_requests request
  where request.organization_id = p_organization_id and request.requested_by = v_actor
    and request.request_id = p_request_id;
  if found then
    if v_existing_request.payload_sha256 <> v_payload_sha256 then
      raise exception 'Request id was already used with different inputs.' using errcode = '22023';
    end if;
    select snapshot.* into strict v_snapshot
    from public.living_project_document_snapshots snapshot
    where snapshot.id = v_existing_request.snapshot_id and snapshot.organization_id = p_organization_id;
    return jsonb_build_object('snapshot', to_jsonb(v_snapshot), 'idempotent_replay', true);
  end if;

  if v_document.source_version <> p_expected_source_version then
    raise exception 'Living project document changed; refresh before preserving.' using errcode = '40001';
  end if;

  select snapshot.* into v_snapshot
  from public.living_project_document_snapshots snapshot
  where snapshot.living_project_document_id = p_living_project_document_id
    and snapshot.project_id = p_project_id and snapshot.organization_id = p_organization_id
    and snapshot.projection_kind = p_projection_kind
    and snapshot.source_version = p_expected_source_version
  for share;

  if not found then
    v_projection := private.build_living_project_snapshot_projection(
      p_organization_id, p_project_id, p_projection_kind, p_expected_source_version, v_generated_at);
    if p_projection_kind = 'client' then
      update public.living_project_documents
      set client_projection = v_projection, generated_at = v_generated_at
      where id = p_living_project_document_id and project_id = p_project_id
        and organization_id = p_organization_id;
    else
      update public.living_project_documents
      set internal_projection = v_projection, generated_at = v_generated_at
      where id = p_living_project_document_id and project_id = p_project_id
        and organization_id = p_organization_id;
    end if;
    insert into public.living_project_document_snapshots (
      organization_id, living_project_document_id, project_id, projection_kind,
      source_version, snapshot, reason, generated_by, generated_at
    ) values (
      p_organization_id, p_living_project_document_id, p_project_id, p_projection_kind,
      p_expected_source_version, v_projection, v_reason, v_actor, v_generated_at
    ) returning * into v_snapshot;
  end if;

  insert into private.living_project_snapshot_requests (
    organization_id, requested_by, request_id, payload_sha256, snapshot_id
  ) values (p_organization_id, v_actor, p_request_id, v_payload_sha256, v_snapshot.id);

  return jsonb_build_object('snapshot', to_jsonb(v_snapshot), 'idempotent_replay', false);
end;
$$;

create function public.preserve_living_project_snapshot(
  p_organization_id uuid,
  p_project_id uuid,
  p_living_project_document_id uuid,
  p_projection_kind text,
  p_expected_source_version bigint,
  p_request_id uuid,
  p_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.preserve_living_project_snapshot(
    p_organization_id, p_project_id, p_living_project_document_id,
    p_projection_kind, p_expected_source_version, p_request_id, p_reason
  );
$$;

revoke all on function private.build_living_project_snapshot_projection(uuid, uuid, text, bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.preserve_living_project_snapshot(uuid, uuid, uuid, text, bigint, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.preserve_living_project_snapshot(uuid, uuid, uuid, text, bigint, uuid, text)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.preserve_living_project_snapshot(uuid, uuid, uuid, text, bigint, uuid, text)
  to authenticated;
grant execute on function public.preserve_living_project_snapshot(uuid, uuid, uuid, text, bigint, uuid, text)
  to authenticated;

revoke insert, update on public.living_project_documents from authenticated;
revoke insert on public.living_project_document_snapshots from authenticated;
drop policy if exists "Team can manage living project documents" on public.living_project_documents;
create policy "Team can read living project documents"
  on public.living_project_documents for select to authenticated
  using (public.is_team_organization_member(organization_id));
drop policy if exists "Team can create living project snapshots" on public.living_project_document_snapshots;

comment on function public.preserve_living_project_snapshot(uuid, uuid, uuid, text, bigint, uuid, text) is
  'Atomically preserves a server-generated living project snapshot for an authorized active team member.';
comment on table private.living_project_snapshot_requests is
  'Permanent tenant-scoped idempotency ledger retained with immutable living project snapshots.';

commit;
