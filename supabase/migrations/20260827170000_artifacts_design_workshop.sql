-- Anka OS - immutable Artifacts and designer-controlled Design Workshop.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null,
  engagement_id uuid,
  engagement_stage_instance_id uuid,
  artifact_type text not null check (artifact_type in ('discovery', 'vision', 'audience')),
  title text not null check (length(trim(title)) between 1 and 240),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (engagement_stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create table public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  artifact_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_version_id uuid,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_checksum text not null check (content_checksum ~ '^[a-f0-9]{64}$'),
  change_summary text not null default '',
  ai_use_allowed boolean not null default false,
  data_classification text not null default 'internal'
    check (data_classification in ('public', 'internal', 'confidential', 'restricted')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete cascade,
  foreign key (parent_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  unique (artifact_id, version_number),
  unique (artifact_id, content_checksum),
  unique (id, organization_id)
);

create table public.artifact_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  artifact_id uuid not null,
  artifact_version_id uuid not null,
  engagement_id uuid not null,
  decision text not null default 'approved' check (decision = 'approved'),
  notes text not null default '',
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  foreign key (artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete cascade,
  foreign key (artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  unique (artifact_version_id),
  unique (id, organization_id)
);

create table public.design_model_registry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  model_id text not null check (length(trim(model_id)) between 1 and 160),
  display_name text not null,
  supported_output_types text[] not null default array['design_direction']::text[],
  input_formats text[] not null default array['text', 'json']::text[],
  limitations text not null default '',
  cost_class text not null check (cost_class in ('low', 'medium', 'high')),
  speed_class text not null check (speed_class in ('fast', 'standard', 'deliberate')),
  privacy_classification text not null check (privacy_classification in ('standard', 'restricted_context')),
  allowed_engagement_types text[] not null default array['project', 'retainer']::text[],
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, model_id),
  unique (id, organization_id)
);

create table public.design_workshop_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  brand_id uuid not null,
  engagement_stage_instance_id uuid,
  output_family text not null check (output_family in (
    'brand_identity', 'website_design', 'marketing_asset', 'video_motion'
  )),
  output_brief jsonb not null check (jsonb_typeof(output_brief) = 'object'),
  designer_instructions text not null,
  context_manifest jsonb not null check (jsonb_typeof(context_manifest) = 'object'),
  context_checksum text not null check (context_checksum ~ '^[a-f0-9]{64}$'),
  status text not null default 'ready'
    check (status in ('ready', 'generating', 'comparison', 'released', 'generation_failed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  foreign key (engagement_stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create table public.design_workshop_context_versions (
  organization_id uuid not null,
  session_id uuid not null,
  artifact_id uuid not null,
  artifact_version_id uuid not null,
  artifact_approval_id uuid not null,
  artifact_type text not null check (artifact_type in ('discovery', 'vision', 'audience')),
  primary key (session_id, artifact_type),
  foreign key (session_id, organization_id)
    references public.design_workshop_sessions(id, organization_id) on delete cascade,
  foreign key (artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  foreign key (artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  foreign key (artifact_approval_id, organization_id)
    references public.artifact_approvals(id, organization_id) on delete restrict
);

create table public.design_workshop_model_selections (
  organization_id uuid not null,
  session_id uuid not null,
  model_registry_id uuid not null,
  position integer not null check (position between 1 and 3),
  primary key (session_id, model_registry_id),
  unique (session_id, position),
  foreign key (session_id, organization_id)
    references public.design_workshop_sessions(id, organization_id) on delete cascade,
  foreign key (model_registry_id, organization_id)
    references public.design_model_registry(id, organization_id) on delete restrict
);

create table public.design_generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  session_id uuid not null,
  model_registry_id uuid not null,
  provider text not null,
  model_id text not null,
  direction_slot integer not null check (direction_slot between 1 and 3),
  attempt_number integer not null default 1 check (attempt_number between 1 and 3),
  status text not null check (status in ('running', 'completed', 'failed', 'rejected_duplicate')),
  input_manifest_checksum text not null check (input_manifest_checksum ~ '^[a-f0-9]{64}$'),
  parameters jsonb not null default '{}'::jsonb,
  external_response_id text,
  output_checksum text,
  failure_reason text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (session_id, organization_id)
    references public.design_workshop_sessions(id, organization_id) on delete cascade,
  foreign key (model_registry_id, organization_id)
    references public.design_model_registry(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create table public.design_directions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  direction_slot integer not null check (direction_slot between 1 and 3),
  created_at timestamptz not null default now(),
  foreign key (session_id, organization_id)
    references public.design_workshop_sessions(id, organization_id) on delete cascade,
  unique (session_id, direction_slot),
  unique (id, organization_id)
);

create table public.design_direction_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  direction_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_version_id uuid,
  generation_run_id uuid,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_checksum text not null check (content_checksum ~ '^[a-f0-9]{64}$'),
  distinctness_signature text not null check (length(distinctness_signature) >= 16),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (direction_id, organization_id)
    references public.design_directions(id, organization_id) on delete cascade,
  foreign key (parent_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete restrict,
  foreign key (generation_run_id, organization_id)
    references public.design_generation_runs(id, organization_id) on delete restrict,
  unique (direction_id, version_number),
  unique (direction_id, content_checksum),
  unique (id, organization_id)
);

create table public.design_direction_selections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  session_id uuid not null unique,
  direction_version_id uuid not null,
  notes text not null default '',
  selected_by uuid not null references auth.users(id) on delete restrict,
  selected_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (session_id, organization_id)
    references public.design_workshop_sessions(id, organization_id) on delete cascade,
  foreign key (direction_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create table public.design_direction_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  session_id uuid not null unique,
  direction_version_id uuid not null,
  release_notes text not null default '',
  released_by uuid not null references auth.users(id) on delete restrict,
  released_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (session_id, organization_id)
    references public.design_workshop_sessions(id, organization_id) on delete cascade,
  foreign key (direction_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

-- Foreign-key, queue, comparison, and RLS lookup indexes.
create index idx_artifacts_brand_engagement
  on public.artifacts(organization_id, brand_id, engagement_id, artifact_type);
create index idx_artifacts_stage on public.artifacts(engagement_stage_instance_id)
  where engagement_stage_instance_id is not null;
create index idx_artifact_versions_artifact
  on public.artifact_versions(organization_id, artifact_id, version_number desc);
create index idx_artifact_versions_parent on public.artifact_versions(parent_version_id)
  where parent_version_id is not null;
create index idx_artifact_approvals_artifact
  on public.artifact_approvals(organization_id, artifact_id, approved_at desc);
create index idx_artifact_approvals_engagement
  on public.artifact_approvals(engagement_id, approved_at desc);
create index idx_design_models_active
  on public.design_model_registry(organization_id, provider, model_id) where is_active;
create index idx_design_sessions_engagement
  on public.design_workshop_sessions(organization_id, engagement_id, created_at desc);
create index idx_design_sessions_stage on public.design_workshop_sessions(engagement_stage_instance_id)
  where engagement_stage_instance_id is not null;
create index idx_design_context_artifact on public.design_workshop_context_versions(artifact_version_id);
create index idx_design_context_approval on public.design_workshop_context_versions(artifact_approval_id);
create index idx_design_model_selection_model on public.design_workshop_model_selections(model_registry_id);
create index idx_design_runs_session
  on public.design_generation_runs(organization_id, session_id, direction_slot, created_at);
create index idx_design_runs_model on public.design_generation_runs(model_registry_id, created_at desc);
create index idx_design_directions_session on public.design_directions(organization_id, session_id);
create index idx_design_direction_versions_direction
  on public.design_direction_versions(organization_id, direction_id, version_number desc);
create index idx_design_direction_versions_parent on public.design_direction_versions(parent_version_id)
  where parent_version_id is not null;
create index idx_design_direction_versions_run on public.design_direction_versions(generation_run_id)
  where generation_run_id is not null;
create index idx_design_selections_engagement on public.design_direction_selections(engagement_id, selected_at desc);
create index idx_design_selections_version on public.design_direction_selections(direction_version_id);
create index idx_design_releases_engagement on public.design_direction_releases(engagement_id, released_at desc);
create index idx_design_releases_version on public.design_direction_releases(direction_version_id);

-- Immutable history rows cannot be rewritten or deleted, including by service code.
create or replace function private.reject_immutable_artifact_history_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% records are immutable; create a new version or decision row.', tg_table_name
    using errcode = '55000';
end;
$$;

revoke all on function private.reject_immutable_artifact_history_change()
  from public, anon, authenticated;
grant execute on function private.reject_immutable_artifact_history_change() to service_role;

create trigger trg_artifact_versions_immutable
before update or delete on public.artifact_versions
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_artifact_approvals_immutable
before update or delete on public.artifact_approvals
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_design_context_immutable
before update or delete on public.design_workshop_context_versions
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_design_direction_versions_immutable
before update or delete on public.design_direction_versions
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_design_selections_immutable
before update or delete on public.design_direction_selections
for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_design_releases_immutable
before update or delete on public.design_direction_releases
for each row execute function private.reject_immutable_artifact_history_change();

-- All new public tables are tenant-scoped and browser read-only.
alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.artifact_approvals enable row level security;
alter table public.design_model_registry enable row level security;
alter table public.design_workshop_sessions enable row level security;
alter table public.design_workshop_context_versions enable row level security;
alter table public.design_workshop_model_selections enable row level security;
alter table public.design_generation_runs enable row level security;
alter table public.design_directions enable row level security;
alter table public.design_direction_versions enable row level security;
alter table public.design_direction_selections enable row level security;
alter table public.design_direction_releases enable row level security;

create policy "Team can read artifacts" on public.artifacts for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read artifact versions" on public.artifact_versions for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read artifact approvals" on public.artifact_approvals for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read design models" on public.design_model_registry for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read workshop sessions" on public.design_workshop_sessions for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read workshop context" on public.design_workshop_context_versions for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read workshop model selections" on public.design_workshop_model_selections for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read design generation runs" on public.design_generation_runs for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read design directions" on public.design_directions for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read direction versions" on public.design_direction_versions for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read direction selections" on public.design_direction_selections for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read direction releases" on public.design_direction_releases for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on
  public.artifacts, public.artifact_versions, public.artifact_approvals,
  public.design_model_registry, public.design_workshop_sessions,
  public.design_workshop_context_versions, public.design_workshop_model_selections,
  public.design_generation_runs, public.design_directions,
  public.design_direction_versions, public.design_direction_selections,
  public.design_direction_releases
from anon, authenticated;

grant select on
  public.artifacts, public.artifact_versions, public.artifact_approvals,
  public.design_model_registry, public.design_workshop_sessions,
  public.design_workshop_context_versions, public.design_workshop_model_selections,
  public.design_generation_runs, public.design_directions,
  public.design_direction_versions, public.design_direction_selections,
  public.design_direction_releases
to authenticated;

grant all on
  public.artifacts, public.artifact_versions, public.artifact_approvals,
  public.design_model_registry, public.design_workshop_sessions,
  public.design_workshop_context_versions, public.design_workshop_model_selections,
  public.design_generation_runs, public.design_directions,
  public.design_direction_versions, public.design_direction_selections,
  public.design_direction_releases
to service_role;

-- Initial provider-neutral registry entries. They reuse the existing OpenAI
-- connector credential; this migration creates no connector or secret.
insert into public.design_model_registry (
  organization_id, provider, model_id, display_name, supported_output_types,
  input_formats, limitations, cost_class, speed_class, privacy_classification,
  allowed_engagement_types
)
select organization.id, seeded.provider, seeded.model_id, seeded.display_name,
  seeded.supported_output_types, seeded.input_formats, seeded.limitations,
  seeded.cost_class, seeded.speed_class, seeded.privacy_classification,
  array['project', 'retainer']::text[]
from public.organizations organization
cross join (values
  ('openai', 'gpt-5.4', 'OpenAI GPT-5.4', array['design_direction', 'critique']::text[],
   array['text', 'json']::text[], 'Structured direction concepts; no production asset export in this phase.',
   'high', 'deliberate', 'standard'),
  ('openai', 'gpt-5.4-mini', 'OpenAI GPT-5.4 mini', array['design_direction']::text[],
   array['text', 'json']::text[], 'Fast structured exploration; designer review remains mandatory.',
   'medium', 'fast', 'standard')
) as seeded(
  provider, model_id, display_name, supported_output_types, input_formats,
  limitations, cost_class, speed_class, privacy_classification
)
on conflict (organization_id, provider, model_id) do nothing;

comment on table public.artifact_versions is
  'Append-only typed artifact content. Revisions are new rows and never overwrite an earlier version.';
comment on table public.design_workshop_sessions is
  'Designer-controlled snapshot of exact approved artifact versions plus an output brief and safe designer instructions.';
comment on table public.design_direction_versions is
  'Append-only generated or human-refined direction versions with model/run attribution and lineage.';

commit;
