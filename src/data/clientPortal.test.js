import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const portal = readFileSync(new URL('../apps/AnkaSpherePortal.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')
const fileFunction = readFileSync(new URL('../../supabase/functions/portal-file-url/index.ts', import.meta.url), 'utf8')

test('client portal uses only the canonical repository and projection records', () => {
  assert.doesNotMatch(portal, /\.from\(/)
  assert.doesNotMatch(portal, /as_/)
  assert.match(repository, /from\('client_project_projections'\)/)
  assert.match(repository, /from\('client_portal_items'\)/)
  assert.match(repository, /from\('requests'\)/)
  assert.match(repository, /from\('comments'\)/)
})

test('portal revision stays linked to the exact released version', () => {
  assert.match(portal, /deliverableVersionId: revisionTarget\.source_id/)
  assert.match(repository, /target_deliverable_version_id: input\.deliverableVersionId/)
  assert.match(repository, /request_origin: 'client'/)
  assert.match(repository, /visibility: 'client_visible'/)
})

test('formal approval remains unavailable during UAT', () => {
  assert.match(portal, /featureFlags\.clientApprovals/)
  assert.doesNotMatch(portal, /client_approved/)
  assert.doesNotMatch(portal, /approval_type: 'client_approval'/)
})

test('released files use short-lived signed URLs after project authorization', () => {
  assert.match(fileFunction, /project_client_access/)
  assert.match(fileFunction, /client_portal_items/)
  assert.match(fileFunction, /createSignedUrl\(file\.storage_path, 300\)/)
  assert.doesNotMatch(fileFunction, /getPublicUrl/)
  assert.match(repository, /functions\.invoke\('portal-file-url'/)
})

test('portal subscribes only to sanitized and collaboration records', () => {
  assert.match(repository, /table: 'client_project_projections'/)
  assert.match(repository, /table: 'client_portal_items'/)
  assert.match(repository, /table: 'requests'/)
  assert.match(repository, /table: 'comments'/)
  assert.doesNotMatch(repository, /table: 'tasks'/)
})
