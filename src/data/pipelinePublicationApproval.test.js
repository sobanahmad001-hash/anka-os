import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260920152000_n4_pipeline_preset_department_approvals.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/tests/n4_pipeline_preset_department_approvals.behavior.sql', import.meta.url), 'utf8')
const approval = migration.match(/create function public\.approve_pipeline_template_version_department[\s\S]*?\n\$\$;/)?.[0] || ''
const publication = migration.match(/create or replace function public\.publish_pipeline_template_version[\s\S]*?\n\$\$;/)?.[0] || ''

test('N4 approvals are immutable, tenant-bound, exact-version records with closed browser writes', () => {
  assert.match(migration, /foreign key \(pipeline_template_version_id, pipeline_template_id, organization_id\)/)
  assert.match(migration, /foreign key \(department_id, organization_id\)/)
  assert.match(migration, /unique \(pipeline_template_version_id, department_id, approved_by\)/)
  assert.match(migration, /protect_pipeline_template_department_approvals[\s\S]*private\.reject_pipeline_template_mutation/)
  assert.match(migration, /alter table public\.pipeline_template_department_approvals enable row level security/)
  assert.match(migration, /create function private\.can_read_pipeline_template_approval[\s\S]*security definer set search_path = ''/)
  assert.match(migration, /grant execute on function private\.can_read_pipeline_template_approval\(uuid, uuid\)\s+to authenticated, service_role/)
  assert.match(migration, /using \(private\.can_read_pipeline_template_approval\(pipeline_template_version_id, organization_id\)\)/)
  assert.match(migration, /revoke all on public\.pipeline_template_department_approvals from public, anon, authenticated, service_role/)
  assert.match(migration, /grant select on public\.pipeline_template_department_approvals to authenticated, service_role/)
})

test('N4 approval action requires current canonical head of an affected department and an unpublished cross-department version', () => {
  for (const gate of [
    /organization\.status = 'active'/,
    /membership\.member_kind = 'team'/,
    /membership\.status = 'active'/,
    /membership\.role = 'department_manager'/,
    /membership\.department_id = p_department_id/,
    /v_department_count < 2/,
    /service\.department_id = p_department_id/,
    /Published versions cannot receive a new department approval/,
  ]) assert.match(approval, gate)
  assert.doesNotMatch(approval, /project_manager_bindings|organization_department_memberships|executive/)
  assert.match(migration, /grant execute on function public\.approve_pipeline_template_version_department\(uuid, text\)\s+to authenticated/)
})

test('N4 publication checks every affected department against current exact-version head approval', () => {
  assert.match(publication, /array_agg\(distinct service\.department_id order by service\.department_id\)/)
  assert.match(publication, /if coalesce\(cardinality\(v_departments\), 0\) > 1 then/)
  assert.match(publication, /foreach v_department in array v_departments loop/)
  assert.match(publication, /order by item\.service_id[\s\S]*?for share/)
  assert.ok(publication.indexOf('for v_selected_service in') < publication.search(/if exists \(\s*select 1 from unnest\(v_service_ids\)/))
  assert.ok(publication.indexOf('for v_selected_service in') < publication.indexOf('v_manifest := private.pipeline_rule_manifest'))
  assert.match(publication, /approval\.pipeline_template_version_id = v_version\.id/)
  assert.match(publication, /approval\.department_id = v_department/)
  assert.match(publication, /membership\.role = 'department_manager'/)
  assert.match(publication, /membership\.department_id = v_department/)
  assert.match(publication, /for share of membership/)
  assert.doesNotMatch(publication, /project_manager_bindings|organization_department_memberships/)
  assert.match(publication, /membership\.role in \('system_owner', 'operations_admin'\)/)
  assert.match(publication, /for share of organization, membership/)
  assert.match(publication, /idempotent_replay/)
})

test('N4 SQL verifier covers denial, revoked-head replacement, version isolation and replay without committed fixtures', () => {
  for (const gate of [
    'Cross-department publish without approvals succeeded',
    'Project manager approved org preset',
    'One of two department approvals sufficed',
    'Revoked head approval still counted',
    'Prior-version approvals authorized new version',
    'Publication replay failed',
    'Approval history was mutable',
  ]) assert.match(verifier, new RegExp(gate))
  assert.match(verifier, /rollback;\s*$/)
})
