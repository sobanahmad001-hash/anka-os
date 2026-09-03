-- W7 active-organization client creation.
-- Replaces the ambiguous oldest-membership RPC with an explicit tenant contract.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.create_commercial_client(
  text, text, text, text, text, text, text, text
);

create function public.create_commercial_client(
  p_organization_id uuid,
  p_name text,
  p_brand_name text,
  p_legal_name text default '',
  p_primary_email text default null,
  p_website_url text default null,
  p_industry text default '',
  p_brand_description text default '',
  p_brand_website_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_client public.clients;
  v_agency_client public.agency_clients;
  v_brand public.brands;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'Active organization is required.' using errcode = '22023';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_brand_name), '') is null then
    raise exception 'Client and brand names are required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    where membership.user_id = v_actor_id
      and membership.organization_id = p_organization_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership is required for the selected organization.' using errcode = '42501';
  end if;

  insert into public.clients (
    name, email, company, industry, status, notes, owner_id, organization_id
  ) values (
    trim(p_name),
    nullif(trim(p_primary_email), ''),
    coalesce(nullif(trim(p_legal_name), ''), trim(p_name)),
    coalesce(trim(p_industry), ''),
    'active',
    '',
    v_actor_id,
    p_organization_id
  ) returning * into v_client;

  insert into public.agency_clients (
    organization_id, canonical_client_id, legacy_client_id, name, legal_name,
    primary_email, website_url, industry, status, owner_id, created_by
  ) values (
    p_organization_id,
    v_client.id,
    v_client.id,
    v_client.name,
    v_client.company,
    v_client.email,
    nullif(trim(p_website_url), ''),
    v_client.industry,
    'active',
    v_actor_id,
    v_actor_id
  ) returning * into v_agency_client;

  insert into public.brands (
    organization_id, client_id, name, description, website_url,
    status, is_default, created_by
  ) values (
    p_organization_id,
    v_agency_client.id,
    trim(p_brand_name),
    coalesce(trim(p_brand_description), ''),
    coalesce(nullif(trim(p_brand_website_url), ''), nullif(trim(p_website_url), '')),
    'active',
    true,
    v_actor_id
  ) returning * into v_brand;

  return jsonb_build_object(
    'canonical_client', to_jsonb(v_client),
    'client', to_jsonb(v_agency_client),
    'brand', to_jsonb(v_brand)
  );
end;
$$;

revoke all on function public.create_commercial_client(
  uuid, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_commercial_client(
  uuid, text, text, text, text, text, text, text, text
) to authenticated, service_role;

comment on function public.create_commercial_client(
  uuid, text, text, text, text, text, text, text, text
) is
  'Atomically creates a canonical client, commercial profile, and default brand inside an explicitly selected active team organization.';

commit;
