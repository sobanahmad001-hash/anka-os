-- N4: narrow catalogue writes to active owner/admin team members.
-- Existing service identities and rows are unchanged; retirement remains a soft update.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists "Leaders can manage service catalogue" on public.service_catalog;

create policy "Active admins can create catalogue services"
on public.service_catalog for insert to authenticated
with check (
  public.is_team_organization_member(organization_id)
  and public.has_organization_role(organization_id, array['system_owner', 'operations_admin'])
  and exists (
    select 1 from public.organizations organization
    where organization.id = organization_id and organization.status = 'active'
  )
);

create policy "Active admins can update catalogue services"
on public.service_catalog for update to authenticated
using (
  public.is_team_organization_member(organization_id)
  and public.has_organization_role(organization_id, array['system_owner', 'operations_admin'])
  and exists (
    select 1 from public.organizations organization
    where organization.id = organization_id and organization.status = 'active'
  )
)
with check (
  public.is_team_organization_member(organization_id)
  and public.has_organization_role(organization_id, array['system_owner', 'operations_admin'])
  and exists (
    select 1 from public.organizations organization
    where organization.id = organization_id and organization.status = 'active'
  )
);

revoke delete on public.service_catalog from authenticated;
commit;
