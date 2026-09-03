-- OAF2 rollback-safe verification.
-- Run only after 20260903050747_canonical_ownership_convergence.sql is applied.

begin;

create temporary table oaf2_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into oaf2_runtime_checks values
  ('all_agency_clients_have_canonical_roots', not exists (
    select 1
    from public.agency_clients agency_client
    left join public.clients client
      on client.id = agency_client.canonical_client_id
     and client.organization_id = agency_client.organization_id
    where client.id is null
       or agency_client.legacy_client_id <> agency_client.canonical_client_id
  )),
  ('all_engagements_have_canonical_projects', not exists (
    select 1
    from public.engagements engagement
    left join public.projects project
      on project.id = engagement.project_id
     and project.organization_id = engagement.organization_id
    where project.id is null
       or engagement.legacy_project_id <> engagement.project_id
  )),
  ('engagement_clients_match_project_clients', not exists (
    select 1
    from public.engagements engagement
    join public.agency_clients agency_client on agency_client.id = engagement.client_id
    join public.projects project on project.id = engagement.project_id
    where agency_client.canonical_client_id <> project.client_id
       or agency_client.organization_id <> project.organization_id
  )),
  ('one_living_record_per_project', not exists (
    select project.id
    from public.projects project
    left join public.living_project_documents living_record
      on living_record.project_id = project.id
     and living_record.organization_id = project.organization_id
    group by project.id
    having count(living_record.id) <> 1
  )),
  ('artifact_ownership_is_consistent', not exists (
    select 1
    from public.artifacts artifact
    left join public.engagements engagement
      on engagement.id = artifact.engagement_id
     and engagement.organization_id = artifact.organization_id
    where (artifact.engagement_id is null) <> (artifact.project_id is null)
       or (artifact.engagement_id is not null and engagement.project_id <> artifact.project_id)
  )),
  ('work_item_ownership_is_consistent', not exists (
    select 1
    from public.work_items work_item
    join public.engagements engagement
      on engagement.id = work_item.engagement_id
     and engagement.organization_id = work_item.organization_id
    where engagement.project_id <> work_item.project_id
  )),
  ('ai_context_pairs_are_consistent', not exists (
    select 1
    from public.ai_runs ai_run
    join public.engagements engagement
      on engagement.id = ai_run.engagement_id
     and engagement.organization_id = ai_run.organization_id
    where engagement.project_id <> ai_run.project_id
  )),
  ('portal_client_matches_commercial_client', not exists (
    select 1
    from public.client_project_projections projection
    join public.engagements engagement on engagement.project_id = projection.project_id
    join public.agency_clients agency_client on agency_client.id = engagement.client_id
    where projection.client_id <> agency_client.canonical_client_id
       or projection.organization_id <> engagement.organization_id
  ));

do $$
declare
  v_membership public.organization_memberships;
  v_agency_client public.agency_clients;
  v_brand public.brands;
  v_engagement public.engagements;
begin
  select membership.*
  into v_membership
  from public.organization_memberships membership
  where membership.member_kind = 'team'
    and membership.status = 'active'
  order by membership.created_at
  limit 1;

  if not found then
    insert into oaf2_runtime_checks values
      ('old_client_insert_creates_canonical_root', false),
      ('old_engagement_insert_creates_project_and_living_record', false);
    return;
  end if;

  insert into public.agency_clients (
    organization_id, name, legal_name, industry, status, owner_id, created_by
  ) values (
    v_membership.organization_id,
    'OAF2 rollback-only client',
    'OAF2 rollback-only client',
    'verification',
    'active',
    v_membership.user_id,
    v_membership.user_id
  ) returning * into v_agency_client;

  insert into oaf2_runtime_checks values (
    'old_client_insert_creates_canonical_root',
    v_agency_client.canonical_client_id is not null
    and v_agency_client.legacy_client_id = v_agency_client.canonical_client_id
    and exists (
      select 1 from public.clients client
      where client.id = v_agency_client.canonical_client_id
        and client.organization_id = v_agency_client.organization_id
    )
  );

  insert into public.brands (
    organization_id, client_id, name, status, is_default, created_by
  ) values (
    v_membership.organization_id,
    v_agency_client.id,
    'OAF2 rollback-only brand',
    'active',
    true,
    v_membership.user_id
  ) returning * into v_brand;

  insert into public.engagements (
    organization_id, client_id, brand_id, name, engagement_type,
    objective, status, lead_owner_id, created_by
  ) values (
    v_membership.organization_id,
    v_agency_client.id,
    v_brand.id,
    'OAF2 rollback-only engagement',
    'project',
    'Verify canonical ownership compatibility.',
    'planning',
    v_membership.user_id,
    v_membership.user_id
  ) returning * into v_engagement;

  insert into oaf2_runtime_checks values (
    'old_engagement_insert_creates_project_and_living_record',
    v_engagement.project_id is not null
    and v_engagement.legacy_project_id = v_engagement.project_id
    and exists (
      select 1
      from public.projects project
      join public.living_project_documents living_record
        on living_record.project_id = project.id
       and living_record.organization_id = project.organization_id
      where project.id = v_engagement.project_id
        and project.client_id = v_agency_client.canonical_client_id
    )
  );
end;
$$;

select jsonb_build_object(
  'canonical_client_link_not_null', (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_clients'
      and column_name = 'canonical_client_id'
  ),
  'canonical_project_link_not_null', (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'engagements'
      and column_name = 'project_id'
  ),
  'work_item_project_link_not_null', (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_items'
      and column_name = 'project_id'
  ),
  'commercial_client_rpc_is_invoker', (
    select not procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = 'public.create_commercial_client(text,text,text,text,text,text,text,text)'::regprocedure
  ),
  'commercial_client_rpc_is_authenticated_only',
    has_function_privilege(
      'authenticated',
      'public.create_commercial_client(text,text,text,text,text,text,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.create_commercial_client(text,text,text,text,text,text,text,text)',
      'EXECUTE'
    ),
  'ai_mutual_exclusion_removed', not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_runs'::regclass
      and conname = 'ai_runs_single_commercial_context_check'
  )
) || (select jsonb_object_agg(check_name, passed) from oaf2_runtime_checks)
  as oaf2_canonical_ownership_convergence_verification;

rollback;
