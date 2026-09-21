-- D04 pins an optional approved S07 package version to an immutable DS6 handoff.
-- Client release remains a separate governed operation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.production_handoff_packages
  add column design_delivery_package_version_id uuid;
alter table public.production_handoff_packages
  add constraint production_handoff_exact_design_package_fkey
  foreign key (design_delivery_package_version_id, organization_id)
  references public.artifact_versions(id, organization_id) on delete restrict;
create index production_handoff_exact_design_package_idx
  on public.production_handoff_packages(organization_id, design_delivery_package_version_id)
  where design_delivery_package_version_id is not null;

create or replace function private.enforce_production_handoff_package_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status <> 'preparing' then
    raise exception 'Completed production handoff packages are immutable.' using errcode = '55000';
  end if;
  if row(new.id, new.organization_id, new.design_direction_release_id,
      new.design_delivery_package_version_id, new.requested_by, new.created_at)
    is distinct from row(old.id, old.organization_id, old.design_direction_release_id,
      old.design_delivery_package_version_id, old.requested_by, old.created_at) then
    raise exception 'Production handoff package identity is immutable.' using errcode = '55000';
  end if;
  if new.status = 'preparing' then
    raise exception 'Production handoff updates must finish as ready or failed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.guard_production_handoff_design_package()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_artifact public.artifacts%rowtype;
  v_release public.design_direction_releases%rowtype;
  v_context public.design_delivery_package_version_contexts%rowtype;
begin
  if new.design_delivery_package_version_id is null then return new; end if;
  select artifact.* into v_artifact from public.artifact_versions version
    join public.artifacts artifact on artifact.id = version.artifact_id
      and artifact.organization_id = version.organization_id
    where version.id = new.design_delivery_package_version_id
      and version.organization_id = new.organization_id
      and artifact.artifact_type = 'design_delivery_package';
  if not found then raise exception 'Exact Design delivery package version required' using errcode = '23514'; end if;
  select * into v_release from public.design_direction_releases
    where id = new.design_direction_release_id and organization_id = new.organization_id;
  if not found or v_release.engagement_id <> v_artifact.engagement_id then
    raise exception 'Design package and direction release must share one engagement' using errcode = '23514';
  end if;
  select * into v_context from public.design_delivery_package_version_contexts
    where artifact_version_id = new.design_delivery_package_version_id
      and artifact_id = v_artifact.id and organization_id = new.organization_id;
  if not found then raise exception 'Design package work provenance is required' using errcode = '23514'; end if;
  if not exists (select 1 from public.artifact_approvals approval
    where approval.artifact_version_id = new.design_delivery_package_version_id
      and approval.artifact_id = v_artifact.id and approval.organization_id = new.organization_id
      and approval.engagement_id = v_artifact.engagement_id and approval.decision = 'approved') then
    raise exception 'Exact Design package approval is required' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_production_handoff_design_package() from public, anon, authenticated;
grant execute on function private.guard_production_handoff_design_package() to service_role;
create trigger guard_production_handoff_design_package
  before insert on public.production_handoff_packages
  for each row execute function private.guard_production_handoff_design_package();
comment on column public.production_handoff_packages.design_delivery_package_version_id is
  'Optional approved S07 exact version. Null preserves existing direction-only DS6 handoffs.';
commit;
