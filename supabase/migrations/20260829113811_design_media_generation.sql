-- Anka Sphere OS - Design Workshop generated media.
-- Adds private, version-scoped image assets and an honest video placeholder.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'design-generated-media',
  'design-generated-media',
  false,
  10485760,
  array['image/png']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.design_media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  design_direction_version_id uuid not null,
  media_type text not null check (media_type in ('image', 'video')),
  status text not null default 'pending'
    check (status in ('pending', 'generating', 'ready', 'failed', 'unavailable')),
  model_registry_id uuid,
  provider text,
  storage_path text,
  prompt text not null check (length(trim(prompt)) between 1 and 6000),
  failure_reason text not null default '' check (length(failure_reason) <= 2000),
  generated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (design_direction_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete cascade,
  foreign key (model_registry_id, organization_id)
    references public.design_model_registry(id, organization_id) on delete restrict,
  constraint design_media_assets_ready_storage check (
    (status = 'ready') = (storage_path is not null)
  ),
  constraint design_media_assets_provider_scope check (
    (media_type = 'image' and model_registry_id is not null and provider is not null)
    or
    (media_type = 'video' and status = 'unavailable' and model_registry_id is null and provider is null)
  ),
  constraint design_media_assets_storage_path_scope check (
    storage_path is null
    or storage_path like organization_id::text || '/' || design_direction_version_id::text || '/%'
  ),
  unique (id, organization_id)
);

create index idx_design_media_assets_version
  on public.design_media_assets(
    organization_id, design_direction_version_id, created_at desc
  );

create index idx_design_media_assets_model
  on public.design_media_assets(model_registry_id, created_at desc)
  where model_registry_id is not null;

create index idx_design_media_assets_in_progress
  on public.design_media_assets(organization_id, status, created_at)
  where status in ('pending', 'generating');

alter table public.design_media_assets enable row level security;

create policy "Team can read permitted design media"
  on public.design_media_assets
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and exists (
      select 1
      from public.design_direction_versions version
      where version.id = design_direction_version_id
        and version.organization_id = design_media_assets.organization_id
    )
  );

revoke all on public.design_media_assets from anon, authenticated;
grant select on public.design_media_assets to authenticated;
grant all on public.design_media_assets to service_role;

-- Deliberately grant no browser role access to storage.objects for this bucket.
-- The Design Workshop Edge Function uploads with the server credential and
-- returns short-lived signed URLs only after exact-version authorization.

insert into public.design_model_registry (
  organization_id, provider, model_id, display_name, supported_output_types,
  input_formats, limitations, cost_class, speed_class, privacy_classification,
  allowed_engagement_types
)
select
  organization.id,
  'openai',
  'gpt-image-2',
  'OpenAI GPT Image 2',
  array['image']::text[],
  array['text']::text[],
  'Still-image generation only. Every output remains subject to human design review.',
  'high',
  'standard',
  'standard',
  array['project', 'retainer']::text[]
from public.organizations organization
on conflict (organization_id, provider, model_id) do update
set display_name = excluded.display_name,
    supported_output_types = (
      select array_agg(distinct output_type order by output_type)
      from unnest(
        public.design_model_registry.supported_output_types
        || excluded.supported_output_types
      ) as item(output_type)
    ),
    limitations = excluded.limitations,
    is_active = true,
    updated_at = now();

comment on table public.design_media_assets is
  'Append-created image outputs and honest unavailable video requests attached to one exact immutable Design direction version.';
comment on column public.design_media_assets.failure_reason is
  'User-visible terminal failure or provider-unavailable context; never contains provider credentials.';
comment on column public.design_media_assets.storage_path is
  'Private bucket object path. Clients receive only short-lived server-signed URLs.';

commit;
