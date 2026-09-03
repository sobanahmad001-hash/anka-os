-- RET2 rollback-safe verification. Run only after the matching migration is applied.
begin;

create temporary table ret2_checks (
  check_name text primary key,
  passed boolean not null default false
) on commit drop;

insert into ret2_checks (check_name) values
  ('fixture_prerequisites_available'),
  ('monthly_short_month_clamps_without_drift'),
  ('weekly_anchor_and_half_open_window_are_exact'),
  ('preview_is_read_only_and_returns_exact_dates'),
  ('service_owner_can_confirm_one_period'),
  ('generated_work_is_canonical_and_complete'),
  ('same_request_replays_identical_ids'),
  ('new_request_same_period_replays_one_occurrence'),
  ('request_key_cannot_change_business_target'),
  ('wrong_actor_is_rejected'),
  ('noncanonical_period_is_rejected'),
  ('inactive_plan_is_rejected'),
  ('past_period_requires_reason'),
  ('partial_failure_rolls_back_every_business_row'),
  ('occurrences_are_append_only'),
  ('attempts_are_append_only'),
  ('work_item_provenance_is_immutable'),
  ('generation_audit_payload_is_exact'),
  ('created_via_vocabulary_is_extended_once'),
  ('all_ret2_tables_have_rls'),
  ('rls_select_policies_are_exact'),
  ('rls_write_policies_are_absent'),
  ('table_acl_matrix_is_exact'),
  ('rpc_acl_matrix_is_exact'),
  ('server_actions_are_invoker_only'),
  ('tenant_composite_foreign_keys_are_exact'),
  ('tenant_foreign_key_indexes_are_exact'),
  ('append_only_guards_are_exact'),
  ('no_scheduler_surface_exists');

update ret2_checks set passed =
  private.recurring_month_anchor(date '2027-01-31', 1) = date '2027-02-28'
  and private.recurring_month_anchor(date '2027-01-31', 2) = date '2027-03-31'
  and private.recurring_month_anchor(date '2028-01-31', 1) = date '2028-02-29'
where check_name = 'monthly_short_month_clamps_without_drift';

update ret2_checks set passed =
  private.recurring_period_end('weekly', date '2027-01-06', date '2027-01-20') = date '2027-01-27'
where check_name = 'weekly_anchor_and_half_open_window_are_exact';

update ret2_checks set passed = coalesce((
  select bool_and(class.relrowsecurity)
  from pg_class class
  where class.oid = any(array[
    'public.recurring_work_occurrences'::regclass,
    'public.recurring_work_generation_attempts'::regclass
  ])
), false) where check_name = 'all_ret2_tables_have_rls';

update ret2_checks set passed = (
  with expected(table_name, policy_name) as (values
    ('recurring_work_occurrences', 'Team can read organization recurring occurrences'),
    ('recurring_work_generation_attempts', 'Team can read organization recurring generation attempts')
  )
  select count(*) = 2 and bool_and(
    policy.polcmd = 'r'
    and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
    and pg_get_expr(policy.polqual, policy.polrelid) like '%is_team_organization_member%'
    and policy.polwithcheck is null
  )
  from expected
  join pg_class class on class.relname = expected.table_name
  join pg_namespace namespace on namespace.oid = class.relnamespace and namespace.nspname = 'public'
  join pg_policy policy on policy.polrelid = class.oid and policy.polname = expected.policy_name
) where check_name = 'rls_select_policies_are_exact';

update ret2_checks set passed = not exists (
  select 1 from pg_policy policy
  where policy.polrelid = any(array[
    'public.recurring_work_occurrences'::regclass,
    'public.recurring_work_generation_attempts'::regclass
  ]) and policy.polcmd <> 'r'
) and (
  select count(*) from pg_policy policy
  where policy.polrelid = any(array[
    'public.recurring_work_occurrences'::regclass,
    'public.recurring_work_generation_attempts'::regclass
  ])
) = 2 where check_name = 'rls_write_policies_are_absent';

update ret2_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  tables(table_name) as (values
    ('public.recurring_work_occurrences'),
    ('public.recurring_work_generation_attempts')
  ), privileges(privilege_name) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')),
  matrix as (
    select role_name, table_name, privilege_name,
      case
        when role_name = 'authenticated' then privilege_name = 'SELECT'
        when role_name = 'service_role' then privilege_name in ('SELECT', 'INSERT')
        else false
      end as expected
    from roles cross join tables cross join privileges
  )
  select count(*) = 24 and bool_and(
    has_table_privilege(role_name, table_name, privilege_name) = expected
  ) from matrix
) where check_name = 'table_acl_matrix_is_exact';

update ret2_checks set passed = (
  with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
  functions(signature) as (values
    ('public.preview_recurring_work_period(uuid,date,text,uuid)'),
    ('public.confirm_recurring_work_period(uuid,date,uuid,text,uuid)')
  ), matrix as (
    select role_name, signature, role_name = 'service_role' as expected
    from roles cross join functions
  )
  select count(*) = 6 and bool_and(
    has_function_privilege(role_name, signature, 'EXECUTE') = expected
  ) from matrix
) where check_name = 'rpc_acl_matrix_is_exact';

update ret2_checks set passed = coalesce((
  select count(*) = 2 and bool_and(not procedure.prosecdef)
  from pg_proc procedure
  where procedure.oid = any(array[
    'public.preview_recurring_work_period(uuid,date,text,uuid)'::regprocedure,
    'public.confirm_recurring_work_period(uuid,date,uuid,text,uuid)'::regprocedure
  ])
), false) where check_name = 'server_actions_are_invoker_only';

update ret2_checks set passed = (
  with expected(constraint_name, child_table, child_columns, parent_table, parent_columns) as (values
    ('recurring_occurrences_plan_org_fk', 'public.recurring_work_occurrences'::regclass,
      array['plan_id','organization_id'], 'public.recurring_work_plans'::regclass,
      array['id','organization_id']),
    ('recurring_occurrences_version_plan_org_fk', 'public.recurring_work_occurrences'::regclass,
      array['plan_version_id','plan_id','organization_id'], 'public.recurring_work_plan_versions'::regclass,
      array['id','plan_id','organization_id']),
    ('recurring_occurrences_engagement_project_org_fk', 'public.recurring_work_occurrences'::regclass,
      array['engagement_id','project_id','organization_id'], 'public.engagements'::regclass,
      array['id','project_id','organization_id']),
    ('recurring_occurrences_service_scope_fk', 'public.recurring_work_occurrences'::regclass,
      array['engagement_service_id','engagement_id','service_id','organization_id'], 'public.engagement_services'::regclass,
      array['id','engagement_id','service_id','organization_id']),
    ('recurring_attempts_occurrence_scope_fk', 'public.recurring_work_generation_attempts'::regclass,
      array['occurrence_id','plan_id','plan_version_id','organization_id'], 'public.recurring_work_occurrences'::regclass,
      array['id','plan_id','plan_version_id','organization_id']),
    ('work_items_recurring_occurrence_scope_fk', 'public.work_items'::regclass,
      array['recurring_occurrence_id','recurring_plan_id','recurring_plan_version_id','organization_id'],
      'public.recurring_work_occurrences'::regclass, array['id','plan_id','plan_version_id','organization_id']),
    ('work_items_recurring_version_scope_fk', 'public.work_items'::regclass,
      array['recurring_plan_version_id','recurring_plan_id','organization_id'],
      'public.recurring_work_plan_versions'::regclass, array['id','plan_id','organization_id'])
  )
  select count(*) = 7 and bool_and(
    constraint_record.contype = 'f' and constraint_record.confrelid = expected.parent_table
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(constraint_record.conkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = constraint_record.conrelid and attribute.attnum = key.attnum) = expected.child_columns
    and (select array_agg(attribute.attname::text order by key.ordinality)
      from unnest(constraint_record.confkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = constraint_record.confrelid and attribute.attnum = key.attnum) = expected.parent_columns
  )
  from expected
  join pg_constraint constraint_record on constraint_record.conname = expected.constraint_name
    and constraint_record.conrelid = expected.child_table
) where check_name = 'tenant_composite_foreign_keys_are_exact';

update ret2_checks set passed = (
  with expected(index_name, table_oid) as (values
    ('idx_recurring_occurrences_plan_org_fk', 'public.recurring_work_occurrences'::regclass),
    ('idx_recurring_occurrences_version_plan_org_fk', 'public.recurring_work_occurrences'::regclass),
    ('idx_recurring_occurrences_engagement_project_org_fk', 'public.recurring_work_occurrences'::regclass),
    ('idx_recurring_occurrences_service_scope_fk', 'public.recurring_work_occurrences'::regclass),
    ('idx_recurring_attempts_occurrence_scope_fk', 'public.recurring_work_generation_attempts'::regclass),
    ('idx_work_items_recurring_occurrence_fk', 'public.work_items'::regclass),
    ('idx_work_items_recurring_version_fk', 'public.work_items'::regclass)
  )
  select count(*) = 7 and bool_and(index_record.indisvalid)
  from expected
  join pg_class index_class on index_class.relname = expected.index_name and index_class.relkind = 'i'
  join pg_index index_record on index_record.indexrelid = index_class.oid
    and index_record.indrelid = expected.table_oid
) where check_name = 'tenant_foreign_key_indexes_are_exact';

update ret2_checks set passed = (
  with expected(trigger_name, table_oid) as (values
    ('protect_recurring_occurrences', 'public.recurring_work_occurrences'::regclass),
    ('protect_recurring_generation_attempts', 'public.recurring_work_generation_attempts'::regclass),
    ('protect_work_item_recurring_provenance', 'public.work_items'::regclass)
  )
  select count(*) = 3 and bool_and(not trigger_record.tgisinternal)
  from expected
  join pg_trigger trigger_record on trigger_record.tgname = expected.trigger_name
    and trigger_record.tgrelid = expected.table_oid
) where check_name = 'append_only_guards_are_exact';

update ret2_checks set passed = coalesce((
  select pg_get_constraintdef(constraint_record.oid) like '%recurring_plan%'
    and pg_get_constraintdef(constraint_record.oid) like '%ai_chat_proposal%'
    and pg_get_constraintdef(constraint_record.oid) like '%automation_rule%'
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.work_items'::regclass
    and constraint_record.conname = 'work_items_created_via_check'
), false) where check_name = 'created_via_vocabulary_is_extended_once';

update ret2_checks set passed =
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'public.confirm_recurring_work_period(uuid,date,uuid,text,uuid)'::regprocedure)) > 0
  and position('cron.schedule' in pg_get_functiondef(
    'public.confirm_recurring_work_period(uuid,date,uuid,text,uuid)'::regprocedure)) = 0
where check_name = 'no_scheduler_surface_exists';

create or replace function private.ret2_verifier_fail_second_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.created_via = 'recurring_plan' and new.recurring_template_key = 'second_item' then
    raise exception 'RET2 verifier injected work-item failure.';
  end if;
  return new;
end;
$$;

do $$
declare
  v_org_id uuid;
  v_department_id text;
  v_service_owner uuid := gen_random_uuid();
  v_project_owner uuid := gen_random_uuid();
  v_wrong_actor uuid := gen_random_uuid();
  v_client_id uuid;
  v_agency_client_id uuid;
  v_brand_id uuid;
  v_project_id uuid;
  v_engagement_id uuid;
  v_service_id uuid;
  v_engagement_service_id uuid;
  v_plan public.recurring_work_plans;
  v_past_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
  v_past_version public.recurring_work_plan_versions;
  v_preview jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_replay jsonb;
  v_occurrence public.recurring_work_occurrences;
  v_attempt public.recurring_work_generation_attempts;
  v_work_item public.work_items;
  v_anchor date := current_date + 70;
  v_request_key uuid := gen_random_uuid();
  v_replay_key uuid := gen_random_uuid();
  v_failure_key uuid := gen_random_uuid();
  v_template jsonb;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_before_occurrences bigint;
  v_before_items bigint;
  v_before_events bigint;
begin
  select department.organization_id, department.id into v_org_id, v_department_id
  from public.departments department
  join public.organizations organization on organization.id = department.organization_id
  where organization.status = 'active'
  order by department.created_at, department.id limit 1;
  if v_org_id is null then return; end if;

  insert into auth.users (id) values (v_service_owner), (v_project_owner), (v_wrong_actor);
  insert into public.organization_memberships
    (organization_id, user_id, member_kind, role, department_id, status)
  values
    (v_org_id, v_service_owner, 'team', 'contributor', v_department_id, 'active'),
    (v_org_id, v_project_owner, 'team', 'project_owner', v_department_id, 'active'),
    (v_org_id, v_wrong_actor, 'team', 'contributor', v_department_id, 'active');

  insert into public.clients (name, company, owner_id, organization_id)
  values ('RET2 client ' || v_suffix, 'RET2', v_project_owner, v_org_id) returning id into v_client_id;
  insert into public.agency_clients
    (organization_id, legacy_client_id, canonical_client_id, name, owner_id, created_by)
  values (v_org_id, v_client_id, v_client_id, 'RET2 agency client ' || v_suffix,
    v_project_owner, v_service_owner) returning id into v_agency_client_id;
  insert into public.brands (organization_id, client_id, name, is_default, created_by)
  values (v_org_id, v_agency_client_id, 'RET2 brand ' || v_suffix, true, v_service_owner)
  returning id into v_brand_id;
  insert into public.projects
    (name, department_id, status, owner_id, organization_id, client_id, engagement_type)
  values ('RET2 project ' || v_suffix, v_department_id, 'active', v_project_owner,
    v_org_id, v_client_id, 'retainer') returning id into v_project_id;
  insert into public.engagements
    (organization_id, client_id, brand_id, legacy_project_id, project_id, name,
     engagement_type, status, lead_owner_id, created_by)
  values (v_org_id, v_agency_client_id, v_brand_id, v_project_id, v_project_id,
    'RET2 engagement ' || v_suffix, 'retainer', 'active', v_project_owner, v_service_owner)
  returning id into v_engagement_id;
  insert into public.service_catalog (organization_id, department_id, slug, name)
  values (v_org_id, v_department_id, 'ret2_' || v_suffix, 'RET2 service')
  returning id into v_service_id;
  insert into public.engagement_services
    (organization_id, engagement_id, service_id, owner_id, status, activated_by)
  values (v_org_id, v_engagement_id, v_service_id, v_service_owner, 'active', v_service_owner)
  returning id into v_engagement_service_id;

  update ret2_checks set passed = true where check_name = 'fixture_prerequisites_available';
  v_template := jsonb_build_array(
    jsonb_build_object('template_key', 'first_item', 'title', 'First item',
      'default_assignee_id', v_service_owner, 'start_offset_days', 0, 'due_offset_days', 2, 'position', 0),
    jsonb_build_object('template_key', 'second_item', 'title', 'Second item',
      'default_assignee_id', v_project_owner, 'start_offset_days', 1, 'due_offset_days', 3, 'position', 1)
  );
  v_plan := public.create_recurring_work_plan(
    v_engagement_service_id, 'RET2 weekly plan', 'Verifier', 'weekly', 'Asia/Karachi',
    v_anchor, null, '{}'::jsonb, v_template, v_service_owner
  );
  select * into v_version from public.recurring_work_plan_versions where plan_id = v_plan.id;
  v_plan := public.approve_recurring_work_plan_version(v_plan.id, v_version.id, 'Approved', v_project_owner);
  v_plan := public.transition_recurring_work_plan(v_plan.id, 'active', '', '', v_project_owner);

  select count(*) into v_before_occurrences from public.recurring_work_occurrences where plan_id = v_plan.id;
  v_preview := public.preview_recurring_work_period(v_plan.id, v_anchor, '', v_service_owner);
  update ret2_checks set passed =
    (v_preview->>'eligible')::boolean
    and (v_preview->>'period_start')::date = v_anchor
    and (v_preview->>'period_end')::date = v_anchor + 7
    and v_preview->>'timezone' = 'Asia/Karachi'
    and jsonb_array_length(v_preview->'template_items') = 2
    and (select count(*) from public.recurring_work_occurrences where plan_id = v_plan.id) = v_before_occurrences
  where check_name = 'preview_is_read_only_and_returns_exact_dates';

  v_result := public.confirm_recurring_work_period(v_plan.id, v_anchor, v_request_key, '', v_service_owner);
  select * into v_occurrence from public.recurring_work_occurrences
    where plan_id = v_plan.id and period_start = v_anchor;
  update ret2_checks set passed =
    v_result->>'occurrence_id' = v_occurrence.id::text
    and v_occurrence.plan_version_id = v_version.id
    and v_occurrence.period_end = v_anchor + 7
    and v_occurrence.timezone = 'Asia/Karachi'
    and jsonb_array_length(v_result->'work_items') = 2
  where check_name = 'service_owner_can_confirm_one_period';

  update ret2_checks set passed = (
    select count(*) = 2 and bool_and(
      work_item.organization_id = v_org_id and work_item.project_id = v_project_id
      and work_item.engagement_id = v_engagement_id and work_item.created_via = 'recurring_plan'
      and work_item.recurring_plan_id = v_plan.id
      and work_item.recurring_plan_version_id = v_version.id
      and work_item.status = 'not_started' and work_item.deleted_at is null
    ) from public.work_items work_item where work_item.recurring_occurrence_id = v_occurrence.id
  ) where check_name = 'generated_work_is_canonical_and_complete';

  v_retry := public.confirm_recurring_work_period(v_plan.id, v_anchor, v_request_key, '', v_service_owner);
  update ret2_checks set passed =
    v_retry->>'occurrence_id' = v_result->>'occurrence_id'
    and v_retry->'work_items' = v_result->'work_items'
    and (select count(*) from public.recurring_work_occurrences where plan_id = v_plan.id and period_start = v_anchor) = 1
    and (select count(*) from public.recurring_work_generation_attempts where request_key = v_request_key) = 1
  where check_name = 'same_request_replays_identical_ids';

  v_replay := public.confirm_recurring_work_period(v_plan.id, v_anchor, v_replay_key, '', v_service_owner);
  update ret2_checks set passed =
    v_replay->>'occurrence_id' = v_result->>'occurrence_id'
    and v_replay->'work_items' = v_result->'work_items'
    and (select count(*) from public.recurring_work_generation_attempts
      where occurrence_id = v_occurrence.id) = 2
    and (select outcome from public.recurring_work_generation_attempts where request_key = v_replay_key) = 'replayed'
  where check_name = 'new_request_same_period_replays_one_occurrence';

  begin
    perform public.confirm_recurring_work_period(v_plan.id, v_anchor + 7, v_request_key, '', v_service_owner);
  exception when sqlstate '22023' then
    update ret2_checks set passed = true where check_name = 'request_key_cannot_change_business_target';
  end;
  begin
    perform public.confirm_recurring_work_period(v_plan.id, v_anchor + 7, gen_random_uuid(), '', v_wrong_actor);
  exception when sqlstate '42501' then
    update ret2_checks set passed = true where check_name = 'wrong_actor_is_rejected';
  end;

  v_preview := public.preview_recurring_work_period(v_plan.id, v_anchor + 1, '', v_service_owner);
  update ret2_checks set passed =
    v_preview->'reasons' ? 'period_start_is_not_canonical'
  where check_name = 'noncanonical_period_is_rejected';

  v_plan := public.transition_recurring_work_plan(v_plan.id, 'paused', 'Verifier pause', '', v_project_owner);
  v_preview := public.preview_recurring_work_period(v_plan.id, v_anchor + 7, '', v_service_owner);
  begin
    perform public.confirm_recurring_work_period(v_plan.id, v_anchor + 7, gen_random_uuid(), '', v_service_owner);
  exception when sqlstate '22023' then
    update ret2_checks set passed = v_preview->'reasons' ? 'plan_not_active'
      where check_name = 'inactive_plan_is_rejected';
  end;
  v_plan := public.transition_recurring_work_plan(v_plan.id, 'active', '', '', v_project_owner);

  v_past_plan := public.create_recurring_work_plan(
    v_engagement_service_id, 'RET2 past plan', 'Verifier', 'weekly', 'UTC',
    current_date - 14, null, '{}'::jsonb, v_template, v_service_owner
  );
  select * into v_past_version from public.recurring_work_plan_versions where plan_id = v_past_plan.id;
  v_past_plan := public.approve_recurring_work_plan_version(
    v_past_plan.id, v_past_version.id, 'Approved', v_project_owner
  );
  v_past_plan := public.transition_recurring_work_plan(v_past_plan.id, 'active', '', '', v_project_owner);
  v_preview := public.preview_recurring_work_period(v_past_plan.id, current_date - 7, '', v_service_owner);
  update ret2_checks set passed =
    v_preview->'reasons' ? 'past_period_reason_required'
    and (public.preview_recurring_work_period(
      v_past_plan.id, current_date - 7, 'Approved recovery', v_service_owner
    )->>'eligible')::boolean
  where check_name = 'past_period_requires_reason';

  execute 'create trigger ret2_verifier_injected_failure before insert on public.work_items
    for each row execute function private.ret2_verifier_fail_second_item()';
  select count(*) into v_before_occurrences from public.recurring_work_occurrences where plan_id = v_plan.id;
  select count(*) into v_before_items from public.work_items where recurring_plan_id = v_plan.id;
  select count(*) into v_before_events from public.engagement_events
    where engagement_id = v_engagement_id and payload->>'request_key' = v_failure_key::text;
  begin
    perform public.confirm_recurring_work_period(v_plan.id, v_anchor + 7, v_failure_key, '', v_service_owner);
  exception when raise_exception then
    update ret2_checks set passed =
      (select count(*) from public.recurring_work_occurrences where plan_id = v_plan.id) = v_before_occurrences
      and (select count(*) from public.work_items where recurring_plan_id = v_plan.id) = v_before_items
      and (select count(*) from public.recurring_work_generation_attempts where request_key = v_failure_key) = 0
      and (select count(*) from public.engagement_events
        where engagement_id = v_engagement_id and payload->>'request_key' = v_failure_key::text) = v_before_events
    where check_name = 'partial_failure_rolls_back_every_business_row';
  end;
  execute 'drop trigger ret2_verifier_injected_failure on public.work_items';

  select * into v_attempt from public.recurring_work_generation_attempts where request_key = v_request_key;
  select * into v_work_item from public.work_items
    where recurring_occurrence_id = v_occurrence.id order by position limit 1;
  begin
    update public.recurring_work_occurrences set timezone = 'UTC' where id = v_occurrence.id;
  exception when sqlstate '55000' then
    update ret2_checks set passed = true where check_name = 'occurrences_are_append_only';
  end;
  begin
    delete from public.recurring_work_generation_attempts where id = v_attempt.id;
  exception when sqlstate '55000' then
    update ret2_checks set passed = true where check_name = 'attempts_are_append_only';
  end;
  begin
    update public.work_items set recurring_template_key = 'changed' where id = v_work_item.id;
  exception when sqlstate '55000' then
    update ret2_checks set passed = true where check_name = 'work_item_provenance_is_immutable';
  end;

  update ret2_checks set passed =
    (select count(*) = 1 and bool_and(
      event.actor_id = v_service_owner
      and event.payload->>'plan_id' = v_plan.id::text
      and event.payload->>'plan_version_id' = v_version.id::text
      and event.payload->>'occurrence_id' = v_occurrence.id::text
      and event.payload->>'request_key' = v_request_key::text
      and event.payload->>'created_via' = 'recurring_plan'
    ) from public.engagement_events event
    where event.engagement_id = v_engagement_id
      and event.event_type = 'recurring_period_generated'
      and event.payload->>'request_key' = v_request_key::text)
    and (select count(*) = 2 from public.engagement_events event
      where event.engagement_id = v_engagement_id and event.event_type = 'work_item_created'
        and event.payload->>'request_key' = v_request_key::text
        and event.payload->>'created_via' = 'recurring_plan')
  where check_name = 'generation_audit_payload_is_exact';
end;
$$;

select jsonb_object_agg(check_name, passed order by check_name)
  as ret2_manual_period_generation_verification
from ret2_checks;

do $$
begin
  if exists (select 1 from ret2_checks where not passed) then
    raise exception 'RET2 verification failed: %', (
      select string_agg(check_name, ', ' order by check_name)
      from ret2_checks where not passed
    );
  end if;
end;
$$;

rollback;
