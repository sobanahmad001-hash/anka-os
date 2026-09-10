import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatCompletionGuard, runCurrentChatOperation } from './departmentChatIdentity.js'

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

for (const action of ['rename', 'archive', 'conversation reload', 'show archived']) {
  test('late ' + action + ' cannot overwrite a newer conversation action', async () => {
    const guard = createChatCompletionGuard()
    const first = deferred()
    const events = []
    const oldOperation = runCurrentChatOperation(guard, {
      start: () => events.push('old:start'),
      operation: () => first.promise,
      success: value => events.push('old:' + value),
      failure: () => events.push('old:error'),
      settle: () => events.push('old:settle'),
    })
    await runCurrentChatOperation(guard, {
      operation: async () => 'new',
      success: value => events.push(value),
      settle: () => events.push('new:settle'),
    })
    first.resolve('late')
    await oldOperation
    assert.deepEqual(events, ['old:start', 'new', 'new:settle'])
  })
}
