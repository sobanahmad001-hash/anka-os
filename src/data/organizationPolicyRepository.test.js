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
