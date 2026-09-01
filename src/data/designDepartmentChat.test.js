import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const edge = read('supabase/functions/department-chat/index.ts')
const designArtifact = read('supabase/functions/_shared/designSystemArtifacts.ts')
const ui = read('src/apps/DesignSystems.jsx')
const repository = read('src/data/designSystemsRepository.js')

test('UW1 enables only Design alongside the existing Content Department Chat', () => {
  assert.match(edge, /ENABLED_DEPARTMENTS = new Set\(\['content', 'design'\]\)/)
  assert.match(edge, /CHAT_DESIGN_ARTIFACT_TYPE_SET/)
  assert.doesNotMatch(edge, /departmentId !== 'content'/)
  assert.match(designArtifact, /new Set\(\['design_system'\]\)/)
  assert.doesNotMatch(designArtifact, /design_direction/)
})

test('UW1 keeps Design chat draft-only, auditable, and scoped to Design', () => {
  assert.match(edge, /service_catalog\.department_id', departmentId/)
  assert.match(edge, /integration_connection_departments\.department_id', departmentId/)
  assert.match(edge, /artifact_draft_proposed_via_chat/)
  assert.match(edge, /ai_use_allowed: false/)
  assert.match(edge, /data_classification: 'internal'/)
  assert.match(edge, /Hourly AI run limit reached/)
  assert.match(edge, /Organization AI budget has been reached/)
  assert.doesNotMatch(edge, /artifact_approvals\)\.insert/)
})

test('UW1 provides an engagement-scoped Design Systems chat UI', () => {
  assert.match(ui, /Shared Department Chat/)
  assert.match(ui, /departmentId="design"/)
  assert.match(ui, /Design Systems service/)
  assert.match(repository, /department-chat/)
  assert.match(repository, /engagement_stage_instances/)
})
