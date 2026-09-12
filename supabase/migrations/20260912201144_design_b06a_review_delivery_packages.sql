-- DESIGN B06a - canonical exact-version website/social review packages.
-- artifacts/artifact_versions remain the only package root and version truth.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.artifacts drop constraint artifacts_artifact_type_check;
alter table public.artifacts add constraint artifacts_artifact_type_check check (artifact_type in (
  'discovery','vision','audience','brand_statement','website_architecture','keyword_strategy','content',
  'campaign_messaging','scripts','channel_strategy','campaign_brief','measurement_plan','marketing_report',
  'technical_brief','launch_checklist','design_system','seo_research','design_delivery_package'
));

alter table public.artifact_versions
  add constraint artifact_versions_artifact_id_id_organization_key
  unique (artifact_id, id, organization_id);

alter table public.design_asset_versions
  add constraint design_asset_versions_asset_id_id_organization_key
  unique (asset_id, id, organization_id);

create table public.design_delivery_package_version_contexts (
  artifact_version_id uuid primary key,
  organization_id uuid not null,
  artifact_id uuid not null,
  source_engagement_service_id uuid not null,
  destination_department_id text,
  destination_engagement_service_id uuid,
  project_task_id uuid,
  engagement_work_item_id uuid,
  operation_key text not null check (length(trim(operation_key)) between 8 and 200),
  request_checksum text not null check (request_checksum ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (artifact_id, artifact_version_id, organization_id)
    references public.artifact_versions(artifact_id, id, organization_id) on delete restrict,
  foreign key (source_engagement_service_id, organization_id)
    references public.engagement_services(id, organization_id) on delete restrict,
  foreign key (destination_engagement_service_id, organization_id)
    references public.engagement_services(id, organization_id) on delete restrict,
  foreign key (project_task_id, organization_id)
    references public.tasks(id, organization_id) on delete restrict,
  foreign key (engagement_work_item_id, organization_id)
    references public.work_items(id, organization_id) on delete restrict,
  unique (artifact_version_id, organization_id),
  unique (organization_id, created_by, operation_key),
  check ((project_task_id is not null)::integer + (engagement_work_item_id is not null)::integer = 1),
  check (
    (destination_department_id is null and destination_engagement_service_id is null)
    or
    (destination_department_id in ('content','marketing','development')
      and destination_engagement_service_id is not null)
  )
);

create table public.design_delivery_package_version_assets (
  artifact_version_id uuid not null,
  organization_id uuid not null,
  artifact_id uuid not null,
  design_asset_id uuid not null,
  design_asset_version_id uuid not null,
  position integer not null check (position between 1 and 50),
  usage_role text not null default 'deliverable'
    check (usage_role in ('deliverable','reference')),
  created_at timestamptz not null default now(),
  primary key (artifact_version_id, design_asset_version_id),
  unique (artifact_version_id, position),
  foreign key (artifact_id, artifact_version_id, organization_id)
    references public.artifact_versions(artifact_id, id, organization_id) on delete restrict,
  foreign key (design_asset_id, design_asset_version_id, organization_id)
    references public.design_asset_versions(asset_id, id, organization_id) on delete restrict
);

create index idx_design_delivery_package_context_artifact
  on public.design_delivery_package_version_contexts(organization_id, artifact_id, created_at desc);
create index idx_design_delivery_package_context_task
  on public.design_delivery_package_version_contexts(project_task_id)
  where project_task_id is not null;
create index idx_design_delivery_package_context_work_item
  on public.design_delivery_package_version_contexts(engagement_work_item_id)
  where engagement_work_item_id is not null;
create index idx_design_delivery_package_assets_asset
  on public.design_delivery_package_version_assets(organization_id, design_asset_id, design_asset_version_id);

create or replace function private.validate_design_delivery_package_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_engagement_id uuid;
  v_brand_id uuid;
  v_project_id uuid;
  v_destination_department text;
begin
  select artifact.engagement_id, artifact.brand_id, engagement.project_id
  into v_engagement_id, v_brand_id, v_project_id
  from public.artifact_versions version
  join public.artifacts artifact on artifact.id = version.artifact_id
    and artifact.organization_id = version.organization_id
  join public.engagements engagement on engagement.id = artifact.engagement_id
    and engagement.organization_id = artifact.organization_id
    and engagement.brand_id = artifact.brand_id
  where version.id = new.artifact_version_id
    and version.artifact_id = new.artifact_id
    and version.organization_id = new.organization_id
    and artifact.artifact_type = 'design_delivery_package';
  if not found then raise exception 'Delivery package version must use the canonical Design package artifact type.' using errcode='23514'; end if;

  if not exists (
    select 1 from public.engagement_services service
    join public.service_catalog catalog on catalog.id = service.service_id
      and catalog.organization_id = service.organization_id
    where service.id = new.source_engagement_service_id
      and service.organization_id = new.organization_id
      and service.engagement_id = v_engagement_id
      and service.status = 'active' and catalog.is_active
      and catalog.department_id = 'design'
  ) then raise exception 'Delivery package requires its current active Design service.' using errcode='23514'; end if;

  if new.destination_engagement_service_id is not null then
    select catalog.department_id into v_destination_department
    from public.engagement_services service
    join public.service_catalog catalog on catalog.id = service.service_id
      and catalog.organization_id = service.organization_id
    where service.id = new.destination_engagement_service_id
      and service.organization_id = new.organization_id
      and service.engagement_id = v_engagement_id
      and service.status = 'active' and catalog.is_active;
    if not found or v_destination_department <> new.destination_department_id then
      raise exception 'The downstream destination service is unavailable or inactive.' using errcode='23514';
    end if;
  end if;

  if new.project_task_id is not null and not exists (
    select 1 from public.tasks task where task.id = new.project_task_id
      and task.organization_id = new.organization_id and task.project_id = v_project_id
      and task.archived_at is null
  ) then raise exception 'The package project task is unavailable or outside this project.' using errcode='23514'; end if;
  if new.engagement_work_item_id is not null and not exists (
    select 1 from public.work_items item where item.id = new.engagement_work_item_id
      and item.organization_id = new.organization_id and item.engagement_id = v_engagement_id
      and item.brand_id = v_brand_id and item.deleted_at is null
  ) then raise exception 'The package work item is unavailable or outside this engagement.' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function private.validate_design_delivery_package_asset_reference()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_archived_at timestamptz;
  v_package_engagement_id uuid;
  v_package_brand_id uuid;
begin
  if exists (
    select 1 from public.design_delivery_package_version_contexts context
    where context.artifact_version_id = new.artifact_version_id
      and context.organization_id = new.organization_id
  ) then
    raise exception 'Design delivery package exact-version references are sealed.' using errcode='55000';
  end if;
  select asset.archived_at into v_archived_at
  from public.design_assets asset
  where asset.id = new.design_asset_id and asset.organization_id = new.organization_id
  for key share;
  if not found then raise exception 'Referenced Design asset is unavailable.' using errcode='23514'; end if;
  if v_archived_at is not null then raise exception 'Archived Design assets cannot be added to a delivery package.' using errcode='23514'; end if;

  select artifact.engagement_id, artifact.brand_id
  into v_package_engagement_id, v_package_brand_id
  from public.artifact_versions version
  join public.artifacts artifact on artifact.id = version.artifact_id
    and artifact.organization_id = version.organization_id
  where version.id = new.artifact_version_id and version.artifact_id = new.artifact_id
    and version.organization_id = new.organization_id
    and artifact.artifact_type = 'design_delivery_package';
  if not found then raise exception 'Package asset reference has no canonical package version.' using errcode='23514'; end if;
  if not exists (
    select 1 from public.design_assets asset
    join public.design_asset_versions version on version.asset_id = asset.id
      and version.organization_id = asset.organization_id
    where asset.id = new.design_asset_id and asset.organization_id = new.organization_id
      and asset.engagement_id = v_package_engagement_id and asset.brand_id = v_package_brand_id
      and version.id = new.design_asset_version_id
  ) then raise exception 'Referenced Design asset version is outside this package context.' using errcode='23514'; end if;
  return new;
end;
$$;

create trigger trg_design_delivery_package_context_validate
before insert on public.design_delivery_package_version_contexts
for each row execute function private.validate_design_delivery_package_context();
create trigger trg_design_delivery_package_asset_validate
before insert on public.design_delivery_package_version_assets
for each row execute function private.validate_design_delivery_package_asset_reference();
create trigger trg_design_delivery_package_context_immutable
before update or delete on public.design_delivery_package_version_contexts
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_design_delivery_package_assets_immutable
before update or delete on public.design_delivery_package_version_assets
for each row execute function private.reject_immutable_artifact_history_change();

create or replace function private.reject_design_delivery_package_root_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.artifact_type = 'design_delivery_package' then
    raise exception 'Design delivery package roots are immutable; create a new artifact version.' using errcode='55000';
  end if;
  return old;
end;
$$;
create trigger trg_design_delivery_package_root_immutable
before update or delete on public.artifacts
for each row when (old.artifact_type = 'design_delivery_package')
execute function private.reject_design_delivery_package_root_change();

create or replace function private.guard_design_delivery_package_version_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.artifacts artifact
    where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id
      and artifact.artifact_type = 'design_delivery_package'
  ) and nullif(pg_catalog.current_setting('app.design_delivery_package_version_id',true),'')
      is distinct from new.id::text then
    raise exception 'Design delivery package versions require the canonical atomic save boundary.' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger trg_design_delivery_package_version_insert
before insert on public.artifact_versions
for each row execute function private.guard_design_delivery_package_version_insert();

create or replace function private.assert_design_delivery_package_ready(
  p_artifact_version_id uuid, p_organization_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.design_delivery_package_version_contexts context
    join public.artifact_versions version on version.id = context.artifact_version_id
      and version.organization_id = context.organization_id
    join public.artifacts artifact on artifact.id = version.artifact_id
      and artifact.organization_id = version.organization_id
    where context.artifact_version_id = p_artifact_version_id
      and context.organization_id = p_organization_id
      and artifact.artifact_type = 'design_delivery_package'
  ) then raise exception 'Design delivery package context is unavailable.' using errcode='23514'; end if;
  if exists (
    select 1
    from public.design_delivery_package_version_contexts context
    join public.artifact_versions version on version.id = context.artifact_version_id
      and version.organization_id = context.organization_id
    join public.artifacts artifact on artifact.id = version.artifact_id
      and artifact.organization_id = version.organization_id
    join public.engagements engagement on engagement.id = artifact.engagement_id
      and engagement.organization_id = artifact.organization_id
      and engagement.brand_id = artifact.brand_id
    left join public.organizations organization on organization.id = context.organization_id
      and organization.status = 'active'
    left join public.engagement_services source_service on source_service.id = context.source_engagement_service_id
      and source_service.organization_id = context.organization_id
      and source_service.engagement_id = engagement.id and source_service.status = 'active'
    left join public.service_catalog source_catalog on source_catalog.id = source_service.service_id
      and source_catalog.organization_id = source_service.organization_id
      and source_catalog.department_id = 'design' and source_catalog.is_active
    left join public.tasks task on task.id = context.project_task_id
      and task.organization_id = context.organization_id
      and task.project_id = engagement.project_id and task.archived_at is null
    left join public.work_items item on item.id = context.engagement_work_item_id
      and item.organization_id = context.organization_id
      and item.project_id = engagement.project_id and item.engagement_id = engagement.id
      and item.brand_id = artifact.brand_id and item.deleted_at is null
    where context.artifact_version_id = p_artifact_version_id
      and context.organization_id = p_organization_id
      and (organization.id is null or engagement.status <> 'active'
        or source_service.id is null or source_catalog.id is null
        or (context.project_task_id is not null and task.id is null)
        or (context.engagement_work_item_id is not null and item.id is null))
  ) then raise exception 'The package organization, Design service, or typed work context is no longer active.' using errcode='23514'; end if;
  if not exists (
    select 1 from public.design_delivery_package_version_assets
    where artifact_version_id = p_artifact_version_id and organization_id = p_organization_id
  ) then raise exception 'Design delivery package has no selected exact versions.' using errcode='23514'; end if;
  if exists (
    select 1 from public.design_delivery_package_version_assets reference
    join public.design_assets asset on asset.id = reference.design_asset_id
      and asset.organization_id = reference.organization_id
    join public.design_asset_versions version on version.id = reference.design_asset_version_id
      and version.organization_id = reference.organization_id
    left join storage.objects object on object.bucket_id = version.storage_bucket
      and object.name = version.storage_path
    where reference.artifact_version_id = p_artifact_version_id
      and reference.organization_id = p_organization_id
      and (asset.archived_at is not null or object.id is null
        or object.archived_at is not null or object.is_delete_marker)
  ) then raise exception 'A selected Design object is missing or its asset is inactive.' using errcode='23514'; end if;
  if exists (
    select 1 from public.design_delivery_package_version_contexts context
    left join public.engagement_services service on service.id = context.destination_engagement_service_id
      and service.organization_id = context.organization_id and service.status = 'active'
    left join public.service_catalog catalog on catalog.id = service.service_id
      and catalog.organization_id = service.organization_id and catalog.is_active
    where context.artifact_version_id = p_artifact_version_id
      and context.organization_id = p_organization_id
      and context.destination_engagement_service_id is not null
      and (service.id is null or catalog.department_id is distinct from context.destination_department_id)
  ) then raise exception 'The downstream destination service is no longer active.' using errcode='23514'; end if;
end;
$$;

create or replace function private.guard_design_delivery_package_version_complete()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.artifacts artifact
    where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id
      and artifact.artifact_type = 'design_delivery_package'
  ) then
    perform private.assert_design_delivery_package_ready(new.id, new.organization_id);
  end if;
  return new;
end;
$$;
create constraint trigger trg_design_delivery_package_version_complete
after insert on public.artifact_versions deferrable initially deferred
for each row execute function private.guard_design_delivery_package_version_complete();

create or replace function private.guard_design_delivery_package_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.artifact_versions version
    join public.artifacts artifact on artifact.id = version.artifact_id
      and artifact.organization_id = version.organization_id
    where version.id = new.artifact_version_id and version.organization_id = new.organization_id
      and artifact.artifact_type = 'design_delivery_package'
  ) then
    perform private.assert_design_delivery_package_ready(new.artifact_version_id, new.organization_id);
  end if;
  return new;
end;
$$;
create trigger trg_design_delivery_package_review_ready
before insert on public.artifact_approval_requests
for each row execute function private.guard_design_delivery_package_review();
create trigger trg_design_delivery_package_approval_ready
before insert on public.artifact_approvals
for each row execute function private.guard_design_delivery_package_review();

create or replace function private.reject_referenced_design_asset_archive()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.design_delivery_package_version_assets reference
    where reference.organization_id = old.organization_id and reference.design_asset_id = old.id
  ) then raise exception 'Design assets referenced by delivery packages cannot be archived.' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger trg_design_assets_package_reference_archive_guard
before update of archived_at on public.design_assets
for each row execute function private.reject_referenced_design_asset_archive();

create or replace function public.save_design_delivery_package_version(
  p_organization_id uuid, p_actor_id uuid, p_artifact_id uuid,
  p_engagement_id uuid, p_brand_id uuid, p_source_engagement_service_id uuid,
  p_destination_department_id text, p_destination_engagement_service_id uuid,
  p_project_task_id uuid, p_engagement_work_item_id uuid,
  p_expected_latest_version_id uuid, p_operation_key text, p_request_checksum text,
  p_title text, p_content jsonb, p_content_checksum text, p_asset_version_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_membership record;
  v_artifact public.artifacts%rowtype;
  v_latest public.artifact_versions%rowtype;
  v_version public.artifact_versions%rowtype;
  v_replay public.design_delivery_package_version_contexts%rowtype;
  v_asset record;
  v_position integer := 0;
  v_object_count integer := 0;
begin
  if p_organization_id is null or p_actor_id is null or p_engagement_id is null or p_brand_id is null
    or p_source_engagement_service_id is null then raise exception 'Package organization, actor, engagement, brand, and Design service are required.'; end if;
  if length(trim(coalesce(p_title,''))) not between 1 and 240 then raise exception 'Package title is required.'; end if;
  if jsonb_typeof(p_content) <> 'object' or p_content->>'destination_type' not in ('website','social')
    or nullif(trim(p_content->>'usage_instructions'),'') is null
    or p_content_checksum !~ '^[a-f0-9]{64}$' or p_request_checksum !~ '^[a-f0-9]{64}$'
    or length(trim(coalesce(p_operation_key,''))) not between 8 and 200 then
    raise exception 'Package content or replay identity is invalid.';
  end if;
  if cardinality(coalesce(p_asset_version_ids,array[]::uuid[])) not between 1 and 50
    or cardinality(p_asset_version_ids) <> (select count(distinct id) from unnest(p_asset_version_ids) id) then
    raise exception 'Select between 1 and 50 unique exact Design asset versions.';
  end if;
  if (p_project_task_id is not null)::integer + (p_engagement_work_item_id is not null)::integer <> 1 then
    raise exception 'Select exactly one canonical task or work item.';
  end if;

  if not exists (
    select 1 from public.organizations organization
    where organization.id = p_organization_id and organization.status = 'active'
  ) then raise exception 'Active organization required.' using errcode='42501'; end if;

  select role, department_id into v_membership from public.organization_memberships
  where organization_id=p_organization_id and user_id=p_actor_id
    and member_kind='team' and status='active'
  for share;
  if not found or (v_membership.role in ('system_owner','operations_admin','executive')
    or v_membership.department_id='design') is not true then raise exception 'Design department access required.' using errcode='42501'; end if;

  if not exists (
    select 1 from public.engagements engagement
    join public.engagement_services service on service.engagement_id=engagement.id
      and service.organization_id=engagement.organization_id
    join public.service_catalog catalog on catalog.id=service.service_id
      and catalog.organization_id=service.organization_id
    where engagement.id=p_engagement_id and engagement.organization_id=p_organization_id
      and engagement.brand_id=p_brand_id and engagement.status='active'
      and service.id=p_source_engagement_service_id and service.status='active'
      and catalog.department_id='design' and catalog.is_active
  ) then raise exception 'Delivery package requires its current active Design service.' using errcode='23514'; end if;
  if p_project_task_id is not null and not exists (
    select 1 from public.tasks task
    join public.engagements engagement on engagement.project_id=task.project_id
      and engagement.organization_id=task.organization_id
    where task.id=p_project_task_id and task.organization_id=p_organization_id
      and task.archived_at is null and engagement.id=p_engagement_id and engagement.brand_id=p_brand_id
  ) then raise exception 'The package project task is unavailable or outside this project.' using errcode='23514'; end if;
  if p_engagement_work_item_id is not null and not exists (
    select 1 from public.work_items item
    where item.id=p_engagement_work_item_id and item.organization_id=p_organization_id
      and item.engagement_id=p_engagement_id and item.brand_id=p_brand_id and item.deleted_at is null
  ) then raise exception 'The package work item is unavailable or outside this engagement.' using errcode='23514'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text||':'||p_actor_id::text||':'||trim(p_operation_key),0));
  select * into v_replay from public.design_delivery_package_version_contexts
  where organization_id=p_organization_id and created_by=p_actor_id and operation_key=trim(p_operation_key);
  if found then
    if v_replay.request_checksum <> p_request_checksum then
      raise exception 'Operation key was already used for a different package intent.' using errcode='23505';
    end if;
    select * into v_version from public.artifact_versions where id=v_replay.artifact_version_id;
    select * into v_artifact from public.artifacts where id=v_version.artifact_id;
    return jsonb_build_object('artifact',to_jsonb(v_artifact),'version',to_jsonb(v_version),
      'context',to_jsonb(v_replay),'idempotent_replay',true);
  end if;

  for v_asset in
    select asset.id, asset.archived_at
    from public.design_assets asset
    where asset.organization_id=p_organization_id
      and asset.engagement_id=p_engagement_id and asset.brand_id=p_brand_id
      and asset.id in (select version.asset_id from public.design_asset_versions version
        where version.organization_id=p_organization_id and version.id=any(p_asset_version_ids))
    order by asset.id for key share of asset
  loop
    if v_asset.archived_at is not null then raise exception 'Archived Design assets cannot be packaged.' using errcode='23514'; end if;
  end loop;
  if (select count(*) from public.design_asset_versions version
      join public.design_assets asset on asset.id=version.asset_id and asset.organization_id=version.organization_id
      where version.organization_id=p_organization_id and version.id=any(p_asset_version_ids)
        and asset.engagement_id=p_engagement_id and asset.brand_id=p_brand_id)
      <> cardinality(p_asset_version_ids) then
    raise exception 'One or more exact Design asset versions are unavailable in this context.' using errcode='23514';
  end if;
  for v_asset in
    select object.id
    from public.design_asset_versions version
    join storage.objects object on object.bucket_id=version.storage_bucket and object.name=version.storage_path
    where version.organization_id=p_organization_id and version.id=any(p_asset_version_ids)
      and object.archived_at is null and not object.is_delete_marker
    order by object.id for key share of object
  loop
    v_object_count:=v_object_count+1;
  end loop;
  if v_object_count <> cardinality(p_asset_version_ids) then
    raise exception 'A selected Design object is missing or its asset is inactive.' using errcode='23514';
  end if;

  if p_artifact_id is null then
    if p_expected_latest_version_id is not null then raise exception 'New package expected version must be empty.' using errcode='40001'; end if;
    insert into public.artifacts(organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(p_organization_id,p_brand_id,p_engagement_id,'design_delivery_package',trim(p_title),p_actor_id)
    returning * into v_artifact;
  else
    select * into v_artifact from public.artifacts where id=p_artifact_id and organization_id=p_organization_id for update;
    if not found or v_artifact.artifact_type<>'design_delivery_package'
      or v_artifact.engagement_id<>p_engagement_id or v_artifact.brand_id<>p_brand_id then
      raise exception 'Canonical Design delivery package root is unavailable.' using errcode='P0002';
    end if;
  end if;
  select * into v_latest from public.artifact_versions where artifact_id=v_artifact.id
    and organization_id=p_organization_id order by version_number desc limit 1;
  if v_latest.id is distinct from p_expected_latest_version_id then
    raise exception 'Package changed since it was loaded; reload before saving.' using errcode='40001';
  end if;

  v_version.id:=gen_random_uuid();
  perform pg_catalog.set_config('app.design_delivery_package_version_id',v_version.id::text,true);
  insert into public.artifact_versions(id,organization_id,artifact_id,version_number,parent_version_id,
    content,content_checksum,change_summary,created_by)
  values(v_version.id,p_organization_id,v_artifact.id,coalesce(v_latest.version_number,0)+1,v_latest.id,
    p_content,p_content_checksum,'Design delivery package draft',p_actor_id) returning * into v_version;
  for v_asset in
    select version.asset_id, version.id from public.design_asset_versions version
    where version.organization_id=p_organization_id and version.id=any(p_asset_version_ids)
    order by array_position(p_asset_version_ids,version.id)
  loop
    v_position:=v_position+1;
    insert into public.design_delivery_package_version_assets(artifact_version_id,organization_id,artifact_id,
      design_asset_id,design_asset_version_id,position)
    values(v_version.id,p_organization_id,v_artifact.id,v_asset.asset_id,v_asset.id,v_position);
  end loop;
  insert into public.design_delivery_package_version_contexts(artifact_version_id,organization_id,artifact_id,
    source_engagement_service_id,destination_department_id,destination_engagement_service_id,
    project_task_id,engagement_work_item_id,operation_key,request_checksum,created_by)
  values(v_version.id,p_organization_id,v_artifact.id,p_source_engagement_service_id,
    p_destination_department_id,p_destination_engagement_service_id,p_project_task_id,
    p_engagement_work_item_id,trim(p_operation_key),p_request_checksum,p_actor_id)
  returning * into v_replay;
  perform private.assert_design_delivery_package_ready(v_version.id,p_organization_id);
  perform pg_catalog.set_config('app.design_delivery_package_version_id','',true);
  return jsonb_build_object('artifact',to_jsonb(v_artifact),'version',to_jsonb(v_version),
    'context',to_jsonb(v_replay),'idempotent_replay',false);
end;
$$;

revoke all on function public.save_design_delivery_package_version(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid[])
from public, anon, authenticated;
grant execute on function public.save_design_delivery_package_version(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid[])
to service_role;

alter table public.design_delivery_package_version_contexts enable row level security;
alter table public.design_delivery_package_version_assets enable row level security;
create policy "Team can read scoped Design package contexts"
on public.design_delivery_package_version_contexts for select to authenticated
using (public.is_team_organization_member(organization_id));
create policy "Team can read scoped Design package assets"
on public.design_delivery_package_version_assets for select to authenticated
using (public.is_team_organization_member(organization_id));
revoke all on public.design_delivery_package_version_contexts,
  public.design_delivery_package_version_assets from public, anon, authenticated, service_role;
grant select on public.design_delivery_package_version_contexts,
  public.design_delivery_package_version_assets to authenticated;
grant select, insert on public.design_delivery_package_version_contexts,
  public.design_delivery_package_version_assets to service_role;

revoke all on function private.validate_design_delivery_package_context(),
  private.validate_design_delivery_package_asset_reference(),
  private.reject_design_delivery_package_root_change(),
  private.guard_design_delivery_package_version_insert(),
  private.assert_design_delivery_package_ready(uuid,uuid),
  private.guard_design_delivery_package_version_complete(),
  private.guard_design_delivery_package_review(),
  private.reject_referenced_design_asset_archive()
from public, anon, authenticated;
grant execute on function private.validate_design_delivery_package_context(),
  private.validate_design_delivery_package_asset_reference(),
  private.reject_design_delivery_package_root_change(),
  private.guard_design_delivery_package_version_insert(),
  private.assert_design_delivery_package_ready(uuid,uuid),
  private.guard_design_delivery_package_version_complete(),
  private.guard_design_delivery_package_review(),
  private.reject_referenced_design_asset_archive()
to service_role;

comment on table public.design_delivery_package_version_contexts is
  'Narrow immutable exact-work and service linkage for canonical Design package artifact versions; not a second package model.';
comment on table public.design_delivery_package_version_assets is
  'Exact immutable Design asset-version consumers. Rows coordinate with soft archive and never store signed URLs.';
commit;
