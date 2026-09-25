-- CLI-created as 20260925080013; ordered after released 20260925130000.
-- Additive exact media references. Existing artifact references remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.design_creative_brief_media_sources (
  organization_id uuid not null,
  creative_brief_version_id uuid not null,
  asset_version_id uuid not null,
  source_kind text not null default 'design_asset_version' check (source_kind = 'design_asset_version'),
  primary key (creative_brief_version_id, asset_version_id),
  foreign key (creative_brief_version_id, organization_id)
    references public.design_creative_brief_versions(id, organization_id) on delete restrict,
  foreign key (asset_version_id, organization_id)
    references public.design_asset_versions(id, organization_id) on delete restrict
);
create index design_brief_media_source_version on public.design_creative_brief_media_sources(asset_version_id, organization_id);
alter table public.design_creative_brief_media_sources enable row level security;
create policy "Read visible brief and media source" on public.design_creative_brief_media_sources
for select to authenticated using (
  exists (select 1 from public.design_creative_brief_versions brief
    where brief.id = creative_brief_version_id and brief.organization_id = design_creative_brief_media_sources.organization_id)
  and exists (select 1 from public.design_asset_versions asset
    where asset.id = asset_version_id and asset.organization_id = design_creative_brief_media_sources.organization_id)
);
revoke all on public.design_creative_brief_media_sources from public, anon, authenticated, service_role;
grant select on public.design_creative_brief_media_sources to authenticated;
grant select, insert on public.design_creative_brief_media_sources to service_role;
create trigger design_brief_media_sources_immutable before update or delete
on public.design_creative_brief_media_sources for each row execute function private.reject_immutable_artifact_history_change();

-- Materialize references in the same transaction as the immutable brief version.
-- The Edge caller additionally checks current source visibility using caller RLS.
create function private.record_design_brief_media_sources()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare ref jsonb; brief public.design_creative_briefs; asset public.design_assets;
begin
  if not (new.content ? 'media_references') then return new; end if;
  if jsonb_typeof(new.content->'media_references') is distinct from 'array'
    or jsonb_array_length(new.content->'media_references') > 50 then
    raise exception 'Invalid typed media references' using errcode='22023';
  end if;
  select * into strict brief from public.design_creative_briefs
    where id=new.creative_brief_id and organization_id=new.organization_id;
  for ref in select value from jsonb_array_elements(new.content->'media_references') loop
    if jsonb_typeof(ref) is distinct from 'object'
      or ref->>'kind' is distinct from 'design_asset_version'
      or coalesce(ref->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or ref - 'kind' - 'id' <> '{}'::jsonb then
      raise exception 'Exact Design asset version reference required' using errcode='22023';
    end if;
    select root.* into asset from public.design_asset_versions version
      join public.design_assets root on root.id=version.asset_id and root.organization_id=version.organization_id
      where version.id=(ref->>'id')::uuid and version.organization_id=new.organization_id
        and root.archived_at is null
        and version.mime_type in ('image/png','video/mp4','video/quicktime') for share of root;
    if not found or (brief.visibility='official' and
      (asset.engagement_id is distinct from brief.engagement_id or asset.brand_id is distinct from brief.brand_id)) then
      raise exception 'Media reference is outside exact brief scope' using errcode='42501';
    end if;
    insert into public.design_creative_brief_media_sources(organization_id,creative_brief_version_id,asset_version_id)
      values(new.organization_id,new.id,(ref->>'id')::uuid);
  end loop;
  return new;
end;
$$;
revoke all on function private.record_design_brief_media_sources() from public,anon,authenticated;
grant execute on function private.record_design_brief_media_sources() to service_role;
create trigger record_design_brief_media_sources after insert on public.design_creative_brief_versions
for each row execute function private.record_design_brief_media_sources();

-- Extend canonical versions only for checked copies of ready private videos.
alter table public.design_assets drop constraint design_assets_output_type_check,
  add constraint design_assets_output_type_check check (output_type in ('static_image','video'));
alter table public.design_asset_versions
  add column source_video_job_id uuid,
  add constraint design_asset_video_source_fk foreign key (source_video_job_id,organization_id)
    references private.design_video_generation_jobs(id,organization_id) on delete restrict,
  drop constraint design_asset_versions_source_kind_check,
  drop constraint design_asset_versions_storage_bucket_check,
  drop constraint design_asset_versions_mime_type_check,
  drop constraint design_asset_versions_byte_size_check,
  drop constraint design_asset_versions_check,
  drop constraint design_asset_versions_check2,
  add constraint design_asset_versions_source_kind_check check (source_kind in ('upload','generated','recorded_variant','private_video_copy')),
  add constraint design_asset_versions_media_contract check (
    (source_kind <> 'private_video_copy' and source_video_job_id is null
      and storage_bucket='design-generated-media' and mime_type='image/png'
      and (byte_size is null or byte_size between 1 and 10485760)
      and ((source_kind='upload' and source_media_asset_id is null and byte_size is not null
        and width is not null and height is not null and content_checksum is not null
        and operation_key is not null and request_checksum is not null
        and storage_path=organization_id::text||'/assets/'||asset_id::text||'/'||id::text||'/file.png')
      or (source_kind in ('generated','recorded_variant') and source_media_asset_id is not null
        and storage_path like organization_id::text||'/%')))
    or (source_kind='private_video_copy' and source_video_job_id is not null
      and source_media_asset_id is null and source_direction_version_id is null
      and storage_bucket='design-generated-video' and mime_type in ('video/mp4','video/quicktime')
      and byte_size is not null and byte_size between 12 and 52428800
      and width is null and height is null and content_checksum is not null
      and operation_key is not null and request_checksum is not null
      and lifecycle_status='draft' and version_number=1 and parent_version_id is null
      and storage_path=organization_id::text||'/assets/'||asset_id::text||'/'||id::text||'/file.'||
        case mime_type when 'video/mp4' then 'mp4' else 'mov' end)
  );
create index design_asset_video_source on public.design_asset_versions(source_video_job_id,organization_id)
  where source_video_job_id is not null;

create function private.guard_design_asset_media_kind()
returns trigger language plpgsql security invoker set search_path='' as $$
declare root_kind text;
begin
  select output_type into root_kind from public.design_assets
    where id=new.asset_id and organization_id=new.organization_id for key share;
  if root_kind is distinct from (case when new.source_kind='private_video_copy' then 'video' else 'static_image' end) then
    raise exception 'Asset root and exact file media kind differ' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_design_asset_media_kind() from public,anon,authenticated;
grant execute on function private.guard_design_asset_media_kind() to service_role;
create trigger guard_design_asset_media_kind before insert on public.design_asset_versions
for each row execute function private.guard_design_asset_media_kind();

create table private.design_video_promotions (
  organization_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation_key uuid not null,
  source_job_id uuid not null,
  target_engagement_id uuid not null,
  target_service_id uuid not null,
  brand_id uuid not null,
  asset_id uuid not null default gen_random_uuid(),
  version_id uuid not null default gen_random_uuid(),
  request_checksum text not null check (request_checksum ~ '^[a-f0-9]{64}$'),
  name text not null,
  rights_notes text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,actor_id,operation_key),
  unique(asset_id), unique(version_id),
  foreign key (source_job_id,organization_id) references private.design_video_generation_jobs(id,organization_id) on delete restrict,
  foreign key (target_engagement_id,organization_id) references public.engagements(id,organization_id) on delete restrict,
  foreign key (target_service_id,organization_id) references public.engagement_services(id,organization_id) on delete restrict,
  foreign key (brand_id,organization_id) references public.brands(id,organization_id) on delete restrict
);
create index design_video_promotion_source on private.design_video_promotions(source_job_id,organization_id);
create index design_video_promotion_target on private.design_video_promotions(target_engagement_id,organization_id);
create index design_video_promotion_service on private.design_video_promotions(target_service_id,organization_id);
create index design_video_promotion_brand on private.design_video_promotions(brand_id,organization_id);
create index design_video_promotion_actor on private.design_video_promotions(actor_id);
alter table private.design_video_promotions enable row level security;
revoke all on private.design_video_promotions from public,anon,authenticated,service_role;
create trigger design_video_promotion_immutable before update or delete on private.design_video_promotions
for each row execute function private.reject_immutable_artifact_history_change();

-- Service-only bridge to the already owner-private ledger. No provider access.
-- NULL operation previews without writes; a confirmed operation reserves immutable IDs.
create function public.prepare_design_video_promotion(
  p_organization_id uuid,p_actor_id uuid,p_job_id uuid,p_engagement_id uuid,
  p_service_id uuid,p_operation_key uuid,p_expected_checksum text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job private.design_video_generation_jobs;
  receipt private.design_video_promotions;
  target public.engagements;
  source_content jsonb;
  source_name text;
  source_rights text;
  fingerprint text;
begin
  -- Reuse current owner/membership gate before both initial and replay paths.
  perform public.get_design_video_job(p_organization_id,p_job_id,p_actor_id);
  select * into strict job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id and requested_by=p_actor_id;
  if job.status <> 'ready' or job.output_sha256 is null or job.output_byte_length is null
    or job.output_mime_type is distinct from (case job.output_format when 'mp4' then 'video/mp4' else 'video/quicktime' end)
    or job.output_storage_path is distinct from p_organization_id::text||'/'||job.direction_version_id::text||'/'||job.id::text||'/output.'||job.output_format then
    raise exception 'Exact ready private video required' using errcode='42501';
  end if;
  select * into target from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
  if not found or not exists (select 1 from public.engagement_services service
    join public.service_catalog catalog on catalog.id=service.service_id
    where service.id=p_service_id and service.organization_id=p_organization_id
      and service.engagement_id=p_engagement_id and service.status='active'
      and catalog.department_id='design' and catalog.is_active) then
    raise exception 'Active target Design context required' using errcode='42501';
  end if;
  select brief_version.content into source_content from public.design_direction_versions direction
    join public.design_creative_brief_versions brief_version on brief_version.id=direction.creative_brief_version_id
      and brief_version.organization_id=direction.organization_id
    where direction.id=job.direction_version_id and direction.organization_id=p_organization_id;
  if not found then raise exception 'Exact source brief is unavailable' using errcode='42501'; end if;
  source_name:=left(coalesce(nullif(trim(source_content->>'title'),''),'Saved video'),180);
  source_rights:=coalesce(source_content->>'rights_notes','');
  -- Never silently truncate or infer licensing terms.
  if length(source_rights)>2000 then raise exception 'Source rights notes exceed canonical asset limit' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('job',job.id,'sha256',job.output_sha256,
    'bytes',job.output_byte_length,'mime',job.output_mime_type,'direction',job.direction_version_id,
    'engagement',target.id,'brand',target.brand_id,'service',p_service_id,'name',source_name,'rights',source_rights)::text,'sha256'),'hex');
  if p_operation_key is not null then
    if p_expected_checksum is distinct from fingerprint then raise exception 'Promotion preview changed' using errcode='40001'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'design-video-promotion:'||p_organization_id::text||':'||p_actor_id::text||':'||p_operation_key::text,0));
    select * into receipt from private.design_video_promotions where organization_id=p_organization_id
      and actor_id=p_actor_id and operation_key=p_operation_key;
    if found then
      if receipt.request_checksum is distinct from fingerprint or receipt.source_job_id<>p_job_id
        or receipt.target_engagement_id<>p_engagement_id or receipt.target_service_id<>p_service_id then
        raise exception 'Operation key already used for another promotion' using errcode='23505';
      end if;
    else
      insert into private.design_video_promotions(organization_id,actor_id,operation_key,source_job_id,
        target_engagement_id,target_service_id,brand_id,request_checksum,name,rights_notes)
      values(p_organization_id,p_actor_id,p_operation_key,p_job_id,p_engagement_id,p_service_id,
        target.brand_id,fingerprint,source_name,source_rights) returning * into receipt;
    end if;
  end if;
  return jsonb_build_object('job_id',job.id,'direction_version_id',job.direction_version_id,
    'target_engagement_id',target.id,'target_service_id',p_service_id,'brand_id',target.brand_id,
    'name',source_name,'rights_notes',source_rights,'checksum',fingerprint,
    'source_path',job.output_storage_path,'sha256',job.output_sha256,'byte_length',job.output_byte_length,
    'mime_type',job.output_mime_type,'format',job.output_format,
    'asset_id',receipt.asset_id,'version_id',receipt.version_id);
end;
$$;
revoke all on function public.prepare_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;

create function public.complete_design_video_promotion(
  p_organization_id uuid,p_actor_id uuid,p_job_id uuid,p_engagement_id uuid,
  p_service_id uuid,p_operation_key uuid,p_expected_checksum text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb; object_path text; saved public.design_asset_versions;
begin
  if p_operation_key is null then raise exception 'Operation key required' using errcode='22023'; end if;
  prepared:=public.prepare_design_video_promotion(p_organization_id,p_actor_id,p_job_id,p_engagement_id,
    p_service_id,p_operation_key,p_expected_checksum);
  select * into saved from public.design_asset_versions where id=(prepared->>'version_id')::uuid
    and organization_id=p_organization_id;
  if found then return jsonb_build_object('asset_id',saved.asset_id,'version_id',saved.id,'status','draft','idempotent_replay',true); end if;
  object_path:=p_organization_id::text||'/assets/'||(prepared->>'asset_id')||'/'||(prepared->>'version_id')||'/file.'||(prepared->>'format');
  if not exists(select 1 from storage.objects where bucket_id='design-generated-video' and name=object_path) then
    raise exception 'Checked draft video object is unavailable' using errcode='P0002';
  end if;
  insert into public.design_assets(id,organization_id,engagement_id,brand_id,name,output_type,rights_notes,created_by)
    values((prepared->>'asset_id')::uuid,p_organization_id,p_engagement_id,(prepared->>'brand_id')::uuid,
      prepared->>'name','video',prepared->>'rights_notes',p_actor_id);
  insert into public.design_asset_versions(id,organization_id,asset_id,version_number,source_kind,
    source_video_job_id,lifecycle_status,storage_bucket,storage_path,mime_type,byte_size,original_filename,
    content_checksum,operation_key,request_checksum,created_by,change_summary)
    values((prepared->>'version_id')::uuid,p_organization_id,(prepared->>'asset_id')::uuid,1,'private_video_copy',
      p_job_id,'draft','design-generated-video',object_path,prepared->>'mime_type',(prepared->>'byte_length')::bigint,
      'file.'||(prepared->>'format'),prepared->>'sha256',p_operation_key::text,p_expected_checksum,p_actor_id,
      'Exact copy of owner-private video; no approval transferred') returning * into saved;
  return jsonb_build_object('asset_id',saved.asset_id,'version_id',saved.id,'status','draft','idempotent_replay',false);
end;
$$;
revoke all on function public.complete_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- Recheck and lock current media eligibility inside the freeze transaction.
-- The existing canonical asset read boundary is active team membership plus
-- matching asset/engagement organization and brand; no new N1 policy is defined.
create function private.assert_design_brief_media_freeze(
  p_organization_id uuid,p_actor_id uuid,p_brief_id uuid,p_version_id uuid
) returns void language plpgsql security invoker set search_path='' as $$
declare brief public.design_creative_briefs; content jsonb; asset record; expected integer; seen integer:=0;
begin
  select version.content into content from public.design_creative_brief_versions version
    where version.id=p_version_id and version.organization_id=p_organization_id
      and version.creative_brief_id=p_brief_id;
  if not found then raise exception 'Exact brief version unavailable' using errcode='42501'; end if;
  expected:=jsonb_array_length(coalesce(content->'media_references','[]'::jsonb));
  if expected=0 then return; end if;
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    where org.id=p_organization_id and org.status='active' and member.user_id=p_actor_id
      and member.member_kind='team' and member.status='active' for share of org,member;
  if not found then raise exception 'Current media source access required' using errcode='42501'; end if;
  select * into strict brief from public.design_creative_briefs
    where id=p_brief_id and organization_id=p_organization_id;
  if brief.visibility='private' and brief.created_by is distinct from p_actor_id then
    raise exception 'Private brief is owner-only' using errcode='42501';
  end if;
  for asset in
    select root.* from public.design_creative_brief_media_sources source
    join public.design_asset_versions version on version.id=source.asset_version_id and version.organization_id=source.organization_id
    join public.design_assets root on root.id=version.asset_id and root.organization_id=version.organization_id
    join public.engagements engagement on engagement.id=root.engagement_id
      and engagement.organization_id=root.organization_id and engagement.brand_id=root.brand_id
    where source.creative_brief_version_id=p_version_id and source.organization_id=p_organization_id
    order by root.id for share of root,engagement
  loop
    if asset.archived_at is not null or (brief.visibility='official' and
      (asset.engagement_id is distinct from brief.engagement_id or asset.brand_id is distinct from brief.brand_id)) then
      raise exception 'Pinned media source is no longer eligible' using errcode='42501';
    end if;
    seen:=seen+1;
  end loop;
  if seen<>expected then raise exception 'Pinned media source is unavailable' using errcode='42501'; end if;
end;
$$;
revoke all on function private.assert_design_brief_media_freeze(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.assert_design_brief_media_freeze(uuid,uuid,uuid,uuid) to service_role;
create or replace function public.freeze_design_creative_brief_version(
  p_organization_id uuid, p_actor_id uuid, p_creative_brief_id uuid,
  p_creative_brief_version_id uuid, p_expected_revision integer, p_operation_key uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_brief public.design_creative_briefs%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_creative_brief_id::text, 0));
  select * into v_brief from public.design_creative_briefs
  where id = p_creative_brief_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Creative brief not found.' using errcode = 'P0002'; end if;
  if v_brief.last_freeze_operation_key = p_operation_key
    and v_brief.frozen_version_id is distinct from p_creative_brief_version_id then
    raise exception 'Freeze operation key belongs to another exact version' using errcode='23505';
  end if;
  perform private.assert_design_brief_media_freeze(p_organization_id,p_actor_id,p_creative_brief_id,p_creative_brief_version_id);
  if v_brief.last_freeze_operation_key = p_operation_key then
    return jsonb_build_object('brief', to_jsonb(v_brief), 'idempotent_replay', true);
  end if;
  if v_brief.visibility = 'private' and v_brief.created_by <> p_actor_id then
    raise exception 'Private creative brief is owner-only.' using errcode = '42501';
  end if;
  if v_brief.revision <> p_expected_revision then
    raise exception 'Creative brief changed; reload before freezing.' using errcode = '40001';
  end if;
  if not exists (select 1 from public.design_creative_brief_versions version
    where version.id = p_creative_brief_version_id and version.organization_id = p_organization_id
      and version.creative_brief_id = v_brief.id and coalesce((version.validation_snapshot->>'valid')::boolean, false)) then
    raise exception 'Only a complete validated version can be used for generation.' using errcode = '23514';
  end if;
  update public.design_creative_briefs set frozen_version_id = p_creative_brief_version_id,
    revision = revision + 1, last_freeze_operation_key = p_operation_key,
    updated_by = p_actor_id, updated_at = now() where id = v_brief.id returning * into v_brief;
  return jsonb_build_object('brief', to_jsonb(v_brief), 'idempotent_replay', false);
end;
$$;

revoke all on function public.freeze_design_creative_brief_version(uuid, uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.freeze_design_creative_brief_version(uuid, uuid, uuid, uuid, integer, uuid) to service_role;

commit;
