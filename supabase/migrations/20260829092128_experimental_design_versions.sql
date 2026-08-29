-- Anka Sphere OS - D2 Experimental Design Direction Versions
-- Experiments remain immutable direction versions, but are visible only to
-- their creator and explicitly invited active organization members.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.design_direction_versions
  add column is_experimental boolean not null default false,
  add column experiment_visibility uuid[];

alter table public.design_direction_versions
  add constraint design_direction_versions_experiment_visibility_scope
  check (
    is_experimental
    or coalesce(cardinality(experiment_visibility), 0) = 0
  );

-- An experiment and its promoted child intentionally carry the same content.
-- Preserve duplicate protection independently inside each lane.
alter table public.design_direction_versions
  drop constraint design_direction_versions_direction_id_content_checksum_key;

create unique index uq_design_direction_versions_main_content
  on public.design_direction_versions(direction_id, content_checksum)
  where not is_experimental;

create unique index uq_design_direction_versions_experimental_content_creator
  on public.design_direction_versions(direction_id, content_checksum, created_by)
  where is_experimental;

create index idx_design_direction_versions_main_comparison
  on public.design_direction_versions(organization_id, direction_id, version_number desc)
  where not is_experimental;

create index idx_design_direction_versions_experiment_visibility
  on public.design_direction_versions using gin(experiment_visibility)
  where is_experimental;

create index idx_design_direction_versions_experiment_creator
  on public.design_direction_versions(organization_id, created_by)
  where is_experimental;

drop policy if exists "Team can read direction versions"
  on public.design_direction_versions;

create policy "Team can read permitted direction versions"
  on public.design_direction_versions
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and (
      not is_experimental
      or created_by = (select auth.uid())
      or experiment_visibility @> array[(select auth.uid())]
    )
  );

-- D1 proofing remains generic, but its rows must inherit the tightened target
-- visibility so comment text cannot reveal a private experiment.
drop policy if exists "Team can read exact-version proofing comments"
  on public.artifact_version_comments;

create policy "Team can read permitted exact-version proofing comments"
  on public.artifact_version_comments
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and (
      design_direction_version_id is null
      or exists (
        select 1
        from public.design_direction_versions version
        where version.id = design_direction_version_id
          and version.organization_id = artifact_version_comments.organization_id
      )
    )
  );

-- Selection and release are mainline decisions. Experimental rows must first
-- be promoted by inserting a new, non-experimental child version.
create or replace function private.reject_experimental_direction_decision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.design_direction_versions version
    where version.id = new.direction_version_id
      and version.organization_id = new.organization_id
      and version.is_experimental
  ) then
    raise exception 'Experimental direction versions must be promoted before selection or release.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_experimental_direction_decision()
  from public, anon, authenticated;
grant execute on function private.reject_experimental_direction_decision()
  to service_role;

create trigger trg_design_selections_reject_experimental
before insert on public.design_direction_selections
for each row execute function private.reject_experimental_direction_decision();

create trigger trg_design_releases_reject_experimental
before insert on public.design_direction_releases
for each row execute function private.reject_experimental_direction_decision();

comment on column public.design_direction_versions.is_experimental is
  'True for an isolated experiment excluded from main comparison, selection, and release.';
comment on column public.design_direction_versions.experiment_visibility is
  'Active team user IDs invited to view and promote this immutable experimental version.';

commit;
