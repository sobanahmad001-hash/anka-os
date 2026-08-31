-- Anka OS - MK1 External Events.
-- Brand-scoped real-world events and their department-neutral content plan.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  event_name text not null check (length(trim(event_name)) between 1 and 200),
  category text not null check (category in (
    'concert', 'sports', 'festival', 'awards', 'holiday', 'fashion', 'conference', 'other'
  )),
  venue text,
  location text,
  start_date date not null,
  end_date date,
  source_url text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  unique (id, organization_id),
  check (end_date is null or end_date >= start_date),
  check (venue is null or length(trim(venue)) between 1 and 300),
  check (location is null or length(trim(location)) between 1 and 300),
  check (source_url is null or length(trim(source_url)) between 1 and 2000)
);

create table public.content_event_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  external_event_id uuid not null,
  content_type text not null check (content_type in ('blog', 'social', 'email', 'design_asset')),
  linked_work_item_id uuid,
  lead_time_days integer not null check (lead_time_days >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'ready', 'published')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (external_event_id, organization_id)
    references public.external_events(id, organization_id) on delete cascade,
  foreign key (linked_work_item_id, organization_id)
    references public.work_items(id, organization_id)
    on delete set null (linked_work_item_id),
  unique (id, organization_id)
);

create index idx_external_events_brand_dates
  on public.external_events(organization_id, brand_id, start_date, end_date);
create index idx_external_events_brand_fk
  on public.external_events(brand_id, organization_id);
create index idx_external_events_created_by_fk
  on public.external_events(created_by);
create index idx_content_event_links_event
  on public.content_event_links(organization_id, external_event_id, created_at);
create index idx_content_event_links_external_event_fk
  on public.content_event_links(external_event_id, organization_id);
create index idx_content_event_links_work_item_fk
  on public.content_event_links(linked_work_item_id, organization_id)
  where linked_work_item_id is not null;
create index idx_content_event_links_created_by_fk
  on public.content_event_links(created_by);
create index idx_content_event_links_due
  on public.content_event_links(organization_id, external_event_id, lead_time_days)
  where status in ('planned', 'in_progress');

alter table public.external_events enable row level security;
alter table public.content_event_links enable row level security;

create policy "Team can read organization external events"
  on public.external_events for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read organization content event links"
  on public.content_event_links for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.external_events from anon, authenticated;
revoke all on public.content_event_links from anon, authenticated;
grant select on public.external_events to authenticated;
grant select on public.content_event_links to authenticated;
grant select, insert, update, delete on public.external_events to service_role;
grant select, insert, update, delete on public.content_event_links to service_role;

create view public.content_event_links_due
with (security_invoker = true)
as
select
  link.id,
  link.organization_id,
  event.brand_id,
  link.external_event_id,
  event.event_name,
  event.category,
  event.venue,
  event.location,
  event.start_date as event_start_date,
  event.end_date as event_end_date,
  link.content_type,
  link.linked_work_item_id,
  link.lead_time_days,
  link.status,
  event.start_date - link.lead_time_days as due_date,
  link.created_by,
  link.created_at
from public.content_event_links link
join public.external_events event
  on event.id = link.external_event_id
 and event.organization_id = link.organization_id
where link.status in ('planned', 'in_progress')
  and event.start_date - link.lead_time_days <= current_date;

revoke all on public.content_event_links_due from public, anon, authenticated;
grant select on public.content_event_links_due to authenticated, service_role;

commit;
