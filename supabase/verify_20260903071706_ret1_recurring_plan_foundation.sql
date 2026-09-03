-- RET1 rollback-safe verification. Run only after the matching migration is applied.
begin;

create temporary table ret1_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

insert into ret1_checks values
  ('canonical_plan_ownership_is_consistent', not exists (
    select 1 from public.recurring_work_plans plan
    left join public.engagements engagement
      on engagement.id = plan.engagement_id and engagement.project_id = plan.project_id
     and engagement.organization_id = plan.organization_id
    left join public.engagement_services service
      on service.id = plan.engagement_service_id and service.engagement_id = plan.engagement_id
     and service.service_id = plan.service_id and service.organization_id = plan.organization_id
    where engagement.id is null or service.id is null or engagement.engagement_type <> 'retainer'
  )),
  ('approved_pointer_has_append_only_approval', not exists (
    select 1 from public.recurring_work_plans plan
    left join public.recurring_work_plan_version_approvals approval
      on approval.plan_version_id = plan.approved_version_id
     and approval.plan_id = plan.id and approval.organization_id = plan.organization_id
    where plan.approved_version_id is not null and approval.id is null
  )),
  ('all_content_tables_have_rls', (
    select bool_and(class.relrowsecurity) from pg_class class where class.oid = any(array[
      'public.recurring_work_plans'::regclass,
      'public.recurring_work_plan_versions'::regclass,
      'public.recurring_work_plan_template_items'::regclass,
      'public.recurring_work_plan_version_approvals'::regclass
    ])
  )),
  ('browser_tables_are_read_only',
    has_table_privilege('authenticated', 'public.recurring_work_plans', 'SELECT')
    and not has_table_privilege('authenticated', 'public.recurring_work_plans', 'INSERT')
    and not has_table_privilege('authenticated', 'public.recurring_work_plan_versions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.recurring_work_plan_template_items', 'DELETE')
    and not has_table_privilege('anon', 'public.recurring_work_plans', 'SELECT')
  ),
  ('server_actions_are_invoker_only', (
    select bool_and(not procedure.prosecdef) from pg_proc procedure where procedure.oid = any(array[
      'public.create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure,
      'public.create_recurring_work_plan_version(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure,
      'public.approve_recurring_work_plan_version(uuid,uuid,text,uuid)'::regprocedure,
      'public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)'::regprocedure,
      'public.transition_recurring_work_plan(uuid,text,text,text,uuid)'::regprocedure
    ])
  )),
  ('browser_cannot_execute_server_actions',
    not has_function_privilege('authenticated',
      'public.create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('anon',
      'public.transition_recurring_work_plan(uuid,text,text,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
      'public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)', 'EXECUTE')
  ),
  ('service_role_has_narrow_action_access',
    has_function_privilege('service_role',
      'public.create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role',
      'public.approve_recurring_work_plan_version(uuid,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role',
      'public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)', 'EXECUTE')
    and not has_table_privilege('service_role', 'public.recurring_work_plan_versions', 'UPDATE')
    and not has_table_privilege('service_role', 'public.recurring_work_plan_template_items', 'DELETE')
  ),
  ('relationship_authority_is_exact',
    position('v_service.owner_id is distinct from p_actor_id' in pg_get_functiondef(
      'public.create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure)) > 0
    and position('v_project_owner_id is distinct from p_actor_id' in pg_get_functiondef(
      'public.approve_recurring_work_plan_version(uuid,uuid,text,uuid)'::regprocedure)) > 0
    and position('membership.role = ''department_manager''' in pg_get_functiondef(
      'public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)'::regprocedure)) > 0
    and position('membership.department_id = v_department_id' in pg_get_functiondef(
      'public.reassign_recurring_plan_template_item(uuid,text,uuid,uuid)'::regprocedure)) > 0
  ),
  ('tenant_composite_constraints_exist', (
    select count(*) >= 4 from pg_constraint constraint_record
    where constraint_record.conrelid = any(array[
      'public.recurring_work_plans'::regclass,
      'public.recurring_work_plan_versions'::regclass,
      'public.recurring_work_plan_template_items'::regclass,
      'public.recurring_work_plan_version_approvals'::regclass
    ]) and constraint_record.contype = 'f'
      and pg_get_constraintdef(constraint_record.oid) like '%organization_id%'
  )),
  ('tenant_foreign_key_indexes_exist', (
    select count(*) = 3 from pg_class index_record
    where index_record.relkind = 'i' and index_record.relname in (
      'idx_recurring_work_plans_engagement_project_org_fk',
      'idx_recurring_work_plans_service_scope_fk',
      'idx_recurring_template_items_version_plan_org_fk'
    )
  )),
  ('audit_vocabulary_is_complete', (
    select pg_get_constraintdef(constraint_record.oid) like all (array[
      '%recurring_plan_created%', '%recurring_plan_version_created%',
      '%recurring_plan_version_approved%', '%recurring_plan_status_changed%'
    ]) from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.engagement_events'::regclass
      and constraint_record.conname = 'engagement_events_event_type_check'
  )),
  ('append_only_guards_exist', (
    select count(*) = 4 from pg_trigger trigger_record
    where trigger_record.tgname in (
      'protect_recurring_plan_header', 'protect_recurring_plan_versions',
      'protect_recurring_plan_template_items', 'protect_recurring_plan_version_approvals'
    ) and not trigger_record.tgisinternal
  )),
  ('only_v1_frequencies_are_allowed', exists (
    select 1 from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.recurring_work_plan_versions'::regclass
      and pg_get_constraintdef(constraint_record.oid) like '%weekly%monthly%'
  )),
  ('no_occurrence_or_scheduler_tables_added', not exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and (table_name like 'recurring%occurrence%' or table_name like 'recurring%schedule%')
  ));

select jsonb_object_agg(check_name, passed order by check_name)
  as ret1_recurring_plan_foundation_verification
from ret1_checks;

do $$
begin
  if exists (select 1 from ret1_checks where not passed) then
    raise exception 'RET1 verification failed.';
  end if;
end;
$$;

rollback;
