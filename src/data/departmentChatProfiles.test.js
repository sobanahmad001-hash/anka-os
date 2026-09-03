import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEPARTMENT_CHAT_PROFILE_VERSION, departmentChatProfile } from './departmentChatProfiles.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const edge = read('supabase/functions/department-chat/index.ts')
const panel = read('src/components/DevelopmentTrackingPanel.jsx')
const workshop = read('src/apps/DepartmentWorkshop.jsx')
const repository = read('src/data/developmentStudioRepository.js')

test('WCH2 exposes one shared, versioned profile contract for all four departments', () => {
  assert.equal(DEPARTMENT_CHAT_PROFILE_VERSION, 'wch2-v1')
  assert.deepEqual(departmentChatProfile('development').artifactTypes, ['technical_brief', 'launch_checklist'])
  assert.equal(departmentChatProfile('development').mount, 'development_tracking_panel')
  assert.deepEqual(departmentChatProfile('content').workItemTypes, ['task', 'bug', 'request'])
  assert.throws(() => departmentChatProfile('unknown'), /Unsupported Department Chat department/)
})

test('WCH2 freezes canonical roots and operating extensions with exact approved versions', () => {
  for (const field of [
    'canonical_client_id', 'agency_client_id', 'project_id', 'engagement_id', 'brand_id',
    'active_service_ids', 'approved_artifact_version_ids', 'connector_connection_id',
    'model_id', 'engagement_stage_instance_id', 'context_checksum',
  ]) assert.match(edge, new RegExp(field))
  assert.match(edge, /agencyClient\.canonical_client_id !== project\.client_id/)
  assert.match(edge, /brand\.client_id !== agencyClient\.id/)
  assert.match(edge, /project_id: projectId, engagement_id: engagementId/)
})

test('WCH2 connector and model selection fail closed without a fallback', () => {
  assert.match(edge, /connections\.length !== 1/)
  assert.match(edge, /requires an explicit model_id/)
  assert.doesNotMatch(edge, /model:\s*text\([^\n]+\)\s*\|\|/)
  assert.doesNotMatch(edge, /anthropic/i)
})

test('WCH2 keeps Development profiles schema-only and runtime-disabled', () => {
  assert.match(edge, /ENABLED_DEPARTMENTS = new Set\(\['content', 'design', 'marketing'\]\)/)
  assert.doesNotMatch(panel, /<DepartmentChat/)
  assert.doesNotMatch(panel, /departmentId="development"/)
  assert.doesNotMatch(repository, /department-chat|proposeArtifact|proposeWorkItem/)
  assert.doesNotMatch(workshop, /departmentId="development"[\s\S]*DepartmentChat/)
})
