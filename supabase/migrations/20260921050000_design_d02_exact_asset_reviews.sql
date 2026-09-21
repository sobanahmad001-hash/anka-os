-- D02 records review decisions beside immutable Design file versions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.design_asset_review_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null,
  asset_version_id uuid not null,
  event_type text not null check (event_type in ('submitted', 'approved', 'changes_requested')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation_key uuid not null,
  note text not null default '' check (length(note) <= 2000),
  object_checksum text check (object_checksum ~ '^[a-f0-9]{64}$'),
  check (event_type = 'changes_requested' or object_checksum is not null),
  created_at timestamptz not null default now(),
  foreign key (asset_id, asset_version_id, organization_id)
    references public.design_asset_versions(asset_id, id, organization_id) on delete restrict,
  unique (organization_id, actor_id, operation_key),
  check (event_type <> 'changes_requested' or length(btrim(note)) > 0)
);
create unique index design_asset_review_one_submission
  on public.design_asset_review_events(organization_id, asset_version_id)
  where event_type = 'submitted';
create unique index design_asset_review_one_decision
  on public.design_asset_review_events(organization_id, asset_version_id)
  where event_type in ('approved', 'changes_requested');
create index design_asset_review_asset_history
  on public.design_asset_review_events(organization_id, asset_id, created_at desc);
create index design_asset_review_actor_fk
  on public.design_asset_review_events(actor_id);

create or replace function private.guard_design_asset_review_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_asset public.design_assets%rowtype;
  v_submission public.design_asset_review_events%rowtype;
  v_role text;
  v_department text;
begin
  if tg_op <> 'INSERT' then raise exception 'Design asset review history is immutable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.organization_id::text || ':' || new.asset_version_id::text || ':asset_review', 0));
  select * into v_asset from public.design_assets
    where id = new.asset_id and organization_id = new.organization_id for share;
  if not found or v_asset.archived_at is not null then
    raise exception 'Review requires an active Design asset' using errcode = '23514';
  end if;
  select membership.role, membership.department_id into v_role, v_department
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id and membership.user_id = new.actor_id
      and membership.member_kind = 'team' and membership.status = 'active';
  if not found then raise exception 'Active team member required' using errcode = '42501'; end if;
  if new.event_type = 'submitted' then
    if v_role not in ('system_owner', 'operations_admin', 'executive')
      and coalesce(v_department, '') <> 'design' then
      raise exception 'Design authoring authority required' using errcode = '42501';
    end if;
    if exists (select 1 from public.design_asset_review_events old
      where old.organization_id = new.organization_id and old.asset_version_id = new.asset_version_id) then
      raise exception 'This exact asset version already has review history' using errcode = '23505';
    end if;
  else
    if v_role not in ('system_owner', 'operations_admin', 'executive')
      and not (v_role = 'department_manager' and coalesce(v_department, '') = 'design') then
      raise exception 'Design reviewer authority required' using errcode = '42501';
    end if;
    select * into v_submission from public.design_asset_review_events old
      where old.organization_id = new.organization_id and old.asset_version_id = new.asset_version_id
        and old.asset_id = new.asset_id and old.event_type = 'submitted';
    if not found or v_submission.actor_id = new.actor_id then
      raise exception 'A different author must submit the exact version before review' using errcode = '23514';
    end if;
    if exists (select 1 from public.design_asset_review_events old
      where old.organization_id = new.organization_id and old.asset_version_id = new.asset_version_id
        and old.event_type in ('approved', 'changes_requested')) then
      raise exception 'This exact asset version already has a decision' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_design_asset_review_event
before insert or update or delete on public.design_asset_review_events
for each row execute function private.guard_design_asset_review_event();

create or replace function private.guard_design_asset_archive_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.design_asset_review_events review
    where review.organization_id = old.organization_id and review.asset_id = old.id
  ) then
    raise exception 'An asset with submitted review history cannot be archived' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_design_asset_archive_review
before update of archived_at on public.design_assets
for each row execute function private.guard_design_asset_archive_review();

alter table public.design_asset_review_events enable row level security;
create policy "Team reads scoped Design asset reviews"
  on public.design_asset_review_events for select to authenticated using (
    public.is_team_organization_member(organization_id)
    and exists (select 1 from public.design_assets asset
      where asset.id = design_asset_review_events.asset_id
        and asset.organization_id = design_asset_review_events.organization_id)
  );
revoke all on public.design_asset_review_events from public, anon, authenticated, service_role;
grant select on public.design_asset_review_events to authenticated;
grant select, insert on public.design_asset_review_events to service_role;
comment on table public.design_asset_review_events is
  'Immutable exact-version Design asset review; approval never mutates the file or later versions.';
commit;