-- RP4: real, reviewable HTML/CSS page designs attached to immutable Design versions.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.website_page_designs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  design_direction_version_id uuid not null,
  slug text not null check (length(trim(slug)) between 1 and 240),
  html_content text not null check (length(trim(html_content)) between 1 and 500000),
  css_content text not null check (length(trim(css_content)) between 1 and 200000),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'exported')),
  exported_at timestamptz,
  wordpress_export_url text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (design_direction_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete cascade,
  constraint website_page_designs_export_requires_url check (
    status <> 'exported' or wordpress_export_url is not null
  ),
  unique (id, organization_id)
);

create index idx_website_page_designs_version_slug
  on public.website_page_designs(
    organization_id, design_direction_version_id, slug, created_at desc
  );

alter table public.website_page_designs enable row level security;

create policy "Team can read permitted website page designs"
  on public.website_page_designs
  for select
  to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and exists (
      select 1
      from public.design_direction_versions version
      where version.id = design_direction_version_id
        and version.organization_id = website_page_designs.organization_id
    )
  );

revoke all on public.website_page_designs from anon, authenticated;
grant select on public.website_page_designs to authenticated;
grant all on public.website_page_designs to service_role;

-- Reuse the existing full text-generation model. This adds an output capability;
-- it does not create a parallel model or provider route.
update public.design_model_registry
set supported_output_types = (
      select array_agg(distinct output_type order by output_type)
      from unnest(supported_output_types || array['html_css']::text[]) item(output_type)
    ),
    updated_at = now()
where provider = 'openai'
  and model_id = 'gpt-5.4';

comment on table public.website_page_designs is
  'Append-created standalone HTML/CSS page attempts generated from one exact Design direction version and reviewed by humans.';
comment on column public.website_page_designs.slug is
  'Exact website_architecture.pages[].slug value. RP2 uses slug, never page_slug.';
comment on column public.website_page_designs.wordpress_export_url is
  'Reserved for the isolated RP5 export flow; RP4 never writes this field or exported status.';

commit;
