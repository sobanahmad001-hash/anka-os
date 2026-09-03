-- Anka OS - QTS4 deliberate promotion into canonical project, work-item, or artifact records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.work_items drop constraint work_items_created_via_check;
alter table public.work_items add constraint work_items_created_via_check
  check (created_via in ('manual', 'ai_chat_proposal', 'automation_rule', 'recurring_plan', 'quick_task_promotion'));

create table public.quick_task_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quick_task_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_revision_id uuid not null,
  source_content_sha256 text not null check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  target_kind text not null check (target_kind in ('project', 'work_item', 'artifact')),
  destination_project_id uuid,
  destination_work_item_id uuid,
  destination_artifact_id uuid,
  destination_artifact_version_id uuid,
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  request_checksum text not null check (request_checksum ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid not null,
  promoted_by uuid not null references auth.users(id) on delete restrict,
  promoted_at timestamptz not null default now(),
  constraint quick_task_promotions_source_task_fkey foreign key (quick_task_id, organization_id, owner_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict,
  constraint quick_task_promotions_source_revision_fkey foreign key (source_revision_id, quick_task_id, organization_id, owner_id)
    references public.quick_task_revisions(id, quick_task_id, organization_id, owner_id) on delete restrict,
  constraint quick_task_promotions_project_fkey foreign key (destination_project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint quick_task_promotions_work_item_fkey foreign key (destination_work_item_id, organization_id)
    references public.work_items(id, organization_id) on delete restrict,
  constraint quick_task_promotions_artifact_fkey foreign key (destination_artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  constraint quick_task_promotions_artifact_version_fkey foreign key (destination_artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  constraint quick_task_promotions_exact_target_check check (
    (target_kind = 'project' and destination_project_id is not null and destination_work_item_id is null and destination_artifact_id is null and destination_artifact_version_id is null)
    or (target_kind = 'work_item' and destination_project_id is null and destination_work_item_id is not null and destination_artifact_id is null and destination_artifact_version_id is null)
    or (target_kind = 'artifact' and destination_project_id is null and destination_work_item_id is null and destination_artifact_id is not null and destination_artifact_version_id is not null)
  ),
  unique (quick_task_id),
  unique (organization_id, idempotency_key)
);

create index idx_quick_task_promotions_owner on public.quick_task_promotions(owner_id, organization_id, promoted_at desc);
create index idx_quick_task_promotions_source_revision on public.quick_task_promotions(source_revision_id, quick_task_id, organization_id, owner_id);
create index idx_quick_task_promotions_project on public.quick_task_promotions(destination_project_id, organization_id) where destination_project_id is not null;
create index idx_quick_task_promotions_work_item on public.quick_task_promotions(destination_work_item_id, organization_id) where destination_work_item_id is not null;
create index idx_quick_task_promotions_artifact on public.quick_task_promotions(destination_artifact_id, organization_id) where destination_artifact_id is not null;
create index idx_quick_task_promotions_artifact_version on public.quick_task_promotions(destination_artifact_version_id, organization_id) where destination_artifact_version_id is not null;

alter table public.quick_task_promotions enable row level security;
create policy "Owners and leaders can read Quick Task promotion metadata"
  on public.quick_task_promotions for select to authenticated
  using (
    (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id))
    or public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive'])
  );
revoke all on table public.quick_task_promotions from public, anon, authenticated;
grant select on table public.quick_task_promotions to authenticated, service_role;
grant all on table public.quick_task_promotions to service_role;

create function private.reject_quick_task_promotion_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Quick Task promotion history is append-only.';
end;
$$;
create trigger trg_quick_task_promotions_append_only
before update or delete on public.quick_task_promotions
for each row execute function private.reject_quick_task_promotion_mutation();

create function public.promote_quick_task(
  p_quick_task_id uuid,
  p_expected_revision_id uuid,
  p_expected_content_sha256 text,
  p_target_kind text,
  p_mapping jsonb,
  p_idempotency_key uuid,
  p_human_confirmed boolean,
  p_actor_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.quick_tasks;
  v_revision public.quick_task_revisions;
  v_promotion public.quick_task_promotions;
  v_project public.projects;
  v_work_item public.work_items;
  v_artifact public.artifacts;
  v_version public.artifact_versions;
  v_engagement public.engagements;
  v_client_id uuid;
  v_owner_id uuid;
  v_assignee_id uuid;
  v_existing_artifact_id uuid;
  v_department_id text;
  v_artifact_type text;
  v_artifact_content jsonb;
  v_content_checksum text;
  v_request_checksum text;
  v_mapping_metadata jsonb := '{}'::jsonb;
  v_created_artifact boolean := false;
begin
  if p_human_confirmed is distinct from true then raise exception 'Explicit human confirmation is required.'; end if;
  if p_target_kind not in ('project', 'work_item', 'artifact') then raise exception 'Unsupported Quick Task promotion target.'; end if;
  if jsonb_typeof(p_mapping) is distinct from 'object' then raise exception 'Promotion mapping must be a JSON object.'; end if;
  if p_expected_content_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Expected content checksum is invalid.'; end if;

  select task.* into v_task from public.quick_tasks task where task.id = p_quick_task_id for update;
  if not found or v_task.owner_id <> p_actor_id then raise exception 'Owned Quick Task not found.'; end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_task.organization_id and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
  ) then raise exception 'Active team membership required.'; end if;

  v_request_checksum := encode(extensions.digest(convert_to(jsonb_build_object(
    'quick_task_id', p_quick_task_id, 'expected_revision_id', p_expected_revision_id,
    'expected_content_sha256', p_expected_content_sha256, 'target_kind', p_target_kind, 'mapping', p_mapping
  )::text, 'UTF8'), 'sha256'), 'hex');

  select promotion.* into v_promotion from public.quick_task_promotions promotion
  where promotion.organization_id = v_task.organization_id and promotion.idempotency_key = p_idempotency_key for share;
  if found then
    if v_promotion.quick_task_id <> p_quick_task_id or v_promotion.source_revision_id <> p_expected_revision_id
      or v_promotion.source_content_sha256 <> p_expected_content_sha256 or v_promotion.target_kind <> p_target_kind
      or v_promotion.request_checksum <> v_request_checksum then
      raise exception 'Idempotency key was already used for a different promotion request.';
    end if;
    return jsonb_build_object(
      'promotion_id', v_promotion.id, 'target_kind', v_promotion.target_kind,
      'project_id', v_promotion.destination_project_id, 'work_item_id', v_promotion.destination_work_item_id,
      'artifact_id', v_promotion.destination_artifact_id, 'artifact_version_id', v_promotion.destination_artifact_version_id,
      'idempotent_replay', true
    );
  end if;

  if v_task.state not in ('active', 'preserved') or v_task.purged_at is not null then raise exception 'Only active or preserved Quick Tasks can be promoted.'; end if;
  if v_task.current_revision_id <> p_expected_revision_id then raise exception 'Quick Task changed; reload before promoting.'; end if;
  select revision.* into v_revision from public.quick_task_revisions revision
  where revision.id = p_expected_revision_id and revision.quick_task_id = v_task.id
    and revision.organization_id = v_task.organization_id and revision.owner_id = v_task.owner_id;
  if not found or v_revision.content_sha256 <> p_expected_content_sha256 then raise exception 'Quick Task revision checksum does not match.'; end if;

  if p_target_kind = 'project' then
    v_client_id := nullif(p_mapping ->> 'client_id', '')::uuid;
    v_owner_id := coalesce(nullif(p_mapping ->> 'owner_id', '')::uuid, p_actor_id);
    if char_length(btrim(coalesce(p_mapping ->> 'name', ''))) not between 1 and 240 then raise exception 'Project name must be between 1 and 240 characters.'; end if;
    if v_client_id is not null and not exists (
      select 1 from public.clients client where client.id = v_client_id and client.organization_id = v_task.organization_id
    ) then raise exception 'Project client does not belong to this organization.'; end if;
    if not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = v_task.organization_id and membership.user_id = v_owner_id
        and membership.member_kind = 'team' and membership.status = 'active'
    ) then raise exception 'Project owner must be an active team member.'; end if;
    insert into public.projects (
      organization_id, client_id, name, description, department_id, engagement_type, status, priority,
      owner_id, start_date, due_date, scope_statement, exclusions, portal_visible
    ) values (
      v_task.organization_id, v_client_id, btrim(p_mapping ->> 'name'), left(coalesce(p_mapping ->> 'description', ''), 20000),
      nullif(p_mapping ->> 'department_id', ''), case when v_client_id is null then 'internal' else 'project' end,
      'planning', coalesce(nullif(p_mapping ->> 'priority', ''), 'medium'), v_owner_id,
      nullif(p_mapping ->> 'start_date', '')::date, nullif(p_mapping ->> 'due_date', '')::date,
      left(coalesce(p_mapping ->> 'scope_statement', ''), 20000), left(coalesce(p_mapping ->> 'exclusions', ''), 20000), false
    ) returning * into v_project;
    v_mapping_metadata := jsonb_strip_nulls(jsonb_build_object(
      'client_id', v_client_id, 'owner_id', v_owner_id, 'department_id', nullif(p_mapping ->> 'department_id', ''),
      'engagement_type', v_project.engagement_type
    ));
  elsif p_target_kind = 'work_item' then
    select engagement.* into v_engagement from public.engagements engagement
    where engagement.id = nullif(p_mapping ->> 'engagement_id', '')::uuid
      and engagement.organization_id = v_task.organization_id and engagement.project_id is not null for share;
    if not found then raise exception 'Eligible engagement not found.'; end if;
    v_assignee_id := nullif(p_mapping ->> 'assignee_id', '')::uuid;
    if v_assignee_id is not null and coalesce((p_mapping ->> 'assignee_confirmed')::boolean, false) is distinct from true then
      raise exception 'The mapped assignee requires explicit confirmation.';
    end if;
    select * into v_work_item from public.save_work_item(
      p_work_item_id => null, p_engagement_id => v_engagement.id, p_title => p_mapping ->> 'title',
      p_description => coalesce(p_mapping ->> 'description', ''),
      p_work_item_type => coalesce(nullif(p_mapping ->> 'work_item_type', ''), 'task'),
      p_priority => coalesce(nullif(p_mapping ->> 'priority', ''), 'medium'), p_status => 'not_started',
      p_assignee_id => v_assignee_id, p_department_id => nullif(p_mapping ->> 'department_id', ''),
      p_linked_artifact_id => null, p_linked_artifact_version_id => null,
      p_linked_engagement_stage_instance_id => null, p_start_date => nullif(p_mapping ->> 'start_date', '')::date,
      p_due_date => nullif(p_mapping ->> 'due_date', '')::date, p_position => 0, p_parent_work_item_id => null,
      p_actor_id => p_actor_id, p_created_via => 'quick_task_promotion'
    );
    v_mapping_metadata := jsonb_strip_nulls(jsonb_build_object(
      'engagement_id', v_engagement.id, 'project_id', v_engagement.project_id, 'brand_id', v_engagement.brand_id,
      'department_id', v_work_item.department_id, 'assignee_id', v_work_item.assignee_id, 'work_item_type', v_work_item.work_item_type
    ));
  else
    v_department_id := nullif(p_mapping ->> 'department_id', '');
    v_artifact_type := nullif(p_mapping ->> 'artifact_type', '');
    v_artifact_content := p_mapping -> 'content';
    if not (
      (v_department_id = 'content' and v_artifact_type in ('discovery', 'vision', 'audience', 'website_architecture', 'keyword_strategy', 'content', 'campaign_messaging', 'scripts'))
      or (v_department_id = 'design' and v_artifact_type = 'design_system')
      or (v_department_id = 'marketing' and v_artifact_type in ('channel_strategy', 'campaign_brief', 'measurement_plan'))
      or (v_department_id = 'development' and v_artifact_type in ('technical_brief', 'launch_checklist'))
    ) then raise exception 'Artifact type is not supported by the selected department.'; end if;
    if jsonb_typeof(v_artifact_content) is distinct from 'object' then raise exception 'Artifact content must be a validated JSON object.'; end if;
    select engagement.* into v_engagement from public.engagements engagement
    where engagement.id = nullif(p_mapping ->> 'engagement_id', '')::uuid
      and engagement.organization_id = v_task.organization_id and engagement.project_id is not null for share;
    if not found then raise exception 'Eligible engagement not found.'; end if;
    if not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = v_task.organization_id and membership.user_id = p_actor_id
        and membership.member_kind = 'team' and membership.status = 'active'
        and (membership.department_id = v_department_id or membership.role in ('system_owner', 'operations_admin', 'executive'))
    ) then raise exception 'Department authority is required for artifact promotion.'; end if;
    if not exists (
      select 1 from public.engagement_services engagement_service
      join public.service_catalog service on service.id = engagement_service.service_id
        and service.organization_id = engagement_service.organization_id
      where engagement_service.engagement_id = v_engagement.id and engagement_service.organization_id = v_task.organization_id
        and engagement_service.status = 'active' and service.department_id = v_department_id and service.is_active
    ) then raise exception 'An active engagement service is required for artifact promotion.'; end if;
    v_existing_artifact_id := nullif(p_mapping ->> 'artifact_id', '')::uuid;
    if v_existing_artifact_id is not null then
      select artifact.* into v_artifact from public.artifacts artifact
      where artifact.id = v_existing_artifact_id and artifact.organization_id = v_task.organization_id
        and artifact.project_id = v_engagement.project_id and artifact.engagement_id = v_engagement.id
        and artifact.brand_id = v_engagement.brand_id and artifact.artifact_type = v_artifact_type for update;
      if not found then raise exception 'Mapped artifact does not match the organization, project, engagement, brand, and type.'; end if;
    else
      if char_length(btrim(coalesce(p_mapping ->> 'title', ''))) not between 1 and 240 then raise exception 'Artifact title must be between 1 and 240 characters.'; end if;
      insert into public.artifacts (
        organization_id, project_id, brand_id, engagement_id, engagement_stage_instance_id, artifact_type, title, created_by
      ) values (
        v_task.organization_id, v_engagement.project_id, v_engagement.brand_id, v_engagement.id,
        null, v_artifact_type, btrim(p_mapping ->> 'title'), p_actor_id
      ) returning * into v_artifact;
      v_created_artifact := true;
    end if;
    v_content_checksum := encode(extensions.digest(convert_to(v_artifact_content::text, 'UTF8'), 'sha256'), 'hex');
    insert into public.artifact_versions (
      organization_id, artifact_id, version_number, parent_version_id, content, content_checksum,
      change_summary, ai_use_allowed, data_classification, created_by
    )
    select v_task.organization_id, v_artifact.id, coalesce(max(version.version_number), 0) + 1,
      (array_agg(version.id order by version.version_number desc))[1], v_artifact_content, v_content_checksum,
      left(coalesce(p_mapping ->> 'change_summary', 'Promoted from Quick Tasks'), 1000), false, 'internal', p_actor_id
    from public.artifact_versions version where version.artifact_id = v_artifact.id
    returning * into v_version;
    insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
    values (
      v_task.organization_id, v_engagement.id, 'artifact_version_created', p_actor_id,
      jsonb_build_object(
        'record_type', 'artifact', 'record_id', v_artifact.id, 'version_id', v_version.id, 'action', 'version_created',
        'artifact_type', v_artifact_type, 'source', 'quick_task_promotion', 'quick_task_id', v_task.id,
        'quick_task_revision_id', v_revision.id, 'created_artifact', v_created_artifact
      )
    );
    v_mapping_metadata := jsonb_build_object(
      'engagement_id', v_engagement.id, 'project_id', v_engagement.project_id, 'brand_id', v_engagement.brand_id,
      'department_id', v_department_id, 'artifact_type', v_artifact_type, 'appended_to_existing_artifact', not v_created_artifact
    );
  end if;

  insert into public.quick_task_promotions (
    organization_id, quick_task_id, owner_id, source_revision_id, source_content_sha256, target_kind,
    destination_project_id, destination_work_item_id, destination_artifact_id, destination_artifact_version_id,
    mapping, request_checksum, idempotency_key, promoted_by
  ) values (
    v_task.organization_id, v_task.id, v_task.owner_id, v_revision.id, v_revision.content_sha256, p_target_kind,
    v_project.id, v_work_item.id, v_artifact.id, v_version.id, v_mapping_metadata, v_request_checksum, p_idempotency_key, p_actor_id
  ) returning * into v_promotion;

  update public.quick_tasks task set
    state = 'promoted', promoted_at = v_promotion.promoted_at, expires_at = null, recoverable_until = null,
    preserved_at = null, discarded_at = null, expired_at = null, updated_at = v_promotion.promoted_at
  where task.id = v_task.id;

  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind, event_type, revision_number, from_state, to_state, reason
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'owner', 'promoted',
    v_revision.revision_number, v_task.state, 'promoted', 'deliberate_' || p_target_kind || '_promotion'
  );

  return jsonb_build_object(
    'promotion_id', v_promotion.id, 'target_kind', v_promotion.target_kind,
    'project_id', v_promotion.destination_project_id, 'work_item_id', v_promotion.destination_work_item_id,
    'artifact_id', v_promotion.destination_artifact_id, 'artifact_version_id', v_promotion.destination_artifact_version_id,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function private.reject_quick_task_promotion_mutation() from public, anon, authenticated;
grant execute on function private.reject_quick_task_promotion_mutation() to service_role;
revoke all on function public.promote_quick_task(uuid, uuid, text, text, jsonb, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.promote_quick_task(uuid, uuid, text, text, jsonb, uuid, boolean, uuid) to service_role;

comment on table public.quick_task_promotions is
  'Append-only, content-free provenance for one deliberate Quick Task promotion into one typed canonical destination.';
comment on column public.quick_task_promotions.mapping is
  'Content-free destination mapping metadata. Full request equality is represented only by request_checksum.';
comment on function public.promote_quick_task(uuid, uuid, text, text, jsonb, uuid, boolean, uuid) is
  'Service-role-only atomic copy from one exact owned Quick Task revision into one canonical destination.';
commit;
