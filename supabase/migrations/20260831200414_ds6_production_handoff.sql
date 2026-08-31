-- Anka OS DS6 - immutable released-direction production handoff packages.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Reuse the existing private media bucket while allowing one packaged output.
-- No browser storage policy is added; package downloads are server-signed only.
update storage.buckets
set public = false,
    file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800),
    allowed_mime_types = (
      select array_agg(distinct mime_type order by mime_type)
      from unnest(
        coalesce(allowed_mime_types, '{}'::text[]) || array['application/zip']::text[]
      ) as allowed(mime_type)
    )
where id = 'design-generated-media';

create table public.production_handoff_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  design_direction_release_id uuid not null,
  status text not null default 'preparing'
    check (status in ('preparing', 'ready', 'failed')),
  included_asset_ids uuid[] not null default '{}',
  package_storage_path text,
  failure_reason text not null default ''
    check (length(failure_reason) <= 2000),
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (design_direction_release_id, organization_id)
    references public.design_direction_releases(id, organization_id) on delete cascade,
  unique (id, organization_id),
  constraint production_handoff_packages_ready_storage check (
    (status = 'ready' and package_storage_path is not null and completed_at is not null and failure_reason = '')
    or
    (status = 'failed' and package_storage_path is null and completed_at is not null and length(trim(failure_reason)) > 0)
    or
    (status = 'preparing' and package_storage_path is null and completed_at is null and failure_reason = '')
  ),
  constraint production_handoff_packages_storage_scope check (
    package_storage_path is null
    or package_storage_path like organization_id::text || '/' || design_direction_release_id::text || '/handoffs/' || id::text || '.zip'
  )
);

create index idx_production_handoff_packages_release
  on public.production_handoff_packages(
    design_direction_release_id, organization_id, created_at desc
  );
create index idx_production_handoff_packages_requested_by
  on public.production_handoff_packages(requested_by, created_at desc);
create index idx_production_handoff_packages_preparing
  on public.production_handoff_packages(organization_id, created_at)
  where status = 'preparing';

create or replace function private.enforce_production_handoff_package_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'preparing' then
    raise exception 'Completed production handoff packages are immutable.'
      using errcode = '55000';
  end if;

  if row(
    new.id, new.organization_id, new.design_direction_release_id,
    new.requested_by, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.design_direction_release_id,
    old.requested_by, old.created_at
  ) then
    raise exception 'Production handoff package identity is immutable.'
      using errcode = '55000';
  end if;

  if new.status = 'preparing' then
    raise exception 'Production handoff updates must finish as ready or failed.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_production_handoff_package_transition()
  from public, anon, authenticated;
grant execute on function private.enforce_production_handoff_package_transition()
  to service_role;

create trigger trg_production_handoff_package_transition
before update on public.production_handoff_packages
for each row execute function private.enforce_production_handoff_package_transition();

alter table public.production_handoff_packages enable row level security;

create policy "Team can read organization production handoffs"
  on public.production_handoff_packages
  for select
  to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.production_handoff_packages from anon, authenticated;
grant select on public.production_handoff_packages to authenticated;
revoke all on public.production_handoff_packages from service_role;
grant select, insert, update on public.production_handoff_packages to service_role;

comment on table public.production_handoff_packages is
  'Server-built delivery package for one immutable released Design direction. Browser access is read-only and package files use short-lived signed URLs.';
comment on column public.production_handoff_packages.included_asset_ids is
  'Exact ready design_media_assets successfully included in the package; content-request-targeted assets are never inferred into a direction release.';
comment on column public.production_handoff_packages.failure_reason is
  'Honest terminal packaging failure, including an unavailable or corrupt source object. Never stores credentials or signed URLs.';

commit;
