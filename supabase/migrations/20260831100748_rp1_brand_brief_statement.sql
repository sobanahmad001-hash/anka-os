-- Anka OS RP1 - mutable brand brief plus immutable brand-statement vocabulary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.brand_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  target_market text not null default '',
  price_tier text not null default ''
    check (price_tier in ('', 'value', 'mid', 'premium')),
  operating_principles text[] not null default '{}'::text[],
  competitor_references text[] not null default '{}'::text[],
  raw_brief text not null check (length(trim(raw_brief)) between 1 and 50000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  unique (brand_id),
  unique (id, organization_id),
  constraint brand_briefs_updated_after_creation check (updated_at >= created_at)
);

create index idx_brand_briefs_organization
  on public.brand_briefs(organization_id, updated_at desc);

alter table public.brand_briefs enable row level security;

create policy "Team can read brand briefs"
  on public.brand_briefs
  for select
  to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.brand_briefs from anon, authenticated;
grant select on public.brand_briefs to authenticated;
grant all on public.brand_briefs to service_role;

alter table public.artifacts
  drop constraint artifacts_artifact_type_check;

alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'discovery',
    'vision',
    'audience',
    'brand_statement',
    'website_architecture',
    'keyword_strategy',
    'content',
    'campaign_messaging',
    'scripts',
    'channel_strategy',
    'campaign_brief',
    'measurement_plan',
    'marketing_report',
    'technical_brief',
    'launch_checklist'
  ));

comment on table public.brand_briefs is
  'One mutable working brief per brand. Approved brand statements remain immutable artifacts.';
comment on column public.brand_briefs.updated_at is
  'Set explicitly by the authorized Content Studio write path on every in-place revision.';

commit;
