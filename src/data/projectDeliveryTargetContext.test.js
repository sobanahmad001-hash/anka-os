import test from 'node:test'
import assert from 'node:assert/strict'
import {projectDeliveryTargetContext} from './projectDeliveryTargetContext.js'

const id = n => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const scope = {organizationId: id(1), projectId: id(2), engagementId: id(3)}
const row = {organization_id: id(1), project_id: id(2), engagement_id: id(3)}
const target = { ...row, id: id(4), connection_id: id(5), site_id: id(6), current: true, version_number: 1, connection_revision: '2026-10-29T11:00:00Z', base_url: 'https://stage.example.test'}

test('organization account and a sole current binding never select a destination implicitly', () => {
  assert.equal(projectDeliveryTargetContext(scope, {...row, targets: [], connections: [{id: id(5)}]}).state, 'needs_project_binding')
  const result = projectDeliveryTargetContext(scope, {...row, targets: [target]})
  assert.equal(result.state, 'needs_destination')
  assert.equal(result.destination, null)
  assert.equal(result.choices.length, 1)
})
test('exact project target identity selects only a current canonical binding and excludes secrets', () => {
  const result = projectDeliveryTargetContext(scope, {...row, targets: [{...target, secret_name: 'never expose', public_config: {password: 'synthetic'}}]}, {targetId: target.id})
  assert.equal(result.state, 'ready')
  assert.equal(result.destination.site_id, target.site_id)
  assert.equal(result.destination.published, false)
  assert.ok(Object.isFrozen(result.destination))
  assert.equal(JSON.stringify(result).includes('synthetic'), false)
  assert.equal(JSON.stringify(result).includes('secret_name'), false)
})
test('ambiguous, stale and paged destinations stay actionable without guessing', () => {
  const workspace = {...row, targets: [target, {...target, id: id(7), site_id: id(8)}], has_more: true}
  assert.equal(projectDeliveryTargetContext(scope, workspace).state, 'needs_destination')
  const unavailable = projectDeliveryTargetContext(scope, {...workspace, targets: [{...target, current: false}]}, {targetId: target.id})
  assert.equal(unavailable.state, 'destination_unavailable')
  assert.equal(unavailable.has_more, true)
})
test('foreign scope, malformed bindings, duplicate IDs and credential-bearing URLs fail closed', () => {
  for (const changed of [{project_id: id(99)}, {site_id: 'bad'}, {connection_revision: 'bad'}, {base_url: 'https://user:secret@stage.example.test'}, {version_number: 0}]) {
    assert.throws(() => projectDeliveryTargetContext(scope, {...row, targets: [{...target, ...changed}]}))
  }
  assert.throws(() => projectDeliveryTargetContext(scope, {...row, project_id: id(99), targets: []}))
  assert.throws(() => projectDeliveryTargetContext(scope, {...row, targets: [target, target]}))
})
