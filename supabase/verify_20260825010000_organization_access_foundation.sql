-- Verification for 20260825010000_organization_access_foundation.sql
-- READ-ONLY: run after Migration 1 and return the single JSON result.

select jsonb_pretty(
  jsonb_build_object(
    'migration', '20260825010000_organization_access_foundation',
    'organization', (
      select to_jsonb(org)
      from (
        select id, name, slug, status
        from public.organizations
        where slug = 'anka-sphere'
      ) org
    ),
    'membership_count', (
      select count(*)
      from public.organization_memberships
      where organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    ),
    'auth_user_count', (select count(*) from auth.users),
    'departments', (
      select jsonb_agg(
        jsonb_build_object('id', id, 'name', name)
        order by id
      )
      from public.departments
      where organization_id = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    ),
    'null_organization_links', jsonb_build_object(
      'departments', (select count(*) from public.departments where organization_id is null),
      'clients', (select count(*) from public.clients where organization_id is null),
      'projects', (select count(*) from public.projects where organization_id is null)
    ),
    'new_tables', jsonb_build_object(
      'organizations', to_regclass('public.organizations') is not null,
      'organization_memberships', to_regclass('public.organization_memberships') is not null,
      'client_contacts', to_regclass('public.client_contacts') is not null,
      'workstreams', to_regclass('public.workstreams') is not null,
      'project_client_access', to_regclass('public.project_client_access') is not null
    ),
    'legacy_client_gates', jsonb_build_object(
      'projects_visible', (select count(*) from public.as_projects where portal_visible = true),
      'tasks_visible', (select count(*) from public.as_tasks where client_visible = true),
      'deliverables_released', (
        select count(*)
        from public.as_deliverables
        where internal_review_status = 'released'
          and released_to_client_at is not null
      ),
      'documents_visible', (
        select count(*) from public.as_project_documents where client_visible = true
      ),
      'pages_visible', (
        select count(*) from public.as_project_pages where client_visible = true
      ),
      'timeline_visible', (
        select count(*) from public.as_timeline_events where client_visible = true
      ),
      'client_signoff_update_policy_exists', exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'as_client_signoffs'
          and policyname = 'client_respond_signoffs'
      )
    ),
    'sphere_deliverables_bucket_public', (
      select public
      from storage.buckets
      where id = 'sphere-deliverables'
    )
  )
) as migration_1_verification;
