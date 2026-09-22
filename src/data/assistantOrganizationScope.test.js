import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const screen = readFileSync(new URL('../apps/AnkaAssistant.jsx', import.meta.url), 'utf8')
const delivery = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')
const ai = readFileSync(new URL('./aiRepository.js', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/ai-chat/index.ts', import.meta.url), 'utf8')

test('legacy Assistant waits for an active organization and scopes every initial read', () => {
  assert.match(screen, /<OrganizationGate><ScopedAnkaAssistant \/><\/OrganizationGate>/)
  assert.match(screen, /delivery\.listProjects\(activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(screen, /operatingSpine\.listEngagements\(activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(screen, /aiRepository\.listRuns\(activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(screen, /operatingSpine\.getEngagement\(engagementId, activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(screen, /if \(!current \|\| requestSignal\.aborted\) return/)
  assert.doesNotMatch(screen, /operatingSpine\.listEngagements\(\)/)
})

test('project context and audit stay in selected organization before provider dispatch', () => {
  assert.match(delivery, /async listProjects\(activeOrganizationId, \{ signal \} = \{\}\)/)
  assert.match(delivery, /async getProjectWorkspace\(projectId, activeOrganizationId, \{ signal \} = \{\}\)/)
  assert.match(ai, /\.eq\('organization_id', organizationId\)\.is\('redacted_at', null\)/)
  assert.match(screen, /workspace\?\.project\?\.organization_id !== activeOrganizationId/)
  assert.match(edge, /if \(body\.organizationId !== ORGANIZATION_ID\) return json\(\{ error: 'Active organization mismatch' \}, 403\)/)
  assert.ok(edge.indexOf('body.organizationId !== ORGANIZATION_ID') < edge.indexOf('const hourAgo'))
})
