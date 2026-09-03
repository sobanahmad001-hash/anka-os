import assert from 'node:assert/strict'
import test from 'node:test'
import { createDepartmentChatRepository } from './departmentChatTransport.js'
import { createChatCompletionGuard, handleCurrentChatFailure } from './departmentChatIdentity.js'
import { isOrganizationAccessError } from './organizationScope.js'

function repository(envelope) {
  const query = { select: () => query, eq: () => query, single: async () => envelope }
  return createDepartmentChatRepository({ functions: { invoke: async () => envelope }, from: () => query })
}

const actions = {
  preview: repo => repo.proposeArtifact('content', {}),
  workPreview: repo => repo.proposeWorkItem('content', {}),
  confirm: repo => repo.confirmProposal('proposal'),
  reject: repo => repo.rejectProposal('proposal'),
  officialRead: repo => repo.getOfficialRecord('org', { work_item_id: 'item' }),
}

for (const [name, action] of Object.entries(actions)) {
  test(name + ' preserves envelope-only 403 and invokes current organization recovery', async () => {
    const repo = repository({ status: 403, data: null, error: { message: 'Forbidden' } })
    const guard = createChatCompletionGuard()
    let refreshes = 0
    await assert.rejects(action(repo), error => {
      handleCurrentChatFailure(guard.begin(), error, reason => { if (isOrganizationAccessError(reason)) refreshes++ }, () => {})
      assert.equal(error.status, 403)
      return true
    })
    assert.equal(refreshes, 1)
  })
  test(name + ' late old-context 403 cannot refresh or block new selection', async () => {
    let resolve
    const response = new Promise(done => { resolve = done })
    const query = { select: () => query, eq: () => query, single: () => response }
    const repo = createDepartmentChatRepository({ functions: { invoke: () => response }, from: () => query })
    const old = createChatCompletionGuard()
    const current = old.begin()
    let selection = 'A'
    let refreshes = 0
    let errors = 0
    const pending = action(repo).catch(error => handleCurrentChatFailure(current, error, () => { refreshes++; selection = null }, () => errors++))
    old.dispose()
    selection = 'B'
    resolve({ status: 403, error: { message: 'Forbidden' } })
    await pending
    assert.equal(selection, 'B')
    assert.equal(refreshes, 0)
    assert.equal(errors, 0)
  })
}

test('FunctionsHttpError context status wins and preserves terminal outcome', async () => {
  const repo = repository({ error: { status: 500, context: new Response(JSON.stringify({ error: 'Expired', outcome: 'expired' }), { status: 409 }) } })
  await assert.rejects(repo.confirmProposal('proposal'), error => error.status === 409 && error.outcome === 'expired')
})

test('non-JSON function response preserves context status and fallback statuses', async () => {
  for (const error of [{ context: new Response('Forbidden', { status: 403 }) }, { status: 403 }, { statusCode: 403 }]) {
    await assert.rejects(repository({ error }).rejectProposal('proposal'), reason => reason.status === 403)
  }
})

test('recovery abort suppresses remaining state completion', () => {
  const controller = new AbortController()
  const current = createChatCompletionGuard(controller.signal).begin()
  let shown = false
  handleCurrentChatFailure(current, { status: 403 }, () => controller.abort(), () => { shown = true })
  assert.equal(shown, false)
})
