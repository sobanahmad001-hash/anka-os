import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__organizationPolicyRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./organizationPolicyRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createOrganizationPolicyRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '11111111-1111-4111-8111-111111111111'
const policy = '22222222-2222-4222-8222-222222222222'
const review = '33333333-3333-4333-8333-333333333333'

test('organization policy checks scoped reads and exact receipts', async () => {
  const calls = []
  const repository = createOrganizationPolicyRepository({
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'get_organization_ai_policy') return Promise.resolve({ data: {
        organization_id: org, confirmed: [{ id: policy, statement: 'Human review first',
          source_note: 'Owner approved the existing release process.' }],
        candidates: [], history: [],
      } })
      if (name === 'propose_organization_ai_policy') return Promise.resolve({
        data: { policy_id: policy, status: 'candidate' },
      })
      return Promise.resolve({ data: { policy_id: policy, status: 'confirmed' } })
    },
  })
  assert.equal((await repository.list(org)).confirmed.length, 1)
  await repository.propose({ organizationId: org, requestId: policy,
    statement: ' Human review first ', sourceNote: ' Owner approved the release process. ' })
  assert.equal(calls[1].args.p_statement, 'Human review first')
  await repository.review({ organizationId: org, policyId: policy, requestId: review,
    decision: 'confirm', evidence: ' Reviewed ' })
  assert.equal(calls[2].args.p_evidence, 'Reviewed')
  await assert.rejects(repository.propose({ organizationId: org, requestId: policy,
    statement: 'Policy', sourceNote: 'Short' }), TypeError)
})

test('organization policy refuses another organization receipt', async () => {
  const repository = createOrganizationPolicyRepository({
    rpc() { return Promise.resolve({ data: {
      organization_id: '99999999-9999-4999-8999-999999999999',
      confirmed: [], candidates: [], history: [],
    } }) },
  })
  await assert.rejects(repository.list(org), /active organization/)
})

test('organization policy purge requires exact chain preview and matching receipt', async () => {
  const calls = []
  const repository = createOrganizationPolicyRepository({
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'preview_organization_ai_policy_purge') return Promise.resolve({ data: {
        organization_id: org, policy_ids: [policy, review],
        records: [{ id: policy, statement: 'Old', source_note: 'Prior approved basis' },
          { id: review, statement: 'New', source_note: 'Corrected approved basis' }],
      } })
      return Promise.resolve({ data: { purged_policy_ids: [policy, review] } })
    },
  })
  const preview = await repository.previewPurge(org, policy)
  assert.deepEqual(preview.policy_ids, [policy, review])
  await repository.purge({ organizationId: org, policyId: policy, requestId: review,
    policyIds: preview.policy_ids, confirmation: 'PURGE',
    reason: 'Owner authorized exact chain purge' })
  assert.deepEqual(calls[1].args.p_expected_policy_ids, [policy, review])
  await assert.rejects(repository.purge({ organizationId: org, policyId: policy,
    requestId: review, policyIds: [policy], confirmation: 'DELETE',
    reason: 'Owner authorized exact chain purge' }), TypeError)
})
