-- DESIGN B02: creative brief versions and reversible working direction state.
-- Immutable selections, approvals, releases, and generated media remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The legacy tasks primary key is id-only. B02 references task identity together
-- with its tenant, so expose the narrow composite candidate key first. The
-- primary key already makes id globally unique; this preflight also refuses a
-- nullable tenant. ADD UNIQUE takes a brief table lock bounded by lock_timeout.
do $$
begin
  if not exists (
    select 1 from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.tasks'::regclass
      and constraint_record.contype = 'p'
      and (select array_agg(attribute.attname order by key.ordinality)::text[]
        from unnest(constraint_record.conkey) with ordinality key(attnum, ordinality)
        join pg_attribute attribute on attribute.attrelid = constraint_record.conrelid
          and attribute.attnum = key.attnum) = array['id']::text[]
  ) then raise exception 'B02 requires the canonical tasks(id) primary key.'; end if;
  if exists (select 1 from public.tasks where organization_id is null) then
    raise exception 'B02 cannot add tenant-safe task identity while a task tenant is null.';
  end if;
end;
$$;
alter table public.tasks add constraint tasks_id_organization_id_key unique (id, organization_id);

create table public.design_creative_briefs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  engagement_id uuid, brand_id uuid, engagement_service_id uuid,
  project_task_id uuid, engagement_work_item_id uuid,
  visibility text not null default 'official' check (visibility in ('official', 'private')),
  revision integer not null default 0 check (revision >= 0),
  current_version_id uuid, frozen_version_id uuid, last_freeze_operation_key uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (id, organization_id), unique (organization_id, created_by, last_freeze_operation_key),
  foreign key (engagement_id, organization_id) references public.engagements(id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete restrict,
  foreign key (engagement_service_id, organization_id) references public.engagement_services(id, organization_id) on delete restrict,
  foreign key (project_task_id, organization_id) references public.tasks(id, organization_id) on delete restrict,
  foreign key (engagement_work_item_id, organization_id) references public.work_items(id, organization_id) on delete restrict,
  check ((visibility = 'official' and engagement_id is not null and brand_id is not null and engagement_service_id is not null)
    or (visibility = 'private' and engagement_id is null and brand_id is null and engagement_service_id is null
      and project_task_id is null and engagement_work_item_id is null)),
  constraint design_creative_briefs_exact_scope_check check (
    (project_task_id is null and engagement_work_item_id is null)
    or (project_task_id is not null and engagement_work_item_id is null)
    or (project_task_id is null and engagement_work_item_id is not null)
  )
);

create table public.design_creative_brief_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  creative_brief_id uuid not null, version_number integer not null check (version_number > 0),
  parent_version_id uuid, content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_checksum text not null check (content_checksum ~ '^[a-f0-9]{64}$'),
  validation_snapshot jsonb not null check (jsonb_typeof(validation_snapshot) = 'object'),
  operation_key uuid not null, created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id), unique (creative_brief_id, id, organization_id),
  unique (creative_brief_id, version_number),
  unique (organization_id, created_by, operation_key),
  foreign key (creative_brief_id, organization_id) references public.design_creative_briefs(id, organization_id) on delete cascade,
  constraint design_creative_brief_versions_parent_same_root_fk
    foreign key (creative_brief_id, parent_version_id, organization_id)
    references public.design_creative_brief_versions(creative_brief_id, id, organization_id) on delete restrict
);

alter table public.design_creative_briefs add constraint design_creative_briefs_current_version_fk
  foreign key (id, current_version_id, organization_id)
  references public.design_creative_brief_versions(creative_brief_id, id, organization_id) on delete restrict;
alter table public.design_creative_briefs add constraint design_creative_briefs_frozen_version_fk
  foreign key (id, frozen_version_id, organization_id)
  references public.design_creative_brief_versions(creative_brief_id, id, organization_id) on delete restrict;

create table public.design_creative_brief_version_sources (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  creative_brief_version_id uuid not null, artifact_version_id uuid not null,
  source_role text not null default 'reference' check (source_role in ('brand', 'reference')),
  created_at timestamptz not null default now(),
  unique (creative_brief_version_id, artifact_version_id), unique (id, organization_id),
  foreign key (creative_brief_version_id, organization_id) references public.design_creative_brief_versions(id, organization_id) on delete cascade,
  foreign key (artifact_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete restrict
);

create table public.design_working_direction_preferences (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  engagement_id uuid not null, session_id uuid not null, direction_version_id uuid not null,
  revision integer not null default 1 check (revision > 0), last_operation_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (id, organization_id), unique (session_id), unique (organization_id, updated_by, last_operation_key),
  foreign key (engagement_id, organization_id) references public.engagements(id, organization_id) on delete cascade,
  foreign key (session_id, organization_id) references public.design_workshop_sessions(id, organization_id) on delete cascade,
  foreign key (direction_version_id, organization_id) references public.design_direction_versions(id, organization_id) on delete restrict
);

alter table public.design_direction_versions add column creative_brief_version_id uuid;
alter table public.design_direction_versions add constraint design_direction_versions_creative_brief_version_fk
  foreign key (creative_brief_version_id, organization_id) references public.design_creative_brief_versions(id, organization_id) on delete restrict;

alter table public.design_workshop_sessions
  add column project_task_id uuid,
  add column engagement_work_item_id uuid,
  add constraint design_workshop_sessions_task_fk
    foreign key (project_task_id, organization_id) references public.tasks(id, organization_id) on delete restrict,
  add constraint design_workshop_sessions_work_item_fk
    foreign key (engagement_work_item_id, organization_id) references public.work_items(id, organization_id) on delete restrict,
  add constraint design_workshop_sessions_exact_scope_check
    check (project_task_id is null or engagement_work_item_id is null);

create index idx_design_creative_briefs_official_context
  on public.design_creative_briefs(organization_id, engagement_id, engagement_service_id, updated_at desc) where visibility = 'official';
create unique index uq_design_creative_briefs_official_engagement_scope
  on public.design_creative_briefs(organization_id, engagement_id, engagement_service_id)
  where visibility = 'official' and project_task_id is null and engagement_work_item_id is null;
create unique index uq_design_creative_briefs_official_task_scope
  on public.design_creative_briefs(organization_id, engagement_id, engagement_service_id, project_task_id)
  where visibility = 'official' and project_task_id is not null and engagement_work_item_id is null;
create unique index uq_design_creative_briefs_official_work_item_scope
  on public.design_creative_briefs(organization_id, engagement_id, engagement_service_id, engagement_work_item_id)
  where visibility = 'official' and project_task_id is null and engagement_work_item_id is not null;
create index idx_design_creative_briefs_private_owner
  on public.design_creative_briefs(organization_id, created_by, updated_at desc) where visibility = 'private';
create index idx_design_creative_briefs_brand on public.design_creative_briefs(brand_id, organization_id) where brand_id is not null;
create index idx_design_creative_briefs_current_version on public.design_creative_briefs(current_version_id, organization_id) where current_version_id is not null;
create index idx_design_creative_briefs_frozen_version on public.design_creative_briefs(frozen_version_id, organization_id) where frozen_version_id is not null;
create index idx_design_creative_briefs_task on public.design_creative_briefs(project_task_id) where project_task_id is not null;
create index idx_design_creative_briefs_work_item on public.design_creative_briefs(engagement_work_item_id) where engagement_work_item_id is not null;
create index idx_design_creative_brief_versions_root
  on public.design_creative_brief_versions(organization_id, creative_brief_id, version_number desc);
create index idx_design_creative_brief_versions_parent on public.design_creative_brief_versions(parent_version_id) where parent_version_id is not null;
create index idx_design_creative_brief_sources_version on public.design_creative_brief_version_sources(organization_id, creative_brief_version_id);
create index idx_design_creative_brief_sources_artifact on public.design_creative_brief_version_sources(artifact_version_id, organization_id);
create index idx_design_working_preferences_engagement on public.design_working_direction_preferences(organization_id, engagement_id, updated_at desc);
create index idx_design_working_preferences_version on public.design_working_direction_preferences(direction_version_id, organization_id);
create index idx_design_direction_versions_brief on public.design_direction_versions(creative_brief_version_id, organization_id)
  where creative_brief_version_id is not null;
create index idx_design_sessions_task_context on public.design_workshop_sessions(project_task_id) where project_task_id is not null;
create index idx_design_sessions_work_item_context on public.design_workshop_sessions(engagement_work_item_id) where engagement_work_item_id is not null;

create or replace function private.validate_design_creative_brief_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_project_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.engagement_id is distinct from old.engagement_id
    or new.brand_id is distinct from old.brand_id
    or new.engagement_service_id is distinct from old.engagement_service_id
    or new.project_task_id is distinct from old.project_task_id
    or new.engagement_work_item_id is distinct from old.engagement_work_item_id
    or new.visibility is distinct from old.visibility
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'Creative brief context identity is immutable.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  if new.visibility = 'private' then return new; end if;
  select engagement.project_id into v_project_id from public.engagements engagement
  where engagement.id = new.engagement_id and engagement.organization_id = new.organization_id and engagement.brand_id = new.brand_id;
  if not found then raise exception 'Creative brief engagement and brand chain is invalid.' using errcode = '23514'; end if;
  if not exists (
    select 1 from public.engagement_services service join public.service_catalog catalog on catalog.id = service.service_id
    where service.id = new.engagement_service_id and service.organization_id = new.organization_id
      and service.engagement_id = new.engagement_id and service.status = 'active'
      and catalog.department_id = 'design' and catalog.is_active
  ) then raise exception 'Creative brief requires an active Design service in its engagement.' using errcode = '23514'; end if;
  if new.project_task_id is not null and not exists (
    select 1 from public.tasks task where task.id = new.project_task_id and task.organization_id = new.organization_id
      and task.project_id = v_project_id and task.archived_at is null
  ) then raise exception 'Creative brief project task is outside its project.' using errcode = '23514'; end if;
  if new.engagement_work_item_id is not null and not exists (
    select 1 from public.work_items item where item.id = new.engagement_work_item_id and item.organization_id = new.organization_id
      and item.engagement_id = new.engagement_id and item.deleted_at is null
  ) then raise exception 'Creative brief work item is outside its engagement.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_design_creative_brief_context() from public, anon, authenticated;
grant execute on function private.validate_design_creative_brief_context() to service_role;
create trigger trg_design_creative_briefs_context before insert or update on public.design_creative_briefs
for each row execute function private.validate_design_creative_brief_context();

create or replace function private.validate_design_workshop_session_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_project_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.engagement_id is distinct from old.engagement_id
    or new.brand_id is distinct from old.brand_id
    or new.engagement_service_id is distinct from old.engagement_service_id
    or new.project_task_id is distinct from old.project_task_id
    or new.engagement_work_item_id is distinct from old.engagement_work_item_id
  ) then raise exception 'Design session work context is immutable.' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' then return new; end if;
  select project_id into v_project_id from public.engagements
  where id = new.engagement_id and organization_id = new.organization_id and brand_id = new.brand_id;
  if not found then raise exception 'Design session engagement and brand chain is invalid.' using errcode = '23514'; end if;
  if not exists (
    select 1 from public.engagement_services service
    join public.service_catalog catalog on catalog.id = service.service_id
    where service.id = new.engagement_service_id and service.organization_id = new.organization_id
      and service.engagement_id = new.engagement_id and service.status = 'active'
      and catalog.department_id = 'design' and catalog.is_active
  ) then raise exception 'Design session requires an active Design service in its engagement.' using errcode = '23514'; end if;
  if new.project_task_id is not null and not exists (
    select 1 from public.tasks where id = new.project_task_id and organization_id = new.organization_id
      and project_id = v_project_id and archived_at is null
  ) then raise exception 'Design session task is outside its project.' using errcode = '23514'; end if;
  if new.engagement_work_item_id is not null and not exists (
    select 1 from public.work_items where id = new.engagement_work_item_id and organization_id = new.organization_id
      and engagement_id = new.engagement_id and deleted_at is null
  ) then raise exception 'Design session work item is outside its engagement.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_design_workshop_session_context() from public, anon, authenticated;
grant execute on function private.validate_design_workshop_session_context() to service_role;
create trigger trg_design_workshop_sessions_context before insert or update on public.design_workshop_sessions
for each row execute function private.validate_design_workshop_session_context();

create or replace function private.validate_design_direction_brief_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.creative_brief_version_id is null then return new; end if;
  if not exists (
    select 1
    from public.design_directions direction
    join public.design_workshop_sessions session
      on session.id = direction.session_id and session.organization_id = direction.organization_id
    join public.design_creative_brief_versions brief_version
      on brief_version.id = new.creative_brief_version_id and brief_version.organization_id = new.organization_id
    join public.design_creative_briefs brief
      on brief.id = brief_version.creative_brief_id and brief.organization_id = brief_version.organization_id
    where direction.id = new.direction_id and direction.organization_id = new.organization_id
      and brief.visibility = 'official'
      and brief.engagement_id = session.engagement_id
      and brief.engagement_service_id = session.engagement_service_id
      and brief.project_task_id is not distinct from session.project_task_id
      and brief.engagement_work_item_id is not distinct from session.engagement_work_item_id
  ) then raise exception 'Direction brief version is outside its exact Design session context.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_design_direction_brief_context() from public, anon, authenticated;
grant execute on function private.validate_design_direction_brief_context() to service_role;
create trigger trg_design_direction_versions_brief_context before insert or update of creative_brief_version_id
on public.design_direction_versions for each row execute function private.validate_design_direction_brief_context();

create or replace function private.validate_design_working_direction_preference()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.design_workshop_sessions session
    join public.design_directions direction
      on direction.session_id = session.id and direction.organization_id = session.organization_id
    join public.design_direction_versions version
      on version.direction_id = direction.id and version.organization_id = direction.organization_id
    join public.design_creative_brief_versions brief_version
      on brief_version.id = version.creative_brief_version_id and brief_version.organization_id = version.organization_id
    join public.design_creative_briefs brief
      on brief.id = brief_version.creative_brief_id and brief.organization_id = brief_version.organization_id
    where session.id = new.session_id and session.organization_id = new.organization_id
      and session.engagement_id = new.engagement_id and version.id = new.direction_version_id
      and not version.is_experimental and brief.visibility = 'official'
      and brief.engagement_id = session.engagement_id
      and brief.engagement_service_id = session.engagement_service_id
      and brief.project_task_id is not distinct from session.project_task_id
      and brief.engagement_work_item_id is not distinct from session.engagement_work_item_id
  ) then raise exception 'Working direction preference is outside its exact session and brief context.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_design_working_direction_preference() from public, anon, authenticated;
grant execute on function private.validate_design_working_direction_preference() to service_role;
create trigger trg_design_working_preferences_chain before insert or update on public.design_working_direction_preferences
for each row execute function private.validate_design_working_direction_preference();

create trigger trg_design_creative_brief_versions_immutable before update or delete on public.design_creative_brief_versions
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_design_creative_brief_sources_immutable before update or delete on public.design_creative_brief_version_sources
for each row execute function private.reject_immutable_artifact_history_change();

alter table public.design_creative_briefs enable row level security;
alter table public.design_creative_brief_versions enable row level security;
alter table public.design_creative_brief_version_sources enable row level security;
alter table public.design_working_direction_preferences enable row level security;

create policy "Team can read official or owned Design briefs" on public.design_creative_briefs for select to authenticated
using (public.is_team_organization_member(organization_id) and (visibility = 'official' or created_by = (select auth.uid())));
create policy "Team can read permitted Design brief versions" on public.design_creative_brief_versions for select to authenticated
using (exists (select 1 from public.design_creative_briefs brief
  where brief.id = design_creative_brief_versions.creative_brief_id
    and brief.organization_id = design_creative_brief_versions.organization_id));
create policy "Team can read permitted Design brief sources" on public.design_creative_brief_version_sources for select to authenticated
using (exists (select 1 from public.design_creative_brief_versions version
  where version.id = design_creative_brief_version_sources.creative_brief_version_id
    and version.organization_id = design_creative_brief_version_sources.organization_id));
create policy "Team can read working Design directions" on public.design_working_direction_preferences for select to authenticated
using (public.is_team_organization_member(organization_id));

revoke all on public.design_creative_briefs, public.design_creative_brief_versions,
  public.design_creative_brief_version_sources, public.design_working_direction_preferences from anon, authenticated;
grant select on public.design_creative_briefs, public.design_creative_brief_versions,
  public.design_creative_brief_version_sources, public.design_working_direction_preferences to authenticated;
grant all on public.design_creative_briefs, public.design_creative_brief_versions,
  public.design_creative_brief_version_sources, public.design_working_direction_preferences to service_role;

comment on table public.design_working_direction_preferences is
  'Mutable, reversible Design working state. It is not a selection, approval, or release.';
comment on column public.design_direction_versions.creative_brief_version_id is
  'Exact immutable creative brief version used as the source for this direction draft.';

create or replace function public.save_design_creative_brief_version(
  p_organization_id uuid, p_actor_id uuid, p_creative_brief_id uuid,
  p_visibility text, p_engagement_id uuid, p_brand_id uuid, p_engagement_service_id uuid,
  p_project_task_id uuid, p_engagement_work_item_id uuid, p_expected_revision integer,
  p_operation_key uuid, p_content jsonb, p_content_checksum text,
  p_validation_snapshot jsonb, p_source_version_ids uuid[] default array[]::uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_brief public.design_creative_briefs%rowtype;
  v_version public.design_creative_brief_versions%rowtype;
  v_parent_id uuid; v_version_number integer; v_source_count integer;
begin
  if p_operation_key is null then raise exception 'Operation key is required.' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_actor_id::text || ':' || p_operation_key::text, 0));
  select * into v_version from public.design_creative_brief_versions
  where organization_id = p_organization_id and created_by = p_actor_id and operation_key = p_operation_key;
  if found then
    select * into v_brief from public.design_creative_briefs where id = v_version.creative_brief_id;
    return jsonb_build_object('brief', to_jsonb(v_brief), 'version', to_jsonb(v_version), 'idempotent_replay', true);
  end if;
  if nullif(btrim(p_content->>'title'), '') is null then
    raise exception 'A title is required to save a creative brief.' using errcode = '22023';
  end if;
  if p_creative_brief_id is null then
    if p_expected_revision <> 0 then raise exception 'New brief expected revision must be zero.' using errcode = '40001'; end if;
    insert into public.design_creative_briefs (
      organization_id, engagement_id, brand_id, engagement_service_id, project_task_id,
      engagement_work_item_id, visibility, created_by, updated_by
    ) values (
      p_organization_id, p_engagement_id, p_brand_id, p_engagement_service_id, p_project_task_id,
      p_engagement_work_item_id, p_visibility, p_actor_id, p_actor_id
    ) returning * into v_brief;
  else
    select * into v_brief from public.design_creative_briefs
    where id = p_creative_brief_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Creative brief not found.' using errcode = 'P0002'; end if;
    if v_brief.visibility = 'private' and v_brief.created_by <> p_actor_id then
      raise exception 'Private creative brief is owner-only.' using errcode = '42501';
    end if;
    if v_brief.visibility <> p_visibility
      or v_brief.engagement_id is distinct from p_engagement_id
      or v_brief.brand_id is distinct from p_brand_id
      or v_brief.engagement_service_id is distinct from p_engagement_service_id
      or v_brief.project_task_id is distinct from p_project_task_id
      or v_brief.engagement_work_item_id is distinct from p_engagement_work_item_id then
      raise exception 'Creative brief context cannot be changed by version save.' using errcode = '23514';
    end if;
    if v_brief.revision <> p_expected_revision then
      raise exception 'Creative brief changed; reload the latest saved version.' using errcode = '40001';
    end if;
  end if;
  select id, version_number into v_parent_id, v_version_number
  from public.design_creative_brief_versions where creative_brief_id = v_brief.id
  order by version_number desc limit 1;
  v_version_number := coalesce(v_version_number, 0) + 1;
  select count(*) into v_source_count from public.artifact_versions
  where organization_id = p_organization_id and id = any(coalesce(p_source_version_ids, array[]::uuid[]));
  if v_source_count <> cardinality(coalesce(p_source_version_ids, array[]::uuid[])) then
    raise exception 'One or more pinned source versions are outside the creative brief organization.' using errcode = '23514';
  end if;
  insert into public.design_creative_brief_versions (
    organization_id, creative_brief_id, version_number, parent_version_id, content,
    content_checksum, validation_snapshot, operation_key, created_by
  ) values (
    p_organization_id, v_brief.id, v_version_number, v_parent_id, p_content,
    p_content_checksum, p_validation_snapshot, p_operation_key, p_actor_id
  ) returning * into v_version;
  insert into public.design_creative_brief_version_sources (
    organization_id, creative_brief_version_id, artifact_version_id
  ) select p_organization_id, v_version.id, source_id from unnest(coalesce(p_source_version_ids, array[]::uuid[])) source_id;
  update public.design_creative_briefs set revision = revision + 1, current_version_id = v_version.id,
    updated_by = p_actor_id, updated_at = now() where id = v_brief.id returning * into v_brief;
  return jsonb_build_object('brief', to_jsonb(v_brief), 'version', to_jsonb(v_version), 'idempotent_replay', false);
end;
$$;

revoke all on function public.save_design_creative_brief_version(uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, integer, uuid, jsonb, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.save_design_creative_brief_version(uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, integer, uuid, jsonb, text, jsonb, uuid[]) to service_role;

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

create or replace function public.set_design_working_direction_preference(
  p_organization_id uuid, p_actor_id uuid, p_engagement_id uuid, p_session_id uuid,
  p_direction_version_id uuid, p_expected_revision integer, p_operation_key uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_preference public.design_working_direction_preferences%rowtype;
begin
  if p_operation_key is null then raise exception 'Operation key is required.' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_session_id::text, 0));
  select * into v_preference from public.design_working_direction_preferences
  where session_id = p_session_id and organization_id = p_organization_id for update;
  if found and v_preference.last_operation_key = p_operation_key then
    return jsonb_build_object('preference', to_jsonb(v_preference), 'idempotent_replay', true);
  end if;
  if not exists (
    select 1 from public.design_workshop_sessions session
    join public.design_directions direction on direction.session_id = session.id
      and direction.organization_id = session.organization_id
    join public.design_direction_versions version on version.direction_id = direction.id
      and version.organization_id = direction.organization_id
    where session.id = p_session_id and session.organization_id = p_organization_id
      and session.engagement_id = p_engagement_id and version.id = p_direction_version_id
      and not version.is_experimental
  ) then raise exception 'Working direction version is outside this session or is experimental.' using errcode = '23514'; end if;
  if found then
    if v_preference.revision <> p_expected_revision then
      raise exception 'Working direction changed; reload before replacing it.' using errcode = '40001';
    end if;
    update public.design_working_direction_preferences set direction_version_id = p_direction_version_id,
      revision = revision + 1, last_operation_key = p_operation_key,
      updated_by = p_actor_id, updated_at = now()
    where id = v_preference.id returning * into v_preference;
  else
    if p_expected_revision <> 0 then raise exception 'New working direction expected revision must be zero.' using errcode = '40001'; end if;
    insert into public.design_working_direction_preferences (
      organization_id, engagement_id, session_id, direction_version_id, last_operation_key,
      created_by, updated_by
    ) values (
      p_organization_id, p_engagement_id, p_session_id, p_direction_version_id,
      p_operation_key, p_actor_id, p_actor_id
    ) returning * into v_preference;
  end if;
  return jsonb_build_object('preference', to_jsonb(v_preference), 'idempotent_replay', false);
end;
$$;

revoke all on function public.set_design_working_direction_preference(uuid, uuid, uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.set_design_working_direction_preference(uuid, uuid, uuid, uuid, uuid, integer, uuid) to service_role;

commit;
