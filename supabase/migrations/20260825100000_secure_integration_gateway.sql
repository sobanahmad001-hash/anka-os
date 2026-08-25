-- Anka Sphere OS - Release 1 / Migration 10
-- Secret-free integration metadata, least-privilege access, and immutable audit.

begin;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('github', 'figma', 'wordpress')),
  display_name text not null check (length(display_name) between 1 and 120),
  base_url text,
  public_config jsonb not null default '{}'::jsonb,
  secret_name text,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'configured', 'verified', 'error', 'disabled')),
  last_checked_at timestamptz,
  last_check_status text check (
    last_check_status is null or last_check_status in ('passed', 'failed', 'not_configured')
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, provider, display_name),
  check (
    not (public_config ?| array[
      'token', 'api_key', 'key', 'secret', 'password', 'authorization', 'credentials',
      'access_token', 'refresh_token', 'private_key', 'app_password'
    ])
  ),
  check (
    secret_name is null
    or (
      secret_name ~ '^ANKA_[A-Z0-9_]+$'
      and (
        (provider = 'github' and secret_name like 'ANKA_GITHUB_%')
        or (provider = 'figma' and secret_name like 'ANKA_FIGMA_%')
        or (provider = 'wordpress' and secret_name like 'ANKA_WORDPRESS_%')
      )
    )
  )
);

create index if not exists idx_integration_connections_org_provider
  on public.integration_connections(organization_id, provider)
  where archived_at is null;

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation text not null check (operation in ('created', 'updated', 'tested', 'disabled')),
  outcome text not null check (outcome in ('succeeded', 'failed', 'blocked')),
  provider text not null check (provider in ('github', 'figma', 'wordpress')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (
    not (metadata ?| array[
      'token', 'api_key', 'key', 'secret', 'password', 'authorization', 'credentials',
      'access_token', 'refresh_token', 'private_key', 'app_password', 'response_body'
    ])
  )
);

create index if not exists idx_integration_events_org_occurred
  on public.integration_events(organization_id, occurred_at desc);

alter table public.integration_connections enable row level security;
alter table public.integration_events enable row level security;

create policy "Team can read integration metadata"
  on public.integration_connections for select to authenticated
  using (
    archived_at is null
    and public.is_team_organization_member(organization_id)
  );

create policy "Leaders can read integration audit"
  on public.integration_events for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['system_owner', 'operations_admin', 'executive']
    )
  );

drop trigger if exists trg_touch_integration_connections
  on public.integration_connections;
create trigger trg_touch_integration_connections
before update on public.integration_connections
for each row execute function private.touch_updated_at();

revoke all on public.integration_connections from anon, authenticated;
revoke all on public.integration_events from anon, authenticated;
grant select on public.integration_connections to authenticated;
grant select on public.integration_events to authenticated;
grant all on public.integration_connections to service_role;
grant all on public.integration_events to service_role;

commit;
