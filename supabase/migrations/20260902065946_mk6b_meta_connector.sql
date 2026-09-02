begin;

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  facebook_page_id text not null check (facebook_page_id ~ '^[0-9]+$'),
  instagram_account_id text check (instagram_account_id is null or instagram_account_id ~ '^[0-9]+$'),
  access_token_ciphertext text not null,
  access_token_iv text not null,
  token_expires_at timestamptz,
  connected_by uuid not null references auth.users(id) on delete restrict,
  connected_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, brand_id, facebook_page_id),
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete cascade
);
create table public.meta_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  meta_connection_id uuid not null,
  snapshot_date date not null,
  platform text not null check (platform in ('facebook', 'instagram')),
  reach bigint, impressions bigint, engagement bigint, spend numeric,
  created_at timestamptz not null default now(),
  unique (meta_connection_id, snapshot_date, platform),
  foreign key (meta_connection_id, organization_id) references public.meta_connections(id, organization_id) on delete cascade
);
create table public.meta_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, brand_id uuid not null,
  facebook_page_id text not null check (facebook_page_id ~ '^[0-9]+$'),
  instagram_account_id text check (instagram_account_id is null or instagram_account_id ~ '^[0-9]+$'),
  actor_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier_ciphertext text not null, code_verifier_iv text not null,
  return_path text not null default '/settings',
  expires_at timestamptz not null default (now() + interval '10 minutes'), consumed_at timestamptz,
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete cascade
);
create index idx_meta_connections_organization_brand on public.meta_connections(organization_id, brand_id);
create index idx_meta_performance_snapshots_org_date on public.meta_performance_snapshots(organization_id, snapshot_date desc);
create index idx_meta_oauth_sessions_expiry on public.meta_oauth_sessions(expires_at);
alter table public.meta_connections enable row level security;
alter table public.meta_performance_snapshots enable row level security;
alter table public.meta_oauth_sessions enable row level security;
create policy "Team can read own Meta connection metadata" on public.meta_connections for select to authenticated using (public.is_team_organization_member(organization_id));
create policy "Team can read own Meta performance snapshots" on public.meta_performance_snapshots for select to authenticated using (public.is_team_organization_member(organization_id));
revoke all on public.meta_connections, public.meta_performance_snapshots, public.meta_oauth_sessions from anon, authenticated;
grant select on public.meta_performance_snapshots to authenticated;
grant all on public.meta_connections, public.meta_performance_snapshots, public.meta_oauth_sessions to service_role;
commit;
