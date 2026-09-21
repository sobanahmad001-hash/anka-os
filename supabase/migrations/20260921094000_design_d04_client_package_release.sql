-- D04 makes client visibility an exact, human-authorized release after a ready internal handoff.
-- The internal DS6 ZIP is never made client-readable.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.production_handoff_packages
  add constraint production_handoff_id_organization_key unique(id, organization_id);

create table public.design_handoff_client_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  engagement_id uuid not null,
  handoff_package_id uuid not null,
  design_package_version_id uuid not null,
  direction_release_id uuid not null,
  released_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  summary text not null default '' check(length(summary) <= 500),
  released_at timestamptz not null default now(),
  foreign key(project_id, organization_id) references public.projects(id, organization_id) on delete restrict,
  foreign key(engagement_id, organization_id) references public.engagements(id, organization_id) on delete restrict,
  foreign key(handoff_package_id, organization_id)
    references public.production_handoff_packages(id, organization_id) on delete restrict,
  foreign key(design_package_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  foreign key(direction_release_id, organization_id)
    references public.design_direction_releases(id, organization_id) on delete restrict,
  unique(handoff_package_id),
  unique(organization_id, released_by, request_id)
);
create index design_handoff_client_releases_project_idx
  on public.design_handoff_client_releases(organization_id, project_id, released_at desc);

create or replace function private.guard_design_handoff_client_release()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_handoff public.production_handoff_packages%rowtype;
  v_artifact public.artifacts%rowtype;
  v_engagement public.engagements%rowtype;
  v_release public.design_direction_releases%rowtype;
begin
  if tg_op <> 'INSERT' then raise exception 'Design client releases are immutable' using errcode='55000'; end if;
  select * into v_handoff from public.production_handoff_packages
    where id=new.handoff_package_id and organization_id=new.organization_id for share;
  if not found or v_handoff.status <> 'ready' or v_handoff.package_storage_path is null
    or v_handoff.design_delivery_package_version_id is distinct from new.design_package_version_id
    or v_handoff.design_direction_release_id is distinct from new.direction_release_id then
    raise exception 'Ready exact Design package handoff required' using errcode='23514';
  end if;
  select * into v_release from public.design_direction_releases
    where id=new.direction_release_id and organization_id=new.organization_id;
  select * into v_engagement from public.engagements
    where id=new.engagement_id and organization_id=new.organization_id;
  select artifact.* into v_artifact from public.artifact_versions version
    join public.artifacts artifact on artifact.id=version.artifact_id
      and artifact.organization_id=version.organization_id
    where version.id=new.design_package_version_id and version.organization_id=new.organization_id
      and artifact.artifact_type='design_delivery_package';
  if v_release.id is null or v_engagement.id is null or v_artifact.id is null
    or v_release.engagement_id <> new.engagement_id
    or v_artifact.engagement_id <> new.engagement_id
    or v_engagement.project_id <> new.project_id then
    raise exception 'Design release, package, engagement, and project must match' using errcode='23514';
  end if;
  if not exists(select 1 from public.projects project
    where project.id=new.project_id and project.organization_id=new.organization_id
      and project.client_id is not null) then
    raise exception 'Client project required for Design client visibility' using errcode='23514';
  end if;
  if not exists(select 1 from public.artifact_approvals approval
    where approval.artifact_version_id=new.design_package_version_id
      and approval.artifact_id=v_artifact.id and approval.organization_id=new.organization_id
      and approval.engagement_id=new.engagement_id and approval.decision='approved') then
    raise exception 'Exact Design package approval required' using errcode='23514';
  end if;
  if not private.p7_release_authority(new.organization_id,new.project_id,new.released_by) then
    raise exception 'Organization release authority required' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_design_handoff_client_release() from public,anon,authenticated;
grant execute on function private.guard_design_handoff_client_release() to service_role;
create trigger guard_design_handoff_client_release
  before insert or update or delete on public.design_handoff_client_releases
  for each row execute function private.guard_design_handoff_client_release();

alter table public.design_handoff_client_releases enable row level security;
create policy "Team reads exact Design client releases"
  on public.design_handoff_client_releases for select to authenticated
  using(public.is_team_organization_member(organization_id));
revoke all on public.design_handoff_client_releases from public,anon,authenticated,service_role;
grant select on public.design_handoff_client_releases to authenticated;
grant select,insert on public.design_handoff_client_releases to service_role;

-- Close the existing permissive team portal write policy for this new source type.
alter table public.client_portal_items drop constraint client_portal_items_source_type_check;
alter table public.client_portal_items add constraint client_portal_items_source_type_check
  check(source_type in ('workstream','milestone','deliverable_version','report',
    'activity_event','living_project_document','design_handoff_release'));
drop policy "Team can manage client portal items" on public.client_portal_items;
create policy "Team can manage client portal items"
  on public.client_portal_items for all to authenticated
  using(public.is_team_organization_member(organization_id)
    and source_type <> 'design_handoff_release')
  with check(public.is_team_organization_member(organization_id)
    and source_type <> 'design_handoff_release'
    and (source_type <> 'deliverable_version' or exists(
      select 1 from public.deliverable_versions version
      where version.id=client_portal_items.source_id
        and version.project_id=client_portal_items.project_id
        and version.review_status in ('ready_for_client_review','client_reviewing',
          'client_approved','delivered_published')
        and exists(select 1 from public.approvals approval
          where approval.deliverable_version_id=version.id
            and approval.approval_type='internal_quality' and approval.decision='approved'))));

create or replace function private.guard_design_handoff_portal_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    if old.source_type='design_handoff_release' then
      raise exception 'Released Design portal projection is immutable' using errcode='55000';
    end if;
    if tg_op='DELETE' then return old; end if;
    if new.source_type='design_handoff_release' then
      raise exception 'Released Design portal projection is immutable' using errcode='55000';
    end if;
    return new;
  end if;
  if new.source_type <> 'design_handoff_release' then return new; end if;
  if new.item_type <> 'design_handoff' or new.status <> 'ready_for_review'
    or new.withdrawn_at is not null
    or not exists(select 1 from public.design_handoff_client_releases release
      where release.id=new.source_id and release.organization_id=new.organization_id
        and release.project_id=new.project_id and release.released_by=new.released_by)
    or new.payload <> jsonb_build_object(
      'handoff_package_id',(select r.handoff_package_id from public.design_handoff_client_releases r where r.id=new.source_id),
      'design_package_version_id',(select r.design_package_version_id from public.design_handoff_client_releases r where r.id=new.source_id),
      'direction_release_id',(select r.direction_release_id from public.design_handoff_client_releases r where r.id=new.source_id)) then
    raise exception 'Sanitized exact Design client release required' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_design_handoff_portal_item() from public,anon,authenticated;
grant execute on function private.guard_design_handoff_portal_item() to service_role;
create trigger guard_design_handoff_portal_item
  before insert or update or delete on public.client_portal_items
  for each row execute function private.guard_design_handoff_portal_item();

-- One transaction creates the immutable release fact and sanitized portal projection.
-- Current organization authority is checked before every replay.
create function public.release_design_handoff_to_client(
  p_organization_id uuid, p_handoff_package_id uuid, p_request_id uuid, p_summary text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  handoff public.production_handoff_packages%rowtype;
  engagement public.engagements%rowtype;
  project public.projects%rowtype;
  existing public.design_handoff_client_releases%rowtype;
  created public.design_handoff_client_releases%rowtype;
  portal_id uuid;
begin
  if actor is null or p_request_id is null or p_organization_id is null or p_handoff_package_id is null then
    raise exception 'Authenticated exact release request required' using errcode='42501';
  end if;
  select * into handoff from public.production_handoff_packages
    where id=p_handoff_package_id and organization_id=p_organization_id for update;
  if not found or handoff.status <> 'ready' or handoff.package_storage_path is null
    or handoff.design_delivery_package_version_id is null then
    raise exception 'Ready DS6 handoff containing an exact approved S07 package required' using errcode='23514';
  end if;
  select * into engagement from public.engagements
    where id=(select r.engagement_id from public.design_direction_releases r
      where r.id=handoff.design_direction_release_id and r.organization_id=p_organization_id)
      and organization_id=p_organization_id;
  if not found then raise exception 'Handoff engagement unavailable' using errcode='23514'; end if;
  select * into project from public.projects
    where id=engagement.project_id and organization_id=p_organization_id;
  if not found or project.client_id is null then
    raise exception 'Client project required for release' using errcode='23514';
  end if;
  if not private.p7_release_authority(p_organization_id,project.id,actor) then
    raise exception 'Organization release authority required' using errcode='42501';
  end if;
  select * into existing from public.design_handoff_client_releases
    where organization_id=p_organization_id and released_by=actor and request_id=p_request_id;
  if found then
    if existing.handoff_package_id <> p_handoff_package_id then
      raise exception 'Release request id belongs to another handoff' using errcode='23505';
    end if;
    return jsonb_build_object('release_id',existing.id,'handoff_package_id',existing.handoff_package_id,'replayed',true);
  end if;
  if exists(select 1 from public.design_handoff_client_releases r
    where r.handoff_package_id=p_handoff_package_id) then
    raise exception 'This exact handoff was already released' using errcode='23505';
  end if;
  insert into public.design_handoff_client_releases(
    organization_id,project_id,engagement_id,handoff_package_id,design_package_version_id,
    direction_release_id,released_by,request_id,summary
  ) values (
    p_organization_id,project.id,engagement.id,handoff.id,handoff.design_delivery_package_version_id,
    handoff.design_direction_release_id,actor,p_request_id,left(coalesce(trim(p_summary),''),500)
  ) returning * into created;
  insert into public.client_project_projections(
    organization_id,project_id,client_id,project_name,engagement_type,summary,health,
    status,start_date,due_date,next_action,withdrawn_at
  ) values (
    p_organization_id,project.id,project.client_id,project.name,project.engagement_type,
    coalesce(project.description,''),coalesce(project.health,'unknown'),project.status,
    project.start_date,project.due_date,'Review the released Design handoff.',null
  ) on conflict(project_id) do update set
    client_id=excluded.client_id,project_name=excluded.project_name,
    engagement_type=excluded.engagement_type,summary=excluded.summary,health=excluded.health,
    status=excluded.status,start_date=excluded.start_date,due_date=excluded.due_date,
    next_action=excluded.next_action,withdrawn_at=null;
  insert into public.client_portal_items(
    organization_id,project_id,source_type,source_id,item_type,title,summary,status,payload,released_by
  ) values (
    p_organization_id,project.id,'design_handoff_release',created.id,'design_handoff',
    'Design handoff ready for review',created.summary,'ready_for_review',
    jsonb_build_object('handoff_package_id',created.handoff_package_id,
      'design_package_version_id',created.design_package_version_id,
      'direction_release_id',created.direction_release_id),actor
  ) returning id into portal_id;
  return jsonb_build_object('release_id',created.id,'portal_item_id',portal_id,
    'handoff_package_id',created.handoff_package_id,'replayed',false);
end;
$$;
revoke all on function public.release_design_handoff_to_client(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.release_design_handoff_to_client(uuid,uuid,uuid,text) to authenticated;
commit;
