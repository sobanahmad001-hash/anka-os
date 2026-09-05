-- PLN2: immutable versioned service-selection presets for the canonical Operating Spine.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.pipeline_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)
);

create table public.pipeline_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_template_id uuid not null,
  version_number integer not null check (version_number > 0),
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 4000),
  change_summary text not null default '' check (length(change_summary) <= 1000),
  source_version_id uuid,
  service_selection_sha256 text not null
    check (service_selection_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint pipeline_template_versions_template_org_fk
    foreign key (pipeline_template_id, organization_id)
    references public.pipeline_templates(id, organization_id) on delete restrict,
  unique (pipeline_template_id, version_number),
  unique (id, pipeline_template_id, organization_id)
);

alter table public.pipeline_template_versions
  add constraint pipeline_template_versions_source_org_fk
  foreign key (source_version_id, pipeline_template_id, organization_id)
  references public.pipeline_template_versions(id, pipeline_template_id, organization_id)
  on delete restrict;

create table public.pipeline_template_version_services (
  organization_id uuid not null,
  pipeline_template_id uuid not null,
  pipeline_template_version_id uuid not null,
  service_id uuid not null,
  position integer not null check (position >= 0),
  primary key (pipeline_template_version_id, service_id),
  constraint pipeline_template_services_version_org_fk
    foreign key (pipeline_template_version_id, pipeline_template_id, organization_id)
    references public.pipeline_template_versions(id, pipeline_template_id, organization_id)
    on delete restrict,
  constraint pipeline_template_services_service_org_fk
    foreign key (service_id, organization_id)
    references public.service_catalog(id, organization_id) on delete restrict,
  unique (pipeline_template_version_id, position)
);

create table public.pipeline_template_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_template_id uuid not null,
  pipeline_template_version_id uuid not null,
  publication_number integer not null check (publication_number > 0),
  published_rule_manifest jsonb not null
    check (jsonb_typeof(published_rule_manifest) = 'object'),
  published_rule_sha256 text not null
    check (published_rule_sha256 ~ '^[0-9a-f]{64}$'),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  constraint pipeline_publications_version_org_fk
    foreign key (pipeline_template_version_id, pipeline_template_id, organization_id)
    references public.pipeline_template_versions(id, pipeline_template_id, organization_id)
    on delete restrict,
  unique (pipeline_template_version_id),
  unique (pipeline_template_id, publication_number)
);

-- PLN3 will write one immutable provenance row when a preset-backed engagement
-- is created. Keeping this separate avoids changing canonical engagement ownership.
create table public.engagement_pipeline_origins (
  engagement_id uuid primary key,
  organization_id uuid not null,
  pipeline_template_id uuid not null,
  pipeline_template_version_id uuid not null,
  original_selection_sha256 text not null
    check (original_selection_sha256 ~ '^[0-9a-f]{64}$'),
  final_selection_sha256 text not null
    check (final_selection_sha256 ~ '^[0-9a-f]{64}$'),
  was_customized boolean not null default false,
  customization_provenance jsonb not null default '[]'::jsonb
    check (jsonb_typeof(customization_provenance) = 'array'),
  preview_rule_sha256 text not null
    check (preview_rule_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint engagement_pipeline_origins_engagement_org_fk
    foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete restrict,
  constraint engagement_pipeline_origins_version_org_fk
    foreign key (pipeline_template_version_id, pipeline_template_id, organization_id)
    references public.pipeline_template_versions(id, pipeline_template_id, organization_id)
    on delete restrict,
  check (
    (was_customized and jsonb_array_length(customization_provenance) > 0)
    or (not was_customized and jsonb_array_length(customization_provenance) = 0
      and original_selection_sha256 = final_selection_sha256)
  )
);

-- PLN3 will use this server-only ledger for organization-scoped exact replay.
create table public.engagement_composition_requests (
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  request_id uuid not null,
  normalized_payload_sha256 text not null
    check (normalized_payload_sha256 ~ '^[0-9a-f]{64}$'),
  preview_rule_sha256 text not null
    check (preview_rule_sha256 ~ '^[0-9a-f]{64}$'),
  engagement_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id),
  constraint engagement_composition_requests_engagement_org_fk
    foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete restrict,
  unique (engagement_id, organization_id)
);

create index idx_pipeline_template_versions_template_org_fk
  on public.pipeline_template_versions(pipeline_template_id, organization_id);
create index idx_pipeline_templates_created_by
  on public.pipeline_templates(created_by);
create index idx_pipeline_template_versions_source_org_fk
  on public.pipeline_template_versions(source_version_id, pipeline_template_id, organization_id)
  where source_version_id is not null;
create index idx_pipeline_template_versions_created_by
  on public.pipeline_template_versions(created_by);
create index idx_pipeline_template_services_version_org_fk
  on public.pipeline_template_version_services(
    pipeline_template_version_id, pipeline_template_id, organization_id
  );
create index idx_pipeline_template_services_service_org_fk
  on public.pipeline_template_version_services(service_id, organization_id);
create index idx_pipeline_publications_version_org_fk
  on public.pipeline_template_publications(
    pipeline_template_version_id, pipeline_template_id, organization_id
  );
create index idx_pipeline_publications_current
  on public.pipeline_template_publications(
    pipeline_template_id, publication_number desc, published_at desc
  );
create index idx_pipeline_publications_published_by
  on public.pipeline_template_publications(published_by);
create index idx_engagement_pipeline_origins_engagement_org_fk
  on public.engagement_pipeline_origins(engagement_id, organization_id);
create index idx_engagement_pipeline_origins_version_org_fk
  on public.engagement_pipeline_origins(
    pipeline_template_version_id, pipeline_template_id, organization_id
  );
create index idx_engagement_pipeline_origins_created_by
  on public.engagement_pipeline_origins(created_by);
create index idx_engagement_composition_requests_requested_by
  on public.engagement_composition_requests(requested_by);

create or replace function private.reject_pipeline_template_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Pipeline templates, versions, selections, publications, provenance, and composition requests are append-only.'
    using errcode = '55000';
end;
$$;

revoke all on function private.reject_pipeline_template_mutation()
  from public, anon, authenticated;

create trigger protect_pipeline_templates
before update or delete on public.pipeline_templates
for each row execute function private.reject_pipeline_template_mutation();
create trigger protect_pipeline_template_versions
before update or delete on public.pipeline_template_versions
for each row execute function private.reject_pipeline_template_mutation();
create trigger protect_pipeline_template_services
before update or delete on public.pipeline_template_version_services
for each row execute function private.reject_pipeline_template_mutation();
create trigger protect_pipeline_template_publications
before update or delete on public.pipeline_template_publications
for each row execute function private.reject_pipeline_template_mutation();
create trigger protect_engagement_pipeline_origins
before update or delete on public.engagement_pipeline_origins
for each row execute function private.reject_pipeline_template_mutation();
create trigger protect_engagement_composition_requests
before update or delete on public.engagement_composition_requests
for each row execute function private.reject_pipeline_template_mutation();

create or replace function private.pipeline_service_selection_sha256(p_service_ids uuid[])
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(
    coalesce((
      select jsonb_agg(selected.service_id::text order by selected.position)::text
      from unnest(p_service_ids) with ordinality selected(service_id, position)
    ), '[]'), 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function private.pipeline_service_selection_sha256(uuid[])
  from public, anon, authenticated;

create or replace function private.pipeline_rule_manifest(
  p_organization_id uuid,
  p_service_ids uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_services as (
    select selected.service_id, selected.position
    from unnest(p_service_ids) with ordinality selected(service_id, position)
  ), selected_rules as (
    select rule.*
    from public.service_stage_rules rule
    join selected_services selected on selected.service_id = rule.service_id
    where rule.organization_id = p_organization_id
  ), relevant_stage_ids as (
    select target_stage_id as stage_id from selected_rules
    union
    select fallback_stage_id from selected_rules where fallback_stage_id is not null
    union
    select stage.id
    from selected_rules rule
    cross join lateral unnest(rule.satisfied_by_stage_slugs) satisfied(stage_slug)
    join public.blueprint_stage_catalog stage
      on stage.organization_id = p_organization_id and stage.slug = satisfied.stage_slug
  )
  select jsonb_build_object(
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', service.id,
        'slug', service.slug,
        'department_id', service.department_id,
        'display_order', service.display_order,
        'is_active', service.is_active
      ) order by selected.position)
      from selected_services selected
      join public.service_catalog service
        on service.id = selected.service_id
       and service.organization_id = p_organization_id
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', rule.service_id,
        'target_stage_id', rule.target_stage_id,
        'rule_kind', rule.rule_kind,
        'prerequisite_key', rule.prerequisite_key,
        'prerequisite_description', rule.prerequisite_description,
        'accepted_asset_kinds', rule.accepted_asset_kinds,
        'satisfied_by_stage_slugs', rule.satisfied_by_stage_slugs,
        'fallback_stage_id', rule.fallback_stage_id
      ) order by selected.position, rule.rule_kind, coalesce(rule.prerequisite_key, ''))
      from selected_rules rule
      join selected_services selected on selected.service_id = rule.service_id
    ), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', stage.id,
        'slug', stage.slug,
        'name', stage.name,
        'accountable_department_id', stage.accountable_department_id,
        'display_order', stage.display_order,
        'stage_kind', stage.stage_kind
      ) order by stage.display_order, stage.slug)
      from public.blueprint_stage_catalog stage
      join relevant_stage_ids relevant on relevant.stage_id = stage.id
      where stage.organization_id = p_organization_id
    ), '[]'::jsonb),
    'dependencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_id', dependency.stage_id,
        'depends_on_stage_id', dependency.depends_on_stage_id,
        'reason', dependency.reason
      ) order by dependency.stage_id, dependency.depends_on_stage_id)
      from public.blueprint_stage_dependencies dependency
      where dependency.organization_id = p_organization_id
        and dependency.stage_id in (select stage_id from relevant_stage_ids)
        and dependency.depends_on_stage_id in (select stage_id from relevant_stage_ids)
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.pipeline_rule_manifest(uuid, uuid[])
  from public, anon, authenticated;

create or replace function private.is_active_pipeline_team_member(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      join public.organization_memberships membership
        on membership.organization_id = organization.id
      where organization.id = p_organization_id
        and organization.status = 'active'
        and membership.user_id = (select auth.uid())
        and membership.member_kind = 'team'
        and membership.status = 'active'
    );
$$;

revoke all on function private.is_active_pipeline_team_member(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_active_pipeline_team_member(uuid)
  to authenticated, service_role;

create or replace function private.has_active_pipeline_template_role(
  p_organization_id uuid,
  p_allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      join public.organization_memberships membership
        on membership.organization_id = organization.id
      where organization.id = p_organization_id
        and organization.status = 'active'
        and membership.user_id = (select auth.uid())
        and membership.member_kind = 'team'
        and membership.status = 'active'
        and membership.role = any(p_allowed_roles)
    );
$$;

revoke all on function private.has_active_pipeline_template_role(uuid, text[])
  from public, anon, authenticated, service_role;

create or replace function private.can_read_pipeline_template_version(
  p_version_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.is_active_pipeline_team_member(p_organization_id)
    and exists (
      select 1
      from public.pipeline_template_versions version
      where version.id = p_version_id
        and version.organization_id = p_organization_id
        and (
          version.created_by = (select auth.uid())
          or private.has_active_pipeline_template_role(
            p_organization_id,
            array['system_owner', 'operations_admin', 'department_manager']
          )
          or exists (
            select 1 from public.pipeline_template_publications publication
            where publication.pipeline_template_version_id = version.id
              and publication.organization_id = version.organization_id
          )
        )
    );
$$;

revoke all on function private.can_read_pipeline_template_version(uuid, uuid)
  from public, anon;
grant execute on function private.can_read_pipeline_template_version(uuid, uuid)
  to authenticated, service_role;

create or replace function public.create_pipeline_template_version(
  p_organization_id uuid,
  p_pipeline_template_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_service_ids uuid[],
  p_source_version_id uuid,
  p_change_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_template public.pipeline_templates;
  v_version public.pipeline_template_versions;
  v_requested_count integer;
  v_available_count integer;
  v_version_number integer;
  v_selection_sha256 text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not private.has_active_pipeline_template_role(
    p_organization_id,
    array['system_owner', 'operations_admin', 'department_manager']
  ) then
    raise exception 'Pipeline template drafting requires an authorized organization role.'
      using errcode = '42501';
  end if;
  if nullif(trim(p_slug), '') is null
     or trim(p_slug) !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' then
    raise exception 'Pipeline template slug must be snake_case.' using errcode = '22023';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 160 then
    raise exception 'Pipeline template name is required and must be at most 160 characters.'
      using errcode = '22023';
  end if;
  if length(coalesce(p_description, '')) > 4000
     or length(coalesce(p_change_summary, '')) > 1000 then
    raise exception 'Pipeline template description or change summary is too long.'
      using errcode = '22023';
  end if;
  if coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'At least one service is required.' using errcode = '22023';
  end if;

  select count(*), count(distinct selected.service_id)
    into v_requested_count, v_available_count
  from unnest(p_service_ids) selected(service_id);
  if v_requested_count <> v_available_count then
    raise exception 'Pipeline template services must be unique.' using errcode = '22023';
  end if;

  select count(*) into v_available_count
  from public.service_catalog service
  where service.organization_id = p_organization_id
    and service.is_active
    and service.id = any(p_service_ids);
  if v_available_count <> v_requested_count then
    raise exception 'One or more pipeline template services are unavailable.'
      using errcode = '22023';
  end if;

  if p_pipeline_template_id is null then
    insert into public.pipeline_templates (organization_id, slug, created_by)
    values (p_organization_id, trim(p_slug), v_actor_id)
    returning * into v_template;
  else
    select * into v_template
    from public.pipeline_templates template
    where template.id = p_pipeline_template_id
      and template.organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'Pipeline template not found.' using errcode = 'P0002';
    end if;
    if v_template.slug <> trim(p_slug) then
      raise exception 'Pipeline template slug is immutable.' using errcode = '22023';
    end if;
  end if;

  if p_source_version_id is not null and not exists (
    select 1 from public.pipeline_template_versions source
    where source.id = p_source_version_id
      and source.pipeline_template_id = v_template.id
      and source.organization_id = p_organization_id
  ) then
    raise exception 'Source pipeline template version is unavailable.' using errcode = '22023';
  end if;

  select coalesce(max(version.version_number), 0) + 1
    into v_version_number
  from public.pipeline_template_versions version
  where version.pipeline_template_id = v_template.id;

  v_selection_sha256 := private.pipeline_service_selection_sha256(p_service_ids);

  insert into public.pipeline_template_versions (
    organization_id, pipeline_template_id, version_number, name, description,
    change_summary, source_version_id, service_selection_sha256, created_by
  ) values (
    p_organization_id, v_template.id, v_version_number, trim(p_name),
    coalesce(trim(p_description), ''), coalesce(trim(p_change_summary), ''),
    p_source_version_id, v_selection_sha256, v_actor_id
  ) returning * into v_version;

  insert into public.pipeline_template_version_services (
    organization_id, pipeline_template_id, pipeline_template_version_id,
    service_id, position
  )
  select p_organization_id, v_template.id, v_version.id,
    selected.service_id, selected.position - 1
  from unnest(p_service_ids) with ordinality selected(service_id, position);

  return jsonb_build_object(
    'pipeline_template_id', v_template.id,
    'pipeline_template_version_id', v_version.id,
    'version_number', v_version.version_number,
    'service_selection_sha256', v_selection_sha256
  );
end;
$$;

create or replace function public.publish_pipeline_template_version(
  p_pipeline_template_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_version public.pipeline_template_versions;
  v_publication public.pipeline_template_publications;
  v_service_ids uuid[];
  v_manifest jsonb;
  v_rule_sha256 text;
  v_publication_number integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_version
  from public.pipeline_template_versions version
  where version.id = p_pipeline_template_version_id;
  if not found then
    raise exception 'Pipeline template version not found.' using errcode = 'P0002';
  end if;
  if not private.has_active_pipeline_template_role(
    v_version.organization_id,
    array['system_owner', 'operations_admin']
  ) then
    raise exception 'Only a System Owner or Operations Admin can publish pipeline templates.'
      using errcode = '42501';
  end if;

  select * into v_publication
  from public.pipeline_template_publications publication
  where publication.pipeline_template_version_id = v_version.id;
  if found then
    return jsonb_build_object(
      'pipeline_template_publication_id', v_publication.id,
      'pipeline_template_version_id', v_version.id,
      'publication_number', v_publication.publication_number,
      'published_rule_sha256', v_publication.published_rule_sha256,
      'idempotent_replay', true
    );
  end if;

  perform 1 from public.pipeline_templates template
  where template.id = v_version.pipeline_template_id
    and template.organization_id = v_version.organization_id
  for update;

  -- A concurrent publisher may have completed while this call waited for the
  -- template lock. Recheck so every replay returns the original publication.
  select * into v_publication
  from public.pipeline_template_publications publication
  where publication.pipeline_template_version_id = v_version.id;
  if found then
    return jsonb_build_object(
      'pipeline_template_publication_id', v_publication.id,
      'pipeline_template_version_id', v_version.id,
      'publication_number', v_publication.publication_number,
      'published_rule_sha256', v_publication.published_rule_sha256,
      'idempotent_replay', true
    );
  end if;

  select array_agg(item.service_id order by item.position)
    into v_service_ids
  from public.pipeline_template_version_services item
  where item.pipeline_template_version_id = v_version.id;
  if coalesce(cardinality(v_service_ids), 0) = 0 then
    raise exception 'Pipeline template version has no services.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_service_ids) selected(service_id)
    left join public.service_catalog service
      on service.id = selected.service_id
     and service.organization_id = v_version.organization_id
     and service.is_active
    where service.id is null
  ) then
    raise exception 'Pipeline template contains an unavailable service.' using errcode = '22023';
  end if;

  v_manifest := private.pipeline_rule_manifest(v_version.organization_id, v_service_ids);
  v_rule_sha256 := encode(extensions.digest(
    convert_to(v_manifest::text, 'UTF8'), 'sha256'
  ), 'hex');

  select coalesce(max(publication.publication_number), 0) + 1
    into v_publication_number
  from public.pipeline_template_publications publication
  where publication.pipeline_template_id = v_version.pipeline_template_id;

  insert into public.pipeline_template_publications (
    organization_id, pipeline_template_id, pipeline_template_version_id,
    publication_number, published_rule_manifest, published_rule_sha256,
    published_by
  ) values (
    v_version.organization_id, v_version.pipeline_template_id, v_version.id,
    v_publication_number, v_manifest, v_rule_sha256, v_actor_id
  ) returning * into v_publication;

  return jsonb_build_object(
    'pipeline_template_publication_id', v_publication.id,
    'pipeline_template_version_id', v_version.id,
    'publication_number', v_publication.publication_number,
    'published_rule_sha256', v_publication.published_rule_sha256,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_pipeline_template_version(
  uuid, uuid, text, text, text, uuid[], uuid, text
) from public, anon;
revoke all on function public.publish_pipeline_template_version(uuid)
  from public, anon;
grant execute on function public.create_pipeline_template_version(
  uuid, uuid, text, text, text, uuid[], uuid, text
) to authenticated, service_role;
grant execute on function public.publish_pipeline_template_version(uuid)
  to authenticated, service_role;

alter table public.pipeline_templates enable row level security;
alter table public.pipeline_template_versions enable row level security;
alter table public.pipeline_template_version_services enable row level security;
alter table public.pipeline_template_publications enable row level security;
alter table public.engagement_pipeline_origins enable row level security;
alter table public.engagement_composition_requests enable row level security;

create policy "Team can read organization pipeline templates"
  on public.pipeline_templates for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));
create policy "Authorized team can read pipeline template versions"
  on public.pipeline_template_versions for select to authenticated
  using (private.can_read_pipeline_template_version(id, organization_id));
create policy "Authorized team can read pipeline template services"
  on public.pipeline_template_version_services for select to authenticated
  using (private.can_read_pipeline_template_version(
    pipeline_template_version_id, organization_id
  ));
create policy "Team can read pipeline template publications"
  on public.pipeline_template_publications for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));
create policy "Team can read engagement pipeline provenance"
  on public.engagement_pipeline_origins for select to authenticated
  using (private.is_active_pipeline_team_member(organization_id));

revoke all on
  public.pipeline_templates,
  public.pipeline_template_versions,
  public.pipeline_template_version_services,
  public.pipeline_template_publications,
  public.engagement_pipeline_origins,
  public.engagement_composition_requests
from public, anon, authenticated, service_role;

grant select on
  public.pipeline_templates,
  public.pipeline_template_versions,
  public.pipeline_template_version_services,
  public.pipeline_template_publications,
  public.engagement_pipeline_origins
to authenticated;

grant select on
  public.pipeline_templates,
  public.pipeline_template_versions,
  public.pipeline_template_version_services,
  public.pipeline_template_publications
to service_role;
grant select, insert on
  public.engagement_pipeline_origins,
  public.engagement_composition_requests
to service_role;

comment on table public.pipeline_templates is
  'Stable organization-scoped identity for immutable versioned pipeline service-selection presets.';
comment on table public.pipeline_template_versions is
  'Immutable preset metadata. Editing creates a new version and never changes an existing engagement.';
comment on table public.pipeline_template_version_services is
  'Immutable ordered service selection. Canonical service rules remain the only journey graph authority.';
comment on table public.pipeline_template_publications is
  'Append-only publication record with the current canonical rule manifest used for later drift notice.';
comment on table public.engagement_pipeline_origins is
  'Reserved PLN3 append-only provenance for original preset selection and pre-creation customization.';
comment on table public.engagement_composition_requests is
  'Reserved PLN3 server-only organization-scoped idempotency ledger for exact engagement-creation replay.';
comment on function public.create_pipeline_template_version(
  uuid, uuid, text, text, text, uuid[], uuid, text
) is 'Creates an immutable pipeline preset version. Department Managers may draft; publication is separate.';
comment on function public.publish_pipeline_template_version(uuid) is
  'Publishes one immutable preset version and freezes a rule manifest for current-rule drift reporting.';

commit;
