-- OAF2 - Canonical ownership and engagement convergence.
--
-- public.clients and public.projects remain the canonical identity and
-- ownership roots. Operating Spine agency_clients and engagements remain
-- stable-ID, one-to-one commercial/workflow extensions so their existing
-- child graphs do not need to be re-keyed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Additive canonical ownership columns
-- ---------------------------------------------------------------------------

alter table public.agency_clients
  add column canonical_client_id uuid;

alter table public.engagements
  add column project_id uuid;

alter table public.artifacts
  add column project_id uuid;

alter table public.work_items
  add column project_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass
      and conname = 'clients_id_organization_id_key'
  ) then
    alter table public.clients
      add constraint clients_id_organization_id_key
      unique (id, organization_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_id_organization_id_key'
  ) then
    alter table public.projects
      add constraint projects_id_organization_id_key
      unique (id, organization_id);
  end if;
end;
$$;

-- Refuse to normalize a pre-existing cross-organisation legacy bridge.
do $$
begin
  if exists (
    select 1
    from public.agency_clients agency_client
    join public.clients client on client.id = agency_client.legacy_client_id
    where agency_client.organization_id <> client.organization_id
  ) then
    raise exception 'OAF2 found a cross-organization client compatibility link.';
  end if;

  if exists (
    select 1
    from public.engagements engagement
    join public.projects project on project.id = engagement.legacy_project_id
    where engagement.organization_id <> project.organization_id
  ) then
    raise exception 'OAF2 found a cross-organization project compatibility link.';
  end if;
end;
$$;

update public.agency_clients
set canonical_client_id = legacy_client_id
where legacy_client_id is not null;

-- Preserve any Operating Spine-only client (including controlled QA records)
-- by materialising its missing canonical client root. No source row is deleted.
do $$
declare
  agency_client record;
  v_client_id uuid;
begin
  for agency_client in
    select *
    from public.agency_clients
    where canonical_client_id is null
    order by id
  loop
    insert into public.clients (
      name, email, company, industry, status, notes, owner_id, organization_id
    ) values (
      agency_client.name,
      agency_client.primary_email,
      coalesce(nullif(agency_client.legal_name, ''), agency_client.name),
      agency_client.industry,
      case agency_client.status
        when 'prospect' then 'lead'
        when 'paused' then 'inactive'
        when 'former' then 'churned'
        else 'active'
      end,
      'Canonical root materialized by OAF2 from Operating Spine client ' || agency_client.id::text,
      agency_client.owner_id,
      agency_client.organization_id
    ) returning id into v_client_id;

    update public.agency_clients
    set canonical_client_id = v_client_id,
        legacy_client_id = v_client_id
    where id = agency_client.id;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from public.agency_clients where canonical_client_id is null) then
    raise exception 'OAF2 failed to materialize every canonical client root.';
  end if;
end;
$$;

update public.engagements
set project_id = legacy_project_id
where legacy_project_id is not null;

-- Preserve every Operating Spine-only engagement by materialising its missing
-- canonical project. The existing project trigger creates its Living Record.
do $$
declare
  engagement record;
  v_project_id uuid;
  v_client_id uuid;
begin
  for engagement in
    select *
    from public.engagements
    where project_id is null
    order by id
  loop
    select agency_client.canonical_client_id
    into v_client_id
    from public.agency_clients agency_client
    where agency_client.id = engagement.client_id
      and agency_client.organization_id = engagement.organization_id;

    if v_client_id is null then
      raise exception 'Engagement % has no canonical client root.', engagement.id;
    end if;

    insert into public.projects (
      name, description, status, priority, owner_id, start_date, due_date,
      progress, organization_id, client_id, engagement_type, client_summary,
      portal_visible, scope_statement, exclusions, health, archived_at
    ) values (
      engagement.name,
      engagement.objective,
      case engagement.status when 'cancelled' then 'archived' else engagement.status end,
      'medium',
      engagement.lead_owner_id,
      engagement.start_date,
      engagement.target_date,
      case when engagement.status = 'completed' then 100 else 0 end,
      engagement.organization_id,
      v_client_id,
      engagement.engagement_type,
      '',
      false,
      engagement.objective,
      '',
      case when engagement.status = 'completed' then 'completed' else 'unknown' end,
      case when engagement.status = 'cancelled' then now() else null end
    ) returning id into v_project_id;

    update public.engagements
    set project_id = v_project_id,
        legacy_project_id = v_project_id
    where id = engagement.id;
  end loop;
end;
$$;

update public.artifacts artifact
set project_id = engagement.project_id
from public.engagements engagement
where artifact.engagement_id = engagement.id
  and artifact.organization_id = engagement.organization_id;

update public.work_items work_item
set project_id = engagement.project_id
from public.engagements engagement
where work_item.engagement_id = engagement.id
  and work_item.organization_id = engagement.organization_id;

update public.ai_runs ai_run
set project_id = engagement.project_id
from public.engagements engagement
where ai_run.engagement_id = engagement.id
  and ai_run.organization_id = engagement.organization_id;

do $$
begin
  if exists (
    select 1
    from public.engagements engagement
    join public.agency_clients agency_client
      on agency_client.id = engagement.client_id
     and agency_client.organization_id = engagement.organization_id
    join public.projects project
      on project.id = engagement.project_id
     and project.organization_id = engagement.organization_id
    where agency_client.canonical_client_id is distinct from project.client_id
  ) then
    raise exception 'OAF2 found an engagement whose canonical project belongs to another client.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Enforced one-to-one and derived ownership invariants
-- ---------------------------------------------------------------------------

alter table public.agency_clients
  alter column canonical_client_id set not null,
  alter column legacy_client_id set not null;

alter table public.engagements
  alter column project_id set not null,
  alter column legacy_project_id set not null;

alter table public.work_items
  alter column project_id set not null;

alter table public.agency_clients
  add constraint agency_clients_canonical_client_id_key
    unique (canonical_client_id),
  add constraint agency_clients_id_canonical_client_organization_key
    unique (id, canonical_client_id, organization_id),
  add constraint agency_clients_compatibility_alias_check
    check (legacy_client_id = canonical_client_id),
  add constraint agency_clients_canonical_client_organization_fkey
    foreign key (canonical_client_id, organization_id)
    references public.clients(id, organization_id) on delete restrict;

alter table public.engagements
  add constraint engagements_project_id_key
    unique (project_id),
  add constraint engagements_id_project_organization_key
    unique (id, project_id, organization_id),
  add constraint engagements_compatibility_alias_check
    check (legacy_project_id = project_id),
  add constraint engagements_project_organization_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict;

alter table public.artifacts
  add constraint artifacts_engagement_project_presence_check
    check (
      (engagement_id is null and project_id is null)
      or (engagement_id is not null and project_id is not null)
    ),
  add constraint artifacts_engagement_project_organization_fkey
    foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id)
    on delete cascade;

alter table public.work_items
  add constraint work_items_engagement_project_organization_fkey
    foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id)
    on delete cascade;

alter table public.ai_runs
  drop constraint ai_runs_single_commercial_context_check;

alter table public.ai_runs
  add constraint ai_runs_engagement_requires_project_check
    check (engagement_id is null or project_id is not null),
  add constraint ai_runs_engagement_project_organization_fkey
    foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id);

create index idx_agency_clients_canonical_client
  on public.agency_clients(canonical_client_id, organization_id);
create index idx_engagements_project
  on public.engagements(project_id, organization_id);
create index idx_artifacts_project
  on public.artifacts(project_id, created_at desc)
  where project_id is not null;
create index idx_work_items_project_active
  on public.work_items(project_id, position)
  where deleted_at is null;
create index idx_ai_runs_engagement_project
  on public.ai_runs(engagement_id, project_id)
  where engagement_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Backwards-compatible canonical-root creation and ownership derivation
-- ---------------------------------------------------------------------------

create or replace function private.ensure_agency_client_canonical_root()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  if new.canonical_client_id is null and new.legacy_client_id is not null then
    new.canonical_client_id := new.legacy_client_id;
  end if;

  if new.canonical_client_id is null then
    insert into public.clients (
      name, email, company, industry, status, notes, owner_id, organization_id
    ) values (
      new.name,
      new.primary_email,
      coalesce(nullif(new.legal_name, ''), new.name),
      new.industry,
      case new.status
        when 'prospect' then 'lead'
        when 'paused' then 'inactive'
        when 'former' then 'churned'
        else 'active'
      end,
      'Canonical root created through the OAF2 compatibility path.',
      new.owner_id,
      new.organization_id
    ) returning id into v_client_id;
    new.canonical_client_id := v_client_id;
  end if;

  new.legacy_client_id := new.canonical_client_id;
  return new;
end;
$$;

create or replace function private.protect_agency_client_canonical_root()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.canonical_client_id is distinct from old.canonical_client_id
     or new.legacy_client_id is distinct from old.legacy_client_id then
    raise exception 'Canonical client ownership is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.ensure_engagement_canonical_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_client_id uuid;
begin
  if new.project_id is null and new.legacy_project_id is not null then
    new.project_id := new.legacy_project_id;
  end if;

  if new.project_id is null then
    select agency_client.canonical_client_id
    into v_client_id
    from public.agency_clients agency_client
    where agency_client.id = new.client_id
      and agency_client.organization_id = new.organization_id;

    if v_client_id is null then
      raise exception 'The engagement client has no canonical client root.' using errcode = '23503';
    end if;

    insert into public.projects (
      name, description, status, priority, owner_id, start_date, due_date,
      progress, organization_id, client_id, engagement_type, client_summary,
      portal_visible, scope_statement, exclusions, health, archived_at
    ) values (
      new.name,
      new.objective,
      case new.status when 'cancelled' then 'archived' else new.status end,
      'medium',
      new.lead_owner_id,
      new.start_date,
      new.target_date,
      case when new.status = 'completed' then 100 else 0 end,
      new.organization_id,
      v_client_id,
      new.engagement_type,
      '',
      false,
      new.objective,
      '',
      case when new.status = 'completed' then 'completed' else 'unknown' end,
      case when new.status = 'cancelled' then now() else null end
    ) returning id into v_project_id;
    new.project_id := v_project_id;
  end if;

  new.legacy_project_id := new.project_id;
  return new;
end;
$$;

create or replace function private.protect_engagement_canonical_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.legacy_project_id is distinct from old.legacy_project_id then
    raise exception 'Canonical project ownership is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.protect_engaged_project_client()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id
     and exists (
       select 1
       from public.engagements engagement
       where engagement.project_id = old.id
         and engagement.organization_id = old.organization_id
     ) then
    raise exception 'A project with an engagement cannot change client ownership.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.validate_engagement_canonical_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_canonical_client_id uuid;
  v_project_client_id uuid;
begin
  select agency_client.canonical_client_id
  into v_canonical_client_id
  from public.agency_clients agency_client
  where agency_client.id = new.client_id
    and agency_client.organization_id = new.organization_id;

  if not found then
    raise exception 'The engagement client is unavailable in its organization.'
      using errcode = '23514';
  end if;

  select project.client_id
  into v_project_client_id
  from public.projects project
  where project.id = new.project_id
    and project.organization_id = new.organization_id;

  if not found or v_project_client_id is distinct from v_canonical_client_id then
    raise exception 'The engagement project must belong to its canonical client.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.derive_engagement_project_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  if new.engagement_id is null then
    return new;
  end if;

  select engagement.project_id
  into v_project_id
  from public.engagements engagement
  where engagement.id = new.engagement_id
    and engagement.organization_id = new.organization_id;

  if v_project_id is null then
    raise exception 'The selected engagement has no canonical project ownership.' using errcode = '23503';
  end if;
  if new.project_id is not null and new.project_id <> v_project_id then
    raise exception 'Engagement and project ownership do not match.' using errcode = '23514';
  end if;

  new.project_id := v_project_id;
  return new;
end;
$$;

drop trigger if exists trg_oaf2_ensure_agency_client_root on public.agency_clients;
create trigger trg_oaf2_ensure_agency_client_root
before insert on public.agency_clients
for each row execute function private.ensure_agency_client_canonical_root();

drop trigger if exists trg_oaf2_protect_agency_client_root on public.agency_clients;
create trigger trg_oaf2_protect_agency_client_root
before update of organization_id, canonical_client_id, legacy_client_id
on public.agency_clients
for each row execute function private.protect_agency_client_canonical_root();

drop trigger if exists trg_oaf2_ensure_engagement_project on public.engagements;
create trigger trg_oaf2_ensure_engagement_project
before insert on public.engagements
for each row execute function private.ensure_engagement_canonical_project();

drop trigger if exists trg_oaf2_protect_engagement_project on public.engagements;
create trigger trg_oaf2_protect_engagement_project
before update of organization_id, project_id, legacy_project_id
on public.engagements
for each row execute function private.protect_engagement_canonical_project();

drop trigger if exists trg_oaf2_protect_engaged_project_client on public.projects;
create trigger trg_oaf2_protect_engaged_project_client
before update of client_id on public.projects
for each row execute function private.protect_engaged_project_client();

drop trigger if exists trg_oaf2_validate_engagement_ownership on public.engagements;
create trigger trg_oaf2_validate_engagement_ownership
before insert or update of organization_id, client_id, project_id
on public.engagements
for each row execute function private.validate_engagement_canonical_ownership();

drop trigger if exists trg_oaf2_derive_artifact_project on public.artifacts;
create trigger trg_oaf2_derive_artifact_project
before insert or update of engagement_id, project_id, organization_id
on public.artifacts
for each row execute function private.derive_engagement_project_ownership();

drop trigger if exists trg_oaf2_derive_work_item_project on public.work_items;
create trigger trg_oaf2_derive_work_item_project
before insert or update of engagement_id, project_id, organization_id
on public.work_items
for each row execute function private.derive_engagement_project_ownership();

drop trigger if exists trg_oaf2_derive_ai_run_project on public.ai_runs;
create trigger trg_oaf2_derive_ai_run_project
before insert or update of engagement_id, project_id, organization_id
on public.ai_runs
for each row execute function private.derive_engagement_project_ownership();

create or replace function private.sync_agency_client_from_canonical_client()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.agency_clients
  set name = new.name,
      primary_email = new.email,
      industry = new.industry,
      status = case new.status
        when 'lead' then 'prospect'
        when 'inactive' then 'paused'
        when 'churned' then 'former'
        else 'active'
      end,
      owner_id = new.owner_id
  where canonical_client_id = new.id
    and organization_id = new.organization_id;
  return new;
end;
$$;

create or replace function private.sync_engagement_from_canonical_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.engagements
  set name = new.name,
      objective = coalesce(nullif(new.scope_statement, ''), new.description),
      status = case new.status when 'archived' then 'cancelled' else new.status end,
      lead_owner_id = new.owner_id,
      start_date = new.start_date,
      target_date = new.due_date
  where project_id = new.id
    and organization_id = new.organization_id;
  return new;
end;
$$;

drop trigger if exists trg_oaf2_sync_agency_client on public.clients;
create trigger trg_oaf2_sync_agency_client
after update of name, email, industry, status, owner_id on public.clients
for each row execute function private.sync_agency_client_from_canonical_client();

drop trigger if exists trg_oaf2_sync_engagement on public.projects;
create trigger trg_oaf2_sync_engagement
after update of name, description, scope_statement, status, owner_id, start_date, due_date
on public.projects
for each row execute function private.sync_engagement_from_canonical_project();

-- ---------------------------------------------------------------------------
-- 4. Transactional client + commercial profile + default brand creation
-- ---------------------------------------------------------------------------

create or replace function public.create_commercial_client(
  p_name text,
  p_brand_name text,
  p_legal_name text default '',
  p_primary_email text default null,
  p_website_url text default null,
  p_industry text default '',
  p_brand_description text default '',
  p_brand_website_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_client public.clients;
  v_agency_client public.agency_clients;
  v_brand public.brands;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_brand_name), '') is null then
    raise exception 'Client and brand names are required.' using errcode = '22023';
  end if;

  select membership.organization_id
  into v_organization_id
  from public.organization_memberships membership
  where membership.user_id = v_actor_id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  order by membership.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'Active team membership is required.' using errcode = '42501';
  end if;

  insert into public.clients (
    name, email, company, industry, status, notes, owner_id, organization_id
  ) values (
    trim(p_name),
    nullif(trim(p_primary_email), ''),
    coalesce(nullif(trim(p_legal_name), ''), trim(p_name)),
    coalesce(trim(p_industry), ''),
    'active',
    '',
    v_actor_id,
    v_organization_id
  ) returning * into v_client;

  insert into public.agency_clients (
    organization_id, canonical_client_id, legacy_client_id, name, legal_name,
    primary_email, website_url, industry, status, owner_id, created_by
  ) values (
    v_organization_id,
    v_client.id,
    v_client.id,
    v_client.name,
    v_client.company,
    v_client.email,
    nullif(trim(p_website_url), ''),
    v_client.industry,
    'active',
    v_actor_id,
    v_actor_id
  ) returning * into v_agency_client;

  insert into public.brands (
    organization_id, client_id, name, description, website_url,
    status, is_default, created_by
  ) values (
    v_organization_id,
    v_agency_client.id,
    trim(p_brand_name),
    coalesce(trim(p_brand_description), ''),
    coalesce(nullif(trim(p_brand_website_url), ''), nullif(trim(p_website_url), '')),
    'active',
    true,
    v_actor_id
  ) returning * into v_brand;

  return jsonb_build_object(
    'canonical_client', to_jsonb(v_client),
    'client', to_jsonb(v_agency_client),
    'brand', to_jsonb(v_brand)
  );
end;
$$;

revoke all on function public.create_commercial_client(
  text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_commercial_client(
  text, text, text, text, text, text, text, text
) to authenticated, service_role;

revoke all on function private.ensure_agency_client_canonical_root()
  from public, anon, authenticated;
revoke all on function private.protect_agency_client_canonical_root()
  from public, anon, authenticated;
revoke all on function private.ensure_engagement_canonical_project()
  from public, anon, authenticated;
revoke all on function private.protect_engagement_canonical_project()
  from public, anon, authenticated;
revoke all on function private.protect_engaged_project_client()
  from public, anon, authenticated;
revoke all on function private.validate_engagement_canonical_ownership()
  from public, anon, authenticated;
revoke all on function private.derive_engagement_project_ownership()
  from public, anon, authenticated;
revoke all on function private.sync_agency_client_from_canonical_client()
  from public, anon, authenticated;
revoke all on function private.sync_engagement_from_canonical_project()
  from public, anon, authenticated;

grant execute on function private.ensure_agency_client_canonical_root() to service_role;
grant execute on function private.protect_agency_client_canonical_root() to service_role;
grant execute on function private.ensure_engagement_canonical_project() to service_role;
grant execute on function private.protect_engagement_canonical_project() to service_role;
grant execute on function private.protect_engaged_project_client() to service_role;
grant execute on function private.validate_engagement_canonical_ownership() to service_role;
grant execute on function private.derive_engagement_project_ownership() to service_role;
grant execute on function private.sync_agency_client_from_canonical_client() to service_role;
grant execute on function private.sync_engagement_from_canonical_project() to service_role;

comment on column public.agency_clients.canonical_client_id is
  'Canonical public.clients ownership root. legacy_client_id is a temporary constrained alias.';
comment on column public.engagements.project_id is
  'Canonical public.projects ownership root. legacy_project_id is a temporary constrained alias.';
comment on column public.artifacts.project_id is
  'Canonical project ownership derived from engagement_id; null only for brand-library artifacts.';
comment on column public.work_items.project_id is
  'Canonical project ownership derived from the required engagement_id.';
comment on function public.create_commercial_client(
  text, text, text, text, text, text, text, text
) is
  'Atomically creates one canonical client, its Operating Spine commercial profile, and its default brand.';

commit;
