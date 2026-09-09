import assert from 'node:assert/strict'
import test from 'node:test'

import { canPreserveReportsSnapshot, runReportsSnapshotOperation } from './reportsAndRecordsOperation.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('obsolete scope after preservation dispatch produces no refetch or UI effects', async () => {
  const pending = deferred()
  let current = true
  let refreshes = 0
  const effects = []
  const operation = runReportsSnapshotOperation({
    signal: new AbortController().signal,
    isCurrent: () => current,
    preserve: () => pending.promise,
    refresh: () => { refreshes += 1; return Promise.resolve({}) },
    onPreserved: () => effects.push('preserved'),
    onRefreshed: () => effects.push('refreshed'),
    onError: () => effects.push('error'),
    onFinished: () => effects.push('finished'),
  })
  current = false
  pending.resolve({ id: 'snapshot-a' })
  await operation
  assert.equal(refreshes, 0)
  assert.deepEqual(effects, [])
})

test('obsolete scope during refresh produces no later refresh or completion effects', async () => {
  const pending = deferred()
  let current = true
  const effects = []
  const operation = runReportsSnapshotOperation({
    signal: new AbortController().signal,
    isCurrent: () => current,
    preserve: () => Promise.resolve({ id: 'snapshot-a' }),
    refresh: () => pending.promise,
    onPreserved: () => effects.push('preserved'),
    onRefreshed: () => effects.push('refreshed'),
    onError: () => effects.push('error'),
    onFinished: () => effects.push('finished'),
  })
  await Promise.resolve()
  current = false
  pending.resolve({ project: { id: 'project-b' } })
  await operation
  assert.deepEqual(effects, ['preserved'])
})

test('current operation applies snapshot, refresh, and completion in order', async () => {
  const effects = []
  await runReportsSnapshotOperation({
    signal: new AbortController().signal,
    isCurrent: () => true,
    preserve: () => Promise.resolve({ id: 'snapshot-a' }),
    refresh: () => Promise.resolve({ project: { id: 'project-a' } }),
    onPreserved: () => effects.push('preserved'),
    onRefreshed: () => effects.push('refreshed'),
    onError: () => effects.push('error'),
    onFinished: () => effects.push('finished'),
  })
  assert.deepEqual(effects, ['preserved', 'refreshed', 'finished'])
})

test('snapshot preservation role predicate exactly matches the database authority set', () => {
  for (const role of ['system_owner', 'operations_admin', 'executive']) {
    assert.equal(canPreserveReportsSnapshot({ membership: { role }, userId: 'actor', projectOwnerId: 'other' }), true)
  }
  assert.equal(canPreserveReportsSnapshot({
    membership: { role: 'project_owner' }, userId: 'actor', projectOwnerId: 'actor',
  }), true)
  for (const role of ['project_owner', 'department_manager', 'contributor', 'client_admin', 'client_viewer']) {
    assert.equal(canPreserveReportsSnapshot({ membership: { role }, userId: 'actor', projectOwnerId: 'other' }), false)
  }
  assert.equal(canPreserveReportsSnapshot({ membership: null, userId: 'actor', projectOwnerId: 'actor' }), false)
})
