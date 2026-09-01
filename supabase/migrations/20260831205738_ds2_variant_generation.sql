-- Anka OS DS2 - released social and advertising direction variants.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.design_direction_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_direction_version_id uuid not null,
  variant_format text not null check (variant_format in (
    'square_1x1', 'story_9x16', 'landscape_1_91x1',
    'banner_728x90', 'banner_300x250', 'portrait_4x5'
  )),
  design_media_asset_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'generating', 'ready', 'failed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (source_direction_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete cascade,
  foreign key (design_media_asset_id, organization_id)
    references public.design_media_assets(id, organization_id)
    on delete set null (design_media_asset_id),
  unique (id, organization_id)
);

create index idx_design_direction_variants_source
  on public.design_direction_variants(
    source_direction_version_id, organization_id, created_at desc
  );
create index idx_design_direction_variants_media_asset
  on public.design_direction_variants(design_media_asset_id, organization_id)
  where design_media_asset_id is not null;
create index idx_design_direction_variants_in_progress
  on public.design_direction_variants(organization_id, status, created_at)
  where status in ('pending', 'generating');
create index idx_design_direction_variants_created_by
  on public.design_direction_variants(created_by);

create or replace function private.validate_design_direction_variant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.design_direction_releases release
    join public.design_direction_versions version
      on version.id = release.direction_version_id
     and version.organization_id = release.organization_id
    join public.design_directions direction
      on direction.id = version.direction_id
     and direction.organization_id = version.organization_id
    join public.design_workshop_sessions session
      on session.id = direction.session_id
     and session.organization_id = direction.organization_id
    join public.engagement_services engagement_service
      on engagement_service.id = session.engagement_service_id
     and engagement_service.organization_id = session.organization_id
     and engagement_service.engagement_id = session.engagement_id
    join public.service_catalog service
      on service.id = engagement_service.service_id
     and service.organization_id = engagement_service.organization_id
    where release.direction_version_id = new.source_direction_version_id
      and release.organization_id = new.organization_id
      and service.slug in ('social_assets', 'advertising_assets')
  ) then
    raise exception 'Variants require a released Social Assets or Advertising Assets direction version.'
      using errcode = '23514';
  end if;

  if new.design_media_asset_id is not null and not exists (
    select 1
    from public.design_media_assets asset
    where asset.id = new.design_media_asset_id
      and asset.organization_id = new.organization_id
      and asset.design_direction_version_id = new.source_direction_version_id
      and asset.media_type = 'image'
  ) then
    raise exception 'Variant media must be an image generated from the same direction version.'
      using errcode = '23514';
  end if;

  if new.status = 'ready' and not exists (
    select 1
    from public.design_media_assets asset
    where asset.id = new.design_media_asset_id
      and asset.organization_id = new.organization_id
      and asset.design_direction_version_id = new.source_direction_version_id
      and asset.media_type = 'image'
      and asset.status = 'ready'
  ) then
    raise exception 'A ready variant requires its ready image asset from the same direction version.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_design_direction_variant()
  from public, anon, authenticated;
grant execute on function private.validate_design_direction_variant()
  to service_role;

create trigger trg_design_direction_variants_validate
before insert or update of source_direction_version_id, design_media_asset_id, status
on public.design_direction_variants
for each row execute function private.validate_design_direction_variant();

alter table public.design_direction_variants enable row level security;

create policy "Team can read released design direction variants"
  on public.design_direction_variants
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and exists (
      select 1
      from public.design_direction_versions version
      where version.id = source_direction_version_id
        and version.organization_id = design_direction_variants.organization_id
    )
  );

revoke all on public.design_direction_variants from anon, authenticated;
grant select on public.design_direction_variants to authenticated;
grant all on public.design_direction_variants to service_role;

comment on table public.design_direction_variants is
  'Independently tracked format variants generated only from released Social Assets or Advertising Assets direction versions.';
comment on column public.design_direction_variants.variant_format is
  'User-selected target platform format; provider output is crop/resampled and verified against these exact dimensions before ready status.';

commit;
