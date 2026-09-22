import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextChatRunnerRepository } from './contextChatRunnerTransport.js'

test('private AI request pins selected organization, source turn, model, and dispatch identity', async () => {
  const calls = []
  const controller = new AbortController()
  const repo = createContextChatRunnerRepository({ functions: { invoke: async (name, options) => {
    calls.push({ name, ...options })
    return { data: { status: 'completed', message: { id: 'reply' } } }
  } } })
  await repo.run({ organization_id: 'old', message_id: 'source', model_configuration_id: 'model',
    dispatch_request_id: 'dispatch' }, { organizationId: 'selected', signal: controller.signal })
  await repo.recover('source', { organizationId: 'selected', signal: controller.signal })
  assert.deepEqual(calls.map(call => call.name), ['context-chat-runner', 'context-chat-runner'])
  assert.deepEqual(calls.map(call => call.body.organization_id), ['selected', 'selected'])
  assert.equal(calls[0].body.message_id, 'source')
  assert.equal(calls[0].body.model_configuration_id, 'model')
  assert.equal(calls[0].body.dispatch_request_id, 'dispatch')
  assert.equal(calls[1].body.recover_only, true)
  assert.equal(calls[1].body.model_configuration_id, undefined)
  assert.equal(calls[0].signal, controller.signal)
})

test('uncertain provider outcomes preserve must-not-submit for the UI', async () => {
  const repo = createContextChatRunnerRepository({ functions: { invoke: async () => ({
    data: { status: 'outcome_unknown', must_not_submit: true },
    error: { message: 'Function failed', context: { status: 503, json: async () => ({
      status: 'outcome_unknown', must_not_submit: true,
    }) } },
  }) } })
  await assert.rejects(repo.run({ message_id: 'source' }, { organizationId: 'selected' }),
    error => error.mustNotSubmit === true && error.outcome === 'outcome_unknown')
})
