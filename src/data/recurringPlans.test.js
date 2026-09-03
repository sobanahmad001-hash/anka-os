import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const repository = readFileSync(new URL('./recurringPlansRepository.js', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260903071706_ret1_recurring_plan_foundation.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260903071706_ret1_recurring_plan_foundation.sql', import.meta.url), 'utf8')

test('repository exposes reads and only the narrow RET1 actions', () => {
  for (const table of ['recurring_work_plans', 'recurring_work_plan_versions',
    'recurring_work_plan_template_items', 'recurring_work_plan_version_approvals']) {
    assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  }
  for (const action of ['create_plan', 'create_version', 'approve_version', 'reassign_template_item', 'transition_plan']) {
    assert.match(repository, new RegExp(`'${action}'`))
  }
  assert.doesNotMatch(repository, /generate|schedule|cron|occurrence/i)
})

test('migration binds plans to canonical ownership and keeps content append-only', () => {
  assert.match(migration, /references public\.engagements\(id, project_id, organization_id\)/)
  assert.match(migration, /references public\.engagement_services\(id, engagement_id, service_id, organization_id\)/)
  assert.match(migration, /Only the current activated service owner can draft a plan version/)
  assert.match(migration, /Only the canonical project owner can approve/)
  assert.match(migration, /Only the service department manager can reassign/)
  assert.match(migration, /versions, template items, and approvals are append-only/)
  assert.match(migration, /engagement_type <> 'retainer'/)
})

test('migration exposes read-only browser access and no generation primitive', () => {
  assert.match(migration, /grant select on public\.recurring_work_plans/)
  assert.doesNotMatch(migration, /grant (insert|update|delete).*to authenticated/i)
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+function|table)[^;]*occurrence/is)
  assert.doesNotMatch(migration, /pg_cron|cron\.schedule/i)
})

test('RET1 tenant constraints, audit vocabulary, and server-only ACLs are explicit', () => {
  assert.match(migration, /unique \(id, engagement_id, service_id, organization_id\)/)
  assert.match(migration, /foreign key \(plan_version_id, plan_id, organization_id\)/)
  assert.match(migration, /idx_recurring_work_plans_service_scope_fk/)
  for (const eventType of ['recurring_plan_created', 'recurring_plan_version_created',
    'recurring_plan_version_approved', 'recurring_plan_status_changed']) {
    assert.match(migration, new RegExp(`'${eventType}'`))
  }
  assert.doesNotMatch(migration, /security definer/i)
  assert.match(migration, /grant execute on function public\.reassign_recurring_plan_template_item[\s\S]*to service_role/)
  assert.match(migration, /membership\.role = 'department_manager'[\s\S]*membership\.department_id = v_department_id/)
  for (const constraintName of [
    'recurring_plans_engagement_project_org_fk',
    'recurring_plans_service_scope_fk',
    'recurring_versions_plan_org_fk',
    'recurring_template_version_plan_org_fk',
    'recurring_approvals_version_plan_org_fk',
    'recurring_work_plans_approved_version_fk',
  ]) {
    assert.match(migration, new RegExp(`constraint ${constraintName}`))
  }
})

test('RET1 verifier exercises representative authority, immutability, and validation behavior', () => {
  for (const checkName of [
    'service_owner_can_create_plan', 'service_owner_can_create_version',
    'project_owner_can_approve_version', 'project_owner_can_transition_lifecycle',
    'department_manager_reassignment_creates_immutable_version',
    'wrong_role_plan_creation_is_rejected', 'wrong_role_approval_is_rejected',
    'cross_organization_actor_is_rejected', 'cross_organization_target_is_rejected',
    'version_update_is_rejected', 'version_delete_is_rejected',
    'template_item_update_is_rejected', 'template_item_delete_is_rejected',
    'approval_update_is_rejected', 'approval_delete_is_rejected',
    'invalid_cadence_is_rejected', 'invalid_timezone_is_rejected',
    'invalid_effective_dates_are_rejected', 'invalid_template_offsets_are_rejected',
    'audit_events_are_created',
  ]) {
    assert.match(verifier, new RegExp(`'${checkName}'`))
  }
  assert.match(verifier, /public\.create_recurring_work_plan\(/)
  assert.match(verifier, /public\.reassign_recurring_plan_template_item\(/)
  assert.match(verifier, /exception when sqlstate '42501'/)
  assert.match(verifier, /exception when sqlstate '55000'/)
})

test('RET1 verifier exhaustively checks catalog security and fails closed after reporting', () => {
  assert.match(verifier, /^begin;/m)
  assert.match(verifier, /table_acl_matrix_is_exact/)
  assert.match(verifier, /count\(\*\) = 48/)
  assert.match(verifier, /rpc_acl_matrix_is_exact/)
  assert.match(verifier, /count\(\*\) = 15/)
  assert.match(verifier, /rls_select_policies_are_exact/)
  assert.match(verifier, /rls_write_policies_are_absent/)
  assert.match(verifier, /server_actions_are_invoker_only/)
  assert.match(verifier, /tenant_composite_foreign_keys_are_exact/)
  assert.match(verifier, /tenant_foreign_key_indexes_are_exact/)
  assert.match(verifier, /select jsonb_object_agg\(check_name, passed order by check_name\)/)
  assert.match(verifier, /raise exception 'RET1 verification failed: %'/)
  assert.match(verifier, /rollback;\s*$/)
  assert.doesNotMatch(verifier, /commit;/i)
})
