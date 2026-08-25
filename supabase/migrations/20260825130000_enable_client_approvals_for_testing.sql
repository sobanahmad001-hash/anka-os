-- Anka Sphere OS - Release 1 / Migration 13
-- Enable formal client approvals for testing.

begin;

update public.organizations
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('client_approvals_enabled', true);

drop policy if exists "Clients can record client approvals" on public.approvals;
create policy "Clients can record client approvals"
  on public.approvals for insert to authenticated
  with check (
    approval_type = 'client_approval'
    and decision in ('approved', 'changes_required')
    and decided_by = (select auth.uid())
    and private.is_project_client(project_id)
    and exists (
      select 1
      from public.organizations organization
      where organization.id = approvals.organization_id
        and coalesce((organization.settings ->> 'client_approvals_enabled')::boolean, false) = true
    )
    and exists (
      select 1
      from public.client_portal_items portal_item
      where portal_item.project_id = approvals.project_id
        and portal_item.source_type = 'deliverable_version'
        and portal_item.source_id = approvals.deliverable_version_id
        and portal_item.withdrawn_at is null
    )
  );

drop policy if exists "Clients can read own client approvals" on public.approvals;
create policy "Clients can read own client approvals"
  on public.approvals for select to authenticated
  using (
    approval_type = 'client_approval'
    and decided_by = (select auth.uid())
    and private.is_project_client(project_id)
  );

create or replace function private.apply_client_approval_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if new.approval_type <> 'client_approval' then
    return new;
  end if;

  select version.review_status
    into current_status
  from public.deliverable_versions version
  where version.id = new.deliverable_version_id;

  if current_status = 'ready_for_client_review' then
    update public.deliverable_versions
    set review_status = 'client_reviewing'
    where id = new.deliverable_version_id;
    current_status := 'client_reviewing';
  end if;

  if current_status = 'client_reviewing' then
    update public.deliverable_versions
    set review_status = case
      when new.decision = 'approved' then 'client_approved'
      else 'revision_requested'
    end
    where id = new.deliverable_version_id;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_client_approval_decision on public.approvals;
create trigger apply_client_approval_decision
after insert on public.approvals
for each row
execute function private.apply_client_approval_decision();

revoke all on function private.apply_client_approval_decision() from public, anon;
grant execute on function private.apply_client_approval_decision() to service_role;

commit;
