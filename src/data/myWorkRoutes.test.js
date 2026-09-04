import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../config/environmentNav.js', import.meta.url), 'utf8')
const screen = readFileSync(new URL('../apps/MyWork.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')

test('My Work is an active canonical route', () => {
  assert.match(app, /path="sphere\/my-work" element={<MyWork \/>}/)
  assert.match(nav, /label: 'My Work', path: '\/sphere\/my-work'/)
  assert.doesNotMatch(screen, /\.from\(/)
  assert.doesNotMatch(screen, /as_/)
})

test('daily queue reads assignments, handoffs, deliverables, and reviews', () => {
  assert.match(repository, /async getMyWork\(userId, activeOrganizationId, \{ signal \} = \{\}\)/)
  assert.match(screen, /delivery\.getMyWork\(user\.id, activeOrganizationId, \{ signal: requestSignal \}\)/)
  assert.match(repository, /\.eq\('assigned_to', userId\)/)
  assert.match(repository, /from\('work_items'\)[\s\S]*?\.eq\('assignee_id', userId\)/)
  assert.match(repository, /owner_id\.eq\.\$\{userId\},requested_by\.eq\.\$\{userId\}/)
  assert.match(repository, /ready_for_internal_review/)
  assert.match(repository, /ready_for_client_review/)
  assert.match(screen, /Project Tasks/)
  assert.match(screen, /Engagement Work Items/)
  assert.match(screen, /Exact-version internal review/)
})

test('deliverable quality flow records an immutable human approval before release', () => {
  assert.match(repository, /async createDeliverableVersion/)
  assert.match(repository, /approval_type: 'internal_quality'/)
  assert.match(repository, /decided_by: actorId/)
  assert.match(repository, /async releaseDeliverableVersion/)
  assert.match(repository, /from\('client_portal_items'\)\.upsert/)
  assert.match(repository, /review_status: 'client_reviewing'/)
})

test('deliverable files use the private canonical bucket', () => {
  assert.match(repository, /storage\.from\('sphere-deliverables'\)\.upload/)
  assert.match(repository, /visibility: 'internal_only'/)
  assert.doesNotMatch(repository, /getPublicUrl/)
})
