-- Anka OS MK3 - brand-scoped Google Ads planning and dated performance snapshots.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null,
  provider_connection_id uuid,
  campaign_name text not null check (length(trim(campaign_name)) between 1 and 180),
  campaign_type text not null check (campaign_type in ('search', 'app', 'display', 'other')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  daily_budget numeric(14, 2) check (daily_budget is null or daily_budget >= 0),
  total_budget numeric(14, 2) check (total_budget is null or total_budget >= 0),
  start_date date,
  end_date date,
  goal text not null default '' check (length(goal) <= 2000),
  location_targeting text[] not null default '{}',
  audience_segment text not null default '' check (length(audience_segment) <= 2000),
  external_account_id text check (external_account_id is null or external_account_id ~ '^[0-9]{10}$'),
  external_campaign_id text check (external_campaign_id is null or external_campaign_id ~ '^[0-9]+$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  foreign key (provider_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  check (end_date is null or start_date is null or end_date >= start_date),
  check (
    (provider_connection_id is null and external_account_id is null and external_campaign_id is null)
    or (provider_connection_id is not null and external_account_id is not null and external_campaign_id is not null)
  ),
  unique (id, organization_id)
);

create table public.ad_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_campaign_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 180),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ad_campaign_id, organization_id)
    references public.ad_campaigns(id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create table public.ad_group_keywords (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_group_id uuid not null,
  keyword text not null check (length(trim(keyword)) between 1 and 500),
  match_type text not null check (match_type in ('broad', 'phrase', 'exact')),
  is_negative boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ad_group_id, organization_id)
    references public.ad_groups(id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create table public.ad_campaign_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_campaign_id uuid not null,
  snapshot_date date not null,
  impressions integer not null default 0 check (impressions >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  cost numeric(18, 6) not null default 0 check (cost >= 0),
  conversions integer not null default 0 check (conversions >= 0),
  provider_connection_id uuid not null,
  external_campaign_id text not null check (external_campaign_id ~ '^[0-9]+$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (ad_campaign_id, organization_id)
    references public.ad_campaigns(id, organization_id) on delete cascade,
  foreign key (provider_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  unique (ad_campaign_id, snapshot_date),
  unique (id, organization_id)
);

create unique index idx_ad_campaigns_brand_name
  on public.ad_campaigns(brand_id, lower(trim(campaign_name)));
create unique index idx_ad_campaigns_external_identity
  on public.ad_campaigns(provider_connection_id, external_campaign_id)
  where provider_connection_id is not null and external_campaign_id is not null;
create index idx_ad_campaigns_brand_dashboard
  on public.ad_campaigns(organization_id, brand_id, status, updated_at desc);
create index idx_ad_campaigns_connection
  on public.ad_campaigns(provider_connection_id, organization_id)
  where provider_connection_id is not null;
create index idx_ad_campaigns_created_by on public.ad_campaigns(created_by);

create unique index idx_ad_groups_campaign_name
  on public.ad_groups(ad_campaign_id, lower(trim(name)));
create index idx_ad_groups_campaign
  on public.ad_groups(organization_id, ad_campaign_id, status, updated_at desc);
create index idx_ad_groups_created_by on public.ad_groups(created_by);

create unique index idx_ad_group_keywords_parent_term
  on public.ad_group_keywords(ad_group_id, lower(trim(keyword)));
create index idx_ad_group_keywords_group
  on public.ad_group_keywords(organization_id, ad_group_id, is_negative, match_type);
create index idx_ad_group_keywords_created_by on public.ad_group_keywords(created_by);

create index idx_ad_campaign_snapshots_campaign_date
  on public.ad_campaign_performance_snapshots(organization_id, ad_campaign_id, snapshot_date desc);
create index idx_ad_campaign_snapshots_connection
  on public.ad_campaign_performance_snapshots(provider_connection_id, organization_id);
create index idx_ad_campaign_snapshots_created_by
  on public.ad_campaign_performance_snapshots(created_by);

create trigger trg_touch_ad_campaigns before update on public.ad_campaigns
for each row execute function private.touch_updated_at();
create trigger trg_touch_ad_groups before update on public.ad_groups
for each row execute function private.touch_updated_at();
create trigger trg_touch_ad_group_keywords before update on public.ad_group_keywords
for each row execute function private.touch_updated_at();

alter table public.ad_campaigns enable row level security;
alter table public.ad_groups enable row level security;
alter table public.ad_group_keywords enable row level security;
alter table public.ad_campaign_performance_snapshots enable row level security;

create policy "Team can read ad campaigns" on public.ad_campaigns
  for select to authenticated using (public.is_team_organization_member(organization_id));
create policy "Team can read ad groups" on public.ad_groups
  for select to authenticated using (public.is_team_organization_member(organization_id));
create policy "Team can read ad group keywords" on public.ad_group_keywords
  for select to authenticated using (public.is_team_organization_member(organization_id));
create policy "Team can read ad campaign snapshots" on public.ad_campaign_performance_snapshots
  for select to authenticated using (public.is_team_organization_member(organization_id));

create view public.ad_campaign_performance_metrics
with (security_invoker = true)
as
select
  snapshot.*,
  case when snapshot.impressions = 0 then null
    else snapshot.clicks::numeric / snapshot.impressions end as ctr,
  case when snapshot.clicks = 0 then null
    else snapshot.cost / snapshot.clicks end as cpc,
  case when snapshot.conversions = 0 then null
    else snapshot.cost / snapshot.conversions end as cost_per_conversion
from public.ad_campaign_performance_snapshots snapshot;

revoke all on public.ad_campaigns, public.ad_groups, public.ad_group_keywords,
  public.ad_campaign_performance_snapshots from anon, authenticated;
revoke all on public.ad_campaign_performance_metrics from anon, authenticated;
grant select on public.ad_campaigns, public.ad_groups, public.ad_group_keywords,
  public.ad_campaign_performance_snapshots, public.ad_campaign_performance_metrics to authenticated;
grant all on public.ad_campaigns, public.ad_groups, public.ad_group_keywords,
  public.ad_campaign_performance_snapshots to service_role;
grant select on public.ad_campaign_performance_metrics to service_role;

comment on table public.ad_campaigns is
  'Brand-scoped Google Ads planning records. These rows never mutate provider entities.';
comment on table public.ad_campaign_performance_snapshots is
  'Append-only dated imports from a read-only Google Ads reporting call.';
comment on view public.ad_campaign_performance_metrics is
  'Live CTR, CPC, and cost-per-conversion calculations with zero denominators returned as null.';

commit;
