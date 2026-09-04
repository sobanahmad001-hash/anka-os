import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const repository = readFileSync(new URL('./recurringPlansRepository.js', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260903071706_ret1_recurring_plan_foundation.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260903071706_ret1_recurring_plan_foundation.sql', import.meta.url), 'utf8')
const ret2Migration = readFileSync(new URL('../../supabase/migrations/20260903123259_ret2_manual_period_generation.sql', import.meta.url), 'utf8')
const ret2Verifier = readFileSync(new URL('../../supabase/verify_20260903123259_ret2_manual_period_generation.sql', import.meta.url), 'utf8')
const ret2Gate = readFileSync(new URL('../../docs/release/RET2_MANUAL_PERIOD_GENERATION_REVIEW_GATE.md', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')

test('repository exposes reads and only the narrow RET1 actions', () => {
  for (const table of ['recurring_work_plans', 'recurring_work_plan_versions',
    'recurring_work_plan_template_items', 'recurring_work_plan_version_approvals']) {
    assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  }
  for (const action of ['create_plan', 'create_version', 'approve_version', 'reassign_template_item', 'transition_plan']) {
    assert.match(repository, new RegExp(`'${action}'`))
  }
  assert.doesNotMatch(repository, /cron|schedulePeriod|bulkGenerate/i)
})

test('recurring-plans is enabled with JWT verification and the exact entrypoint', () => {
  const blocks = [...config.matchAll(/(?:^|\r?\n)\[functions\.recurring-plans\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/g)]
  assert.equal(blocks.length, 1)
  assert.match(blocks[0][1], /^enabled = true$/m)
  assert.match(blocks[0][1], /^verify_jwt = true$/m)
  assert.match(blocks[0][1], /^entrypoint = "\.\/functions\/recurring-plans\/index\.ts"$/m)
  assert.doesNotMatch(blocks[0][1], /^verify_jwt = false$/m)
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
  assert.match(verifier, /insert into auth\.users \(id\) values/)
  assert.doesNotMatch(verifier, /from auth\.users/)
  assert.doesNotMatch(verifier, /on conflict \(organization_id, user_id\) do update/)
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

test('repository exposes only explicit RET2 preview and confirmation actions', () => {
  for (const table of ['recurring_work_occurrences', 'recurring_work_generation_attempts']) {
    assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  }
  assert.match(repository, /invoke\('preview_period'/)
  assert.match(repository, /invoke\('confirm_period'/)
  assert.doesNotMatch(repository, /cron|schedulePeriod|bulkGenerate/i)
})

test('RET2 generation is plan-period idempotent, atomic, and keeps canonical provenance', () => {
  assert.match(ret2Migration, /unique \(organization_id, plan_id, period_start\)/)
  assert.match(ret2Migration, /work_items_recurring_template_unique/)
  assert.match(ret2Migration, /pg_advisory_xact_lock/)
  assert.match(ret2Migration, /created_via[^;]+recurring_plan/s)
  assert.match(ret2Migration, /recurring_occurrence_id/)
  assert.match(ret2Migration, /recurring_plan_version_id/)
  assert.match(ret2Migration, /Recurring period is not eligible/)
  assert.doesNotMatch(ret2Migration, /cron\.schedule|pg_cron|scheduled generation/i)
})

test('RET2 uses plan-aligned half-open periods and preserves monthly anchor after clamping', () => {
  assert.match(ret2Migration, /mod\(p_period_start - p_anchor, 7\)/)
  assert.match(ret2Migration, /private\.recurring_month_anchor\(p_anchor, v_month_offset \+ 1\)/)
  assert.match(ret2Migration, /least\(extract\(day from p_anchor\).*v_last_day\)/s)
  assert.match(ret2Migration, /Exclusive local-date boundary for the half-open occurrence window/)
  assert.match(ret2Migration, /now\(\) at time zone v_version\.timezone/)
})

test('RET2 fails closed on lifecycle, ownership, assignee, and past-period rules', () => {
  for (const reason of [
    'plan_not_active', 'engagement_not_active', 'engagement_service_not_active',
    'service_catalog_not_active', 'template_assignee_not_active',
    'past_period_reason_required', 'period_start_is_not_canonical',
  ]) assert.match(ret2Migration, new RegExp(`'${reason}'`))
  assert.match(ret2Migration, /Only the current activated service owner can generate/)
  assert.match(ret2Migration, /version\.effective_start <= p_period_start/)
  assert.match(ret2Migration, /version\.effective_end is null or version\.effective_end >= p_period_start/)
})

test('RET2 verifier is rollback-safe and names concurrency, atomicity, and security gates', () => {
  for (const checkName of [
    'monthly_short_month_clamps_without_drift',
    'preview_is_read_only_and_returns_exact_dates',
    'same_request_replays_identical_ids',
    'new_request_same_period_replays_one_occurrence',
    'partial_failure_rolls_back_every_business_row',
    'wrong_actor_is_rejected', 'inactive_plan_is_rejected',
    'table_acl_matrix_is_exact', 'rpc_acl_matrix_is_exact',
    'tenant_composite_foreign_keys_are_exact', 'tenant_foreign_key_indexes_are_exact',
  ]) assert.match(ret2Verifier, new RegExp(`'${checkName}'`))
  assert.match(ret2Verifier, /^begin;/m)
  assert.match(ret2Verifier, /raise exception 'RET2 verification failed: %'/)
  assert.match(ret2Verifier, /rollback;\s*$/)
  assert.doesNotMatch(ret2Verifier, /commit;/i)
})

test('RET2 review gate preserves the manual-only release boundary', () => {
  assert.match(ret2Gate, /preview-and-confirm generation for one recurring plan period/)
  assert.match(ret2Gate, /no automatic or bulk catch-up/i)
  assert.match(ret2Gate, /no schedule may be created/i)
  assert.match(ret2Gate, /Admin\/Testing retains authority for merge/)
})
