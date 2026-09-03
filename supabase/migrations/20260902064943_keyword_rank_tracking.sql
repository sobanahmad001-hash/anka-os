-- Anka OS - MK6a Keyword Rank Tracking.
-- Manual keyword registry on MK2 tracked pages with append-only Search Console snapshots.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  tracked_page_id uuid not null,
  keyword text not null check (length(trim(keyword)) between 1 and 200),
  source_artifact_id uuid,
  target_rank_tier text check (target_rank_tier in ('top_3', 'top_10', 'top_20')),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  foreign key (tracked_page_id, organization_id)
    references public.tracked_pages(id, organization_id) on delete cascade,
  foreign key (source_artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete set null (source_artifact_id),
  unique (id, organization_id)
);

create table public.keyword_rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tracked_keyword_id uuid not null,
  snapshot_date date not null,
  position numeric,
  search_console_clicks integer,
  search_console_impressions integer,
  fetched_at timestamptz not null default now(),
  foreign key (tracked_keyword_id, organization_id)
    references public.tracked_keywords(id, organization_id) on delete cascade,
  unique (tracked_keyword_id, snapshot_date),
  check (position is null or position >= 1),
  check (search_console_clicks is null or search_console_clicks >= 0),
  check (search_console_impressions is null or search_console_impressions >= 0)
);

create index idx_tracked_keywords_page_list
  on public.tracked_keywords(organization_id, tracked_page_id, active, created_at desc);
create index idx_tracked_keywords_brand_list
  on public.tracked_keywords(organization_id, brand_id, active, keyword);
create index idx_tracked_keywords_source_artifact_fk
  on public.tracked_keywords(source_artifact_id, organization_id)
  where source_artifact_id is not null;
create index idx_keyword_rank_snapshots_keyword_history
  on public.keyword_rank_snapshots(organization_id, tracked_keyword_id, snapshot_date desc, fetched_at desc);
create index idx_keyword_rank_snapshots_keyword_fk
  on public.keyword_rank_snapshots(tracked_keyword_id, organization_id);

alter table public.tracked_keywords enable row level security;
alter table public.keyword_rank_snapshots enable row level security;

create policy "Team can read organization tracked keywords"
  on public.tracked_keywords for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read organization keyword rank snapshots"
  on public.keyword_rank_snapshots for select to authenticated
  using (public.is_team_organization_member(organization_id));

-- Start each browser and service role table ACL from an explicit zero baseline.
revoke all privileges on public.tracked_keywords, public.keyword_rank_snapshots from anon, authenticated, service_role;
revoke all privileges (id, organization_id, brand_id, tracked_page_id, keyword, source_artifact_id, target_rank_tier, active, created_by, created_at)
  on public.tracked_keywords from anon, authenticated, service_role;
revoke all privileges (id, organization_id, tracked_keyword_id, snapshot_date, position, search_console_clicks, search_console_impressions, fetched_at)
  on public.keyword_rank_snapshots from anon, authenticated, service_role;
grant select on public.tracked_keywords, public.keyword_rank_snapshots to authenticated;
grant select, insert, update, delete on public.tracked_keywords to service_role;
grant select, insert on public.keyword_rank_snapshots to service_role;

commit;
