-- Anka OS - CP1 Content Request Core.
-- Adds individual project/general content requests and their output attachments.
-- Recurring queues, general-mode UI, and Figma handoff generation remain deferred.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.content_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  mode text not null
    check (mode in ('project', 'general')),
  engagement_id uuid,
  brand_id uuid,
  linked_event_id uuid,
  output_path text not null
    check (output_path in ('internal_engine', 'figma_handoff')),
  format text not null
    check (format in (
      'reel', 'carousel', 'single_image', 'stories',
      'carousel_stories', 'reel_carousel', 'web_design_element'
    )),
  brief text not null
    check (length(trim(brief)) between 1 and 12000),
  queue_entry_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'ready', 'delivered')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (engagement_id, organization_id)
    references public.engagements(id, organization_id) on delete cascade,
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete restrict,
  foreign key (linked_event_id, organization_id)
    references public.external_events(id, organization_id)
    on delete set null (linked_event_id),
  unique (id, organization_id),
  check (
    (mode = 'project' and engagement_id is not null and brand_id is not null)
    or
    (mode = 'general' and engagement_id is null)
  )
);

comment on column public.content_requests.linked_event_id is
  'Optional per-request event context. Null is the ordinary recurring-content case, never a client classification.';
comment on column public.content_requests.queue_entry_id is
  'Reserved nullable reference for CP4 queue fulfilment. No foreign key exists until CP4 defines the queue table.';

create table public.content_request_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  content_request_id uuid not null,
  design_media_asset_id uuid,
  figma_handoff_url text,
  created_at timestamptz not null default now(),
  foreign key (content_request_id, organization_id)
    references public.content_requests(id, organization_id) on delete cascade,
  foreign key (design_media_asset_id, organization_id)
    references public.design_media_assets(id, organization_id) on delete cascade,
  unique (id, organization_id),
  unique (design_media_asset_id),
  check (
    (design_media_asset_id is not null and figma_handoff_url is null)
    or
    (design_media_asset_id is null and figma_handoff_url is not null)
  ),
  check (
    figma_handoff_url is null
    or (
      length(trim(figma_handoff_url)) between 1 and 2000
      and figma_handoff_url ~* '^https?://'
    )
  )
);

create index idx_content_requests_project
  on public.content_requests(organization_id, engagement_id, created_at desc)
  where mode = 'project';
create index idx_content_requests_general
  on public.content_requests(organization_id, created_at desc)
  where mode = 'general';
create index idx_content_requests_brand
  on public.content_requests(brand_id, organization_id, created_at desc)
  where brand_id is not null;
create index idx_content_requests_event_fk
  on public.content_requests(linked_event_id, organization_id)
  where linked_event_id is not null;
create index idx_content_requests_created_by_fk
  on public.content_requests(created_by);
create index idx_content_request_assets_request_fk
  on public.content_request_assets(content_request_id, organization_id, created_at);
create index idx_content_request_assets_design_media_fk
  on public.content_request_assets(design_media_asset_id, organization_id)
  where design_media_asset_id is not null;

create or replace function public.enforce_content_request_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.mode = 'project' and not exists (
    select 1
    from public.engagements engagement
    where engagement.id = new.engagement_id
      and engagement.organization_id = new.organization_id
      and engagement.brand_id = new.brand_id
  ) then
    raise exception 'Project content request engagement and brand must match.';
  end if;

  if new.brand_id is not null and not exists (
    select 1
    from public.brands brand
    where brand.id = new.brand_id
      and brand.organization_id = new.organization_id
  ) then
    raise exception 'Content request brand must belong to its organization.';
  end if;

  if new.linked_event_id is not null and not exists (
    select 1
    from public.external_events event
    where event.id = new.linked_event_id
      and event.organization_id = new.organization_id
      and new.brand_id is not null
      and event.brand_id = new.brand_id
  ) then
    raise exception 'Linked event must belong to the content request brand and organization.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_content_request_scope() from public, anon, authenticated;
grant execute on function public.enforce_content_request_scope() to service_role;

create trigger content_requests_enforce_scope
before insert or update of organization_id, mode, engagement_id, brand_id, linked_event_id
on public.content_requests
for each row execute function public.enforce_content_request_scope();

create or replace function public.enforce_content_request_immutable_core()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.organization_id, new.mode, new.engagement_id, new.brand_id,
    new.output_path, new.format, new.brief, new.queue_entry_id,
    new.created_by, new.created_at
  ) is distinct from row(
    old.organization_id, old.mode, old.engagement_id, old.brand_id,
    old.output_path, old.format, old.brief, old.queue_entry_id,
    old.created_by, old.created_at
  ) then
    raise exception 'Content request core fields are immutable.';
  end if;
  if new.linked_event_id is distinct from old.linked_event_id
    and not (old.linked_event_id is not null and new.linked_event_id is null) then
    raise exception 'Content request event context cannot be replaced.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_content_request_immutable_core()
  from public, anon, authenticated;
grant execute on function public.enforce_content_request_immutable_core()
  to service_role;

create trigger content_requests_immutable_core
before update on public.content_requests
for each row execute function public.enforce_content_request_immutable_core();

alter table public.content_requests enable row level security;
alter table public.content_request_assets enable row level security;

create policy "Team can read organization content requests"
  on public.content_requests for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read organization content request assets"
  on public.content_request_assets for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.content_requests from anon, authenticated;
revoke all on public.content_request_assets from anon, authenticated;
grant select on public.content_requests to authenticated;
grant select on public.content_request_assets to authenticated;
grant select, insert, update, delete on public.content_requests to service_role;
grant select, insert, update, delete on public.content_request_assets to service_role;

create or replace function public.create_content_request(
  p_organization_id uuid,
  p_mode text,
  p_engagement_id uuid,
  p_brand_id uuid,
  p_linked_event_id uuid,
  p_output_path text,
  p_format text,
  p_brief text,
  p_queue_entry_id uuid,
  p_actor_id uuid,
  p_create_event_link boolean default false,
  p_event_content_type text default 'social',
  p_lead_time_days integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.content_requests;
  v_link public.content_event_links;
begin
  if p_create_event_link and p_linked_event_id is null then
    raise exception 'An event is required before creating an event-plan link.';
  end if;
  if p_event_content_type not in ('social', 'blog') then
    raise exception 'Content request event links must be social or blog.';
  end if;
  if p_lead_time_days < 0 then
    raise exception 'Lead time must be a non-negative whole number.';
  end if;

  insert into public.content_requests (
    organization_id, mode, engagement_id, brand_id, linked_event_id,
    output_path, format, brief, queue_entry_id, created_by
  ) values (
    p_organization_id, p_mode, p_engagement_id, p_brand_id, p_linked_event_id,
    p_output_path, p_format, p_brief, p_queue_entry_id, p_actor_id
  ) returning * into v_request;

  if p_create_event_link then
    insert into public.content_event_links (
      organization_id, external_event_id, content_type, linked_work_item_id,
      lead_time_days, status, created_by
    ) values (
      p_organization_id, p_linked_event_id, p_event_content_type, null,
      p_lead_time_days, 'planned', p_actor_id
    ) returning * into v_link;
  end if;

  return jsonb_build_object(
    'request', to_jsonb(v_request),
    'event_link', case when v_link.id is null then null else to_jsonb(v_link) end
  );
end;
$$;

revoke execute on function public.create_content_request(
  uuid, text, uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, text, integer
) from public, anon, authenticated;
grant execute on function public.create_content_request(
  uuid, text, uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, text, integer
) to service_role;

commit;
