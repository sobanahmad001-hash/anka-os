begin;

create temp table ret3_checks (
  check_name text primary key,
  passed boolean not null default false
) on commit drop;

insert into ret3_checks (check_name) values
  ('rpc_exists_and_is_stable_invoker'),
  ('rpc_acl_is_service_role_only'),
  ('month_start_must_be_first_day'),
  ('weekly_period_starts_in_selected_month'),
  ('monthly_short_month_anchor_does_not_drift'),
  ('preview_matches_ret2_period_contract'),
  ('preview_is_read_only'),
  ('wrong_actor_is_rejected'),
  ('no_approved_version_is_explicit');

update ret3_checks set passed = exists (
  select 1
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'preview_recurring_work_month'
    and pg_get_function_identity_arguments(procedure.oid) = 'p_plan_id uuid, p_month_start date, p_past_period_reason text, p_actor_id uuid'
    and procedure.provolatile = 's'
    and not procedure.prosecdef
) where check_name = 'rpc_exists_and_is_stable_invoker';

update ret3_checks set passed =
  has_function_privilege('service_role',
    'public.preview_recurring_work_month(uuid,date,text,uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.preview_recurring_work_month(uuid,date,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.preview_recurring_work_month(uuid,date,text,uuid)', 'execute')
where check_name = 'rpc_acl_is_service_role_only';

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
  v_weekly_plan public.recurring_work_plans;
  v_weekly_version public.recurring_work_plan_versions;
  v_monthly_plan public.recurring_work_plans;
  v_monthly_version public.recurring_work_plan_versions;
  v_draft_plan public.recurring_work_plans;
  v_week_preview jsonb;
  v_month_preview jsonb;
  v_march_preview jsonb;
  v_single_preview jsonb;
  v_draft_preview jsonb;
  v_template jsonb;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_before_occurrences bigint;
  v_before_attempts bigint;
  v_before_work_items bigint;
begin
  select department.organization_id, department.id into v_org_id, v_department_id
  from public.departments department
  join public.organizations organization on organization.id = department.organization_id
  where organization.status = 'active'
  order by department.created_at, department.id
  limit 1;
  if v_org_id is null then return; end if;

  insert into auth.users (id) values (v_service_owner), (v_project_owner), (v_wrong_actor);
  insert into public.organization_memberships
    (organization_id, user_id, member_kind, role, department_id, status)
  values
    (v_org_id, v_service_owner, 'team', 'contributor', v_department_id, 'active'),
    (v_org_id, v_project_owner, 'team', 'project_owner', v_department_id, 'active'),
    (v_org_id, v_wrong_actor, 'team', 'contributor', v_department_id, 'active');

  insert into public.clients (name, company, owner_id, organization_id)
  values ('RET3 client ' || v_suffix, 'RET3', v_project_owner, v_org_id)
  returning id into v_client_id;
  insert into public.agency_clients
    (organization_id, legacy_client_id, canonical_client_id, name, owner_id, created_by)
  values (
    v_org_id, v_client_id, v_client_id, 'RET3 agency client ' || v_suffix,
    v_project_owner, v_service_owner
  ) returning id into v_agency_client_id;
  insert into public.brands (organization_id, client_id, name, is_default, created_by)
  values (v_org_id, v_agency_client_id, 'RET3 brand ' || v_suffix, true, v_service_owner)
  returning id into v_brand_id;
  insert into public.projects
    (name, department_id, status, owner_id, organization_id, client_id, engagement_type)
  values (
    'RET3 project ' || v_suffix, v_department_id, 'active', v_project_owner,
    v_org_id, v_client_id, 'retainer'
  ) returning id into v_project_id;
  insert into public.engagements
    (organization_id, client_id, brand_id, legacy_project_id, project_id, name,
     engagement_type, status, lead_owner_id, created_by)
  values (
    v_org_id, v_agency_client_id, v_brand_id, v_project_id, v_project_id,
    'RET3 engagement ' || v_suffix, 'retainer', 'active', v_project_owner, v_service_owner
  ) returning id into v_engagement_id;
  insert into public.service_catalog (organization_id, department_id, slug, name)
  values (v_org_id, v_department_id, 'ret3_' || v_suffix, 'RET3 service')
  returning id into v_service_id;
  insert into public.engagement_services
    (organization_id, engagement_id, service_id, owner_id, status, activated_by)
  values (v_org_id, v_engagement_id, v_service_id, v_service_owner, 'active', v_service_owner)
  returning id into v_engagement_service_id;

  v_template := jsonb_build_array(
    jsonb_build_object(
      'template_key', 'monthly_commitment',
      'title', 'Monthly commitment',
      'default_assignee_id', v_service_owner,
      'start_offset_days', 0,
      'due_offset_days', 2,
      'position', 0
    )
  );

  v_weekly_plan := public.create_recurring_work_plan(
    v_engagement_service_id, 'RET3 weekly plan', 'Verifier', 'weekly', 'Asia/Karachi',
    date '2030-01-07', null, '{}'::jsonb, v_template, v_service_owner
  );
  select * into v_weekly_version
  from public.recurring_work_plan_versions where plan_id = v_weekly_plan.id;
  v_weekly_plan := public.approve_recurring_work_plan_version(
    v_weekly_plan.id, v_weekly_version.id, 'Approved', v_project_owner
  );
  v_weekly_plan := public.transition_recurring_work_plan(
    v_weekly_plan.id, 'active', '', '', v_project_owner
  );

  v_monthly_plan := public.create_recurring_work_plan(
    v_engagement_service_id, 'RET3 monthly plan', 'Verifier', 'monthly', 'America/New_York',
    date '2030-01-31', null, '{}'::jsonb, v_template, v_service_owner
  );
  select * into v_monthly_version
  from public.recurring_work_plan_versions where plan_id = v_monthly_plan.id;
  v_monthly_plan := public.approve_recurring_work_plan_version(
    v_monthly_plan.id, v_monthly_version.id, 'Approved', v_project_owner
  );
  v_monthly_plan := public.transition_recurring_work_plan(
    v_monthly_plan.id, 'active', '', '', v_project_owner
  );

  v_draft_plan := public.create_recurring_work_plan(
    v_engagement_service_id, 'RET3 draft plan', 'Verifier', 'monthly', 'UTC',
    date '2030-01-15', null, '{}'::jsonb, v_template, v_service_owner
  );

  begin
    perform public.preview_recurring_work_month(
      v_weekly_plan.id, date '2030-02-02', '', v_service_owner
    );
  exception when sqlstate '22023' then
    update ret3_checks set passed = true where check_name = 'month_start_must_be_first_day';
  end;

  select count(*) into v_before_occurrences from public.recurring_work_occurrences;
  select count(*) into v_before_attempts from public.recurring_work_generation_attempts;
  select count(*) into v_before_work_items from public.work_items;

  v_week_preview := public.preview_recurring_work_month(
    v_weekly_plan.id, date '2030-02-01', '', v_service_owner
  );
  update ret3_checks set passed =
    v_week_preview->>'membership_rule' = 'period_start_in_month'
    and jsonb_array_length(v_week_preview->'periods') = 4
    and not exists (
      select 1 from jsonb_array_elements(v_week_preview->'periods') period
      where left(period->>'period_start', 7) <> '2030-02'
    )
    and (v_week_preview->'periods'->0->>'period_start')::date = date '2030-02-04'
    and (v_week_preview->'periods'->3->>'period_start')::date = date '2030-02-25'
  where check_name = 'weekly_period_starts_in_selected_month';

  v_single_preview := public.preview_recurring_work_period(
    v_weekly_plan.id, date '2030-02-04', '', v_service_owner
  );
  update ret3_checks set passed =
    v_week_preview->'periods'->0 = v_single_preview
  where check_name = 'preview_matches_ret2_period_contract';

  update ret3_checks set passed =
    (select count(*) from public.recurring_work_occurrences) = v_before_occurrences
    and (select count(*) from public.recurring_work_generation_attempts) = v_before_attempts
    and (select count(*) from public.work_items) = v_before_work_items
  where check_name = 'preview_is_read_only';

  v_month_preview := public.preview_recurring_work_month(
    v_monthly_plan.id, date '2030-02-01', '', v_service_owner
  );
  v_march_preview := public.preview_recurring_work_month(
    v_monthly_plan.id, date '2030-03-01', '', v_service_owner
  );
  update ret3_checks set passed =
    jsonb_array_length(v_month_preview->'periods') = 1
    and (v_month_preview->'periods'->0->>'period_start')::date = date '2030-02-28'
    and (v_month_preview->'periods'->0->>'timezone') = 'America/New_York'
    and (v_march_preview->'periods'->0->>'period_start')::date = date '2030-03-31'
  where check_name = 'monthly_short_month_anchor_does_not_drift';

  begin
    perform public.preview_recurring_work_month(
      v_weekly_plan.id, date '2030-02-01', '', v_wrong_actor
    );
  exception when sqlstate '42501' then
    update ret3_checks set passed = true where check_name = 'wrong_actor_is_rejected';
  end;

  v_draft_preview := public.preview_recurring_work_month(
    v_draft_plan.id, date '2030-02-01', '', v_service_owner
  );
  update ret3_checks set passed =
    jsonb_array_length(v_draft_preview->'periods') = 0
    and v_draft_preview->'reasons' ? 'no_approved_effective_version'
  where check_name = 'no_approved_version_is_explicit';
end;
$$;

select jsonb_object_agg(check_name, passed order by check_name)
  as ret3_monthly_planning_preview_verification
from ret3_checks;

do $$
begin
  if exists (select 1 from ret3_checks where not passed) then
    raise exception 'RET3 verification failed: %', (
      select string_agg(check_name, ', ' order by check_name)
      from ret3_checks where not passed
    );
  end if;
end;
$$;

rollback;
