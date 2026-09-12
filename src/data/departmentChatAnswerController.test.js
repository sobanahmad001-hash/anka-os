import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnswerObservationController, reduceAnswerStreamState } from './departmentChatAnswerController.js'

test('real answer stream state remains provisional until durable completion', () => {
  let state = { status: 'idle', text: '', durable: false }
  for (const event of [
    { type: 'started' }, { type: 'delta', delta: 'Hel' }, { type: 'delta', delta: 'lo' },
  ]) state = reduceAnswerStreamState(state, event)
  assert.deepEqual(state, { status: 'streaming', text: 'Hello', durable: false })
  assert.deepEqual(reduceAnswerStreamState(state, { type: 'completed', answer: 'Hello' }), {
    status: 'completed', text: 'Hello', durable: true,
  })
})

test('failed and unknown terminals never make partial text durable', () => {
  const partial = { status: 'streaming', text: 'partial', durable: false }
  assert.equal(reduceAnswerStreamState(partial, { type: 'failed' }).durable, false)
  assert.equal(reduceAnswerStreamState(partial, { type: 'unknown' }).durable, false)
})

test('local stop is distinguishable from organization-scope abort', () => {
  const scope = new AbortController()
  const local = createAnswerObservationController(scope.signal)
  local.stop()
  assert.equal(local.signal.aborted, true)
  assert.equal(local.stoppedLocally(), true)

  const otherScope = new AbortController()
  const scoped = createAnswerObservationController(otherScope.signal)
  otherScope.abort()
  assert.equal(scoped.signal.aborted, true)
  assert.equal(scoped.stoppedLocally(), false)
})
