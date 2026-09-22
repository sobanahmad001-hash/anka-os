import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextChatReleaseReviewTransport } from './contextChatReleaseReviewTransport.js'

test('held-claim list and independent release carry exact selected organization and evidence', async () => {
  const calls = []
  const signal = new AbortController().signal
  const client = { rpc: (name, args) => {
    calls.push({ name, args })
    return { abortSignal: seen => {
      assert.equal(seen, signal)
      return Promise.resolve({ data: name.startsWith('list_') ? { items: [], has_more: false } : { status: 'released' } })
    } }
  } }
  const repo = createContextChatReleaseReviewTransport(client)
  await repo.list('selected-org', 50, { signal })
  await repo.release({ organizationId: 'selected-org', messageId: 'message', requestId: 'request',
    providerReference: 'provider-request-123', providerCheckedAt: '2026-09-23T00:00:00Z',
    confirmedNoCharge: true, evidence: 'Provider billing confirms no charge for this exact claim.' }, { signal })
  assert.equal(calls[0].name, 'list_context_chat_release_candidates')
  assert.deepEqual(calls[0].args, { p_organization_id: 'selected-org', p_offset: 50 })
  assert.equal(calls[1].name, 'release_context_chat_confirmed_no_charge')
  assert.equal(calls[1].args.p_organization_id, 'selected-org')
  assert.equal(calls[1].args.p_confirmed_no_charge, true)
})
test('release refuses a missing no-charge attestation before RPC', async () => {
  let called = false
  const repo = createContextChatReleaseReviewTransport({ rpc: () => { called = true } })
  assert.throws(() => repo.release({ confirmedNoCharge: false }))
  assert.equal(called, false)
})
