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
})

test('RET1 verifier is rollback-safe and fails closed on named security checks', () => {
  assert.match(verifier, /^begin;/m)
  assert.match(verifier, /browser_tables_are_read_only/)
  assert.match(verifier, /server_actions_are_invoker_only/)
  assert.match(verifier, /browser_cannot_execute_server_actions/)
  assert.match(verifier, /raise exception 'RET1 verification failed.'/)
  assert.match(verifier, /rollback;\s*$/)
  assert.doesNotMatch(verifier, /commit;/i)
})
