-- RET1 rollback-safe verification. Run only after the matching migration is applied.
-- Every fixture and mutation below is enclosed by this transaction and discarded.
begin;

create temporary table ret1_checks (
  check_name text primary key,
  passed boolean not null default false
) on commit drop;

insert into ret1_checks (check_name) values
  ('fixture_prerequisites_available'),
  ('service_owner_can_create_plan'),
  ('service_owner_can_create_version'),
  ('project_owner_can_approve_version'),
  ('project_owner_can_transition_lifecycle'),
  ('department_manager_reassignment_creates_immutable_version'),
  ('wrong_role_plan_creation_is_rejected'),
  ('wrong_role_version_creation_is_rejected'),
  ('wrong_role_approval_is_rejected'),
  ('wrong_role_reassignment_is_rejected'),
  ('wrong_role_lifecycle_transition_is_rejected'),
  ('cross_organization_actor_is_rejected'),
  ('cross_organization_target_is_rejected'),
  ('version_update_is_rejected'),
  ('version_delete_is_rejected'),
  ('template_item_update_is_rejected'),
  ('template_item_delete_is_rejected'),
  ('approval_update_is_rejected'),
  ('approval_delete_is_rejected'),
  ('plan_delete_is_rejected'),
  ('invalid_cadence_is_rejected'),
  ('invalid_timezone_is_rejected'),
  ('invalid_effective_dates_are_rejected'),
  ('invalid_template_offsets_are_rejected'),
  ('audit_events_are_created'),
  ('canonical_plan_ownership_is_consistent'),
  ('approved_pointer_has_append_only_approval'),
  ('all_content_tables_have_rls'),
  ('rls_select_policies_are_exact'),
  ('rls_write_policies_are_absent'),
  ('table_acl_matrix_is_exact'),
  ('rpc_acl_matrix_is_exact'),
  ('server_actions_are_invoker_only'),
  ('tenant_composite_foreign_keys_are_exact'),
  ('tenant_foreign_key_indexes_are_exact'),
  ('audit_vocabulary_is_complete'),
  ('append_only_guards_are_exact'),
  ('only_v1_frequencies_are_allowed'),
  ('no_occurrence_or_scheduler_tables_added');

update ret1_checks set passed = coalesce((
  select bool_and(class.relrowsecurity)
  from pg_class class
  where class.oid = any(array[
    'public.recurring_work_plans'::regclass,
    'public.recurring_work_plan_versions'::regclass,
    'public.recurring_work_plan_template_items'::regclass,
    'public.recurring_work_plan_version_approvals'::regclass
  ])
), false) where check_name = 'all_content_tables_have_rls';

update ret1_checks set passed = (
  with expected(table_name, policy_name) as (values
    ('recurring_work_plans', 'Team can read organization recurring plans'),
    ('recurring_work_plan_versions', 'Team can read organization recurring plan versions'),
    ('recurring_work_plan_template_items', 'Team can read organization recurring plan template items'),
    ('recurring_work_plan_version_approvals', 'Team can read organization recurring plan approvals')
  )
  select count(*) = 4 and bool_and(
    policy.polcmd = 'r'
    and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
    and pg_get_expr(policy.polqual, policy.polrelid) = format(
      '( SELECT is_team_organization_member(%I.organization_id) AS is_team_organization_member)',
      expected.table_name
    )
    and policy.polwithcheck is null
  )
  from expected
  join pg_class class on class.relname = expected.table_name
  join pg_namespace namespace on namespace.oid = class.relnamespace and namespace.nspname = 'public'
  join pg_policy policy on policy.polrelid = class.oid and policy.polname = expected.policy_name
) where check_name = 'rls_select_policies_are_exact';

update ret1_checks set passed = not exists (
  select 1 from pg_policy policy
  where policy.polrelid = any(array[
    'public.recurring_work_plans'::regclass,
    'public.recurring_work_plan_versions'::regclass,
    'public.recurring_work_plan_template_items'::regclass,
    'public.recurring_work_plan_version_approvals'::regclass
  ]) and policy.polcmd <> 'r'
) and (
  select count(*) from pg_policy policy
  where policy.polrelid = any(array[
    'public.recurring_work_plans'::regclass,
    'public.recurring_work_plan_versions'::regclass,
    'public.recurring_work_plan_template_items'::regclass,
    'public.recurring_work_plan_version_approvals'::regclass
  ])
) = 4 where check_name = 'rls_write_policies_are_absent';

update ret1_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  tables(table_name) as (values
    ('public.recurring_work_plans'),
    ('public.recurring_work_plan_versions'),
    ('public.recurring_work_plan_template_items'),
    ('public.recurring_work_plan_version_approvals')
  ), privileges(privilege_name) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')),
  matrix as (
    select role_name, table_name, privilege_name,
      case
        when role_name = 'authenticated' then privilege_name = 'SELECT'
        when role_name = 'service_role' and table_name = 'public.recurring_work_plans'
          then privilege_name in ('SELECT', 'INSERT', 'UPDATE')
        when role_name = 'service_role' then privilege_name in ('SELECT', 'INSERT')
        else false
      end as expected
    from roles cross join tables cross join privileges
  )
  select count(*) = 48 and bool_and(
    has_table_privilege(role_name, table_name, privilege_name) = expected
  ) from matrix
) where check_name = 'table_acl_matrix_is_exact';

update ret1_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  functions(signature) as (values
    ('public.create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'),
    ('public.create_recurring_work_plan_version(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'),
    ('public.approve_recurring_work_plan_version(uuid,uuid,text,uuid)'),
    ('public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)'),
    ('public.transition_recurring_work_plan(uuid,text,text,text,uuid)')
  ), matrix as (
    select role_name, signature, role_name = 'service_role' as expected
    from roles cross join functions
  )
  select count(*) = 15 and bool_and(
    has_function_privilege(role_name, signature, 'EXECUTE') = expected
  ) from matrix
) where check_name = 'rpc_acl_matrix_is_exact';

update ret1_checks set passed = coalesce((
  select count(*) = 5 and bool_and(not procedure.prosecdef)
  from pg_proc procedure
  where procedure.oid = any(array[
    'public.create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure,
    'public.create_recurring_work_plan_version(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure,
    'public.approve_recurring_work_plan_version(uuid,uuid,text,uuid)'::regprocedure,
    'public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)'::regprocedure,
    'public.transition_recurring_work_plan(uuid,text,text,text,uuid)'::regprocedure
  ])
), false) where check_name = 'server_actions_are_invoker_only';

update ret1_checks set passed = (
  with expected(constraint_name, child_table, child_columns, parent_table, parent_columns) as (values
    ('recurring_plans_engagement_project_org_fk', 'public.recurring_work_plans'::regclass,
      array['engagement_id','project_id','organization_id'], 'public.engagements'::regclass,
      array['id','project_id','organization_id']),
    ('recurring_plans_service_scope_fk', 'public.recurring_work_plans'::regclass,
      array['engagement_service_id','engagement_id','service_id','organization_id'], 'public.engagement_services'::regclass,
      array['id','engagement_id','service_id','organization_id']),
    ('recurring_versions_plan_org_fk', 'public.recurring_work_plan_versions'::regclass,
      array['plan_id','organization_id'], 'public.recurring_work_plans'::regclass, array['id','organization_id']),
    ('recurring_template_version_plan_org_fk', 'public.recurring_work_plan_template_items'::regclass,
      array['plan_version_id','plan_id','organization_id'], 'public.recurring_work_plan_versions'::regclass,
      array['id','plan_id','organization_id']),
    ('recurring_approvals_version_plan_org_fk', 'public.recurring_work_plan_version_approvals'::regclass,
      array['plan_version_id','plan_id','organization_id'], 'public.recurring_work_plan_versions'::regclass,
      array['id','plan_id','organization_id']),
    ('recurring_work_plans_approved_version_fk', 'public.recurring_work_plans'::regclass,
      array['approved_version_id','id','organization_id'], 'public.recurring_work_plan_versions'::regclass,
      array['id','plan_id','organization_id'])
  )
  select count(*) = 6 and bool_and(
    constraint_record.contype = 'f'
    and constraint_record.confrelid = expected.parent_table
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(constraint_record.conkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = constraint_record.conrelid and attribute.attnum = key.attnum) = expected.child_columns
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(constraint_record.confkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = constraint_record.confrelid and attribute.attnum = key.attnum) = expected.parent_columns
  )
  from expected
  join pg_constraint constraint_record
    on constraint_record.conname = expected.constraint_name
   and constraint_record.conrelid = expected.child_table
) where check_name = 'tenant_composite_foreign_keys_are_exact';

update ret1_checks set passed = (
  with expected(index_name, table_oid, columns) as (values
    ('idx_recurring_work_plans_engagement_project_org_fk', 'public.recurring_work_plans'::regclass,
      array['engagement_id','project_id','organization_id']),
    ('idx_recurring_work_plans_service_scope_fk', 'public.recurring_work_plans'::regclass,
      array['engagement_service_id','engagement_id','service_id','organization_id']),
    ('idx_recurring_work_plan_versions_plan_org_fk', 'public.recurring_work_plan_versions'::regclass,
      array['plan_id','organization_id']),
    ('idx_recurring_template_items_version_plan_org_fk', 'public.recurring_work_plan_template_items'::regclass,
      array['plan_version_id','plan_id','organization_id']),
    ('idx_recurring_approvals_version_plan_org_fk', 'public.recurring_work_plan_version_approvals'::regclass,
      array['plan_version_id','plan_id','organization_id']),
    ('idx_recurring_work_plans_approved_version_fk', 'public.recurring_work_plans'::regclass,
      array['approved_version_id','id','organization_id'])
  )
  select count(*) = 6 and bool_and(
    index_record.indisvalid
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(index_record.indkey::smallint[]) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = index_record.indrelid and attribute.attnum = key.attnum
      where key.ordinality <= cardinality(expected.columns)) = expected.columns
  )
  from expected
  join pg_class index_class on index_class.relname = expected.index_name and index_class.relkind = 'i'
  join pg_index index_record on index_record.indexrelid = index_class.oid and index_record.indrelid = expected.table_oid
) where check_name = 'tenant_foreign_key_indexes_are_exact';

update ret1_checks set passed = coalesce((
  select pg_get_constraintdef(constraint_record.oid) like all (array[
    '%recurring_plan_created%', '%recurring_plan_version_created%',
    '%recurring_plan_version_approved%', '%recurring_plan_status_changed%'
  ])
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.engagement_events'::regclass
    and constraint_record.conname = 'engagement_events_event_type_check'
), false) where check_name = 'audit_vocabulary_is_complete';

update ret1_checks set passed = (
  with expected(trigger_name, table_oid) as (values
    ('protect_recurring_plan_header', 'public.recurring_work_plans'::regclass),
    ('protect_recurring_plan_versions', 'public.recurring_work_plan_versions'::regclass),
    ('protect_recurring_plan_template_items', 'public.recurring_work_plan_template_items'::regclass),
    ('protect_recurring_plan_version_approvals', 'public.recurring_work_plan_version_approvals'::regclass)
  )
  select count(*) = 4 and bool_and(not trigger_record.tgisinternal)
  from expected
  join pg_trigger trigger_record
    on trigger_record.tgname = expected.trigger_name and trigger_record.tgrelid = expected.table_oid
) where check_name = 'append_only_guards_are_exact';

update ret1_checks set passed = exists (
  select 1 from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.recurring_work_plan_versions'::regclass
    and pg_get_constraintdef(constraint_record.oid) like '%weekly%monthly%'
) where check_name = 'only_v1_frequencies_are_allowed';

update ret1_checks set passed = not exists (
  select 1 from information_schema.tables
  where table_schema = 'public'
    and (table_name like 'recurring%occurrence%' or table_name like 'recurring%schedule%')
) where check_name = 'no_occurrence_or_scheduler_tables_added';

do $$
declare
  v_org_id uuid;
  v_cross_org_id uuid := gen_random_uuid();
  v_department_id text;
  v_service_owner uuid := gen_random_uuid();
  v_project_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_cross_actor uuid := gen_random_uuid();
  v_client_id uuid;
  v_agency_client_id uuid;
  v_brand_id uuid;
  v_project_id uuid;
  v_engagement_id uuid;
  v_service_id uuid;
  v_engagement_service_id uuid;
  v_cross_client_id uuid;
  v_cross_agency_client_id uuid;
  v_cross_brand_id uuid;
  v_cross_project_id uuid;
  v_cross_engagement_id uuid;
  v_cross_service_id uuid;
  v_cross_engagement_service_id uuid;
  v_plan public.recurring_work_plans;
  v_cross_plan public.recurring_work_plans;
  v_version_one public.recurring_work_plan_versions;
  v_version_two public.recurring_work_plan_versions;
  v_version_three public.recurring_work_plan_versions;
  v_template_one public.recurring_work_plan_template_items;
  v_approval public.recurring_work_plan_version_approvals;
  v_template jsonb;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
begin
  select department.organization_id, department.id
    into v_org_id, v_department_id
  from public.departments department
  join public.organizations organization on organization.id = department.organization_id
  where organization.status = 'active'
  order by department.created_at, department.id
  limit 1;

  if v_org_id is null then
    return;
  end if;

  insert into auth.users (id) values
    (v_service_owner),
    (v_project_owner),
    (v_manager),
    (v_cross_actor);

  insert into public.organizations (id, name, slug)
  values (v_cross_org_id, 'RET1 rollback cross organization', 'ret1-cross-' || v_suffix);

  insert into public.organization_memberships
    (organization_id, user_id, member_kind, role, department_id, status)
  values
    (v_org_id, v_service_owner, 'team', 'contributor', v_department_id, 'active'),
    (v_org_id, v_project_owner, 'team', 'project_owner', v_department_id, 'active'),
    (v_org_id, v_manager, 'team', 'department_manager', v_department_id, 'active'),
    (v_cross_org_id, v_cross_actor, 'team', 'project_owner', v_department_id, 'active');

  insert into public.clients (name, company, owner_id, organization_id)
  values ('RET1 client ' || v_suffix, 'RET1', v_project_owner, v_org_id)
  returning id into v_client_id;
  insert into public.agency_clients
    (organization_id, legacy_client_id, canonical_client_id, name, owner_id, created_by)
  values (v_org_id, v_client_id, v_client_id, 'RET1 agency client ' || v_suffix, v_project_owner, v_service_owner)
  returning id into v_agency_client_id;
  insert into public.brands (organization_id, client_id, name, is_default, created_by)
  values (v_org_id, v_agency_client_id, 'RET1 brand ' || v_suffix, true, v_service_owner)
  returning id into v_brand_id;
  insert into public.projects
    (name, department_id, status, owner_id, organization_id, client_id, engagement_type)
  values ('RET1 project ' || v_suffix, v_department_id, 'active', v_project_owner, v_org_id, v_client_id, 'retainer')
  returning id into v_project_id;
  insert into public.engagements
    (organization_id, client_id, brand_id, legacy_project_id, project_id, name,
     engagement_type, status, lead_owner_id, created_by)
  values (v_org_id, v_agency_client_id, v_brand_id, v_project_id, v_project_id,
    'RET1 engagement ' || v_suffix, 'retainer', 'active', v_project_owner, v_service_owner)
  returning id into v_engagement_id;
  insert into public.service_catalog (organization_id, department_id, slug, name)
  values (v_org_id, v_department_id, 'ret1_' || v_suffix, 'RET1 service')
  returning id into v_service_id;
  insert into public.engagement_services
    (organization_id, engagement_id, service_id, owner_id, status, activated_by)
  values (v_org_id, v_engagement_id, v_service_id, v_service_owner, 'active', v_service_owner)
  returning id into v_engagement_service_id;

  insert into public.clients (name, company, owner_id, organization_id)
  values ('RET1 cross client ' || v_suffix, 'RET1', v_cross_actor, v_cross_org_id)
  returning id into v_cross_client_id;
  insert into public.agency_clients
    (organization_id, legacy_client_id, canonical_client_id, name, owner_id, created_by)
  values (v_cross_org_id, v_cross_client_id, v_cross_client_id, 'RET1 cross agency client ' || v_suffix,
    v_cross_actor, v_cross_actor)
  returning id into v_cross_agency_client_id;
  insert into public.brands (organization_id, client_id, name, is_default, created_by)
  values (v_cross_org_id, v_cross_agency_client_id, 'RET1 cross brand ' || v_suffix, true, v_cross_actor)
  returning id into v_cross_brand_id;
  insert into public.projects
    (name, department_id, status, owner_id, organization_id, client_id, engagement_type)
  values ('RET1 cross project ' || v_suffix, v_department_id, 'active', v_cross_actor,
    v_cross_org_id, v_cross_client_id, 'retainer')
  returning id into v_cross_project_id;
  insert into public.engagements
    (organization_id, client_id, brand_id, legacy_project_id, project_id, name,
     engagement_type, status, lead_owner_id, created_by)
  values (v_cross_org_id, v_cross_agency_client_id, v_cross_brand_id, v_cross_project_id, v_cross_project_id,
    'RET1 cross engagement ' || v_suffix, 'retainer', 'active', v_cross_actor, v_cross_actor)
  returning id into v_cross_engagement_id;
  insert into public.service_catalog (organization_id, department_id, slug, name)
  values (v_cross_org_id, v_department_id, 'ret1_cross_' || v_suffix, 'RET1 cross service')
  returning id into v_cross_service_id;
  insert into public.engagement_services
    (organization_id, engagement_id, service_id, owner_id, status, activated_by)
  values (v_cross_org_id, v_cross_engagement_id, v_cross_service_id, v_cross_actor, 'active', v_cross_actor)
  returning id into v_cross_engagement_service_id;

  update ret1_checks set passed = true where check_name = 'fixture_prerequisites_available';

  v_template := jsonb_build_array(jsonb_build_object(
    'template_key', 'weekly_review', 'title', 'Weekly review',
    'default_assignee_id', v_service_owner, 'start_offset_days', 0,
    'due_offset_days', 2, 'position', 0
  ));

  v_plan := public.create_recurring_work_plan(
    v_engagement_service_id, 'RET1 plan', 'Rollback verifier', 'weekly', 'UTC',
    current_date, null, '{}'::jsonb, v_template, v_service_owner
  );
  select * into v_version_one from public.recurring_work_plan_versions
    where plan_id = v_plan.id and version_number = 1;
  select * into v_template_one from public.recurring_work_plan_template_items
    where plan_version_id = v_version_one.id and template_key = 'weekly_review';
  update ret1_checks set passed = (
    v_plan.organization_id = v_org_id and v_plan.created_by = v_service_owner
    and v_version_one.id is not null and v_template_one.id is not null
  ) where check_name = 'service_owner_can_create_plan';

  v_version_two := public.create_recurring_work_plan_version(
    v_plan.id, 'RET1 plan v2', 'Rollback verifier', 'monthly', 'UTC',
    current_date, null, '{}'::jsonb, v_template, v_service_owner
  );
  update ret1_checks set passed = v_version_two.version_number = 2
    and v_version_two.created_by = v_service_owner
    where check_name = 'service_owner_can_create_version';

  begin
    perform public.create_recurring_work_plan(
      v_engagement_service_id, 'Wrong actor', '', 'weekly', 'UTC', current_date,
      null, '{}'::jsonb, v_template, v_manager);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'wrong_role_plan_creation_is_rejected';
  end;
  begin
    perform public.create_recurring_work_plan_version(
      v_plan.id, 'Wrong actor', '', 'weekly', 'UTC', current_date,
      null, '{}'::jsonb, v_template, v_manager);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'wrong_role_version_creation_is_rejected';
  end;
  begin
    perform public.approve_recurring_work_plan_version(v_plan.id, v_version_two.id, '', v_service_owner);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'wrong_role_approval_is_rejected';
  end;
  begin
    perform public.transition_recurring_work_plan(v_plan.id, 'active', '', '', v_service_owner);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'wrong_role_lifecycle_transition_is_rejected';
  end;

  v_plan := public.approve_recurring_work_plan_version(v_plan.id, v_version_two.id, 'Approved by project owner', v_project_owner);
  update ret1_checks set passed = v_plan.status = 'approved'
    and v_plan.approved_version_id = v_version_two.id
    where check_name = 'project_owner_can_approve_version';
  v_plan := public.transition_recurring_work_plan(v_plan.id, 'active', '', '', v_project_owner);
  update ret1_checks set passed = v_plan.status = 'active' and v_plan.status_changed_by = v_project_owner
    where check_name = 'project_owner_can_transition_lifecycle';

  begin
    perform public.reassign_recurring_plan_template_item(v_plan.id, 'weekly_review', v_manager, v_service_owner);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'wrong_role_reassignment_is_rejected';
  end;

  v_version_three := public.reassign_recurring_plan_template_item(
    v_plan.id, 'weekly_review', v_manager, v_manager
  );
  update ret1_checks set passed = (
    v_version_three.version_number = 3
    and (select default_assignee_id from public.recurring_work_plan_template_items
      where plan_version_id = v_version_two.id and template_key = 'weekly_review') = v_service_owner
    and (select default_assignee_id from public.recurring_work_plan_template_items
      where plan_version_id = v_version_three.id and template_key = 'weekly_review') = v_manager
  ) where check_name = 'department_manager_reassignment_creates_immutable_version';
  v_plan := public.approve_recurring_work_plan_version(
    v_plan.id, v_version_three.id, 'Approved reassignment', v_project_owner
  );

  begin
    perform public.approve_recurring_work_plan_version(v_plan.id, v_version_three.id, '', v_cross_actor);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'cross_organization_actor_is_rejected';
  end;

  v_cross_plan := public.create_recurring_work_plan(
    v_cross_engagement_service_id, 'RET1 cross plan', '', 'weekly', 'UTC',
    current_date, null, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'template_key', 'cross_review', 'title', 'Cross review',
      'default_assignee_id', v_cross_actor, 'start_offset_days', 0,
      'due_offset_days', 1, 'position', 0)),
    v_cross_actor
  );
  select * into v_version_one from public.recurring_work_plan_versions
    where plan_id = v_cross_plan.id and version_number = 1;
  begin
    perform public.approve_recurring_work_plan_version(
      v_cross_plan.id, v_version_one.id, '', v_project_owner);
  exception when sqlstate '42501' then
    update ret1_checks set passed = true where check_name = 'cross_organization_target_is_rejected';
  end;

  v_template := jsonb_build_array(jsonb_build_object(
    'template_key', 'weekly_review', 'title', 'Weekly review',
    'default_assignee_id', v_manager, 'start_offset_days', 0,
    'due_offset_days', 2, 'position', 0
  ));

  begin
    perform public.create_recurring_work_plan_version(
      v_plan.id, 'Invalid cadence', '', 'daily', 'UTC', current_date,
      null, '{}'::jsonb, v_template, v_service_owner);
  exception when check_violation then
    update ret1_checks set passed = true where check_name = 'invalid_cadence_is_rejected';
  end;
  begin
    perform public.create_recurring_work_plan_version(
      v_plan.id, 'Invalid timezone', '', 'weekly', 'Not/A_Real_Zone', current_date,
      null, '{}'::jsonb, v_template, v_service_owner);
  exception when sqlstate '22023' then
    update ret1_checks set passed = true where check_name = 'invalid_timezone_is_rejected';
  end;
  begin
    perform public.create_recurring_work_plan_version(
      v_plan.id, 'Invalid dates', '', 'weekly', 'UTC', current_date,
      current_date - 1, '{}'::jsonb, v_template, v_service_owner);
  exception when check_violation then
    update ret1_checks set passed = true where check_name = 'invalid_effective_dates_are_rejected';
  end;
  begin
    perform public.create_recurring_work_plan_version(
      v_plan.id, 'Invalid offsets', '', 'weekly', 'UTC', current_date,
      null, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'template_key', 'bad_offset', 'title', 'Bad offset',
        'start_offset_days', 3, 'due_offset_days', 2, 'position', 0)),
      v_service_owner);
  exception when check_violation then
    update ret1_checks set passed = true where check_name = 'invalid_template_offsets_are_rejected';
  end;

  select * into v_template_one from public.recurring_work_plan_template_items
    where plan_version_id = v_version_three.id and template_key = 'weekly_review';
  select * into v_approval from public.recurring_work_plan_version_approvals
    where plan_version_id = v_version_three.id;

  begin
    update public.recurring_work_plan_versions set title = 'mutated' where id = v_version_three.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'version_update_is_rejected';
  end;
  begin
    delete from public.recurring_work_plan_versions where id = v_version_three.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'version_delete_is_rejected';
  end;
  begin
    update public.recurring_work_plan_template_items set title = 'mutated' where id = v_template_one.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'template_item_update_is_rejected';
  end;
  begin
    delete from public.recurring_work_plan_template_items where id = v_template_one.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'template_item_delete_is_rejected';
  end;
  begin
    update public.recurring_work_plan_version_approvals set approval_note = 'mutated' where id = v_approval.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'approval_update_is_rejected';
  end;
  begin
    delete from public.recurring_work_plan_version_approvals where id = v_approval.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'approval_delete_is_rejected';
  end;
  begin
    delete from public.recurring_work_plans where id = v_plan.id;
  exception when sqlstate '55000' then
    update ret1_checks set passed = true where check_name = 'plan_delete_is_rejected';
  end;

  v_plan := public.transition_recurring_work_plan(v_plan.id, 'paused', 'Capacity hold', 'One cycle delayed', v_project_owner);
  v_plan := public.transition_recurring_work_plan(v_plan.id, 'active', '', '', v_project_owner);
  v_plan := public.transition_recurring_work_plan(v_plan.id, 'ended', 'Contract ended', 'No new work', v_project_owner);
  v_plan := public.transition_recurring_work_plan(v_plan.id, 'archived', 'Records retained', 'Read only', v_project_owner);
  update ret1_checks set passed = passed and v_plan.status = 'archived'
    where check_name = 'project_owner_can_transition_lifecycle';

  update ret1_checks set passed = (
    select count(distinct event_type) = 4
    from public.engagement_events event
    where event.engagement_id = v_engagement_id
      and event.payload->>'plan_id' = v_plan.id::text
      and event.event_type in (
        'recurring_plan_created', 'recurring_plan_version_created',
        'recurring_plan_version_approved', 'recurring_plan_status_changed'
      )
  ) where check_name = 'audit_events_are_created';

  update ret1_checks set passed = not exists (
    select 1 from public.recurring_work_plans plan
    left join public.engagements engagement
      on engagement.id = plan.engagement_id and engagement.project_id = plan.project_id
     and engagement.organization_id = plan.organization_id
    left join public.engagement_services service
      on service.id = plan.engagement_service_id and service.engagement_id = plan.engagement_id
     and service.service_id = plan.service_id and service.organization_id = plan.organization_id
    where engagement.id is null or service.id is null or engagement.engagement_type <> 'retainer'
  ) where check_name = 'canonical_plan_ownership_is_consistent';

  update ret1_checks set passed = not exists (
    select 1 from public.recurring_work_plans plan
    left join public.recurring_work_plan_version_approvals approval
      on approval.plan_version_id = plan.approved_version_id
     and approval.plan_id = plan.id and approval.organization_id = plan.organization_id
    where plan.approved_version_id is not null and approval.id is null
  ) where check_name = 'approved_pointer_has_append_only_approval';
end;
$$;

select jsonb_object_agg(check_name, passed order by check_name)
  as ret1_recurring_plan_foundation_verification
from ret1_checks;

do $$
begin
  if exists (select 1 from ret1_checks where not passed) then
    raise exception 'RET1 verification failed: %', (
      select string_agg(check_name, ', ' order by check_name)
      from ret1_checks where not passed
    );
  end if;
end;
$$;

rollback;
