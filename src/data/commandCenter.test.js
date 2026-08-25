import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const screen = readFileSync(new URL('../apps/AgencyCommandCenter.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')

test('admin overview uses the canonical agency command centre', () => {
  assert.match(app, /path="admin" element={<AgencyCommandCenter \/>}/)
  assert.doesNotMatch(screen, /\.from\(/)
  assert.doesNotMatch(screen, /as_/)
})

test('command centre composes operational health without duplicating records', () => {
  assert.match(repository, /async getAgencyCommandCenter/)
  for (const table of ['projects', 'clients', 'tasks', 'requests', 'milestones', 'deliverable_versions', 'activity_events', 'organization_memberships']) {
    assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  }
})

test('leadership signals are evidence-based operational exceptions', () => {
  assert.match(screen, /status === 'blocked'/)
  assert.match(screen, /isOverdue\(task\.due_date\)/)
  assert.match(screen, /ready_for_internal_review/)
  assert.match(screen, /ready_for_client_review/)
  assert.match(screen, /pressure indicators are operational, not performance scores/)
})
