begin;

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads', 'meta'
  ));

alter table public.integration_events
  drop constraint if exists integration_events_provider_check;
alter table public.integration_events
  add constraint integration_events_provider_check
  check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads', 'meta'
  ));

alter table public.integration_events
  drop constraint if exists integration_events_operation_check;
alter table public.integration_events
  add constraint integration_events_operation_check
  check (operation in (
    'created', 'updated', 'tested', 'disabled',
    'authorization_started', 'authorized', 'reauthorized',
    'authorization_failed', 'disconnected', 'synced'
  ));

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  integration_connection_id uuid not null,
  brand_id uuid not null,
  facebook_page_id text not null,
  instagram_account_id text,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  token_expires_at timestamptz,
  connected_by uuid not null references auth.users(id) on delete restrict,
  connected_at timestamptz not null default now(),
  constraint meta_connections_id_organization_unique unique (id, organization_id),
  constraint meta_connections_registry_unique unique (integration_connection_id),
  constraint meta_connections_brand_page_unique unique (organization_id, brand_id, facebook_page_id),
  constraint meta_connections_facebook_page_id_check check (facebook_page_id ~ '^[0-9]+$'),
  constraint meta_connections_instagram_account_id_check check (
    instagram_account_id is null or instagram_account_id ~ '^[0-9]+$'
  ),
  constraint meta_connections_brand_fk foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  constraint meta_connections_registry_fk foreign key (integration_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete cascade
);

create table public.meta_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  meta_connection_id uuid not null,
  snapshot_date date not null,
  platform text not null,
  reach integer,
  impressions integer,
  engagement integer,
  spend numeric,
  created_at timestamptz not null default now(),
  constraint meta_performance_snapshots_platform_check
    check (platform in ('facebook', 'instagram')),
  constraint meta_performance_snapshots_reach_check check (reach is null or reach >= 0),
  constraint meta_performance_snapshots_impressions_check check (impressions is null or impressions >= 0),
  constraint meta_performance_snapshots_engagement_check check (engagement is null or engagement >= 0),
  constraint meta_performance_snapshots_spend_check check (spend is null),
  constraint meta_performance_snapshots_daily_unique
    unique (meta_connection_id, snapshot_date, platform),
  constraint meta_performance_snapshots_connection_fk
    foreign key (meta_connection_id, organization_id)
    references public.meta_connections(id, organization_id) on delete cascade
);

create table public.meta_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  integration_connection_id uuid not null,
  brand_id uuid not null,
  facebook_page_id text not null,
  instagram_account_id text,
  actor_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null,
  code_verifier_ciphertext text not null,
  code_verifier_iv text not null,
  return_path text not null default '/settings',
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint meta_oauth_sessions_state_hash_unique unique (state_hash),
  constraint meta_oauth_sessions_state_hash_check check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_oauth_sessions_facebook_page_id_check check (facebook_page_id ~ '^[0-9]+$'),
  constraint meta_oauth_sessions_instagram_account_id_check check (
    instagram_account_id is null or instagram_account_id ~ '^[0-9]+$'
  ),
  constraint meta_oauth_sessions_return_path_check check (
    return_path ~ '^/[A-Za-z0-9/_?&=.-]*$' and return_path !~ '^//'
  ),
  constraint meta_oauth_sessions_brand_fk foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  constraint meta_oauth_sessions_registry_fk foreign key (integration_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete cascade
);

create index idx_meta_oauth_sessions_connection
  on public.meta_oauth_sessions(integration_connection_id);
create index idx_meta_oauth_sessions_actor
  on public.meta_oauth_sessions(actor_id);
create index idx_meta_oauth_sessions_expiry
  on public.meta_oauth_sessions(expires_at);

alter table public.meta_connections enable row level security;
alter table public.meta_performance_snapshots enable row level security;
alter table public.meta_oauth_sessions enable row level security;

create policy "Team can read own Meta connection metadata"
  on public.meta_connections for select to authenticated
  using (public.is_team_organization_member(organization_id));
create policy "Team can read own Meta performance snapshots"
  on public.meta_performance_snapshots for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.meta_connections from anon, authenticated;
revoke all on public.meta_performance_snapshots from anon, authenticated;
revoke all on public.meta_oauth_sessions from anon, authenticated;

grant select (
  id, organization_id, integration_connection_id, brand_id, facebook_page_id,
  instagram_account_id, token_expires_at, connected_by, connected_at
) on public.meta_connections to authenticated;
grant select on public.meta_performance_snapshots to authenticated;
grant all on public.meta_connections to service_role;
grant all on public.meta_performance_snapshots to service_role;
grant all on public.meta_oauth_sessions to service_role;

commit;
