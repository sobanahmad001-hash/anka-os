-- PLN2 rollback-safe verification. Run only after the matching migration is applied.
begin;

create temporary table pln2_checks (
  check_name text primary key,
  passed boolean not null default false
) on commit drop;

insert into pln2_checks (check_name) values
  ('all_tables_have_rls'),
  ('rls_policy_matrix_is_exact'),
  ('table_acl_matrix_is_exact'),
  ('rpc_acl_matrix_is_exact'),
  ('rpc_security_is_exact'),
  ('authorization_helpers_are_exact'),
  ('append_only_guards_are_exact'),
  ('tenant_foreign_keys_are_exact'),
  ('foreign_key_indexes_exist'),
  ('no_redundant_catalog_constraints'),
  ('no_template_owned_graph'),
  ('canonical_composer_is_unchanged'),
  ('rule_manifest_uses_canonical_graph'),
  ('selection_and_rule_hashes_are_sha256'),
  ('provenance_contract_is_exact'),
  ('idempotency_contract_is_exact'),
  ('department_manager_can_draft'),
  ('department_manager_cannot_publish'),
  ('operations_admin_can_publish'),
  ('contributor_cannot_draft'),
  ('published_version_visible_to_contributor'),
  ('unpublished_version_hidden_from_contributor'),
  ('publication_replay_is_idempotent'),
  ('service_selection_order_is_preserved'),
  ('version_update_is_rejected'),
  ('publication_delete_is_rejected'),
  ('privileged_client_membership_is_rejected'),
  ('suspended_organization_is_rejected'),
  ('archived_organization_is_rejected'),
  ('suspended_membership_is_rejected'),
  ('revoked_membership_is_rejected'),
  ('cross_organization_service_is_rejected'),
  ('cross_organization_write_is_rejected'),
  ('cross_organization_reads_are_empty'),
  ('anonymous_calls_are_rejected'),
  ('rejected_calls_leave_no_rows'),
  ('publish_replay_rechecks_authorization'),
  ('inactive_context_reads_are_empty');

update pln2_checks set passed = coalesce((
  select count(*) = 6 and bool_and(class.relrowsecurity)
  from pg_class class
  where class.oid = any(array[
    'public.pipeline_templates'::regclass,
    'public.pipeline_template_versions'::regclass,
    'public.pipeline_template_version_services'::regclass,
    'public.pipeline_template_publications'::regclass,
    'public.engagement_pipeline_origins'::regclass,
    'public.engagement_composition_requests'::regclass
  ])
), false) where check_name = 'all_tables_have_rls';

update pln2_checks set passed = (
  with expected(table_name, policy_name, required_expression) as (values
    ('pipeline_templates', 'Team can read organization pipeline templates',
      'is_active_pipeline_team_member(organization_id)'),
    ('pipeline_template_versions', 'Authorized team can read pipeline template versions',
      'can_read_pipeline_template_version(id, organization_id)'),
    ('pipeline_template_version_services', 'Authorized team can read pipeline template services',
      'can_read_pipeline_template_version(pipeline_template_version_id, organization_id)'),
    ('pipeline_template_publications', 'Team can read pipeline template publications',
      'is_active_pipeline_team_member(organization_id)'),
    ('engagement_pipeline_origins', 'Team can read engagement pipeline provenance',
      'is_active_pipeline_team_member(organization_id)')
  ), actual as (
    select class.relname as table_name, policy.polname as policy_name,
      policy.polcmd, policy.polroles, policy.polwithcheck,
      pg_get_expr(policy.polqual, policy.polrelid) as using_expression
    from pg_policy policy
    join pg_class class on class.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'pipeline_templates', 'pipeline_template_versions',
        'pipeline_template_version_services', 'pipeline_template_publications',
        'engagement_pipeline_origins', 'engagement_composition_requests'
      )
  )
  select (select count(*) from actual) = 5
    and count(actual.policy_name) = 5
    and bool_and(
      actual.polcmd = 'r'
      and actual.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
      and actual.polwithcheck is null
      and position(expected.required_expression in actual.using_expression) > 0
      and position('is_team_organization_member' in actual.using_expression) = 0
      and position('has_organization_role' in actual.using_expression) = 0
    )
  from expected left join actual using (table_name, policy_name)
) where check_name = 'rls_policy_matrix_is_exact';

update pln2_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  tables(table_name) as (values
    ('public.pipeline_templates'),
    ('public.pipeline_template_versions'),
    ('public.pipeline_template_version_services'),
    ('public.pipeline_template_publications'),
    ('public.engagement_pipeline_origins'),
    ('public.engagement_composition_requests')
  ), privileges(privilege_name) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')),
  matrix as (
    select role_name, table_name, privilege_name,
      case
        when role_name = 'authenticated'
          then privilege_name = 'SELECT'
            and table_name <> 'public.engagement_composition_requests'
        when role_name = 'service_role'
          then (table_name in (
              'public.pipeline_templates', 'public.pipeline_template_versions',
              'public.pipeline_template_version_services', 'public.pipeline_template_publications'
            ) and privilege_name = 'SELECT')
            or (table_name in (
              'public.engagement_pipeline_origins', 'public.engagement_composition_requests'
            ) and privilege_name in ('SELECT', 'INSERT'))
        else false
      end as expected
    from roles cross join tables cross join privileges
  )
  select count(*) = 72 and bool_and(
    has_table_privilege(role_name, table_name, privilege_name) = expected
  ) from matrix
) where check_name = 'table_acl_matrix_is_exact';

update pln2_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  functions(signature) as (values
    ('public.create_pipeline_template_version(uuid,uuid,text,text,text,uuid[],uuid,text)'),
    ('public.publish_pipeline_template_version(uuid)')
  ), matrix as (
    select role_name, signature, role_name in ('authenticated', 'service_role') as expected
    from roles cross join functions
  )
  select count(*) = 6 and bool_and(
    has_function_privilege(role_name, signature, 'EXECUTE') = expected
  ) from matrix
) where check_name = 'rpc_acl_matrix_is_exact';

update pln2_checks set passed = coalesce((
  select count(*) = 2
    and bool_and(procedure.prosecdef)
    and bool_and(procedure.proconfig = array['search_path=""'])
    and bool_and(position('private.has_active_pipeline_template_role' in
      pg_get_functiondef(procedure.oid)) > 0)
    and bool_and(position('public.has_organization_role' in
      pg_get_functiondef(procedure.oid)) = 0)
  from pg_proc procedure
  where procedure.oid = any(array[
    'public.create_pipeline_template_version(uuid,uuid,text,text,text,uuid[],uuid,text)'::regprocedure,
    'public.publish_pipeline_template_version(uuid)'::regprocedure
  ])
), false) where check_name = 'rpc_security_is_exact';

update pln2_checks set passed = (
  with helpers(signature, authenticated_execute, required_fragments) as (values
    ('private.is_active_pipeline_team_member(uuid)', true,
      array['organization.status = ''active''', 'membership.member_kind = ''team''',
        'membership.status = ''active''', 'auth.uid()']),
    ('private.has_active_pipeline_template_role(uuid,text[])', false,
      array['organization.status = ''active''', 'membership.member_kind = ''team''',
        'membership.status = ''active''', 'membership.role = any', 'auth.uid()']),
    ('private.can_read_pipeline_template_version(uuid,uuid)', true,
      array['private.is_active_pipeline_team_member',
        'private.has_active_pipeline_template_role', 'auth.uid()'])
  ), inspected as (
    select helpers.*, procedure.oid, procedure.prosecdef, procedure.proconfig,
      lower(pg_get_functiondef(procedure.oid)) as definition
    from helpers
    join pg_proc procedure on procedure.oid = helpers.signature::regprocedure
  )
  select count(*) = 3
    and bool_and(inspected.prosecdef)
    and bool_and(inspected.proconfig = array['search_path=""'])
    and bool_and(has_function_privilege(
      'authenticated', inspected.signature, 'EXECUTE'
    ) = inspected.authenticated_execute)
    and bool_and(not has_function_privilege('anon', inspected.signature, 'EXECUTE'))
    and bool_and(not exists (
      select 1 from unnest(inspected.required_fragments) fragment
      where position(lower(fragment) in inspected.definition) = 0
    ))
  from inspected
) where check_name = 'authorization_helpers_are_exact';

update pln2_checks set passed = (
  with expected(trigger_name, table_oid) as (values
    ('protect_pipeline_templates', 'public.pipeline_templates'::regclass),
    ('protect_pipeline_template_versions', 'public.pipeline_template_versions'::regclass),
    ('protect_pipeline_template_services', 'public.pipeline_template_version_services'::regclass),
    ('protect_pipeline_template_publications', 'public.pipeline_template_publications'::regclass),
    ('protect_engagement_pipeline_origins', 'public.engagement_pipeline_origins'::regclass),
    ('protect_engagement_composition_requests', 'public.engagement_composition_requests'::regclass)
  )
  select count(*) = 6
    and bool_and(not trigger_record.tgisinternal)
    and bool_and(trigger_record.tgenabled = 'O')
    and bool_and(trigger_record.tgtype = 27)
    and bool_and(trigger_record.tgfoid =
      'private.reject_pipeline_template_mutation()'::regprocedure)
  from expected
  join pg_trigger trigger_record
    on trigger_record.tgname = expected.trigger_name
   and trigger_record.tgrelid = expected.table_oid
  cross join lateral (
    select procedure.prorettype, procedure.prosecdef, procedure.proconfig
    from pg_proc procedure
    where procedure.oid = trigger_record.tgfoid
  ) trigger_function
  where trigger_function.prorettype = 'trigger'::regtype
    and not trigger_function.prosecdef
    and trigger_function.proconfig = array['search_path=""']
) where check_name = 'append_only_guards_are_exact';

update pln2_checks set passed = (
  with expected(constraint_name, child_table, child_columns, parent_table, parent_columns) as (values
    ('pipeline_template_versions_template_org_fk', 'public.pipeline_template_versions'::regclass,
      array['pipeline_template_id','organization_id'], 'public.pipeline_templates'::regclass,
      array['id','organization_id']),
    ('pipeline_template_versions_source_org_fk', 'public.pipeline_template_versions'::regclass,
      array['source_version_id','pipeline_template_id','organization_id'], 'public.pipeline_template_versions'::regclass,
      array['id','pipeline_template_id','organization_id']),
    ('pipeline_template_services_version_org_fk', 'public.pipeline_template_version_services'::regclass,
      array['pipeline_template_version_id','pipeline_template_id','organization_id'], 'public.pipeline_template_versions'::regclass,
      array['id','pipeline_template_id','organization_id']),
    ('pipeline_template_services_service_org_fk', 'public.pipeline_template_version_services'::regclass,
      array['service_id','organization_id'], 'public.service_catalog'::regclass,
      array['id','organization_id']),
    ('pipeline_publications_version_org_fk', 'public.pipeline_template_publications'::regclass,
      array['pipeline_template_version_id','pipeline_template_id','organization_id'], 'public.pipeline_template_versions'::regclass,
      array['id','pipeline_template_id','organization_id']),
    ('engagement_pipeline_origins_engagement_org_fk', 'public.engagement_pipeline_origins'::regclass,
      array['engagement_id','organization_id'], 'public.engagements'::regclass,
      array['id','organization_id']),
    ('engagement_pipeline_origins_version_org_fk', 'public.engagement_pipeline_origins'::regclass,
      array['pipeline_template_version_id','pipeline_template_id','organization_id'], 'public.pipeline_template_versions'::regclass,
      array['id','pipeline_template_id','organization_id']),
    ('engagement_composition_requests_engagement_org_fk', 'public.engagement_composition_requests'::regclass,
      array['engagement_id','organization_id'], 'public.engagements'::regclass,
      array['id','organization_id'])
  )
  select count(*) = 8 and bool_and(
    constraint_record.contype = 'f'
    and constraint_record.confrelid = expected.parent_table
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(constraint_record.conkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = constraint_record.conrelid
       and attribute.attnum = key.attnum) = expected.child_columns
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(constraint_record.confkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = constraint_record.confrelid
       and attribute.attnum = key.attnum) = expected.parent_columns
  )
  from expected
  join pg_constraint constraint_record
    on constraint_record.conname = expected.constraint_name
   and constraint_record.conrelid = expected.child_table
) where check_name = 'tenant_foreign_keys_are_exact';

update pln2_checks set passed = (
  with target_tables(table_oid) as (values
    ('public.pipeline_templates'::regclass),
    ('public.pipeline_template_versions'::regclass),
    ('public.pipeline_template_version_services'::regclass),
    ('public.pipeline_template_publications'::regclass),
    ('public.engagement_pipeline_origins'::regclass),
    ('public.engagement_composition_requests'::regclass)
  ), foreign_keys as (
    select constraint_record.*
    from pg_constraint constraint_record
    join target_tables on target_tables.table_oid = constraint_record.conrelid
    where constraint_record.contype = 'f'
  )
  select count(*) = 15 and bool_and(exists (
    select 1
    from pg_index index_record
    where index_record.indrelid = foreign_keys.conrelid
      and index_record.indisvalid
      and index_record.indisready
      and index_record.indexprs is null
      and (
        index_record.indpred is null
        or pg_get_expr(index_record.indpred, index_record.indrelid)
          = '(source_version_id IS NOT NULL)'
      )
      and (
        select array_agg(index_column.attnum::smallint order by index_column.ordinality)
        from unnest(index_record.indkey) with ordinality
          index_column(attnum, ordinality)
        where index_column.ordinality <= cardinality(foreign_keys.conkey)
      ) = foreign_keys.conkey
  ))
  from foreign_keys
) where check_name = 'foreign_key_indexes_exist';

update pln2_checks set passed = not exists (
  select 1 from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'idx_engagement_composition_requests_engagement_org_fk'
) and not exists (
  select 1 from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.pipeline_template_publications'::regclass
    and constraint_record.contype = 'u'
    and pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (id, organization_id)'
) where check_name = 'no_redundant_catalog_constraints';

update pln2_checks set passed = not exists (
  select 1 from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'pipeline_template_stages', 'pipeline_template_dependencies',
      'pipeline_template_prerequisites', 'pipeline_template_stage_rules'
    )
) where check_name = 'no_template_owned_graph';

update pln2_checks set passed = exists (
  select 1 from pg_proc procedure
  where procedure.oid = 'public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)'::regprocedure
    and not procedure.prosecdef
) and position('pipeline_template' in lower(pg_get_functiondef(
  'public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)'::regprocedure
))) = 0 where check_name = 'canonical_composer_is_unchanged';

update pln2_checks set passed = position('public.service_stage_rules' in pg_get_functiondef(
  'private.pipeline_rule_manifest(uuid,uuid[])'::regprocedure
)) > 0 and position('public.blueprint_stage_dependencies' in pg_get_functiondef(
  'private.pipeline_rule_manifest(uuid,uuid[])'::regprocedure
)) > 0 where check_name = 'rule_manifest_uses_canonical_graph';

update pln2_checks set passed = (
  select count(*) = 5
  from information_schema.columns
  where table_schema = 'public' and (
    (table_name = 'pipeline_template_versions' and column_name = 'service_selection_sha256')
    or (table_name = 'pipeline_template_publications' and column_name = 'published_rule_sha256')
    or (table_name = 'engagement_pipeline_origins' and column_name in (
      'original_selection_sha256', 'final_selection_sha256', 'preview_rule_sha256'
    ))
  )
) where check_name = 'selection_and_rule_hashes_are_sha256';

update pln2_checks set passed = exists (
  select 1 from pg_constraint
  where conrelid = 'public.engagement_pipeline_origins'::regclass
    and pg_get_constraintdef(oid) like '%was_customized%jsonb_array_length%'
) and not has_table_privilege('authenticated', 'public.engagement_pipeline_origins', 'INSERT,UPDATE,DELETE')
where check_name = 'provenance_contract_is_exact';

update pln2_checks set passed = exists (
  select 1 from pg_constraint
  where conrelid = 'public.engagement_composition_requests'::regclass
    and contype = 'p'
    and pg_get_constraintdef(oid) like '%organization_id%request_id%'
) and not has_table_privilege('authenticated', 'public.engagement_composition_requests', 'SELECT,INSERT,UPDATE,DELETE')
where check_name = 'idempotency_contract_is_exact';

do $$
declare
  v_org_id uuid;
  v_department_id text;
  v_service_ids uuid[];
  v_manager uuid := gen_random_uuid();
  v_operations_admin uuid := gen_random_uuid();
  v_contributor uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_version_one jsonb;
  v_version_two jsonb;
  v_publication_one jsonb;
  v_publication_replay jsonb;
  v_manager_publish_rejected boolean := false;
  v_contributor_draft_rejected boolean := false;
  v_version_update_rejected boolean := false;
  v_publication_delete_rejected boolean := false;
  v_published_visible integer := 0;
  v_unpublished_visible integer := 0;
begin
  select service.organization_id, service.department_id,
    array_agg(service.id order by service.display_order, service.id)
    into v_org_id, v_department_id, v_service_ids
  from public.service_catalog service
  join public.organizations organization on organization.id = service.organization_id
  where service.is_active and organization.status = 'active'
  group by service.organization_id, service.department_id
  having count(*) >= 2
  order by service.organization_id, service.department_id
  limit 1;

  if v_org_id is null then
    return;
  end if;
  v_service_ids := v_service_ids[1:2];

  insert into auth.users (id) values (v_manager), (v_operations_admin), (v_contributor);
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_org_id, v_manager, 'team', 'department_manager', v_department_id, 'active'),
    (v_org_id, v_operations_admin, 'team', 'operations_admin', v_department_id, 'active'),
    (v_org_id, v_contributor, 'team', 'contributor', v_department_id, 'active');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_manager, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.create_pipeline_template_version(
    v_org_id, null, 'pln2_' || v_suffix, 'PLN2 verification', '',
    v_service_ids, null, 'Initial rollback draft'
  ) into v_version_one;
  reset role;
  update pln2_checks set passed = (v_version_one->>'pipeline_template_version_id') is not null
    where check_name = 'department_manager_can_draft';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_manager, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.create_pipeline_template_version(
    v_org_id, (v_version_one->>'pipeline_template_id')::uuid,
    'pln2_' || v_suffix, 'PLN2 verification revised', '',
    array[v_service_ids[2], v_service_ids[1]],
    (v_version_one->>'pipeline_template_version_id')::uuid,
    'Reverse the default service order'
  ) into v_version_two;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_id, (v_version_one->>'pipeline_template_id')::uuid,
      'pln2_' || v_suffix, 'Unauthorized', '', v_service_ids,
      (v_version_one->>'pipeline_template_version_id')::uuid, ''
    );
  exception when insufficient_privilege then
    v_contributor_draft_rejected := true;
  end;
  reset role;
  update pln2_checks set passed = v_contributor_draft_rejected
    where check_name = 'contributor_cannot_draft';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_manager, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.publish_pipeline_template_version(
      (v_version_one->>'pipeline_template_version_id')::uuid
    );
  exception when insufficient_privilege then
    v_manager_publish_rejected := true;
  end;
  reset role;
  update pln2_checks set passed = v_manager_publish_rejected
    where check_name = 'department_manager_cannot_publish';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_operations_admin, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.publish_pipeline_template_version(
    (v_version_one->>'pipeline_template_version_id')::uuid
  ) into v_publication_one;
  select public.publish_pipeline_template_version(
    (v_version_one->>'pipeline_template_version_id')::uuid
  ) into v_publication_replay;
  reset role;
  update pln2_checks set passed =
    (v_publication_one->>'pipeline_template_publication_id') is not null
    and (v_publication_one->>'published_rule_sha256') ~ '^[0-9a-f]{64}$'
    where check_name = 'operations_admin_can_publish';
  update pln2_checks set passed =
    v_publication_one->>'pipeline_template_publication_id'
      = v_publication_replay->>'pipeline_template_publication_id'
    and (v_publication_replay->>'idempotent_replay')::boolean
    where check_name = 'publication_replay_is_idempotent';

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_contributor, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_published_visible
  from public.pipeline_template_versions
  where id = (v_version_one->>'pipeline_template_version_id')::uuid;
  select count(*) into v_unpublished_visible
  from public.pipeline_template_versions
  where id = (v_version_two->>'pipeline_template_version_id')::uuid;
  reset role;
  update pln2_checks set passed = v_published_visible = 1
    where check_name = 'published_version_visible_to_contributor';
  update pln2_checks set passed = v_unpublished_visible = 0
    where check_name = 'unpublished_version_hidden_from_contributor';

  update pln2_checks set passed = (
    select array_agg(item.service_id order by item.position) = v_service_ids
    from public.pipeline_template_version_services item
    where item.pipeline_template_version_id =
      (v_version_one->>'pipeline_template_version_id')::uuid
  ) where check_name = 'service_selection_order_is_preserved';

  begin
    update public.pipeline_template_versions set name = 'Mutated'
    where id = (v_version_one->>'pipeline_template_version_id')::uuid;
  exception when object_not_in_prerequisite_state then
    v_version_update_rejected := true;
  end;
  update pln2_checks set passed = v_version_update_rejected
    where check_name = 'version_update_is_rejected';

  begin
    delete from public.pipeline_template_publications
    where id = (v_publication_one->>'pipeline_template_publication_id')::uuid;
  exception when object_not_in_prerequisite_state then
    v_publication_delete_rejected := true;
  end;
  update pln2_checks set passed = v_publication_delete_rejected
    where check_name = 'publication_delete_is_rejected';
end;
$$;

do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_service_a uuid := gen_random_uuid();
  v_service_b uuid := gen_random_uuid();
  v_department_id text;
  v_authorized uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_client_role uuid := gen_random_uuid();
  v_suspended_member uuid := gen_random_uuid();
  v_revoked_member uuid := gen_random_uuid();
  v_version_a jsonb;
  v_version_b jsonb;
  v_publication_a jsonb;
  v_client_rejected boolean := false;
  v_suspended_member_rejected boolean := false;
  v_revoked_member_rejected boolean := false;
  v_suspended_org_draft_rejected boolean := false;
  v_suspended_org_publish_rejected boolean := false;
  v_archived_org_rejected boolean := false;
  v_cross_service_rejected boolean := false;
  v_cross_write_rejected boolean := false;
  v_anonymous_draft_rejected boolean := false;
  v_anonymous_publish_rejected boolean := false;
  v_anonymous_read_rejected boolean := false;
  v_replay_rejected boolean := false;
  v_cross_read_count integer := 0;
  v_inactive_read_count integer := 0;
  v_read_count integer := 0;
  v_before_templates integer;
  v_before_versions integer;
  v_before_publications integer;
  v_after_templates integer;
  v_after_versions integer;
  v_after_publications integer;
begin
  select department.id into v_department_id
  from public.departments department
  order by department.id
  limit 1;
  if v_department_id is null then
    return;
  end if;

  insert into public.organizations (id, name, slug, status) values
    (v_org_a, 'PLN2 security A', 'pln2_security_a_' || replace(v_org_a::text, '-', ''), 'active'),
    (v_org_b, 'PLN2 security B', 'pln2_security_b_' || replace(v_org_b::text, '-', ''), 'active');
  insert into public.service_catalog (
    id, organization_id, department_id, slug, name, is_active
  ) values
    (v_service_a, v_org_a, v_department_id, 'pln2_service_a', 'PLN2 service A', true),
    (v_service_b, v_org_b, v_department_id, 'pln2_service_b', 'PLN2 service B', true);
  insert into auth.users (id) values
    (v_authorized), (v_other_admin), (v_client_role),
    (v_suspended_member), (v_revoked_member);
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_org_a, v_authorized, 'team', 'operations_admin', v_department_id, 'active'),
    (v_org_b, v_other_admin, 'team', 'operations_admin', v_department_id, 'active'),
    (v_org_a, v_client_role, 'client', 'operations_admin', null, 'active'),
    (v_org_a, v_suspended_member, 'team', 'system_owner', v_department_id, 'suspended'),
    (v_org_a, v_revoked_member, 'team', 'system_owner', v_department_id, 'revoked');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_authorized, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.create_pipeline_template_version(
    v_org_a, null, 'pln2_security_a', 'PLN2 security A', '',
    array[v_service_a], null, 'Security verifier fixture'
  ) into v_version_a;
  select public.publish_pipeline_template_version(
    (v_version_a->>'pipeline_template_version_id')::uuid
  ) into v_publication_a;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_other_admin, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select public.create_pipeline_template_version(
    v_org_b, null, 'pln2_security_b', 'PLN2 security B', '',
    array[v_service_b], null, 'Cross-organization verifier fixture'
  ) into v_version_b;
  perform public.publish_pipeline_template_version(
    (v_version_b->>'pipeline_template_version_id')::uuid
  );
  reset role;

  select count(*) into v_before_templates from public.pipeline_templates;
  select count(*) into v_before_versions from public.pipeline_template_versions;
  select count(*) into v_before_publications from public.pipeline_template_publications;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_client_role, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_client_denied', 'Denied client', '',
      array[v_service_a], null, ''
    );
  exception when insufficient_privilege then
    v_client_rejected := true;
  end;
  select (select count(*) from public.pipeline_templates where organization_id = v_org_a)
    + (select count(*) from public.pipeline_template_versions where organization_id = v_org_a)
    + (select count(*) from public.pipeline_template_version_services where organization_id = v_org_a)
    + (select count(*) from public.pipeline_template_publications where organization_id = v_org_a)
    into v_read_count;
  v_inactive_read_count := v_inactive_read_count + v_read_count;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_suspended_member, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_suspended_denied', 'Denied suspended member', '',
      array[v_service_a], null, ''
    );
  exception when insufficient_privilege then
    v_suspended_member_rejected := true;
  end;
  select count(*) into v_read_count
  from public.pipeline_templates where organization_id = v_org_a;
  v_inactive_read_count := v_inactive_read_count + v_read_count;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_revoked_member, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_revoked_denied', 'Denied revoked member', '',
      array[v_service_a], null, ''
    );
  exception when insufficient_privilege then
    v_revoked_member_rejected := true;
  end;
  select count(*) into v_read_count
  from public.pipeline_templates where organization_id = v_org_a;
  v_inactive_read_count := v_inactive_read_count + v_read_count;
  reset role;

  update public.organizations set status = 'suspended' where id = v_org_a;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_authorized, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_suspended_org_denied', 'Denied suspended organization', '',
      array[v_service_a], null, ''
    );
  exception when insufficient_privilege then
    v_suspended_org_draft_rejected := true;
  end;
  begin
    perform public.publish_pipeline_template_version(
      (v_version_a->>'pipeline_template_version_id')::uuid
    );
  exception when insufficient_privilege then
    v_suspended_org_publish_rejected := true;
  end;
  select count(*) into v_read_count
  from public.pipeline_templates where organization_id = v_org_a;
  v_inactive_read_count := v_inactive_read_count + v_read_count;
  reset role;

  update public.organizations set status = 'archived' where id = v_org_a;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_authorized, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_archived_org_denied', 'Denied archived organization', '',
      array[v_service_a], null, ''
    );
  exception when insufficient_privilege then
    v_archived_org_rejected := true;
  end;
  select count(*) into v_read_count
  from public.pipeline_templates where organization_id = v_org_a;
  v_inactive_read_count := v_inactive_read_count + v_read_count;
  reset role;
  update public.organizations set status = 'active' where id = v_org_a;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_authorized, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_cross_service_denied', 'Denied cross service', '',
      array[v_service_b], null, ''
    );
  exception when invalid_parameter_value then
    v_cross_service_rejected := true;
  end;
  begin
    perform public.create_pipeline_template_version(
      v_org_b, null, 'pln2_cross_write_denied', 'Denied cross write', '',
      array[v_service_b], null, ''
    );
  exception when insufficient_privilege then
    v_cross_write_rejected := true;
  end;
  select (select count(*) from public.pipeline_templates where organization_id = v_org_b)
    + (select count(*) from public.pipeline_template_versions where organization_id = v_org_b)
    + (select count(*) from public.pipeline_template_version_services where organization_id = v_org_b)
    + (select count(*) from public.pipeline_template_publications where organization_id = v_org_b)
    into v_cross_read_count;
  reset role;

  update public.organization_memberships set status = 'revoked'
  where organization_id = v_org_a and user_id = v_authorized;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_authorized, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  begin
    perform public.publish_pipeline_template_version(
      (v_version_a->>'pipeline_template_version_id')::uuid
    );
  exception when insufficient_privilege then
    v_replay_rejected := true;
  end;
  reset role;
  update public.organization_memberships set status = 'active'
  where organization_id = v_org_a and user_id = v_authorized;

  perform set_config('request.jwt.claims', '{}'::jsonb::text, true);
  set local role anon;
  begin
    perform public.create_pipeline_template_version(
      v_org_a, null, 'pln2_anon_denied', 'Denied anonymous', '',
      array[v_service_a], null, ''
    );
  exception when insufficient_privilege then
    v_anonymous_draft_rejected := true;
  end;
  begin
    perform public.publish_pipeline_template_version(
      (v_version_a->>'pipeline_template_version_id')::uuid
    );
  exception when insufficient_privilege then
    v_anonymous_publish_rejected := true;
  end;
  begin
    perform count(*) from public.pipeline_templates;
  exception when insufficient_privilege then
    v_anonymous_read_rejected := true;
  end;
  reset role;

  select count(*) into v_after_templates from public.pipeline_templates;
  select count(*) into v_after_versions from public.pipeline_template_versions;
  select count(*) into v_after_publications from public.pipeline_template_publications;

  update pln2_checks set passed = v_client_rejected
    where check_name = 'privileged_client_membership_is_rejected';
  update pln2_checks set passed =
    v_suspended_org_draft_rejected and v_suspended_org_publish_rejected
    where check_name = 'suspended_organization_is_rejected';
  update pln2_checks set passed = v_archived_org_rejected
    where check_name = 'archived_organization_is_rejected';
  update pln2_checks set passed = v_suspended_member_rejected
    where check_name = 'suspended_membership_is_rejected';
  update pln2_checks set passed = v_revoked_member_rejected
    where check_name = 'revoked_membership_is_rejected';
  update pln2_checks set passed = v_cross_service_rejected
    where check_name = 'cross_organization_service_is_rejected';
  update pln2_checks set passed = v_cross_write_rejected
    where check_name = 'cross_organization_write_is_rejected';
  update pln2_checks set passed = v_cross_read_count = 0
    where check_name = 'cross_organization_reads_are_empty';
  update pln2_checks set passed =
    v_anonymous_draft_rejected and v_anonymous_publish_rejected
      and v_anonymous_read_rejected
    where check_name = 'anonymous_calls_are_rejected';
  update pln2_checks set passed =
    v_before_templates = v_after_templates
      and v_before_versions = v_after_versions
      and v_before_publications = v_after_publications
    where check_name = 'rejected_calls_leave_no_rows';
  update pln2_checks set passed = v_replay_rejected
    where check_name = 'publish_replay_rechecks_authorization';
  update pln2_checks set passed = v_inactive_read_count = 0
    where check_name = 'inactive_context_reads_are_empty';
end;
$$;

select jsonb_object_agg(check_name, passed order by check_name) as pln2_verification
from pln2_checks;

do $$
declare v_failed text;
begin
  select string_agg(check_name, ', ' order by check_name)
    into v_failed from pln2_checks where not passed;
  if v_failed is not null then
    raise exception 'PLN2 verification failed: %', v_failed;
  end if;
end;
$$;

rollback;
