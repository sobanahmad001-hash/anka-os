import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const screen = readFileSync(new URL('../apps/AnkaSphereClients.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')
const inviteFunction = readFileSync(new URL('../../supabase/functions/invite-client-contact/index.ts', import.meta.url), 'utf8')

test('client administration uses canonical records only', () => {
  assert.doesNotMatch(screen, /\.from\(/)
  assert.doesNotMatch(screen, /as_/)
  assert.match(repository, /from\('clients'\)/)
  assert.match(repository, /from\('client_contacts'\)/)
  assert.match(repository, /from\('project_client_access'\)/)
})

test('client invitation is server-authorized and project-scoped', () => {
  assert.match(inviteFunction, /from\('organization_memberships'\)/)
  assert.match(inviteFunction, /auth\.admin\.inviteUserByEmail/)
  assert.match(inviteFunction, /\.eq\('client_id', clientId\)\.in\('id', projectIds\)/)
  assert.match(inviteFunction, /from\('client_contacts'\)\.insert/)
  assert.match(inviteFunction, /from\('project_client_access'\)\.insert/)
})

test('client identities never receive a team organization membership', () => {
  assert.doesNotMatch(inviteFunction, /from\('organization_memberships'\)\.(insert|upsert)/)
  assert.match(inviteFunction, /account_kind: 'client'/)
})

test('portal access requires explicit selected projects', () => {
  assert.match(screen, /projectIds: \[\]/)
  assert.match(screen, /disabled={saving \|\| !invite\.projectIds\.length}/)
  assert.match(inviteFunction, /Select at least one project/)
})
