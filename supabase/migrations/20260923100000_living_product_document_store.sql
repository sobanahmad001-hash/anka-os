-- One Product Document per selected organization. Existing project documents remain separate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.living_product_document (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  content text not null default '',
  changelog jsonb not null default '[]'::jsonb check (jsonb_typeof(changelog) = 'array'),
  version bigint not null default 1 check (version >= 1),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.living_product_document enable row level security;
revoke all on public.living_product_document from public, anon, authenticated;
grant select, insert on public.living_product_document to authenticated;
grant all on public.living_product_document to service_role;
grant update (content, changelog, version, updated_at, updated_by)
  on public.living_product_document to authenticated;

create policy "Organization leadership reads product document"
  on public.living_product_document for select to authenticated
  using (public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive']));

create policy "Organization owners manage product document"
  on public.living_product_document for insert to authenticated
  with check (
    public.has_organization_role(organization_id, array['system_owner', 'operations_admin'])
    and updated_by = auth.uid()
  );

create policy "Organization owners update product document"
  on public.living_product_document for update to authenticated
  using (public.has_organization_role(organization_id, array['system_owner', 'operations_admin']))
  with check (
    public.has_organization_role(organization_id, array['system_owner', 'operations_admin'])
    and updated_by = auth.uid()
  );

commit;
