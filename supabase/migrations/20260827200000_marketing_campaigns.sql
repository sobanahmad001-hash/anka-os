-- Anka OS - campaign planning records and links to canonical artifacts.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  brand_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 180),
  objective text not null default '' check (length(objective) <= 2000),
  planned_channels text[] not null default '{}'::text[]
    check (cardinality(planned_channels) between 1 and 20),
  starts_on date,
  ends_on date,
  planned_budget numeric(14, 2) check (planned_budget is null or planned_budget >= 0),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'active', 'paused', 'completed', 'cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  unique (id, organization_id)
);

create table public.marketing_campaign_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  artifact_id uuid not null,
  relation_type text not null check (relation_type in (
    'channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report'
  )),
  linked_by uuid not null references auth.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id)
    references public.marketing_campaigns(id, organization_id) on delete cascade,
  foreign key (artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  unique (campaign_id, artifact_id),
  unique (id, organization_id)
);

create index idx_marketing_campaigns_engagement
  on public.marketing_campaigns(organization_id, engagement_id, updated_at desc);
create index idx_marketing_campaigns_brand
  on public.marketing_campaigns(organization_id, brand_id, status, starts_on);
create index idx_marketing_campaign_artifacts_campaign
  on public.marketing_campaign_artifacts(organization_id, campaign_id, linked_at);
create index idx_marketing_campaign_artifacts_artifact
  on public.marketing_campaign_artifacts(artifact_id);

create trigger trg_touch_marketing_campaigns
before update on public.marketing_campaigns
for each row execute function private.touch_updated_at();

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_artifacts enable row level security;

create policy "Team can read marketing campaigns"
  on public.marketing_campaigns for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read marketing campaign artifacts"
  on public.marketing_campaign_artifacts for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.marketing_campaigns, public.marketing_campaign_artifacts
  from anon, authenticated;
grant select on public.marketing_campaigns, public.marketing_campaign_artifacts
  to authenticated;
grant all on public.marketing_campaigns, public.marketing_campaign_artifacts
  to service_role;

comment on table public.marketing_campaigns is
  'Internal campaign planning records. Budget is informational and cannot initiate provider spend.';
comment on table public.marketing_campaign_artifacts is
  'Links campaigns to the canonical immutable artifact identities; versions and approvals remain in the shared artifact model.';

commit;
