-- Anka OS - CP4 Content Queue.
-- Adds brand-scoped human plans and atomic action/skip operations.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.content_queue_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null,
  planned_date date not null,
  format text not null check (format in (
    'reel', 'carousel', 'single_image', 'stories',
    'carousel_stories', 'reel_carousel', 'web_design_element'
  )),
  brief_template text not null default '' check (length(brief_template) <= 12000),
  linked_event_id uuid,
  status text not null default 'planned' check (status in ('planned', 'actioned', 'skipped')),
  fulfilled_by_request_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  foreign key (linked_event_id, organization_id)
    references public.external_events(id, organization_id)
    on delete set null (linked_event_id),
  foreign key (fulfilled_by_request_id, organization_id)
    references public.content_requests(id, organization_id)
    on delete set null (fulfilled_by_request_id),
  unique (id, organization_id),
  check (
    status = 'actioned'
    or (status in ('planned', 'skipped') and fulfilled_by_request_id is null)
  )
);

comment on table public.content_queue_entries is
  'Brand-scoped human content plans. Planning alone never creates a content request or event link.';

create index idx_content_queue_entries_calendar
  on public.content_queue_entries(organization_id, brand_id, planned_date, created_at);
create index idx_content_queue_entries_status
  on public.content_queue_entries(organization_id, status, planned_date);
create index idx_content_queue_entries_event_fk
  on public.content_queue_entries(linked_event_id, organization_id)
  where linked_event_id is not null;
create index idx_content_queue_entries_request_fk
  on public.content_queue_entries(fulfilled_by_request_id, organization_id)
  where fulfilled_by_request_id is not null;
create index idx_content_queue_entries_created_by_fk
  on public.content_queue_entries(created_by);

create or replace function public.enforce_content_queue_entry_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.linked_event_id is not null and not exists (
    select 1 from public.external_events event
    where event.id = new.linked_event_id
      and event.organization_id = new.organization_id
      and event.brand_id = new.brand_id
  ) then
    raise exception 'Linked event must belong to the queue entry brand and organization.';
  end if;

  if new.fulfilled_by_request_id is not null and not exists (
    select 1 from public.content_requests request
    where request.id = new.fulfilled_by_request_id
      and request.organization_id = new.organization_id
      and request.brand_id = new.brand_id
      and request.mode = 'general'
      and request.queue_entry_id = new.id
      and request.format = new.format
      and request.brief = new.brief_template
      and request.linked_event_id is not distinct from new.linked_event_id
  ) then
    raise exception 'Fulfilment request must be the matching general request for this queue entry.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_content_queue_entry_scope() from public, anon, authenticated;
grant execute on function public.enforce_content_queue_entry_scope() to service_role;

create trigger content_queue_entries_enforce_scope
before insert or update on public.content_queue_entries
for each row execute function public.enforce_content_queue_entry_scope();

create or replace function public.enforce_content_queue_entry_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(new.organization_id, new.brand_id, new.planned_date, new.format,
    new.brief_template, new.linked_event_id, new.created_by, new.created_at)
    is distinct from
    row(old.organization_id, old.brand_id, old.planned_date, old.format,
      old.brief_template, old.linked_event_id, old.created_by, old.created_at) then
    raise exception 'Queue planning fields are immutable after creation.';
  end if;
  if old.status <> 'planned'
    and not (
      old.status = 'actioned' and new.status = 'actioned'
      and old.fulfilled_by_request_id is not null and new.fulfilled_by_request_id is null
    )
    and row(new.status, new.fulfilled_by_request_id)
      is distinct from row(old.status, old.fulfilled_by_request_id) then
    raise exception 'Actioned and skipped queue entries are terminal.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_content_queue_entry_transition() from public, anon, authenticated;
grant execute on function public.enforce_content_queue_entry_transition() to service_role;

create trigger content_queue_entries_enforce_transition
before update on public.content_queue_entries
for each row execute function public.enforce_content_queue_entry_transition();

create or replace function public.action_content_queue_entry(
  p_organization_id uuid, p_queue_entry_id uuid, p_output_path text, p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry public.content_queue_entries;
  v_result jsonb;
begin
  select * into v_entry from public.content_queue_entries
  where id = p_queue_entry_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'Content queue entry not found.'; end if;
  if v_entry.status <> 'planned' then raise exception 'Only planned queue entries can be actioned.'; end if;
  if length(trim(v_entry.brief_template)) = 0 then
    raise exception 'Add a brief before actioning this queue entry.';
  end if;

  v_result := public.create_content_request(
    p_organization_id, 'general', null, v_entry.brand_id, v_entry.linked_event_id,
    p_output_path, v_entry.format, v_entry.brief_template, v_entry.id, p_actor_id,
    v_entry.linked_event_id is not null, 'social', 0
  );

  update public.content_queue_entries
  set status = 'actioned', fulfilled_by_request_id = (v_result #>> '{request,id}')::uuid
  where id = v_entry.id and organization_id = v_entry.organization_id
  returning * into v_entry;
  return v_result || jsonb_build_object('queue_entry', to_jsonb(v_entry));
end;
$$;

revoke execute on function public.action_content_queue_entry(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.action_content_queue_entry(uuid, uuid, text, uuid)
  to service_role;

create or replace function public.skip_content_queue_entry(
  p_organization_id uuid, p_queue_entry_id uuid
)
returns public.content_queue_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare v_entry public.content_queue_entries;
begin
  select * into v_entry from public.content_queue_entries
  where id = p_queue_entry_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'Content queue entry not found.'; end if;
  if v_entry.status <> 'planned' then raise exception 'Only planned queue entries can be skipped.'; end if;
  update public.content_queue_entries set status = 'skipped'
  where id = v_entry.id and organization_id = v_entry.organization_id
  returning * into v_entry;
  return v_entry;
end;
$$;

revoke execute on function public.skip_content_queue_entry(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.skip_content_queue_entry(uuid, uuid)
  to service_role;

alter table public.content_queue_entries enable row level security;
create policy "Team can read organization content queue"
  on public.content_queue_entries for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.content_queue_entries from anon, authenticated, service_role;
grant select on public.content_queue_entries to authenticated;
grant select, insert, update on public.content_queue_entries to service_role;

commit;
