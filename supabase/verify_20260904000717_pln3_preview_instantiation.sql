-- PLN3 rollback-only verification. Run after the matching migration.
begin;

create temporary table pln3_checks (
  check_name text primary key,
  passed boolean not null default false
) on commit drop;

insert into pln3_checks (check_name) values
  ('rpc_acl_matrix_is_exact'),
  ('rpc_security_is_exact'),
  ('planner_is_private'),
  ('canonical_composer_is_unchanged'),
  ('preview_is_deterministic'),
  ('preview_is_zero_write'),
  ('manager_can_preview_visible_draft'),
  ('contributor_can_preview_publication'),
  ('contributor_cannot_preview_draft'),
  ('unnamed_asset_does_not_satisfy_prerequisite'),
  ('named_asset_satisfies_prerequisite'),
  ('same_set_reorder_has_moved_provenance'),
  ('template_composition_matches_preview'),
  ('origin_provenance_is_persisted'),
  ('composition_replay_is_idempotent'),
  ('request_reuse_with_new_payload_is_rejected'),
  ('unpublished_composition_is_rejected'),
  ('stale_preview_is_rejected_without_writes'),
  ('cross_organization_preview_is_rejected'),
  ('anonymous_execution_is_rejected');

update pln3_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  functions(signature) as (values
    ('public.preview_pipeline_engagement(uuid,uuid,uuid[],jsonb)'),
    ('public.compose_engagement_from_pipeline_template(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)')
  ), matrix as (
    select role_name, signature, role_name = 'authenticated' as expected
    from roles cross join functions
  )
  select count(*) = 6 and bool_and(
    has_function_privilege(role_name, signature, 'EXECUTE') = expected
  ) from matrix
) where check_name = 'rpc_acl_matrix_is_exact';

update pln3_checks set passed = coalesce((
  select count(*) = 2
    and bool_and(procedure.prosecdef)
    and bool_and(procedure.proconfig = array['search_path=""'])
    and bool_and(case procedure.proname
      when 'preview_pipeline_engagement' then procedure.provolatile = 's'
      else procedure.provolatile = 'v'
    end)
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'preview_pipeline_engagement', 'compose_engagement_from_pipeline_template'
    )
), false) where check_name = 'rpc_security_is_exact';

update pln3_checks set passed =
  not has_function_privilege(
    'authenticated', 'private.plan_pipeline_engagement(uuid,uuid,uuid[],jsonb)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'private.plan_pipeline_engagement(uuid,uuid,uuid[],jsonb)', 'EXECUTE'
  )
  and position('public.service_stage_rules' in pg_get_functiondef(
    'private.plan_pipeline_engagement(uuid,uuid,uuid[],jsonb)'::regprocedure
  )) > 0
  and position('public.blueprint_stage_dependencies' in pg_get_functiondef(
    'private.plan_pipeline_engagement(uuid,uuid,uuid[],jsonb)'::regprocedure
  )) > 0
where check_name = 'planner_is_private';

update pln3_checks set passed =
  position('pipeline_template' in lower(pg_get_functiondef(
    'public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)'::regprocedure
  ))) = 0
where check_name = 'canonical_composer_is_unchanged';

do $$
declare
  v_org_a uuid := '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid;
  v_org_b uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_contributor uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_service_a uuid := gen_random_uuid();
  v_service_b uuid := gen_random_uuid();
  v_service_other uuid := gen_random_uuid();
  v_stage_a uuid := gen_random_uuid();
  v_stage_b uuid := gen_random_uuid();
  v_stage_fallback uuid := gen_random_uuid();
  v_department text;
  v_published_version jsonb;
  v_draft_version jsonb;
  v_publication jsonb;
  v_preview jsonb;
  v_preview_again jsonb;
  v_unnamed_asset_preview jsonb;
  v_named_asset_preview jsonb;
  v_draft_preview jsonb;
  v_compose jsonb;
  v_replay jsonb;
  v_engagement uuid;
  v_request uuid := gen_random_uuid();
  v_stale_request uuid := gen_random_uuid();
  v_before bigint;
  v_after bigint;
  v_stage_count integer;
  v_dependency_count integer;
  v_denied boolean;
begin
  select id into v_department from public.departments order by id limit 1;
  if v_department is null then
    raise exception 'PLN3 verifier requires at least one canonical department.';
  end if;

  if not exists (select 1 from public.organizations where id = v_org_a and status = 'active') then
    raise exception 'PLN3 verifier requires the active canonical Anka organization.';
  end if;
  insert into public.organizations (id, name, slug, status) values
    (v_org_b, 'PLN3 verifier B', 'pln3_b_' || replace(v_org_b::text, '-', ''), 'active');
  insert into auth.users (id) values (v_manager), (v_admin), (v_contributor), (v_other);
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_org_a, v_manager, 'team', 'department_manager', v_department, 'active'),
    (v_org_a, v_admin, 'team', 'operations_admin', v_department, 'active'),
    (v_org_a, v_contributor, 'team', 'contributor', v_department, 'active'),
    (v_org_b, v_other, 'team', 'operations_admin', v_department, 'active');

  insert into public.agency_clients (id, organization_id, name, created_by)
    values (v_client, v_org_a, 'PLN3 verifier client', v_admin);
  insert into public.brands (id, organization_id, client_id, name, is_default, created_by)
    values (v_brand, v_org_a, v_client, 'PLN3 verifier brand', true, v_admin);
  insert into public.service_catalog (
    id, organization_id, department_id, slug, name, display_order
  ) values
    (v_service_a, v_org_a, v_department, 'pln3_service_a', 'PLN3 service A', 1),
    (v_service_b, v_org_a, v_department, 'pln3_service_b', 'PLN3 service B', 2),
    (v_service_other, v_org_b, v_department, 'pln3_service_other', 'PLN3 other service', 1);
  insert into public.blueprint_stage_catalog (
    id, organization_id, slug, name, accountable_department_id, display_order, stage_kind
  ) values
    (v_stage_a, v_org_a, 'pln3_stage_a', 'PLN3 stage A', v_department, 10, 'delivery'),
    (v_stage_b, v_org_a, 'pln3_stage_b', 'PLN3 stage B', v_department, 20, 'delivery'),
    (v_stage_fallback, v_org_a, 'pln3_context_intake', 'PLN3 context intake', v_department, 5, 'short_prerequisite');
  insert into public.service_stage_rules (
    organization_id, service_id, target_stage_id, rule_kind,
    prerequisite_key, prerequisite_description, accepted_asset_kinds,
    satisfied_by_stage_slugs, fallback_stage_id
  ) values
    (v_org_a, v_service_a, v_stage_a, 'primary', null, '', '{}', '{}', null),
    (v_org_a, v_service_b, v_stage_b, 'primary', null, '', '{}', '{}', null),
    (v_org_a, v_service_b, v_stage_b, 'prerequisite', 'brand_context',
      'Brand context is required', array['brand_context'], '{}', v_stage_fallback);
  insert into public.blueprint_stage_dependencies (
    organization_id, stage_id, depends_on_stage_id, reason
  ) values (v_org_a, v_stage_b, v_stage_fallback, 'Canonical duplicate of context gate');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.create_pipeline_template_version(
    v_org_a, null, 'pln3_verifier', 'PLN3 verifier', '',
    array[v_service_a, v_service_b], null, 'PLN3 verification fixture'
  ) into v_published_version;
  select public.publish_pipeline_template_version(
    (v_published_version->>'pipeline_template_version_id')::uuid
  ) into v_publication;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_manager, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.create_pipeline_template_version(
    v_org_a, (v_published_version->>'pipeline_template_id')::uuid,
    'pln3_verifier', 'PLN3 verifier draft', '', array[v_service_b, v_service_a],
    (v_published_version->>'pipeline_template_version_id')::uuid, 'Draft preview fixture'
  ) into v_draft_version;
  select public.preview_pipeline_engagement(
    v_org_a, (v_draft_version->>'pipeline_template_version_id')::uuid,
    array[v_service_b, v_service_a], '[]'::jsonb
  ) into v_draft_preview;
  reset role;
  update pln3_checks set passed = not (v_draft_preview->>'is_published')::boolean
    where check_name = 'manager_can_preview_visible_draft';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select (select count(*) from public.engagements where organization_id = v_org_a)
    + (select count(*) from public.engagement_pipeline_origins where organization_id = v_org_a)
    into v_before;
  select public.preview_pipeline_engagement(
    v_org_a, (v_published_version->>'pipeline_template_version_id')::uuid,
    array[v_service_b, v_service_a], '[]'::jsonb
  ) into v_preview;
  select public.preview_pipeline_engagement(
    v_org_a, (v_published_version->>'pipeline_template_version_id')::uuid,
    array[v_service_b, v_service_a], '[]'::jsonb
  ) into v_preview_again;
  select public.preview_pipeline_engagement(
    v_org_a, (v_published_version->>'pipeline_template_version_id')::uuid,
    array[v_service_b, v_service_a], '[{"asset_kind":"brand_context","name":""}]'::jsonb
  ) into v_unnamed_asset_preview;
  select public.preview_pipeline_engagement(
    v_org_a, (v_published_version->>'pipeline_template_version_id')::uuid,
    array[v_service_b, v_service_a], '[{"asset_kind":"brand_context","name":"Approved context"}]'::jsonb
  ) into v_named_asset_preview;
  select (select count(*) from public.engagements where organization_id = v_org_a)
    + (select count(*) from public.engagement_pipeline_origins where organization_id = v_org_a)
    into v_after;
  reset role;

  update pln3_checks set passed = v_preview = v_preview_again
    and (v_preview->>'preview_rule_sha256') ~ '^[0-9a-f]{64}$'
    where check_name = 'preview_is_deterministic';
  update pln3_checks set passed = v_before = v_after
    where check_name = 'preview_is_zero_write';
  update pln3_checks set passed = (v_preview->>'is_published')::boolean
    and v_preview->>'publication_id' = v_publication->>'pipeline_template_publication_id'
    where check_name = 'contributor_can_preview_publication';
  update pln3_checks set passed = exists (
    select 1 from jsonb_array_elements(v_unnamed_asset_preview->'prerequisites') prerequisite
    where prerequisite->>'satisfaction_method' = 'short_stage'
  ) where check_name = 'unnamed_asset_does_not_satisfy_prerequisite';
  update pln3_checks set passed = exists (
    select 1 from jsonb_array_elements(v_named_asset_preview->'prerequisites') prerequisite
    where prerequisite->>'satisfaction_method' = 'existing_asset'
  ) where check_name = 'named_asset_satisfies_prerequisite';
  update pln3_checks set passed = jsonb_array_length(v_preview->'customization_provenance') = 2
    and not exists (
      select 1 from jsonb_array_elements(v_preview->'customization_provenance') change
      where change->>'action' <> 'moved'
    ) where check_name = 'same_set_reorder_has_moved_provenance';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.preview_pipeline_engagement(
      v_org_a, (v_draft_version->>'pipeline_template_version_id')::uuid,
      array[v_service_b, v_service_a], '[]'::jsonb
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  update pln3_checks set passed = v_denied
    where check_name = 'contributor_cannot_preview_draft';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.compose_engagement_from_pipeline_template(
    v_org_a, v_request, (v_published_version->>'pipeline_template_version_id')::uuid,
    v_preview->>'preview_rule_sha256', v_client, v_brand, 'PLN3 composed', 'project',
    array[v_service_b, v_service_a], null, '{}'::jsonb, null, null, '', '[]'::jsonb
  ) into v_compose;
  select public.compose_engagement_from_pipeline_template(
    v_org_a, v_request, (v_published_version->>'pipeline_template_version_id')::uuid,
    v_preview->>'preview_rule_sha256', v_client, v_brand, 'PLN3 composed', 'project',
    array[v_service_b, v_service_a], null, '{}'::jsonb, null, null, '', '[]'::jsonb
  ) into v_replay;
  reset role;
  v_engagement := (v_compose->>'engagement_id')::uuid;
  select count(*) into v_stage_count from public.engagement_stage_instances
    where engagement_id = v_engagement;
  select count(*) into v_dependency_count from public.engagement_stage_dependencies
    where engagement_id = v_engagement;
  update pln3_checks set passed = v_stage_count = jsonb_array_length(v_preview->'stages')
    and v_dependency_count = jsonb_array_length(v_preview->'dependencies')
    and v_dependency_count = 1
    and (v_preview->'dependencies'->0->>'dependency_kind') = 'context_gate'
    where check_name = 'template_composition_matches_preview';
  update pln3_checks set passed = exists (
    select 1 from public.engagement_pipeline_origins origin
    where origin.engagement_id = v_engagement
      and origin.pipeline_template_version_id = (v_published_version->>'pipeline_template_version_id')::uuid
      and origin.preview_rule_sha256 = v_preview->>'preview_rule_sha256'
      and origin.was_customized
      and jsonb_array_length(origin.customization_provenance) = 2
  ) where check_name = 'origin_provenance_is_persisted';
  update pln3_checks set passed = (v_replay->>'idempotent_replay')::boolean
    and v_replay->>'engagement_id' = v_compose->>'engagement_id'
    and (select count(*) from public.engagement_composition_requests
      where organization_id = v_org_a and request_id = v_request) = 1
    where check_name = 'composition_replay_is_idempotent';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.compose_engagement_from_pipeline_template(
      v_org_a, v_request, (v_published_version->>'pipeline_template_version_id')::uuid,
      v_preview->>'preview_rule_sha256', v_client, v_brand, 'Different payload', 'project',
      array[v_service_b, v_service_a], null, '{}'::jsonb, null, null, '', '[]'::jsonb
    );
  exception when invalid_parameter_value then v_denied := true;
  end;
  reset role;
  update pln3_checks set passed = v_denied
    where check_name = 'request_reuse_with_new_payload_is_rejected';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_manager, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.compose_engagement_from_pipeline_template(
      v_org_a, gen_random_uuid(), (v_draft_version->>'pipeline_template_version_id')::uuid,
      v_draft_preview->>'preview_rule_sha256', v_client, v_brand, 'Draft denied', 'project',
      array[v_service_b, v_service_a], null, '{}'::jsonb, null, null, '', '[]'::jsonb
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  update pln3_checks set passed = v_denied
    where check_name = 'unpublished_composition_is_rejected';

  update public.service_stage_rules
    set prerequisite_description = 'Changed after preview'
    where organization_id = v_org_a and service_id = v_service_b
      and rule_kind = 'prerequisite';
  select count(*) into v_before from public.engagements where organization_id = v_org_a;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.compose_engagement_from_pipeline_template(
      v_org_a, v_stale_request, (v_published_version->>'pipeline_template_version_id')::uuid,
      v_preview->>'preview_rule_sha256', v_client, v_brand, 'Stale denied', 'project',
      array[v_service_b, v_service_a], null, '{}'::jsonb, null, null, '', '[]'::jsonb
    );
  exception when serialization_failure then v_denied := true;
  end;
  reset role;
  select count(*) into v_after from public.engagements where organization_id = v_org_a;
  update pln3_checks set passed = v_denied and v_before = v_after
    and not exists (select 1 from public.engagement_composition_requests
      where organization_id = v_org_a and request_id = v_stale_request)
    where check_name = 'stale_preview_is_rejected_without_writes';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.preview_pipeline_engagement(
      v_org_b, (v_published_version->>'pipeline_template_version_id')::uuid,
      array[v_service_other], '[]'::jsonb
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  update pln3_checks set passed = v_denied
    where check_name = 'cross_organization_preview_is_rejected';

  perform set_config('request.jwt.claims', '{}'::jsonb::text, true);
  set local role anon;
  v_denied := false;
  begin
    perform public.preview_pipeline_engagement(
      v_org_a, (v_published_version->>'pipeline_template_version_id')::uuid,
      array[v_service_a, v_service_b], '[]'::jsonb
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  update pln3_checks set passed = v_denied
    where check_name = 'anonymous_execution_is_rejected';
end;
$$;

select jsonb_object_agg(check_name, passed order by check_name) as pln3_verification
from pln3_checks;

do $$
declare v_failed text;
begin
  select string_agg(check_name, ', ' order by check_name)
    into v_failed from pln3_checks where not passed;
  if v_failed is not null then
    raise exception 'PLN3 verification failed: %', v_failed;
  end if;
end;
$$;

rollback;
