-- Anka OS - CP1 Design Media content-request target.
-- Isolated boundary change: preserve the Design Workshop direction path while
-- allowing the same media pipeline to target one ad-hoc Content request.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.design_media_assets
  alter column design_direction_version_id drop not null,
  add column content_request_id uuid;

alter table public.design_media_assets
  add constraint design_media_assets_content_request_org_fkey
  foreign key (content_request_id, organization_id)
  references public.content_requests(id, organization_id) on delete cascade,
  add constraint design_media_assets_exactly_one_target check (
    (design_direction_version_id is not null and content_request_id is null)
    or
    (design_direction_version_id is null and content_request_id is not null)
  );

alter table public.design_media_assets
  drop constraint design_media_assets_storage_path_scope;

alter table public.design_media_assets
  add constraint design_media_assets_storage_path_scope check (
    storage_path is null
    or (
      design_direction_version_id is not null
      and storage_path like organization_id::text || '/' || design_direction_version_id::text || '/%'
    )
    or (
      content_request_id is not null
      and storage_path like organization_id::text || '/content-requests/' || content_request_id::text || '/%'
    )
  );

create index idx_design_media_assets_content_request
  on public.design_media_assets(organization_id, content_request_id, created_at desc)
  where content_request_id is not null;
create index idx_design_media_assets_content_request_fk
  on public.design_media_assets(content_request_id, organization_id)
  where content_request_id is not null;

drop policy "Team can read permitted design media" on public.design_media_assets;

create policy "Team can read permitted design media"
  on public.design_media_assets
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and (
      (
        design_direction_version_id is not null
        and exists (
          select 1
          from public.design_direction_versions version
          where version.id = design_direction_version_id
            and version.organization_id = design_media_assets.organization_id
        )
      )
      or
      (
        content_request_id is not null
        and exists (
          select 1
          from public.content_requests request
          where request.id = content_request_id
            and request.organization_id = design_media_assets.organization_id
        )
      )
    )
  );

create or replace function public.attach_content_request_design_media_asset()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.content_request_id is not null then
    insert into public.content_request_assets (
      organization_id, content_request_id, design_media_asset_id
    ) values (
      new.organization_id, new.content_request_id, new.id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.attach_content_request_design_media_asset()
  from public, anon, authenticated;
grant execute on function public.attach_content_request_design_media_asset()
  to service_role;

create trigger design_media_assets_attach_content_request
after insert on public.design_media_assets
for each row
when (new.content_request_id is not null)
execute function public.attach_content_request_design_media_asset();

create or replace function public.enforce_content_request_asset_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_output_path text;
begin
  select request.output_path into v_output_path
  from public.content_requests request
  where request.id = new.content_request_id
    and request.organization_id = new.organization_id;

  if v_output_path is null then
    raise exception 'Content request asset target is unavailable.';
  end if;
  if new.design_media_asset_id is not null and (
    v_output_path <> 'internal_engine'
    or not exists (
      select 1
      from public.design_media_assets asset
      where asset.id = new.design_media_asset_id
        and asset.organization_id = new.organization_id
        and asset.content_request_id = new.content_request_id
    )
  ) then
    raise exception 'Design media must target the same internal-engine content request.';
  end if;
  if new.figma_handoff_url is not null and v_output_path <> 'figma_handoff' then
    raise exception 'Figma handoff URLs require a Figma-handoff content request.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_content_request_asset_target()
  from public, anon, authenticated;
grant execute on function public.enforce_content_request_asset_target()
  to service_role;

create trigger content_request_assets_enforce_target
before insert or update of organization_id, content_request_id, design_media_asset_id, figma_handoff_url
on public.content_request_assets
for each row execute function public.enforce_content_request_asset_target();

comment on column public.design_media_assets.content_request_id is
  'Ad-hoc Content Production target. Exactly one of this column and design_direction_version_id must be set.';
comment on constraint design_media_assets_exactly_one_target on public.design_media_assets is
  'Preserves the original exact Design direction target or one CP1 Content request target, never both.';

commit;
