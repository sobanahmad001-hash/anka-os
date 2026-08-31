-- Anka OS - MK4 brand-scoped backlink research and outreach tracking.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.backlink_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  brand_id uuid not null,
  site_name text not null
    check (length(trim(site_name)) between 1 and 240),
  site_url text
    check (
      site_url is null
      or (
        site_url = trim(site_url)
        and length(site_url) between 10 and 2048
        and site_url ~* '^https?://([[:alnum:]]([[:alnum:]-]{0,61}[[:alnum:]])?[.])+[[:alpha:]]([[:alnum:]-]{0,61}[[:alnum:]])?(:[0-9]{1,5})?(/[^[:space:]?#]*)?([?][^[:space:]#]*)?(#[^[:space:]]*)?$'
      )
    ),
  industry_category text
    check (industry_category is null or length(trim(industry_category)) between 1 and 160),
  domain_authority numeric(5, 2)
    check (domain_authority is null or domain_authority between 0 and 100),
  estimated_traffic numeric(18, 2)
    check (estimated_traffic is null or estimated_traffic >= 0),
  relevance_score numeric(5, 2)
    check (relevance_score is null or relevance_score between 0 and 100),
  link_type text
    check (link_type is null or link_type in ('membership', 'partnership', 'editorial', 'guest_post')),
  cost_type text
    check (cost_type is null or cost_type in ('free', 'paid', 'both')),
  outreach_status text not null default 'not_started'
    check (outreach_status in ('not_started', 'contacted', 'in_discussion', 'secured', 'declined')),
  notes text
    check (notes is null or length(notes) <= 20000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  unique (id, organization_id)
);

create index idx_backlink_targets_brand_status
  on public.backlink_targets (
    organization_id, brand_id, outreach_status,
    relevance_score desc nulls last,
    domain_authority desc nulls last,
    created_at desc
  );

create unique index idx_backlink_targets_brand_normalized_url
  on public.backlink_targets (
    organization_id,
    brand_id,
    lower(rtrim(site_url, '/'))
  )
  where site_url is not null;

create index idx_backlink_targets_created_by
  on public.backlink_targets(created_by);

create trigger trg_touch_backlink_targets
before update on public.backlink_targets
for each row execute function private.touch_updated_at();

alter table public.backlink_targets enable row level security;

create policy "Team can read backlink targets"
  on public.backlink_targets for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.backlink_targets from anon, authenticated;
grant select on public.backlink_targets to authenticated;
grant select, insert, update on public.backlink_targets to service_role;

comment on table public.backlink_targets is
  'Brand-scoped manual backlink research and outreach status. It does not send messages, scrape sites, or verify backlinks.';
comment on column public.backlink_targets.domain_authority is
  'Optional manually supplied authority score from 0 to 100; null means unknown.';
comment on column public.backlink_targets.relevance_score is
  'Optional team-assessed relevance score from 0 to 100; null means unknown.';
comment on column public.backlink_targets.estimated_traffic is
  'Optional manually supplied non-negative traffic estimate; null means unknown.';

commit;
