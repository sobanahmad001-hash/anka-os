-- Anka OS - deliberately minimal Development Studio tracking.
-- Reuses the Operating Spine stage rows and immutable artifact history. This
-- migration creates no task, repository, deployment, or client-portal model.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.engagement_stage_instances
  add column team_notes text not null default '';

alter table public.engagement_stage_instances
  drop constraint engagement_stage_instances_status_check;

alter table public.engagement_stage_instances
  add constraint engagement_stage_instances_status_check
  check (status in (
    'planned', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled',
    'not_started', 'complete'
  ));

alter table public.artifacts
  drop constraint artifacts_artifact_type_check;

alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'discovery',
    'vision',
    'audience',
    'website_architecture',
    'keyword_strategy',
    'content',
    'campaign_messaging',
    'scripts',
    'channel_strategy',
    'campaign_brief',
    'measurement_plan',
    'marketing_report',
    'technical_brief',
    'launch_checklist'
  ));

alter table public.engagement_events
  drop constraint engagement_events_event_type_check;

alter table public.engagement_events
  add constraint engagement_events_event_type_check
  check (event_type in (
    'engagement_created',
    'service_activated',
    'blueprint_instantiated',
    'artifact_version_created',
    'artifact_approved',
    'design_direction_released',
    'campaign_created',
    'campaign_updated',
    'artifact_draft_proposed_via_chat',
    'stage_status_changed'
  ));

create or replace function public.update_development_stage_tracking(
  p_stage_id uuid,
  p_status text,
  p_notes text,
  p_actor_id uuid
)
returns public.engagement_stage_instances
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.engagement_stage_instances;
  v_after public.engagement_stage_instances;
begin
  if p_status not in ('not_started', 'in_progress', 'blocked', 'complete') then
    raise exception 'Unsupported Development stage status.';
  end if;

  select stage.* into v_before
  from public.engagement_stage_instances stage
  where stage.id = p_stage_id
    and stage.accountable_department_id = 'development'
  for update;

  if not found then
    raise exception 'Development stage not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_before.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  update public.engagement_stage_instances stage
  set status = p_status,
      team_notes = left(coalesce(p_notes, ''), 12000)
  where stage.id = p_stage_id
  returning stage.* into v_after;

  if v_before.status is distinct from v_after.status then
    insert into public.engagement_events (
      organization_id, engagement_id, event_type, actor_id, payload
    ) values (
      v_after.organization_id,
      v_after.engagement_id,
      'stage_status_changed',
      p_actor_id,
      jsonb_build_object(
        'record_type', 'engagement_stage_instance',
        'record_id', v_after.id,
        'action', 'status_changed',
        'department_id', 'development',
        'previous_status', v_before.status,
        'status', v_after.status
      )
    );
  end if;

  return v_after;
end;
$$;

create or replace function public.save_development_artifact_version(
  p_engagement_id uuid,
  p_stage_id uuid,
  p_artifact_id uuid,
  p_artifact_type text,
  p_title text,
  p_content jsonb,
  p_change_summary text,
  p_data_classification text,
  p_ai_use_allowed boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_engagement public.engagements;
  v_artifact public.artifacts;
  v_latest public.artifact_versions;
  v_version public.artifact_versions;
begin
  if p_artifact_type not in ('technical_brief', 'launch_checklist') then
    raise exception 'Unsupported Development artifact type.';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Development artifact content must be an object.';
  end if;
  if p_data_classification not in ('public', 'internal', 'confidential', 'restricted') then
    raise exception 'Unsupported data classification.';
  end if;

  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.id = p_engagement_id;

  if not found or not exists (
    select 1
    from public.engagement_services engagement_service
    join public.service_catalog service
      on service.id = engagement_service.service_id
     and service.organization_id = engagement_service.organization_id
    where engagement_service.engagement_id = v_engagement.id
      and engagement_service.organization_id = v_engagement.organization_id
      and engagement_service.status = 'active'
      and service.department_id = 'development'
  ) then
    raise exception 'This engagement has no active Development service.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_engagement.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  if p_stage_id is not null and not exists (
    select 1
    from public.engagement_stage_instances stage
    where stage.id = p_stage_id
      and stage.organization_id = v_engagement.organization_id
      and stage.engagement_id = v_engagement.id
      and stage.accountable_department_id = 'development'
  ) then
    raise exception 'Development stage does not match this engagement.';
  end if;

  if p_artifact_id is null then
    insert into public.artifacts (
      organization_id, brand_id, engagement_id, engagement_stage_instance_id,
      artifact_type, title, created_by
    ) values (
      v_engagement.organization_id,
      v_engagement.brand_id,
      v_engagement.id,
      p_stage_id,
      p_artifact_type,
      left(coalesce(nullif(trim(p_title), ''), replace(p_artifact_type, '_', ' ')), 240),
      p_actor_id
    ) returning * into v_artifact;
  else
    select artifact.* into v_artifact
    from public.artifacts artifact
    where artifact.id = p_artifact_id
      and artifact.organization_id = v_engagement.organization_id
      and artifact.engagement_id = v_engagement.id
      and artifact.brand_id = v_engagement.brand_id
      and artifact.artifact_type = p_artifact_type;

    if not found then
      raise exception 'Development artifact does not match this engagement and type.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_artifact.id::text, 0));

  select version.* into v_latest
  from public.artifact_versions version
  where version.artifact_id = v_artifact.id
  order by version.version_number desc
  limit 1;

  insert into public.artifact_versions (
    organization_id, artifact_id, version_number, parent_version_id, content,
    content_checksum, change_summary, ai_use_allowed, data_classification,
    created_by
  ) values (
    v_engagement.organization_id,
    v_artifact.id,
    coalesce(v_latest.version_number, 0) + 1,
    v_latest.id,
    p_content,
    encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'),
    left(coalesce(p_change_summary, ''), 1000),
    coalesce(p_ai_use_allowed, false),
    p_data_classification,
    p_actor_id
  ) returning * into v_version;

  insert into public.engagement_events (
    organization_id, engagement_id, event_type, actor_id, payload
  ) values (
    v_engagement.organization_id,
    v_engagement.id,
    'artifact_version_created',
    p_actor_id,
    jsonb_build_object(
      'record_type', 'artifact',
      'record_id', v_artifact.id,
      'version_id', v_version.id,
      'action', 'version_created',
      'artifact_type', v_artifact.artifact_type,
      'source', 'manual',
      'ai_run_id', null
    )
  );

  return jsonb_build_object('artifact_id', v_artifact.id, 'version', to_jsonb(v_version));
end;
$$;

revoke all on function public.update_development_stage_tracking(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.save_development_artifact_version(
  uuid, uuid, uuid, text, text, jsonb, text, text, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.update_development_stage_tracking(uuid, text, text, uuid)
  to service_role;
grant execute on function public.save_development_artifact_version(
  uuid, uuid, uuid, text, text, jsonb, text, text, boolean, uuid
) to service_role;

comment on column public.engagement_stage_instances.team_notes is
  'Concise internal stage tracking notes; not a task, ticket, or code system of record.';
comment on function public.update_development_stage_tracking(uuid, text, text, uuid) is
  'Service-role-only atomic Development stage status and audit write.';
comment on function public.save_development_artifact_version(
  uuid, uuid, uuid, text, text, jsonb, text, text, boolean, uuid
) is 'Service-role-only atomic Development artifact version and audit write.';

commit;
