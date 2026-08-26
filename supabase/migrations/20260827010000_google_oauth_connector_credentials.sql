-- Anka Sphere OS - Google OAuth connector credentials
-- Single-use authorization sessions plus encrypted-at-rest token storage.

begin;

alter table public.integration_connections
  drop constraint if exists integration_connections_status_check;
alter table public.integration_connections
  add constraint integration_connections_status_check
  check (status in (
    'disconnected', 'configured', 'authorizing', 'verified', 'error', 'disabled'
  ));

alter table public.integration_events
  drop constraint if exists integration_events_operation_check;
alter table public.integration_events
  add constraint integration_events_operation_check
  check (operation in (
    'created', 'updated', 'tested', 'disabled',
    'authorization_started', 'authorized', 'reauthorized',
    'authorization_failed', 'disconnected'
  ));

create table public.integration_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  provider text not null check (provider in (
    'google_analytics', 'google_search_console', 'google_ads'
  )),
  actor_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique check (length(state_hash) = 64),
  code_verifier_ciphertext text not null,
  code_verifier_iv text not null,
  return_path text not null default '/settings'
    check (
      return_path ~ '^/[A-Za-z0-9/_?&=.-]*$'
      and return_path !~ '^//'
    ),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete cascade
);

create index idx_integration_oauth_sessions_connection
  on public.integration_oauth_sessions(connection_id);
create index idx_integration_oauth_sessions_actor
  on public.integration_oauth_sessions(actor_id);
create index idx_integration_oauth_sessions_expiry
  on public.integration_oauth_sessions(expires_at)
  where consumed_at is null;

create table public.integration_oauth_credentials (
  connection_id uuid primary key,
  organization_id uuid not null,
  provider text not null check (provider in (
    'google_analytics', 'google_search_console', 'google_ads'
  )),
  access_token_ciphertext text not null,
  access_token_iv text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  token_type text not null default 'Bearer',
  granted_scopes text[] not null default '{}',
  access_token_expires_at timestamptz not null,
  provider_subject_hash text check (
    provider_subject_hash is null or length(provider_subject_hash) = 64
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete cascade
);

create index idx_integration_oauth_credentials_org_provider
  on public.integration_oauth_credentials(organization_id, provider);

alter table public.integration_oauth_sessions enable row level security;
alter table public.integration_oauth_credentials enable row level security;

revoke all on public.integration_oauth_sessions from anon, authenticated;
revoke all on public.integration_oauth_credentials from anon, authenticated;
grant all on public.integration_oauth_sessions to service_role;
grant all on public.integration_oauth_credentials to service_role;

drop trigger if exists trg_touch_integration_oauth_credentials
  on public.integration_oauth_credentials;
create trigger trg_touch_integration_oauth_credentials
before update on public.integration_oauth_credentials
for each row execute function private.touch_updated_at();

commit;
