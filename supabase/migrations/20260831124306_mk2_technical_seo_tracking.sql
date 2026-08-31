-- Anka OS - MK2 Technical SEO Tracking.
-- Brand-scoped page registry, immutable dated audits, and a live current-health view.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.tracked_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  page_url text not null check (
    length(trim(page_url)) between 8 and 2048
    and trim(page_url) ~* '^https?://[^[:space:]]+$'
  ),
  page_type text not null check (page_type in (
    'homepage', 'service', 'location', 'event', 'blog', 'other'
  )),
  parent_page_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id)
    references public.brands(id, organization_id) on delete cascade,
  foreign key (parent_page_id, brand_id, organization_id)
    references public.tracked_pages(id, brand_id, organization_id)
    on delete set null (parent_page_id),
  unique (id, organization_id),
  unique (id, brand_id, organization_id),
  check (parent_page_id is null or parent_page_id <> id)
);

create unique index idx_tracked_pages_brand_normalized_url
  on public.tracked_pages(
    organization_id,
    brand_id,
    lower(rtrim(trim(page_url), '/'))
  );
create index idx_tracked_pages_brand_list
  on public.tracked_pages(organization_id, brand_id, page_type, page_url);
create index idx_tracked_pages_brand_fk
  on public.tracked_pages(brand_id, organization_id);
create index idx_tracked_pages_parent_fk
  on public.tracked_pages(parent_page_id, brand_id, organization_id)
  where parent_page_id is not null;
create index idx_tracked_pages_created_by_fk on public.tracked_pages(created_by);

create table public.tracked_page_audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tracked_page_id uuid not null,
  audit_date date not null default current_date,
  indexed boolean,
  index_status text check (index_status in (
    'indexed', 'discovered_not_indexed', 'requested', 'excluded'
  )),
  core_web_vitals_mobile numeric,
  core_web_vitals_desktop numeric,
  schema_valid boolean,
  issues text[] not null default '{}'::text[],
  notes text,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'search_console')),
  source_connection_id uuid,
  source_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_details) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (tracked_page_id, organization_id)
    references public.tracked_pages(id, organization_id) on delete cascade,
  foreign key (source_connection_id, organization_id)
    references public.integration_connections(id, organization_id)
    on delete set null (source_connection_id),
  unique (id, organization_id),
  unique (tracked_page_id, audit_date),
  check (core_web_vitals_mobile is null or core_web_vitals_mobile between 0 and 100),
  check (core_web_vitals_desktop is null or core_web_vitals_desktop between 0 and 100),
  check (indexed is not true or index_status = 'indexed'),
  check (index_status is distinct from 'indexed' or indexed is true),
  check (source_type <> 'search_console' or source_connection_id is not null)
);

create index idx_tracked_page_audits_page_history
  on public.tracked_page_audits(organization_id, tracked_page_id, audit_date desc, created_at desc);
create index idx_tracked_page_audits_page_fk
  on public.tracked_page_audits(tracked_page_id, organization_id);
create index idx_tracked_page_audits_source_connection_fk
  on public.tracked_page_audits(source_connection_id, organization_id)
  where source_connection_id is not null;
create index idx_tracked_page_audits_created_by_fk on public.tracked_page_audits(created_by);
create index idx_tracked_page_audits_attention
  on public.tracked_page_audits(organization_id, audit_date desc)
  where index_status = 'discovered_not_indexed'
     or schema_valid is false
     or cardinality(issues) > 0;

create or replace function private.validate_tracked_page_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.parent_page_id is null then
    return new;
  end if;

  if new.parent_page_id = new.id then
    raise exception 'A tracked page cannot be its own parent.';
  end if;

  if exists (
    with recursive descendants as (
      select page.id
      from public.tracked_pages page
      where page.parent_page_id = new.id
        and page.organization_id = new.organization_id
        and page.brand_id = new.brand_id
      union
      select child.id
      from public.tracked_pages child
      join descendants parent on child.parent_page_id = parent.id
      where child.organization_id = new.organization_id
        and child.brand_id = new.brand_id
    )
    select 1 from descendants where id = new.parent_page_id
  ) then
    raise exception 'Tracked page hierarchy cannot contain a cycle.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_tracked_page_parent() from public;

create trigger trg_validate_tracked_page_parent
before insert or update of parent_page_id, id, brand_id, organization_id
on public.tracked_pages
for each row execute function private.validate_tracked_page_parent();

create trigger trg_touch_tracked_pages
before update on public.tracked_pages
for each row execute function private.touch_updated_at();

alter table public.tracked_pages enable row level security;
alter table public.tracked_page_audits enable row level security;

create policy "Team can read organization tracked pages"
  on public.tracked_pages for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read organization tracked page audits"
  on public.tracked_page_audits for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.tracked_pages, public.tracked_page_audits from anon, authenticated;
grant select on public.tracked_pages, public.tracked_page_audits to authenticated;
grant select, insert, update, delete on public.tracked_pages to service_role;
grant select, insert on public.tracked_page_audits to service_role;

create view public.tracked_page_current_health
with (security_invoker = true)
as
select
  page.id as tracked_page_id,
  page.organization_id,
  page.brand_id,
  brand.name as brand_name,
  page.page_url,
  page.page_type,
  page.parent_page_id,
  audit.id as latest_audit_id,
  audit.audit_date,
  audit.indexed,
  audit.index_status,
  audit.core_web_vitals_mobile,
  audit.core_web_vitals_desktop,
  audit.schema_valid,
  coalesce(audit.issues, '{}'::text[]) as issues,
  cardinality(coalesce(audit.issues, '{}'::text[])) as open_issue_count,
  audit.notes,
  audit.source_type,
  audit.source_connection_id,
  audit.source_details,
  case when audit.audit_date is null then null else current_date - audit.audit_date end as days_since_audit,
  coalesce((
    audit.index_status = 'discovered_not_indexed'
    or audit.schema_valid is false
    or cardinality(coalesce(audit.issues, '{}'::text[])) > 0
  ), false) as needs_attention,
  page.created_at,
  page.updated_at
from public.tracked_pages page
join public.brands brand
  on brand.id = page.brand_id
 and brand.organization_id = page.organization_id
left join lateral (
  select snapshot.*
  from public.tracked_page_audits snapshot
  where snapshot.tracked_page_id = page.id
    and snapshot.organization_id = page.organization_id
  order by snapshot.audit_date desc, snapshot.created_at desc, snapshot.id desc
  limit 1
) audit on true;

revoke all on public.tracked_page_current_health from public, anon, authenticated;
grant select on public.tracked_page_current_health to authenticated, service_role;

commit;
