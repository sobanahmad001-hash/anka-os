-- OAF2 rollback-safe verification.
-- Run only after 20260903050747_canonical_ownership_convergence.sql is applied.

begin;

create temporary table oaf2_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

create temporary table oaf2_runtime_context (
  actor_id uuid not null,
  organization_id uuid not null,
  cross_organization_id uuid not null,
  cross_organization_client_id uuid not null
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
    join public.agency_clients agency_client
      on agency_client.id = engagement.client_id
     and agency_client.organization_id = engagement.organization_id
    join public.projects project
      on project.id = engagement.project_id
     and project.organization_id = engagement.organization_id
    where agency_client.canonical_client_id is distinct from project.client_id
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
    where engagement.project_id is distinct from ai_run.project_id
  )),
  ('engagement_ai_runs_are_backfilled', not exists (
    select 1
    from public.ai_runs ai_run
    where ai_run.engagement_id is not null
      and ai_run.project_id is null
  )),
  ('portal_client_matches_commercial_client', not exists (
    select 1
    from public.client_project_projections projection
    join public.engagements engagement on engagement.project_id = projection.project_id
    join public.agency_clients agency_client on agency_client.id = engagement.client_id
    where projection.client_id <> agency_client.canonical_client_id
       or projection.organization_id <> engagement.organization_id
  )),
  ('canonical_client_link_not_null', coalesce((
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_clients'
      and column_name = 'canonical_client_id'
  ), false)),
  ('canonical_project_link_not_null', coalesce((
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'engagements'
      and column_name = 'project_id'
  ), false)),
  ('work_item_project_link_not_null', coalesce((
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_items'
      and column_name = 'project_id'
  ), false)),
  ('commercial_client_rpc_is_invoker', coalesce((
    select not procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = 'public.create_commercial_client(text,text,text,text,text,text,text,text)'::regprocedure
  ), false)),
  ('commercial_client_rpc_is_authenticated_only',
    has_function_privilege(
      'authenticated',
      'public.create_commercial_client(text,text,text,text,text,text,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.create_commercial_client(text,text,text,text,text,text,text,text)',
      'EXECUTE'
    )
  ),
  ('ai_mutual_exclusion_removed', not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_runs'::regclass
      and conname = 'ai_runs_single_commercial_context_check'
  ));

insert into oaf2_runtime_checks (check_name, passed) values
  ('old_client_insert_creates_canonical_root', false),
  ('old_engagement_insert_creates_project_and_living_record', false),
  ('commercial_client_rpc_creates_exact_graph', false),
  ('commercial_client_rpc_failure_is_atomic', false),
  ('compose_engagement_creates_exact_graph', false),
  ('compose_engagement_failure_is_atomic', false),
  ('mismatched_same_org_engagement_insert_is_rejected', false),
  ('mismatched_same_org_engagement_update_is_rejected', false),
  ('valid_unrelated_engagement_update_is_allowed', false),
  ('engaged_project_client_change_is_rejected', false),
  ('engaged_project_unrelated_update_is_allowed', false),
  ('standalone_project_client_change_retains_existing_behavior', false),
  ('engaged_project_cross_organization_change_is_rejected', false),
  ('cross_organization_engagement_write_is_rejected', false),
  ('anon_rpc_execution_is_rejected', false),
  ('authenticated_cross_organization_write_is_rejected', false),
  ('browser_rls_and_acl_boundaries_are_enforced', false);

do $$
declare
  v_membership public.organization_memberships;
  v_agency_client public.agency_clients;
  v_brand public.brands;
  v_engagement public.engagements;
  v_rpc_result jsonb;
  v_rpc_client_id uuid;
  v_rpc_agency_client_id uuid;
  v_rpc_brand_id uuid;
  v_service_id uuid;
  v_composed_engagement_id uuid;
  v_mismatch_project_id uuid;
  v_standalone_project_id uuid;
  v_cross_org_id uuid := gen_random_uuid();
  v_cross_org_client_id uuid;
  v_updated_summary text;
  v_updated_objective text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_rpc_name text;
  v_failed_rpc_name text;
  v_composed_name text;
  v_failed_composed_name text;
begin
  select membership.*
  into v_membership
  from public.organization_memberships membership
  where membership.member_kind = 'team'
    and membership.status = 'active'
  order by membership.created_at
  limit 1;

  if not found then
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_membership.user_id::text, true);
  v_rpc_name := 'OAF2 RPC client ' || v_suffix;
  v_failed_rpc_name := 'OAF2 failed RPC client ' || v_suffix;
  v_composed_name := 'OAF2 composed engagement ' || v_suffix;
  v_failed_composed_name := 'OAF2 failed engagement ' || v_suffix;

  insert into public.agency_clients (
    organization_id, name, legal_name, industry, status, owner_id, created_by
  ) values (
    v_membership.organization_id,
    'OAF2 rollback-only old client ' || v_suffix,
    'OAF2 rollback-only old client ' || v_suffix,
    'verification',
    'active',
    v_membership.user_id,
    v_membership.user_id
  ) returning * into v_agency_client;

  update oaf2_runtime_checks
  set passed = (
    v_agency_client.canonical_client_id is not null
    and v_agency_client.legacy_client_id = v_agency_client.canonical_client_id
    and exists (
      select 1 from public.clients client
      where client.id = v_agency_client.canonical_client_id
        and client.organization_id = v_agency_client.organization_id
    )
  )
  where check_name = 'old_client_insert_creates_canonical_root';

  insert into public.brands (
    organization_id, client_id, name, status, is_default, created_by
  ) values (
    v_membership.organization_id,
    v_agency_client.id,
    'OAF2 rollback-only old brand ' || v_suffix,
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
    'OAF2 rollback-only old engagement ' || v_suffix,
    'project',
    'Verify canonical ownership compatibility.',
    'planning',
    v_membership.user_id,
    v_membership.user_id
  ) returning * into v_engagement;

  update oaf2_runtime_checks
  set passed = (
    v_engagement.project_id is not null
    and v_engagement.legacy_project_id = v_engagement.project_id
    and (select count(*) from public.projects project where project.id = v_engagement.project_id) = 1
    and (
      select count(*)
      from public.living_project_documents living_record
      where living_record.project_id = v_engagement.project_id
    ) = 1
  )
  where check_name = 'old_engagement_insert_creates_project_and_living_record';

  v_rpc_result := public.create_commercial_client(
    v_rpc_name,
    'OAF2 RPC brand ' || v_suffix
  );
  v_rpc_client_id := (v_rpc_result -> 'canonical_client' ->> 'id')::uuid;
  v_rpc_agency_client_id := (v_rpc_result -> 'client' ->> 'id')::uuid;
  v_rpc_brand_id := (v_rpc_result -> 'brand' ->> 'id')::uuid;

  update oaf2_runtime_checks
  set passed = (
    (select count(*) from public.clients where id = v_rpc_client_id and name = v_rpc_name) = 1
    and (
      select count(*) from public.agency_clients
      where id = v_rpc_agency_client_id
        and canonical_client_id = v_rpc_client_id
        and legacy_client_id = v_rpc_client_id
    ) = 1
    and (
      select count(*) from public.brands
      where id = v_rpc_brand_id
        and client_id = v_rpc_agency_client_id
        and is_default
    ) = 1
  )
  where check_name = 'commercial_client_rpc_creates_exact_graph';

  begin
    perform public.create_commercial_client(
      v_failed_rpc_name,
      repeat('B', 201)
    );
  exception
    when check_violation then
      update oaf2_runtime_checks
      set passed = not exists (
        select 1 from public.clients where name = v_failed_rpc_name
      ) and not exists (
        select 1 from public.agency_clients where name = v_failed_rpc_name
      ) and not exists (
        select 1 from public.brands where name = repeat('B', 201)
      )
      where check_name = 'commercial_client_rpc_failure_is_atomic';
  end;

  select service.id
  into v_service_id
  from public.service_catalog service
  where service.organization_id = v_membership.organization_id
    and service.is_active
  order by service.display_order, service.id
  limit 1;

  if found then
    v_composed_engagement_id := public.compose_engagement(
      p_client_id => v_rpc_agency_client_id,
      p_brand_id => v_rpc_brand_id,
      p_name => v_composed_name,
      p_engagement_type => 'project',
      p_service_ids => array[v_service_id],
      p_lead_owner_id => v_membership.user_id
    );

    update oaf2_runtime_checks
    set passed = (
      (select count(*) from public.engagements where id = v_composed_engagement_id) = 1
      and (
        select count(*)
        from public.projects project
        join public.engagements engagement on engagement.project_id = project.id
        where engagement.id = v_composed_engagement_id
          and project.client_id = v_rpc_client_id
      ) = 1
      and (
        select count(*)
        from public.living_project_documents living_record
        join public.engagements engagement on engagement.project_id = living_record.project_id
        where engagement.id = v_composed_engagement_id
      ) = 1
    )
    where check_name = 'compose_engagement_creates_exact_graph';

    begin
      perform public.compose_engagement(
        p_client_id => v_rpc_agency_client_id,
        p_brand_id => v_rpc_brand_id,
        p_name => v_failed_composed_name,
        p_engagement_type => 'project',
        p_service_ids => array[v_service_id],
        p_lead_owner_id => v_membership.user_id,
        p_service_owners => jsonb_build_object(v_service_id::text, 'not-a-uuid')
      );
    exception
      when invalid_text_representation then
        update oaf2_runtime_checks
        set passed = not exists (
          select 1 from public.engagements where name = v_failed_composed_name
        ) and not exists (
          select 1 from public.projects where name = v_failed_composed_name
        ) and not exists (
          select 1
          from public.living_project_documents living_record
          join public.projects project on project.id = living_record.project_id
          where project.name = v_failed_composed_name
        )
        where check_name = 'compose_engagement_failure_is_atomic';
    end;
  end if;

  insert into public.projects (name, organization_id, client_id)
  values (
    'OAF2 mismatch-target project ' || v_suffix,
    v_membership.organization_id,
    v_agency_client.canonical_client_id
  ) returning id into v_mismatch_project_id;

  begin
    insert into public.engagements (
      organization_id, client_id, brand_id, project_id, name,
      engagement_type, objective, status, lead_owner_id, created_by
    ) values (
      v_membership.organization_id,
      v_rpc_agency_client_id,
      v_rpc_brand_id,
      v_mismatch_project_id,
      'OAF2 mismatched insert ' || v_suffix,
      'project',
      'This insert must fail.',
      'planning',
      v_membership.user_id,
      v_membership.user_id
    );
  exception
    when check_violation then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'mismatched_same_org_engagement_insert_is_rejected';
  end;

  begin
    update public.engagements
    set client_id = v_rpc_agency_client_id,
        brand_id = v_rpc_brand_id
    where id = v_engagement.id;
  exception
    when check_violation then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'mismatched_same_org_engagement_update_is_rejected';
  end;

  update public.engagements
  set objective = 'OAF2 unrelated engagement update verified.'
  where id = v_engagement.id
  returning objective into v_updated_objective;

  update oaf2_runtime_checks
  set passed = v_updated_objective = 'OAF2 unrelated engagement update verified.'
  where check_name = 'valid_unrelated_engagement_update_is_allowed';

  begin
    update public.projects
    set client_id = null
    where id = v_engagement.project_id;
  exception
    when check_violation then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'engaged_project_client_change_is_rejected';
  end;

  update public.projects
  set client_summary = client_summary || ' [OAF2 unrelated update verified]'
  where id = v_engagement.project_id
  returning client_summary into v_updated_summary;

  update oaf2_runtime_checks
  set passed = v_updated_summary like '%[OAF2 unrelated update verified]'
  where check_name = 'engaged_project_unrelated_update_is_allowed';

  insert into public.projects (name, organization_id, client_id)
  values (
    'OAF2 rollback-only standalone project ' || v_suffix,
    v_membership.organization_id,
    v_agency_client.canonical_client_id
  ) returning id into v_standalone_project_id;

  update public.projects
  set client_id = null
  where id = v_standalone_project_id;

  update oaf2_runtime_checks
  set passed = exists (
    select 1
    from public.projects project
    where project.id = v_standalone_project_id
      and project.client_id is null
  ) and not exists (
    select 1
    from public.engagements engagement
    where engagement.project_id = v_standalone_project_id
  )
  where check_name = 'standalone_project_client_change_retains_existing_behavior';

  insert into public.organizations (id, name, slug)
  values (
    v_cross_org_id,
    'OAF2 rollback-only cross-organization check',
    'oaf2-rollback-' || v_suffix
  );

  insert into public.clients (name, organization_id)
  values ('OAF2 rollback-only cross-organization client', v_cross_org_id)
  returning id into v_cross_org_client_id;

  begin
    update public.projects
    set client_id = v_cross_org_client_id
    where id = v_engagement.project_id;
  exception
    when check_violation then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'engaged_project_cross_organization_change_is_rejected';
  end;

  begin
    insert into public.engagements (
      organization_id, client_id, brand_id, project_id, name,
      engagement_type, status, lead_owner_id, created_by
    ) values (
      v_cross_org_id,
      v_agency_client.id,
      v_brand.id,
      v_engagement.project_id,
      'OAF2 cross-organization engagement ' || v_suffix,
      'project',
      'planning',
      v_membership.user_id,
      v_membership.user_id
    );
  exception
    when check_violation then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'cross_organization_engagement_write_is_rejected';
  end;

  insert into oaf2_runtime_context (
    actor_id, organization_id, cross_organization_id, cross_organization_client_id
  ) values (
    v_membership.user_id,
    v_membership.organization_id,
    v_cross_org_id,
    v_cross_org_client_id
  );
end;
$$;

grant select, update on oaf2_runtime_checks to anon, authenticated;
grant select on oaf2_runtime_context to authenticated;

set local role anon;
do $$
begin
  begin
    perform public.create_commercial_client('OAF2 anonymous client', 'OAF2 anonymous brand');
  exception
    when insufficient_privilege then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'anon_rpc_execution_is_rejected';
  end;
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  coalesce((select actor_id::text from oaf2_runtime_context limit 1), ''),
  true
);

set local role authenticated;
do $$
declare
  v_context oaf2_runtime_context;
begin
  select * into v_context from oaf2_runtime_context limit 1;
  if not found then
    return;
  end if;

  begin
    insert into public.projects (name, organization_id, client_id)
    values (
      'OAF2 authenticated cross-organization project',
      v_context.cross_organization_id,
      v_context.cross_organization_client_id
    );
  exception
    when insufficient_privilege then
      update oaf2_runtime_checks
      set passed = true
      where check_name = 'authenticated_cross_organization_write_is_rejected';
  end;
end;
$$;
reset role;

update oaf2_runtime_checks
set passed = (
  (select bool_and(class.relrowsecurity)
   from pg_class class
   where class.oid = any(array[
     'public.clients'::regclass,
     'public.projects'::regclass,
     'public.agency_clients'::regclass,
     'public.brands'::regclass,
     'public.engagements'::regclass
   ]))
  and not has_function_privilege(
    'anon',
    'public.create_commercial_client(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.validate_engagement_canonical_ownership()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.protect_engaged_project_client()',
    'EXECUTE'
  )
  and not has_table_privilege('anon', 'public.clients', 'INSERT')
  and not has_table_privilege('anon', 'public.projects', 'UPDATE')
  and not has_table_privilege('anon', 'public.agency_clients', 'INSERT')
  and not has_table_privilege('anon', 'public.brands', 'INSERT')
  and not has_table_privilege('anon', 'public.engagements', 'INSERT')
)
where check_name = 'browser_rls_and_acl_boundaries_are_enforced';

select jsonb_object_agg(check_name, passed order by check_name)
  as oaf2_canonical_ownership_convergence_verification
from oaf2_runtime_checks;

rollback;
