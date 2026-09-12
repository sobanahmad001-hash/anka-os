-- DESIGN B04 - soft archive for standalone uploaded drafts only.
-- Exact versions and Storage objects are retained permanently by this operation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.design_assets
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete restrict,
  add column archive_operation_key text,
  add column archive_reason text;

alter table public.design_assets
  add constraint design_assets_archive_state_complete check (
    (archived_at is null and archived_by is null and archive_operation_key is null and archive_reason is null)
    or
    (archived_at is not null and archived_by is not null and archive_operation_key is not null
      and length(trim(archive_operation_key)) between 8 and 200
      and archive_reason is not null and length(trim(archive_reason)) between 1 and 500)
  );

create unique index design_assets_archive_operation_unique
  on public.design_assets(organization_id, archived_by, archive_operation_key)
  where archive_operation_key is not null;

create index idx_design_assets_active_context
  on public.design_assets(organization_id, engagement_id, brand_id, created_at desc)
  where archived_at is null;

create or replace function private.enforce_design_asset_archive_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.archived_at is not null and (
    new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by
    or new.archive_operation_key is distinct from old.archive_operation_key
    or new.archive_reason is distinct from old.archive_reason
  ) then
    raise exception 'Archived Design asset state is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_design_asset_archive_transition() from public, anon, authenticated;
grant execute on function private.enforce_design_asset_archive_transition() to service_role;

create trigger trg_design_assets_archive_transition
before update of archived_at, archived_by, archive_operation_key, archive_reason on public.design_assets
for each row execute function private.enforce_design_asset_archive_transition();

create or replace function private.reject_archived_design_asset_version_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_archived_at timestamptz;
begin
  select asset.archived_at into v_archived_at
  from public.design_assets asset
  where asset.id = new.asset_id and asset.organization_id = new.organization_id
  for key share;
  if not found then raise exception 'Design asset root is unavailable'; end if;
  if v_archived_at is not null then raise exception 'Archived Design assets cannot receive new versions'; end if;
  return new;
end;
$$;
revoke all on function private.reject_archived_design_asset_version_insert() from public, anon, authenticated;
grant execute on function private.reject_archived_design_asset_version_insert() to service_role;

create trigger trg_design_asset_versions_active_root
before insert on public.design_asset_versions
for each row execute function private.reject_archived_design_asset_version_insert();

create or replace function public.archive_design_asset(
  p_organization_id uuid,
  p_asset_id uuid,
  p_expected_latest_version_id uuid,
  p_operation_key text,
  p_reason text,
  p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_asset public.design_assets%rowtype;
  v_latest public.design_asset_versions%rowtype;
  v_membership record;
  v_version_count integer;
begin
  if p_organization_id is null or p_asset_id is null or p_expected_latest_version_id is null or p_actor_id is null then
    raise exception 'Organization, asset, expected latest version, and actor are required';
  end if;
  if length(trim(coalesce(p_operation_key, ''))) not between 8 and 200 then
    raise exception 'A stable archive operation key of at least 8 characters is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'An archive reason is required';
  end if;

  select role, department_id into v_membership
  from public.organization_memberships
  where organization_id = p_organization_id and user_id = p_actor_id
    and member_kind = 'team' and status = 'active';
  if not found or (
    v_membership.role in ('system_owner', 'operations_admin', 'executive')
    or v_membership.department_id = 'design'
  ) is not true then raise exception 'Design department access required'; end if;

  select * into v_asset from public.design_assets
  where id = p_asset_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'Design asset not found'; end if;

  select * into v_latest from public.design_asset_versions
  where organization_id = p_organization_id and asset_id = p_asset_id
  order by version_number desc limit 1;
  if not found then raise exception 'Design asset has no immutable version history'; end if;

  if v_asset.archived_at is not null then
    if v_asset.archived_by = p_actor_id and v_asset.archive_operation_key = trim(p_operation_key) then
      if v_latest.id <> p_expected_latest_version_id or v_asset.archive_reason <> trim(p_reason) then
        raise exception 'Archive operation key was already used for a different confirmed intent';
      end if;
      return jsonb_build_object('asset', to_jsonb(v_asset), 'idempotent_replay', true,
        'retained_version_count', (select count(*) from public.design_asset_versions
          where organization_id=p_organization_id and asset_id=p_asset_id),
        'storage_objects_deleted', 0);
    end if;
    raise exception 'Design asset is already archived';
  end if;

  if exists (
    select 1 from public.design_assets asset
    where asset.organization_id = p_organization_id and asset.archived_by = p_actor_id
      and asset.archive_operation_key = trim(p_operation_key) and asset.id <> p_asset_id
  ) then raise exception 'Archive operation key was already used for another asset'; end if;

  if v_latest.id <> p_expected_latest_version_id then
    raise exception 'Design asset changed since it was loaded; refresh before archiving' using errcode = '40001';
  end if;

  select count(*) into v_version_count from public.design_asset_versions
  where organization_id = p_organization_id and asset_id = p_asset_id;
  if exists (
    select 1 from public.design_asset_versions version
    where version.organization_id = p_organization_id and version.asset_id = p_asset_id
      and (version.lifecycle_status <> 'draft' or version.source_kind <> 'upload'
        or version.source_media_asset_id is not null or version.source_direction_version_id is not null)
  ) then
    raise exception 'Only standalone uploaded draft assets can be archived; generated, variant, direction-linked, reviewed, approved, released, or otherwise referenced assets remain available';
  end if;

  update public.design_assets set
    archived_at = pg_catalog.clock_timestamp(),
    archived_by = p_actor_id,
    archive_operation_key = trim(p_operation_key),
    archive_reason = trim(p_reason)
  where id = p_asset_id and organization_id = p_organization_id
  returning * into v_asset;

  return jsonb_build_object(
    'asset', to_jsonb(v_asset),
    'idempotent_replay', false,
    'retained_version_count', v_version_count,
    'storage_objects_deleted', 0
  );
end;
$$;

revoke all on function public.archive_design_asset(uuid,uuid,uuid,text,text,uuid)
from public, anon, authenticated;
grant execute on function public.archive_design_asset(uuid,uuid,uuid,text,text,uuid) to service_role;

grant update (archived_at, archived_by, archive_operation_key, archive_reason)
on public.design_assets to service_role;

comment on column public.design_assets.archived_at is
  'Soft archive removes an eligible standalone uploaded draft from normal browsing. Exact immutable versions and Storage objects remain.';
comment on function public.archive_design_asset(uuid,uuid,uuid,text,text,uuid) is
  'Atomically archives only standalone upload-only draft roots. It never deletes version history, Storage objects, releases, handoffs, or references.';

commit;
