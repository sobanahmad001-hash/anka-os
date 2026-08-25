-- Anka Sphere OS - Phase 1 / Migration 2 (20260825020000)
-- Security boundary hardening after the organization/access foundation.
--
-- Safety properties:
--   * no application row or storage object is deleted
--   * authenticated application DML remains governed by existing RLS
--   * anonymous public-table access is removed
--   * elevated table privileges not required by the API are removed
--   * deliverable storage becomes internal-team-only until controlled release
--   * legacy SECURITY DEFINER functions receive fixed search paths and grants

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Table grants: authenticated app only; RLS remains the row-level authority
-- ---------------------------------------------------------------------------

revoke all privileges on all tables in schema public from anon;

revoke truncate, references, trigger
  on all tables in schema public
  from authenticated;

-- Apply the same boundary to future tables created by the migration owner.
alter default privileges in schema public
  revoke all privileges on tables from anon;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- PostgreSQL grants function execution to PUBLIC by default. Future application
-- functions must be granted deliberately after their security review.
alter default privileges in schema public
  revoke execute on functions from public;

alter default privileges in schema public
  revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 2. SECURITY DEFINER hardening
-- ---------------------------------------------------------------------------

alter function public.can_access_task(uuid)
  set search_path = '';

revoke all on function public.can_access_task(uuid) from public, anon;
grant execute on function public.can_access_task(uuid)
  to authenticated, service_role;

alter function public.handle_new_user()
  set search_path = '';

revoke all on function public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_user()
  to service_role;

alter function public.update_project_progress()
  set search_path = '';

revoke all on function public.update_project_progress()
  from public, anon, authenticated;
grant execute on function public.update_project_progress()
  to service_role;

-- This function is invoked by the database event trigger, not by API users.
alter function public.rls_auto_enable()
  set search_path = 'pg_catalog';

revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;
grant execute on function public.rls_auto_enable()
  to service_role;

-- Migration 1 helpers were created with safe search paths. Remove the explicit
-- anonymous grants added by the platform's automatic function grant behavior.
revoke all on function public.is_organization_member(uuid)
  from public, anon;
revoke all on function public.is_team_organization_member(uuid)
  from public, anon;
revoke all on function public.has_organization_role(uuid, text[])
  from public, anon;

grant execute on function public.is_organization_member(uuid)
  to authenticated, service_role;
grant execute on function public.is_team_organization_member(uuid)
  to authenticated, service_role;
grant execute on function public.has_organization_role(uuid, text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Deliverable storage: internal team only until controlled client release
-- ---------------------------------------------------------------------------

update storage.buckets
set public = false
where id = 'sphere-deliverables';

drop policy if exists "authenticated users can upload" on storage.objects;
drop policy if exists "owners can delete" on storage.objects;
drop policy if exists "public read deliverables" on storage.objects;

drop policy if exists "Team can read sphere deliverables" on storage.objects;
create policy "Team can read sphere deliverables"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sphere-deliverables'
    and public.is_team_organization_member(
      '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    )
  );

drop policy if exists "Team can upload sphere deliverables" on storage.objects;
create policy "Team can upload sphere deliverables"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'sphere-deliverables'
    and public.is_team_organization_member(
      '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    )
  );

drop policy if exists "Team can update sphere deliverables" on storage.objects;
create policy "Team can update sphere deliverables"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'sphere-deliverables'
    and public.is_team_organization_member(
      '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    )
  )
  with check (
    bucket_id = 'sphere-deliverables'
    and public.is_team_organization_member(
      '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    )
  );

drop policy if exists "Team can delete sphere deliverables" on storage.objects;
create policy "Team can delete sphere deliverables"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'sphere-deliverables'
    and public.is_team_organization_member(
      '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    )
  );

commit;
