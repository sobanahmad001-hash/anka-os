-- DESIGN B04c - canonical uploaded/generated asset roots and immutable file versions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.design_assets (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  brand_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 180),
  output_type text not null default 'static_image' check (output_type = 'static_image'),
  placement text not null default '' check (length(placement) <= 500),
  rights_notes text not null default '' check (length(rights_notes) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id) references public.engagements(id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create table public.design_asset_versions (
  id uuid primary key,
  organization_id uuid not null,
  asset_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_version_id uuid,
  source_kind text not null check (source_kind in ('upload', 'generated', 'recorded_variant')),
  source_media_asset_id uuid,
  source_direction_version_id uuid,
  lifecycle_status text not null default 'draft' check (lifecycle_status = 'draft'),
  storage_bucket text not null default 'design-generated-media' check (storage_bucket = 'design-generated-media'),
  storage_path text not null,
  mime_type text not null check (mime_type = 'image/png'),
  byte_size bigint check (byte_size is null or byte_size between 1 and 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  original_filename text not null check (length(trim(original_filename)) between 1 and 240),
  content_checksum text check (content_checksum is null or content_checksum ~ '^[a-f0-9]{64}$'),
  change_summary text not null default '' check (length(change_summary) <= 1000),
  operation_key text,
  request_checksum text check (request_checksum is null or request_checksum ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (asset_id, organization_id) references public.design_assets(id, organization_id) on delete restrict,
  foreign key (parent_version_id, organization_id) references public.design_asset_versions(id, organization_id) on delete restrict,
  foreign key (source_media_asset_id, organization_id) references public.design_media_assets(id, organization_id) on delete restrict,
  foreign key (source_direction_version_id, organization_id) references public.design_direction_versions(id, organization_id) on delete restrict,
  check ((source_kind = 'upload' and source_media_asset_id is null and byte_size is not null and width is not null
      and height is not null and content_checksum is not null and operation_key is not null and request_checksum is not null)
    or (source_kind in ('generated', 'recorded_variant') and source_media_asset_id is not null)),
  check ((version_number = 1 and parent_version_id is null) or (version_number > 1 and parent_version_id is not null)),
  check ((source_kind = 'upload' and storage_path = organization_id::text || '/assets/' || asset_id::text || '/' || id::text || '/file.png')
    or (source_kind in ('generated', 'recorded_variant') and storage_path like organization_id::text || '/%')),
  unique (asset_id, version_number),
  unique (source_media_asset_id),
  unique (storage_bucket, storage_path),
  unique (organization_id, created_by, operation_key),
  unique (id, organization_id)
);

create index idx_design_assets_context on public.design_assets(organization_id, engagement_id, brand_id, created_at desc);
create index idx_design_asset_versions_asset on public.design_asset_versions(organization_id, asset_id, version_number desc);
create index idx_design_asset_versions_parent on public.design_asset_versions(organization_id, parent_version_id) where parent_version_id is not null;
create index idx_design_asset_versions_direction on public.design_asset_versions(organization_id, source_direction_version_id) where source_direction_version_id is not null;
create trigger trg_design_asset_versions_immutable before update or delete on public.design_asset_versions
for each row execute function private.reject_immutable_artifact_history_change();
alter table public.design_assets enable row level security;
alter table public.design_asset_versions enable row level security;
create policy "Team can read scoped design assets" on public.design_assets for select to authenticated using (
  public.is_team_organization_member(organization_id)
  and exists (select 1 from public.engagements engagement where engagement.id = design_assets.engagement_id
    and engagement.organization_id = design_assets.organization_id and engagement.brand_id = design_assets.brand_id)
);
create policy "Team can read scoped design asset versions" on public.design_asset_versions for select to authenticated using (
  public.is_team_organization_member(organization_id)
  and exists (select 1 from public.design_assets asset where asset.id = design_asset_versions.asset_id
    and asset.organization_id = design_asset_versions.organization_id)
);
revoke all on public.design_assets, public.design_asset_versions from public, anon, authenticated, service_role;
grant select on public.design_assets, public.design_asset_versions to authenticated;
grant select, insert on public.design_assets, public.design_asset_versions to service_role;

create or replace function public.register_design_asset_upload(
  p_organization_id uuid, p_engagement_id uuid, p_brand_id uuid, p_asset_id uuid, p_version_id uuid,
  p_expected_latest_version_id uuid, p_source_direction_version_id uuid, p_name text, p_output_type text,
  p_placement text, p_rights_notes text, p_original_filename text, p_storage_path text, p_mime_type text,
  p_byte_size bigint, p_width integer, p_height integer, p_content_checksum text, p_change_summary text,
  p_operation_key text, p_request_checksum text, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_membership record;
  v_engagement record;
  v_asset public.design_assets%rowtype;
  v_latest public.design_asset_versions%rowtype;
  v_existing public.design_asset_versions%rowtype;
  v_saved public.design_asset_versions%rowtype;
begin
  if p_organization_id is null or p_engagement_id is null or p_brand_id is null or p_asset_id is null
    or p_version_id is null or p_actor_id is null then raise exception 'Organization, engagement, brand, asset, version, and actor are required'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 180 or p_output_type <> 'static_image' then raise exception 'A supported static-image asset name is required'; end if;
  if length(coalesce(p_placement, '')) > 500 or length(coalesce(p_rights_notes, '')) > 2000
    or length(trim(coalesce(p_original_filename, ''))) not between 1 and 240 or length(coalesce(p_change_summary, '')) > 1000 then
    raise exception 'Asset upload metadata exceeds its supported length';
  end if;
  if p_mime_type <> 'image/png' or p_byte_size not between 1 and 10485760 or p_width <= 0 or p_height <= 0
    or p_content_checksum !~ '^[a-f0-9]{64}$' or p_request_checksum !~ '^[a-f0-9]{64}$'
    or length(trim(coalesce(p_operation_key, ''))) not between 8 and 200 then raise exception 'Asset file metadata is invalid'; end if;
  if p_storage_path <> (p_organization_id::text || '/assets/' || p_asset_id::text || '/' || p_version_id::text || '/file.png') then
    raise exception 'Asset storage path is outside the immutable version scope';
  end if;

  select role, department_id into v_membership from public.organization_memberships
  where organization_id = p_organization_id and user_id = p_actor_id and member_kind = 'team' and status = 'active';
  if not found or not (v_membership.role in ('system_owner', 'operations_admin', 'executive') or v_membership.department_id = 'design') then
    raise exception 'Design department access required';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id and status = 'active') then raise exception 'Active organization required'; end if;
  select id, brand_id into v_engagement from public.engagements where id = p_engagement_id and organization_id = p_organization_id;
  if not found or v_engagement.brand_id <> p_brand_id or not exists (
    select 1 from public.engagement_services es join public.service_catalog sc on sc.id = es.service_id
    where es.engagement_id = p_engagement_id and es.organization_id = p_organization_id
      and es.status = 'active' and sc.department_id = 'design' and sc.is_active
  ) then raise exception 'Active Design engagement and matching brand required'; end if;
  if p_source_direction_version_id is not null and not exists (
    select 1 from public.design_direction_versions version
    join public.design_directions direction on direction.id = version.direction_id and direction.organization_id = version.organization_id
    join public.design_workshop_sessions session on session.id = direction.session_id and session.organization_id = direction.organization_id
    where version.id = p_source_direction_version_id and version.organization_id = p_organization_id
      and session.engagement_id = p_engagement_id and session.brand_id = p_brand_id
  ) then raise exception 'Source direction version is outside this Design context'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || p_actor_id::text || ':' || p_operation_key, 0));
  select * into v_existing from public.design_asset_versions where organization_id = p_organization_id
    and created_by = p_actor_id and operation_key = p_operation_key;
  if found then
    if v_existing.request_checksum <> p_request_checksum then raise exception 'Operation key was already used for a different upload' using errcode = '23505'; end if;
    select * into v_asset from public.design_assets where id = v_existing.asset_id and organization_id = p_organization_id;
    return jsonb_build_object('asset', to_jsonb(v_asset), 'version', to_jsonb(v_existing), 'idempotent_replay', true);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || p_asset_id::text || ':design_asset', 0));
  select * into v_asset from public.design_assets where id = p_asset_id and organization_id = p_organization_id for share;
  if not found then
    if p_expected_latest_version_id is not null then raise exception 'Asset version target no longer exists' using errcode = '40001'; end if;
    insert into public.design_assets(id, organization_id, engagement_id, brand_id, name, output_type, placement, rights_notes, created_by)
    values(p_asset_id, p_organization_id, p_engagement_id, p_brand_id, trim(p_name), p_output_type,
      trim(coalesce(p_placement, '')), trim(coalesce(p_rights_notes, '')), p_actor_id) returning * into v_asset;
  elsif v_asset.engagement_id <> p_engagement_id or v_asset.brand_id <> p_brand_id then
    raise exception 'Asset is outside this Design context';
  end if;

  select * into v_latest from public.design_asset_versions where organization_id = p_organization_id and asset_id = p_asset_id
    order by version_number desc limit 1;
  if v_latest.id is distinct from p_expected_latest_version_id then
    raise exception 'Asset changed since it was loaded; refresh before uploading a new version' using errcode = '40001';
  end if;
  insert into public.design_asset_versions(
    id, organization_id, asset_id, version_number, parent_version_id, source_kind, source_direction_version_id,
    storage_path, mime_type, byte_size, width, height, original_filename, content_checksum, change_summary,
    operation_key, request_checksum, created_by
  ) values(
    p_version_id, p_organization_id, p_asset_id, coalesce(v_latest.version_number, 0) + 1, v_latest.id, 'upload', p_source_direction_version_id,
    p_storage_path, p_mime_type, p_byte_size, p_width, p_height, trim(p_original_filename), p_content_checksum,
    trim(coalesce(p_change_summary, '')), trim(p_operation_key), p_request_checksum, p_actor_id
  ) returning * into v_saved;
  return jsonb_build_object('asset', to_jsonb(v_asset), 'version', to_jsonb(v_saved), 'idempotent_replay', false);
end;
$$;

revoke all on function public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)
from public, anon, authenticated;
grant execute on function public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)
to service_role;

-- Future ready generated images are registered automatically as independent assets.
create or replace function private.register_ready_design_media_asset()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  source record;
  new_asset_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
begin
  if new.media_type <> 'image' or new.status <> 'ready' or new.storage_path is null
    or exists (select 1 from public.design_asset_versions where source_media_asset_id = new.id) then
    return new;
  end if;
  select session.engagement_id, session.brand_id,
    coalesce(nullif(trim(version.content->>'title'), ''), 'Generated output ' || left(new.id::text, 8)) as name
  into source
  from public.design_direction_versions version
  join public.design_directions direction on direction.id = version.direction_id and direction.organization_id = version.organization_id
  join public.design_workshop_sessions session on session.id = direction.session_id and session.organization_id = direction.organization_id
  where version.id = new.design_direction_version_id and version.organization_id = new.organization_id;
  if not found then return new; end if;
  insert into public.design_assets(id, organization_id, engagement_id, brand_id, name, created_by, created_at)
  values(new_asset_id, new.organization_id, source.engagement_id, source.brand_id, source.name, new.generated_by, new.created_at);
  insert into public.design_asset_versions(
    id, organization_id, asset_id, version_number, source_kind, source_media_asset_id, source_direction_version_id,
    storage_path, mime_type, original_filename, created_by, created_at
  ) values(
    new_version_id, new.organization_id, new_asset_id, 1,
    case when exists (
      select 1 from public.design_direction_variants variant
      where variant.design_media_asset_id = new.id and variant.organization_id = new.organization_id
    ) then 'recorded_variant' else 'generated' end,
    new.id, new.design_direction_version_id,
    new.storage_path, 'image/png', new.id::text || '.png', new.generated_by, new.created_at
  );
  return new;
end;
$$;
revoke all on function private.register_ready_design_media_asset() from public, anon, authenticated;
create trigger trg_register_ready_design_media_asset
after insert or update of status, storage_path on public.design_media_assets
for each row execute function private.register_ready_design_media_asset();

-- Every ready generated output becomes its own independent v1 asset.
do $$
declare
  source record;
  new_asset_id uuid;
  new_version_id uuid;
begin
  for source in
    select media.id as media_id, media.organization_id, media.design_direction_version_id, media.storage_path,
      media.generated_by, media.created_at, session.engagement_id, session.brand_id,
      coalesce(nullif(trim(version.content->>'title'), ''), 'Generated output ' || left(media.id::text, 8)) as name,
      case when exists (
        select 1 from public.design_direction_variants variant
        where variant.design_media_asset_id = media.id and variant.organization_id = media.organization_id
      ) then 'recorded_variant' else 'generated' end as source_kind
    from public.design_media_assets media
    join public.design_direction_versions version on version.id = media.design_direction_version_id and version.organization_id = media.organization_id
    join public.design_directions direction on direction.id = version.direction_id and direction.organization_id = version.organization_id
    join public.design_workshop_sessions session on session.id = direction.session_id and session.organization_id = direction.organization_id
    where media.media_type = 'image' and media.status = 'ready' and media.storage_path is not null
  loop
    new_asset_id := gen_random_uuid();
    new_version_id := gen_random_uuid();
    insert into public.design_assets(id, organization_id, engagement_id, brand_id, name, created_by, created_at)
    values(new_asset_id, source.organization_id, source.engagement_id, source.brand_id, source.name, source.generated_by, source.created_at);
    insert into public.design_asset_versions(
      id, organization_id, asset_id, version_number, source_kind, source_media_asset_id, source_direction_version_id,
      storage_path, mime_type, original_filename, created_by, created_at
    ) values(
      new_version_id, source.organization_id, new_asset_id, 1, source.source_kind, source.media_id,
      source.design_direction_version_id, source.storage_path, 'image/png', source.media_id::text || '.png',
      source.generated_by, source.created_at
    );
  end loop;
end;
$$;

comment on table public.design_assets is 'Official Design asset identity in one exact organization, engagement, and brand context. It does not replace work records.';
comment on table public.design_asset_versions is 'Immutable Design file versions. Uploaded replacements create child drafts; unrelated generated outputs remain independent assets.';
comment on function public.register_design_asset_upload(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,text,text,text,text,uuid)
is 'Server-only atomic registration after validated immutable Storage upload. Never approves, releases, publishes, or calls a provider.';
commit;
