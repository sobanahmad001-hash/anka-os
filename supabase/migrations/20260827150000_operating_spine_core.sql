-- Anka OS - Operating Spine core.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Canonical commercial entities
-- ---------------------------------------------------------------------------

create table public.agency_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  legacy_client_id uuid unique
    references public.clients(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 200),
  legal_name text not null default '',
  primary_email text,
  website_url text,
  industry text not null default '',
  status text not null default 'active'
    check (status in ('prospect', 'active', 'paused', 'former')),
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '',
  website_url text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'retired')),
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, organization_id)
    references public.agency_clients(id, organization_id) on delete cascade,
  unique (id, organization_id),
  unique (id, client_id, organization_id)
);

create unique index idx_brands_one_default_per_client
  on public.brands(client_id)
  where is_default;

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  brand_id uuid not null,
  legacy_project_id uuid unique
    references public.projects(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 240),
  engagement_type text not null default 'project'
    check (engagement_type in ('project', 'retainer')),
  objective text not null default '',
  status text not null default 'planning'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  lead_owner_id uuid references auth.users(id) on delete set null,
  start_date date,
  target_date date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, organization_id)
    references public.agency_clients(id, organization_id) on delete restrict,
  foreign key (brand_id, client_id, organization_id)
    references public.brands(id, client_id, organization_id) on delete restrict,
  unique (id, organization_id),
  check (target_date is null or start_date is null or target_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- 2. Structured service catalogue and composable blueprint catalogue
-- ---------------------------------------------------------------------------

create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  department_id text not null
    references public.departments(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)
);

create table public.blueprint_stage_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  name text not null,
  description text not null default '',
  accountable_department_id text
    references public.departments(id) on delete restrict,
  display_order integer not null check (display_order >= 0),
  stage_kind text not null default 'delivery'
    check (stage_kind in ('delivery', 'short_prerequisite')),
  unique (organization_id, slug),
  unique (id, organization_id)
);

create table public.blueprint_stage_dependencies (
  organization_id uuid not null,
  stage_id uuid not null,
  depends_on_stage_id uuid not null,
  reason text not null default '',
  primary key (stage_id, depends_on_stage_id),
  foreign key (stage_id, organization_id)
    references public.blueprint_stage_catalog(id, organization_id) on delete cascade,
  foreign key (depends_on_stage_id, organization_id)
    references public.blueprint_stage_catalog(id, organization_id) on delete cascade,
  check (stage_id <> depends_on_stage_id)
);

create table public.service_stage_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_id uuid not null,
  target_stage_id uuid not null,
  rule_kind text not null check (rule_kind in ('primary', 'prerequisite')),
  prerequisite_key text,
  prerequisite_description text not null default '',
  accepted_asset_kinds text[] not null default '{}'::text[],
  satisfied_by_stage_slugs text[] not null default '{}'::text[],
  fallback_stage_id uuid,
  foreign key (service_id, organization_id)
    references public.service_catalog(id, organization_id) on delete cascade,
  foreign key (target_stage_id, organization_id)
    references public.blueprint_stage_catalog(id, organization_id) on delete cascade,
  foreign key (fallback_stage_id, organization_id)
    references public.blueprint_stage_catalog(id, organization_id) on delete restrict,
  check (
    (rule_kind = 'primary' and prerequisite_key is null and fallback_stage_id is null)
    or
    (rule_kind = 'prerequisite' and prerequisite_key is not null and fallback_stage_id is not null)
  ),
  unique (service_id, rule_kind, prerequisite_key)
);

-- ---------------------------------------------------------------------------
-- 3. Engagement composition and instantiated journey
-- ---------------------------------------------------------------------------

create table public.engagement_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  asset_kind text not null check (asset_kind ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  name text not null,
  source_url text,
  notes text not null default '',
  supplied_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create table public.engagement_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  service_id uuid not null,
  owner_id uuid references auth.users(id) on delete set null,
  target_date date,
  status text not null default 'active'
    check (status in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  activated_by uuid not null references auth.users(id) on delete restrict,
  activated_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.service_catalog(id, organization_id) on delete restrict,
  unique (engagement_id, service_id),
  unique (id, organization_id)
);

create table public.engagement_stage_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  stage_catalog_id uuid not null,
  name text not null,
  accountable_department_id text
    references public.departments(id) on delete restrict,
  stage_kind text not null check (stage_kind in ('delivery', 'short_prerequisite')),
  position integer not null check (position >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (stage_catalog_id, organization_id)
    references public.blueprint_stage_catalog(id, organization_id) on delete restrict,
  unique (engagement_id, stage_catalog_id),
  unique (id, organization_id)
);

create table public.engagement_stage_services (
  organization_id uuid not null,
  stage_instance_id uuid not null,
  engagement_service_id uuid not null,
  relation_kind text not null check (relation_kind in ('primary', 'prerequisite')),
  primary key (stage_instance_id, engagement_service_id, relation_kind),
  foreign key (stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete cascade,
  foreign key (engagement_service_id, organization_id)
    references public.engagement_services(id, organization_id) on delete cascade
);

create table public.engagement_prerequisites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  engagement_service_id uuid not null,
  prerequisite_key text not null,
  description text not null default '',
  status text not null check (status in ('satisfied', 'planned', 'waived')),
  satisfaction_method text not null
    check (satisfaction_method in ('existing_asset', 'selected_stage', 'short_stage', 'waived')),
  asset_id uuid,
  target_stage_instance_id uuid not null,
  prerequisite_stage_instance_id uuid,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (engagement_service_id, organization_id)
    references public.engagement_services(id, organization_id) on delete cascade,
  foreign key (asset_id, organization_id)
    references public.engagement_assets(id, organization_id) on delete restrict,
  foreign key (target_stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete cascade,
  foreign key (prerequisite_stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete restrict,
  unique (engagement_service_id, prerequisite_key),
  check (
    (satisfaction_method = 'existing_asset' and asset_id is not null and prerequisite_stage_instance_id is null and status = 'satisfied')
    or
    (satisfaction_method = 'selected_stage' and asset_id is null and prerequisite_stage_instance_id is not null and status = 'satisfied')
    or
    (satisfaction_method = 'short_stage' and asset_id is null and prerequisite_stage_instance_id is not null and status = 'planned')
    or
    (satisfaction_method = 'waived' and asset_id is null and prerequisite_stage_instance_id is null and status = 'waived')
  )
);

create table public.engagement_stage_dependencies (
  organization_id uuid not null,
  engagement_id uuid not null,
  stage_instance_id uuid not null,
  depends_on_stage_instance_id uuid not null,
  dependency_kind text not null default 'finish_to_start'
    check (dependency_kind in ('finish_to_start', 'context_gate')),
  reason text not null default '',
  primary key (stage_instance_id, depends_on_stage_instance_id),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete cascade,
  foreign key (depends_on_stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete cascade,
  check (stage_instance_id <> depends_on_stage_instance_id)
);

create table public.engagement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  event_type text not null check (event_type in (
    'engagement_created', 'service_activated', 'blueprint_instantiated'
  )),
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 4. Engagement-scoped connector and AI links
-- ---------------------------------------------------------------------------

create table public.integration_connection_engagements (
  connection_id uuid not null,
  organization_id uuid not null,
  engagement_id uuid not null,
  department_id text not null
    references public.departments(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (connection_id, engagement_id, department_id),
  foreign key (connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete cascade,
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade
);

alter table public.ai_runs
  add column engagement_id uuid
    references public.engagements(id) on delete set null;

alter table public.ai_runs
  add constraint ai_runs_single_commercial_context_check
  check (not (project_id is not null and engagement_id is not null));

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------

create index idx_agency_clients_organization
  on public.agency_clients(organization_id, status, name);
create index idx_brands_client
  on public.brands(organization_id, client_id, status);
create index idx_engagements_brand
  on public.engagements(organization_id, brand_id, status, target_date);
create index idx_engagements_client
  on public.engagements(organization_id, client_id, status);
create index idx_service_catalog_department
  on public.service_catalog(organization_id, department_id, is_active, display_order);
create index idx_service_stage_rules_service
  on public.service_stage_rules(organization_id, service_id, rule_kind);
create index idx_engagement_assets_engagement
  on public.engagement_assets(organization_id, engagement_id, asset_kind);
create index idx_engagement_services_engagement
  on public.engagement_services(organization_id, engagement_id, status);
create index idx_engagement_services_owner
  on public.engagement_services(owner_id, target_date)
  where owner_id is not null and status in ('planned', 'active');
create index idx_engagement_stage_instances_engagement
  on public.engagement_stage_instances(organization_id, engagement_id, position);
create index idx_engagement_prerequisites_engagement
  on public.engagement_prerequisites(organization_id, engagement_id, status);
create index idx_engagement_events_engagement
  on public.engagement_events(organization_id, engagement_id, occurred_at desc);
create index idx_integration_connection_engagements_scope
  on public.integration_connection_engagements(organization_id, engagement_id, department_id);
create index idx_ai_runs_engagement_created
  on public.ai_runs(engagement_id, created_at desc)
  where engagement_id is not null and redacted_at is null;

-- ---------------------------------------------------------------------------
-- 6. Updated-at and immutable audit triggers
-- ---------------------------------------------------------------------------

create or replace function private.touch_operating_spine_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.audit_engagement_created()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.engagement_events (
    organization_id, engagement_id, event_type, actor_id, payload
  ) values (
    new.organization_id,
    new.id,
    'engagement_created',
    coalesce((select auth.uid()), new.created_by),
    jsonb_build_object('brand_id', new.brand_id, 'client_id', new.client_id)
  );
  return new;
end;
$$;

create or replace function private.audit_engagement_service_activated()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.engagement_events (
    organization_id, engagement_id, event_type, actor_id, payload
  ) values (
    new.organization_id,
    new.engagement_id,
    'service_activated',
    coalesce((select auth.uid()), new.activated_by),
    jsonb_build_object(
      'engagement_service_id', new.id,
      'service_id', new.service_id,
      'owner_id', new.owner_id,
      'target_date', new.target_date
    )
  );
  return new;
end;
$$;

revoke all on function private.touch_operating_spine_updated_at()
  from public, anon, authenticated;
revoke all on function private.audit_engagement_created()
  from public, anon, authenticated;
revoke all on function private.audit_engagement_service_activated()
  from public, anon, authenticated;
grant execute on function private.touch_operating_spine_updated_at(),
  private.audit_engagement_created(),
  private.audit_engagement_service_activated()
to service_role;

create trigger trg_touch_agency_clients
before update on public.agency_clients
for each row execute function private.touch_operating_spine_updated_at();
create trigger trg_touch_brands
before update on public.brands
for each row execute function private.touch_operating_spine_updated_at();
create trigger trg_touch_engagements
before update on public.engagements
for each row execute function private.touch_operating_spine_updated_at();
create trigger trg_touch_service_catalog
before update on public.service_catalog
for each row execute function private.touch_operating_spine_updated_at();
create trigger trg_audit_engagement_created
after insert on public.engagements
for each row execute function private.audit_engagement_created();
create trigger trg_audit_engagement_service_activated
after insert on public.engagement_services
for each row execute function private.audit_engagement_service_activated();

-- ---------------------------------------------------------------------------
-- 7. Organisation RLS and explicit Data API grants
-- ---------------------------------------------------------------------------

alter table public.agency_clients enable row level security;
alter table public.brands enable row level security;
alter table public.engagements enable row level security;
alter table public.service_catalog enable row level security;
alter table public.blueprint_stage_catalog enable row level security;
alter table public.blueprint_stage_dependencies enable row level security;
alter table public.service_stage_rules enable row level security;
alter table public.engagement_assets enable row level security;
alter table public.engagement_services enable row level security;
alter table public.engagement_stage_instances enable row level security;
alter table public.engagement_stage_services enable row level security;
alter table public.engagement_prerequisites enable row level security;
alter table public.engagement_stage_dependencies enable row level security;
alter table public.engagement_events enable row level security;
alter table public.integration_connection_engagements enable row level security;

create policy "Team can manage agency clients"
  on public.agency_clients for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage brands"
  on public.brands for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage engagements"
  on public.engagements for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));

create policy "Team can read service catalogue"
  on public.service_catalog for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Leaders can manage service catalogue"
  on public.service_catalog for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['system_owner', 'operations_admin', 'executive']
  ))
  with check (public.has_organization_role(
    organization_id,
    array['system_owner', 'operations_admin', 'executive']
  ));

create policy "Team can read blueprint catalogue"
  on public.blueprint_stage_catalog for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read blueprint dependencies"
  on public.blueprint_stage_dependencies for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read service stage rules"
  on public.service_stage_rules for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can manage engagement assets"
  on public.engagement_assets for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage engagement services"
  on public.engagement_services for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage stage instances"
  on public.engagement_stage_instances for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage stage service links"
  on public.engagement_stage_services for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage prerequisites"
  on public.engagement_prerequisites for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can manage stage dependencies"
  on public.engagement_stage_dependencies for all to authenticated
  using (public.is_team_organization_member(organization_id))
  with check (public.is_team_organization_member(organization_id));
create policy "Team can read engagement events"
  on public.engagement_events for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can record engagement events"
  on public.engagement_events for insert to authenticated
  with check (
    public.is_team_organization_member(organization_id)
    and (actor_id is null or actor_id = (select auth.uid()))
  );
create policy "Team can read engagement connector mappings"
  on public.integration_connection_engagements for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can create engagement connector mappings"
  on public.integration_connection_engagements for insert to authenticated
  with check (
    public.is_team_organization_member(organization_id)
    and created_by = (select auth.uid())
  );

revoke all on
  public.agency_clients,
  public.brands,
  public.engagements,
  public.service_catalog,
  public.blueprint_stage_catalog,
  public.blueprint_stage_dependencies,
  public.service_stage_rules,
  public.engagement_assets,
  public.engagement_services,
  public.engagement_stage_instances,
  public.engagement_stage_services,
  public.engagement_prerequisites,
  public.engagement_stage_dependencies,
  public.engagement_events,
  public.integration_connection_engagements
from anon, authenticated;

grant select, insert, update, delete on
  public.agency_clients,
  public.brands,
  public.engagements,
  public.engagement_assets,
  public.engagement_services,
  public.engagement_stage_instances,
  public.engagement_stage_services,
  public.engagement_prerequisites,
  public.engagement_stage_dependencies
to authenticated;
grant select, insert on public.engagement_events to authenticated;
grant select, insert on public.integration_connection_engagements to authenticated;
grant select on
  public.service_catalog,
  public.blueprint_stage_catalog,
  public.blueprint_stage_dependencies,
  public.service_stage_rules
to authenticated;
grant insert, update, delete on public.service_catalog to authenticated;

grant all on
  public.agency_clients,
  public.brands,
  public.engagements,
  public.service_catalog,
  public.blueprint_stage_catalog,
  public.blueprint_stage_dependencies,
  public.service_stage_rules,
  public.engagement_assets,
  public.engagement_services,
  public.engagement_stage_instances,
  public.engagement_stage_services,
  public.engagement_prerequisites,
  public.engagement_stage_dependencies,
  public.engagement_events,
  public.integration_connection_engagements
to service_role;

-- ---------------------------------------------------------------------------
-- 8. Seed the agreed four-department service catalogue and stage graph
-- ---------------------------------------------------------------------------

insert into public.service_catalog (
  organization_id, department_id, slug, name, description, display_order
)
select organization.id, seed.department_id, seed.slug, seed.name, seed.description, seed.display_order
from public.organizations organization
cross join (values
  ('content', 'discovery_facilitation', 'Discovery facilitation', 'Facilitated discovery, evidence, constraints, and objectives.', 10),
  ('content', 'vision_positioning', 'Vision and positioning', 'Vision, positioning, value proposition, and verbal identity.', 20),
  ('content', 'audience_research', 'Audience research', 'Audience segments, motivations, objections, and search behaviour.', 30),
  ('content', 'website_architecture', 'Website architecture', 'Sitemap, page inventory, page goals, calls to action, and requirements.', 40),
  ('content', 'seo_keyword_planning', 'SEO and keyword planning', 'Service, search-demand, and brand keyword lenses mapped to pages.', 50),
  ('content', 'website_content', 'Website content', 'Page briefs, copy, metadata, proof, calls to action, and links.', 60),
  ('content', 'campaign_messaging', 'Campaign messaging', 'Campaign message frameworks, offers, proof, and calls to action.', 70),
  ('content', 'scripts', 'Scripts', 'Scripts for video, social, campaign, and presentation outputs.', 80),
  ('design', 'brand_visual_identity', 'Brand visual identity', 'Palette, typography, imagery, iconography, layout, and motion direction.', 110),
  ('design', 'design_systems', 'Design systems', 'Reusable visual tokens, components, patterns, and usage guidance.', 120),
  ('design', 'website_ux_ui', 'Website UX/UI', 'Flows, wireframes, responsive pages, components, and prototypes.', 130),
  ('design', 'campaign_creative', 'Campaign creative', 'Campaign concepts and production-ready creative directions.', 140),
  ('design', 'social_assets', 'Social assets', 'Channel-specific social graphics and reusable variants.', 150),
  ('design', 'advertising_assets', 'Advertising assets', 'Paid-media creative in required sizes and formats.', 160),
  ('design', 'video_concepts_storyboards', 'Video concepts and storyboards', 'Concepts, scripts-to-frames, storyboards, and keyframes.', 170),
  ('design', 'visual_production', 'Visual production', 'Approved visual production, variants, packaging, and handoff.', 180),
  ('development', 'wordpress_architecture', 'WordPress architecture', 'Theme, plugin, content-model, integration, and environment architecture.', 210),
  ('development', 'staging_production_builds', 'Staging and production builds', 'Responsive WordPress implementation across controlled environments.', 220),
  ('development', 'integrations', 'Integrations', 'Approved third-party, measurement, CRM, form, and automation integrations.', 230),
  ('development', 'technical_seo', 'Technical SEO', 'Crawlability, metadata implementation, redirects, schema, and sitemap controls.', 240),
  ('development', 'performance', 'Performance', 'Performance budgets, diagnostics, remediation, and verification.', 250),
  ('development', 'accessibility', 'Accessibility', 'Accessibility implementation and verification against agreed standards.', 260),
  ('development', 'qa', 'Quality assurance', 'Responsive, browser, functional, integration, and release QA.', 270),
  ('development', 'launch', 'Launch', 'Backup, production release, verification, and rollback readiness.', 280),
  ('development', 'maintenance', 'Maintenance', 'Post-launch fixes, updates, monitoring, and controlled maintenance.', 290),
  ('marketing', 'channel_strategy', 'Channel strategy', 'Channel roles, objectives, audiences, offers, and sequencing.', 310),
  ('marketing', 'social_planning', 'Social planning', 'Social calendars, formats, themes, cadence, and creative requests.', 320),
  ('marketing', 'seo_operations', 'SEO operations', 'Ongoing search opportunities, page actions, and performance learning.', 330),
  ('marketing', 'paid_media', 'Paid media', 'Paid-search and paid-social structure, budgets, targeting, and reporting.', 340),
  ('marketing', 'campaigns', 'Campaigns', 'Campaign planning, activation, coordination, and performance review.', 350),
  ('marketing', 'measurement_plans', 'Measurement plans', 'Events, conversions, naming, UTM governance, and validation.', 360),
  ('marketing', 'analytics', 'Analytics', 'Analytics configuration, interpretation, dashboards, and source freshness.', 370),
  ('marketing', 'reporting', 'Reporting', 'Traceable reporting with source, period, insight, and recommended action.', 380),
  ('marketing', 'experiments_optimisation', 'Experiments and optimisation', 'Hypotheses, variants, measurements, decisions, and reusable learning.', 390)
) as seed(department_id, slug, name, description, display_order)
on conflict (organization_id, slug) do update set
  department_id = excluded.department_id,
  name = excluded.name,
  description = excluded.description,
  display_order = excluded.display_order,
  is_active = true;

insert into public.blueprint_stage_catalog (
  organization_id, slug, name, description,
  accountable_department_id, display_order, stage_kind
)
select organization.id, seed.slug, seed.name, seed.description,
  seed.department_id, seed.display_order, seed.stage_kind
from public.organizations organization
cross join (values
  ('context_intake', 'Context intake', 'Import, validate, or create the minimum missing brand or audience context.', 'content', 5, 'short_prerequisite'),
  ('discovery', 'Discovery', 'Objectives, offers, evidence, and constraints.', 'content', 10, 'delivery'),
  ('vision_identity', 'Vision and identity', 'Vision, positioning, value proposition, and verbal identity.', 'content', 20, 'delivery'),
  ('audience', 'Audience', 'Priority audiences, motivations, objections, channels, and search behaviour.', 'content', 30, 'delivery'),
  ('website_architecture', 'Website architecture', 'Sitemap, page inventory, goals, calls to action, and requirements.', 'content', 40, 'delivery'),
  ('keyword_strategy', 'Keyword strategy', 'Three keyword lenses mapped to target pages.', 'content', 50, 'delivery'),
  ('content', 'Content', 'Approved briefs, copy, metadata, proof, links, messages, or scripts.', 'content', 60, 'delivery'),
  ('design', 'Design', 'Approved identity, UX/UI, creative, social, advertising, or video outputs.', 'design', 70, 'delivery'),
  ('implementation_intake', 'Implementation intake', 'Validate supplied content, design, technical constraints, and access.', 'development', 75, 'short_prerequisite'),
  ('development', 'Development', 'WordPress implementation, integrations, technical quality, and staging.', 'development', 80, 'delivery'),
  ('launch', 'Launch', 'Acceptance, release, backup, rollback, and production verification.', 'development', 90, 'delivery'),
  ('marketing_intake', 'Marketing intake', 'Validate supplied strategy, audience, offer, creative, channel, and measurement context.', 'marketing', 95, 'short_prerequisite'),
  ('growth', 'Growth', 'Campaign, social, SEO, paid media, measurement, reporting, and optimisation.', 'marketing', 100, 'delivery')
) as seed(slug, name, description, department_id, display_order, stage_kind)
on conflict (organization_id, slug) do update set
  name = excluded.name,
  description = excluded.description,
  accountable_department_id = excluded.accountable_department_id,
  display_order = excluded.display_order,
  stage_kind = excluded.stage_kind;

insert into public.blueprint_stage_dependencies (
  organization_id, stage_id, depends_on_stage_id, reason
)
select later.organization_id, later.id, earlier.id,
  'Dependency applies only when both stages are instantiated.'
from (values
  ('vision_identity', 'discovery'),
  ('audience', 'discovery'),
  ('website_architecture', 'audience'),
  ('keyword_strategy', 'website_architecture'),
  ('content', 'keyword_strategy'),
  ('design', 'content'),
  ('development', 'design'),
  ('launch', 'development'),
  ('growth', 'launch')
) as dependency(stage_slug, depends_on_slug)
join public.blueprint_stage_catalog later on later.slug = dependency.stage_slug
join public.blueprint_stage_catalog earlier
  on earlier.organization_id = later.organization_id
 and earlier.slug = dependency.depends_on_slug
on conflict (stage_id, depends_on_stage_id) do nothing;

-- Every service activates one primary stage.
insert into public.service_stage_rules (
  organization_id, service_id, target_stage_id, rule_kind
)
select service.organization_id, service.id, stage.id, 'primary'
from public.service_catalog service
join public.blueprint_stage_catalog stage
  on stage.organization_id = service.organization_id
 and stage.slug = case
   when service.department_id = 'content' and service.slug = 'discovery_facilitation' then 'discovery'
   when service.department_id = 'content' and service.slug = 'vision_positioning' then 'vision_identity'
   when service.department_id = 'content' and service.slug = 'audience_research' then 'audience'
   when service.department_id = 'content' and service.slug = 'website_architecture' then 'website_architecture'
   when service.department_id = 'content' and service.slug = 'seo_keyword_planning' then 'keyword_strategy'
   when service.department_id = 'content' then 'content'
   when service.department_id = 'design' then 'design'
   when service.department_id = 'development' and service.slug = 'launch' then 'launch'
   when service.department_id = 'development' then 'development'
   when service.department_id = 'marketing' then 'growth'
 end
on conflict (service_id, rule_kind, prerequisite_key) do nothing;

-- Non-discovery services accept supplied context or receive one short intake
-- stage. They are never forced through the entire ten-stage cycle.
insert into public.service_stage_rules (
  organization_id, service_id, target_stage_id, rule_kind,
  prerequisite_key, prerequisite_description,
  accepted_asset_kinds, satisfied_by_stage_slugs, fallback_stage_id
)
select
  service.organization_id,
  service.id,
  target_stage.id,
  'prerequisite',
  case
    when service.department_id = 'development' then 'implementation_inputs'
    when service.department_id = 'marketing' then 'marketing_context'
    else 'brand_context'
  end,
  case
    when service.department_id = 'development' then 'Approved or supplied implementation inputs are required.'
    when service.department_id = 'marketing' then 'Approved or supplied audience, offer, channel, and measurement context is required.'
    else 'Approved or supplied brand and audience context is required.'
  end,
  case
    when service.department_id = 'development' then array['approved_content', 'approved_design', 'technical_brief']::text[]
    when service.department_id = 'marketing' then array['brand_context', 'audience_context', 'campaign_brief']::text[]
    else array['brand_context', 'discovery_statement', 'audience_context']::text[]
  end,
  case
    when service.department_id = 'development' then array['design', 'content']::text[]
    when service.department_id = 'marketing' then array['launch', 'design', 'content', 'audience']::text[]
    when service.department_id = 'design' then array['content', 'audience', 'vision_identity', 'discovery']::text[]
    when service.slug = 'vision_positioning' then array['discovery']::text[]
    when service.slug = 'audience_research' then array['vision_identity', 'discovery']::text[]
    when service.slug = 'website_architecture' then array['audience', 'discovery']::text[]
    when service.slug = 'seo_keyword_planning' then array['website_architecture']::text[]
    else array['keyword_strategy', 'website_architecture', 'vision_identity', 'discovery']::text[]
  end,
  fallback.id
from public.service_catalog service
join public.service_stage_rules primary_rule
  on primary_rule.service_id = service.id
 and primary_rule.rule_kind = 'primary'
join public.blueprint_stage_catalog target_stage
  on target_stage.id = primary_rule.target_stage_id
join public.blueprint_stage_catalog fallback
  on fallback.organization_id = service.organization_id
 and fallback.slug = case
   when service.department_id = 'development' then 'implementation_intake'
   when service.department_id = 'marketing' then 'marketing_intake'
   else 'context_intake'
 end
where service.slug <> 'discovery_facilitation'
on conflict (service_id, rule_kind, prerequisite_key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Transactional engagement composer and partial-service instantiation
-- ---------------------------------------------------------------------------

create or replace function public.compose_engagement(
  p_client_id uuid,
  p_brand_id uuid,
  p_name text,
  p_engagement_type text,
  p_service_ids uuid[],
  p_lead_owner_id uuid default null,
  p_service_owners jsonb default '{}'::jsonb,
  p_start_date date default null,
  p_target_date date default null,
  p_objective text default '',
  p_existing_assets jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_engagement_id uuid;
  v_requested_service_count integer;
  v_available_service_count integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Engagement name is required.' using errcode = '22023';
  end if;
  if p_engagement_type not in ('project', 'retainer') then
    raise exception 'Unsupported engagement type.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'At least one service is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_existing_assets, '[]'::jsonb)) <> 'array' then
    raise exception 'Existing assets must be a JSON array.' using errcode = '22023';
  end if;

  select brand.organization_id
  into v_organization_id
  from public.brands brand
  where brand.id = p_brand_id
    and brand.client_id = p_client_id
    and brand.status = 'active';

  if v_organization_id is null
     or not public.is_team_organization_member(v_organization_id) then
    raise exception 'Client and brand are unavailable.' using errcode = '42501';
  end if;

  select count(distinct requested.service_id)
  into v_requested_service_count
  from unnest(p_service_ids) requested(service_id);

  select count(*)
  into v_available_service_count
  from public.service_catalog service
  where service.organization_id = v_organization_id
    and service.is_active
    and service.id = any(p_service_ids);

  if v_requested_service_count <> v_available_service_count then
    raise exception 'One or more selected services are unavailable.' using errcode = '22023';
  end if;

  insert into public.engagements (
    organization_id, client_id, brand_id, name, engagement_type,
    objective, status, lead_owner_id, start_date, target_date, created_by
  ) values (
    v_organization_id, p_client_id, p_brand_id, trim(p_name), p_engagement_type,
    coalesce(trim(p_objective), ''), 'planning', coalesce(p_lead_owner_id, v_actor_id),
    p_start_date, p_target_date, v_actor_id
  ) returning id into v_engagement_id;

  insert into public.engagement_assets (
    organization_id, engagement_id, asset_kind, name, source_url, notes, supplied_by
  )
  select
    v_organization_id,
    v_engagement_id,
    trim(asset.asset_kind),
    trim(asset.name),
    nullif(trim(asset.source_url), ''),
    coalesce(trim(asset.notes), ''),
    v_actor_id
  from jsonb_to_recordset(coalesce(p_existing_assets, '[]'::jsonb)) as asset(
    asset_kind text,
    name text,
    source_url text,
    notes text
  )
  where nullif(trim(asset.asset_kind), '') is not null
    and nullif(trim(asset.name), '') is not null;

  insert into public.engagement_services (
    organization_id, engagement_id, service_id, owner_id,
    target_date, status, activated_by
  )
  select
    v_organization_id,
    v_engagement_id,
    service.id,
    coalesce(
      nullif(p_service_owners ->> service.id::text, '')::uuid,
      p_lead_owner_id,
      v_actor_id
    ),
    p_target_date,
    'active',
    v_actor_id
  from public.service_catalog service
  where service.organization_id = v_organization_id
    and service.id = any(p_service_ids)
    and service.is_active;

  -- Instantiate only primary stages required by selected services.
  insert into public.engagement_stage_instances (
    organization_id, engagement_id, stage_catalog_id, name,
    accountable_department_id, stage_kind, position, status
  )
  select distinct
    v_organization_id,
    v_engagement_id,
    stage.id,
    stage.name,
    stage.accountable_department_id,
    stage.stage_kind,
    stage.display_order,
    'planned'
  from public.engagement_services engagement_service
  join public.service_stage_rules rule
    on rule.service_id = engagement_service.service_id
   and rule.rule_kind = 'primary'
  join public.blueprint_stage_catalog stage on stage.id = rule.target_stage_id
  where engagement_service.engagement_id = v_engagement_id
  on conflict (engagement_id, stage_catalog_id) do nothing;

  insert into public.engagement_stage_services (
    organization_id, stage_instance_id, engagement_service_id, relation_kind
  )
  select
    v_organization_id,
    instance.id,
    engagement_service.id,
    'primary'
  from public.engagement_services engagement_service
  join public.service_stage_rules rule
    on rule.service_id = engagement_service.service_id
   and rule.rule_kind = 'primary'
  join public.engagement_stage_instances instance
    on instance.engagement_id = v_engagement_id
   and instance.stage_catalog_id = rule.target_stage_id
  where engagement_service.engagement_id = v_engagement_id
  on conflict do nothing;

  -- Add only the short prerequisite stages whose context was not supplied.
  insert into public.engagement_stage_instances (
    organization_id, engagement_id, stage_catalog_id, name,
    accountable_department_id, stage_kind, position, status
  )
  select distinct
    v_organization_id,
    v_engagement_id,
    fallback.id,
    fallback.name,
    fallback.accountable_department_id,
    fallback.stage_kind,
    fallback.display_order,
    'ready'
  from public.engagement_services engagement_service
  join public.service_stage_rules rule
    on rule.service_id = engagement_service.service_id
   and rule.rule_kind = 'prerequisite'
  join public.blueprint_stage_catalog fallback on fallback.id = rule.fallback_stage_id
  where engagement_service.engagement_id = v_engagement_id
    and not exists (
      select 1
      from public.engagement_assets asset
      where asset.engagement_id = v_engagement_id
        and asset.asset_kind = any(rule.accepted_asset_kinds)
    )
    and not exists (
      select 1
      from public.engagement_stage_instances satisfying_instance
      join public.blueprint_stage_catalog satisfying_stage
        on satisfying_stage.id = satisfying_instance.stage_catalog_id
      where satisfying_instance.engagement_id = v_engagement_id
        and satisfying_stage.slug = any(rule.satisfied_by_stage_slugs)
    )
  on conflict (engagement_id, stage_catalog_id) do nothing;

  insert into public.engagement_prerequisites (
    organization_id, engagement_id, engagement_service_id,
    prerequisite_key, description, status, satisfaction_method,
    asset_id, target_stage_instance_id, prerequisite_stage_instance_id,
    recorded_by
  )
  select
    v_organization_id,
    v_engagement_id,
    engagement_service.id,
    rule.prerequisite_key,
    rule.prerequisite_description,
    case
      when supplied_asset.id is not null or satisfying_stage.id is not null then 'satisfied'
      else 'planned'
    end,
    case
      when supplied_asset.id is not null then 'existing_asset'
      when satisfying_stage.id is not null then 'selected_stage'
      else 'short_stage'
    end,
    supplied_asset.id,
    target_instance.id,
    case
      when supplied_asset.id is not null then null
      when satisfying_stage.id is not null then satisfying_stage.id
      else fallback_instance.id
    end,
    v_actor_id
  from public.engagement_services engagement_service
  join public.service_stage_rules rule
    on rule.service_id = engagement_service.service_id
   and rule.rule_kind = 'prerequisite'
  join public.engagement_stage_instances target_instance
    on target_instance.engagement_id = v_engagement_id
   and target_instance.stage_catalog_id = rule.target_stage_id
  left join lateral (
    select asset.id
    from public.engagement_assets asset
    where asset.engagement_id = v_engagement_id
      and asset.asset_kind = any(rule.accepted_asset_kinds)
    order by asset.created_at
    limit 1
  ) supplied_asset on true
  left join lateral (
    select instance.id
    from public.engagement_stage_instances instance
    join public.blueprint_stage_catalog stage
      on stage.id = instance.stage_catalog_id
    where instance.engagement_id = v_engagement_id
      and stage.slug = any(rule.satisfied_by_stage_slugs)
    order by stage.display_order desc
    limit 1
  ) satisfying_stage on true
  left join public.engagement_stage_instances fallback_instance
    on fallback_instance.engagement_id = v_engagement_id
   and fallback_instance.stage_catalog_id = rule.fallback_stage_id
  where engagement_service.engagement_id = v_engagement_id
  on conflict (engagement_service_id, prerequisite_key) do nothing;

  insert into public.engagement_stage_services (
    organization_id, stage_instance_id, engagement_service_id, relation_kind
  )
  select
    prerequisite.organization_id,
    prerequisite.prerequisite_stage_instance_id,
    prerequisite.engagement_service_id,
    'prerequisite'
  from public.engagement_prerequisites prerequisite
  where prerequisite.engagement_id = v_engagement_id
    and prerequisite.prerequisite_stage_instance_id is not null
  on conflict do nothing;

  insert into public.engagement_stage_dependencies (
    organization_id, engagement_id, stage_instance_id,
    depends_on_stage_instance_id, dependency_kind, reason
  )
  select
    prerequisite.organization_id,
    prerequisite.engagement_id,
    prerequisite.target_stage_instance_id,
    prerequisite.prerequisite_stage_instance_id,
    'context_gate',
    prerequisite.description
  from public.engagement_prerequisites prerequisite
  where prerequisite.engagement_id = v_engagement_id
    and prerequisite.prerequisite_stage_instance_id is not null
  on conflict do nothing;

  -- Apply canonical dependencies only when both stages actually exist.
  insert into public.engagement_stage_dependencies (
    organization_id, engagement_id, stage_instance_id,
    depends_on_stage_instance_id, dependency_kind, reason
  )
  select
    v_organization_id,
    v_engagement_id,
    later_instance.id,
    earlier_instance.id,
    'finish_to_start',
    dependency.reason
  from public.blueprint_stage_dependencies dependency
  join public.engagement_stage_instances later_instance
    on later_instance.engagement_id = v_engagement_id
   and later_instance.stage_catalog_id = dependency.stage_id
  join public.engagement_stage_instances earlier_instance
    on earlier_instance.engagement_id = v_engagement_id
   and earlier_instance.stage_catalog_id = dependency.depends_on_stage_id
  where dependency.organization_id = v_organization_id
  on conflict do nothing;

  -- Scope all currently verified department connectors to this engagement.
  insert into public.integration_connection_engagements (
    connection_id, organization_id, engagement_id, department_id, created_by
  )
  select distinct
    connection.id,
    v_organization_id,
    v_engagement_id,
    department_map.department_id,
    v_actor_id
  from public.integration_connections connection
  join public.integration_connection_departments department_map
    on department_map.connection_id = connection.id
   and department_map.organization_id = connection.organization_id
  where connection.organization_id = v_organization_id
    and connection.status = 'verified'
    and connection.archived_at is null
    and exists (
      select 1
      from public.engagement_services engagement_service
      join public.service_catalog service on service.id = engagement_service.service_id
      where engagement_service.engagement_id = v_engagement_id
        and service.department_id = department_map.department_id
    )
  on conflict do nothing;

  insert into public.engagement_events (
    organization_id, engagement_id, event_type, actor_id, payload
  ) values (
    v_organization_id,
    v_engagement_id,
    'blueprint_instantiated',
    v_actor_id,
    jsonb_build_object(
      'selected_service_count', v_available_service_count,
      'stage_count', (
        select count(*) from public.engagement_stage_instances
        where engagement_id = v_engagement_id
      ),
      'dependency_count', (
        select count(*) from public.engagement_stage_dependencies
        where engagement_id = v_engagement_id
      )
    )
  );

  return v_engagement_id;
end;
$$;

revoke all on function public.compose_engagement(
  uuid, uuid, text, text, uuid[], uuid, jsonb, date, date, text, jsonb
) from public, anon;
grant execute on function public.compose_engagement(
  uuid, uuid, text, text, uuid[], uuid, jsonb, date, date, text, jsonb
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Traceable compatibility mapping from the old client/project shape
-- ---------------------------------------------------------------------------

insert into public.agency_clients (
  organization_id, legacy_client_id, name, legal_name, primary_email,
  industry, status, owner_id, created_by
)
select
  legacy.organization_id,
  legacy.id,
  legacy.name,
  coalesce(legacy.company, legacy.name),
  legacy.email,
  coalesce(legacy.industry, ''),
  case when legacy.status = 'inactive' then 'paused' else 'active' end,
  legacy.owner_id,
  legacy.owner_id
from public.clients legacy
on conflict (legacy_client_id) do nothing;

insert into public.brands (
  organization_id, client_id, name, description, status, is_default, created_by
)
select
  client.organization_id,
  client.id,
  client.name,
  'Default brand created while mapping the legacy client record.',
  'active',
  true,
  client.created_by
from public.agency_clients client
where not exists (
  select 1 from public.brands existing where existing.client_id = client.id
);

insert into public.engagements (
  organization_id, client_id, brand_id, legacy_project_id,
  name, engagement_type, objective, status, lead_owner_id,
  start_date, target_date, created_by
)
select
  legacy.organization_id,
  client.id,
  brand.id,
  legacy.id,
  legacy.name,
  case when legacy.engagement_type = 'retainer' then 'retainer' else 'project' end,
  coalesce(legacy.description, ''),
  case
    when legacy.status in ('active', 'on_hold', 'completed') then legacy.status
    when legacy.status = 'archived' then 'completed'
    else 'planning'
  end,
  legacy.owner_id,
  legacy.start_date,
  legacy.due_date,
  coalesce(legacy.owner_id, client.created_by)
from public.projects legacy
join public.agency_clients client on client.legacy_client_id = legacy.client_id
join public.brands brand on brand.client_id = client.id and brand.is_default
where legacy.client_id is not null
  and legacy.engagement_type <> 'internal'
  and coalesce(legacy.owner_id, client.created_by) is not null
on conflict (legacy_project_id) do nothing;

comment on table public.agency_clients is
  'Canonical Operating Spine client. Separate from the legacy public.clients table.';
comment on table public.brands is
  'Reusable brand identity and context owned by one canonical client.';
comment on table public.engagements is
  'Bounded client work or retainer. Separate from the legacy public.projects table.';
comment on function public.compose_engagement(
  uuid, uuid, text, text, uuid[], uuid, jsonb, date, date, text, jsonb
) is
  'Creates an engagement transactionally, activates selected services, records existing assets, instantiates only required stages/prerequisites, scopes verified connectors, and writes audit events.';

commit;
