import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatCompletionGuard } from './departmentChatIdentity.js'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

for (const change of ['engagement', 'department', 'user', 'organization']) {
  test('late preview cannot populate the next ' + change, async () => {
    const a = createChatCompletionGuard()
    const pending = deferred()
    const current = a.begin()
    let result = null
    const operation = pending.promise.then(value => { if (current()) result = value })
    a.dispose()
    const b = createChatCompletionGuard()
    const next = b.begin()
    if (next()) result = 'B preview'
    pending.resolve('A preview')
    await operation
    assert.equal(result, 'B preview')
  })
  test('late decision cannot refresh the next ' + change, async () => {
    const a = createChatCompletionGuard()
    const pending = deferred()
    const current = a.begin()
    const refreshes = []
    const operation = pending.promise.then(() => { if (current()) refreshes.push('A') })
    a.dispose()
    pending.resolve({ outcome: 'accepted' })
    await operation
    assert.deepEqual(refreshes, [])
  })
}

test('organization abort and newer request invalidate in-flight completions', () => {
  const controller = new AbortController()
  const guard = createChatCompletionGuard(controller.signal)
  const old = guard.begin()
  const latest = guard.begin()
  assert.equal(old(), false)
  assert.equal(latest(), true)
  controller.abort()
  assert.equal(latest(), false)
})
