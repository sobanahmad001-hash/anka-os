-- Anka OS — DS3 multi-page Design Workshop flow grouping.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.design_page_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  website_architecture_artifact_id uuid,
  flow_name text not null check (length(trim(flow_name)) between 1 and 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (website_architecture_artifact_id, organization_id)
    references public.artifacts(id, organization_id)
    on delete set null (website_architecture_artifact_id),
  unique (id, organization_id)
);

alter table public.design_workshop_sessions
  add column page_flow_id uuid,
  add column page_slug text;

alter table public.design_workshop_sessions
  add constraint design_workshop_sessions_flow_fk
    foreign key (page_flow_id, organization_id)
    references public.design_page_flows(id, organization_id)
    on delete set null (page_flow_id),
  add constraint design_workshop_sessions_flow_requires_slug
    check (page_flow_id is null or page_slug is not null);

create index idx_design_page_flows_engagement
  on public.design_page_flows(organization_id, engagement_id, created_at desc);
create index idx_design_sessions_page_flow
  on public.design_workshop_sessions(organization_id, page_flow_id)
  where page_flow_id is not null;

alter table public.design_page_flows enable row level security;

create policy "Team can read design page flows"
  on public.design_page_flows for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.design_page_flows from anon, authenticated;
grant select on public.design_page_flows to authenticated;
grant all on public.design_page_flows to service_role;

comment on table public.design_page_flows is
  'Optional grouping of independent Design Workshop sessions into pages of one website flow.';

commit;