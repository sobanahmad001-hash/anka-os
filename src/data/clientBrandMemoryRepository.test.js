import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__clientBrandMemoryRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./clientBrandMemoryRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createClientBrandMemoryRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '11111111-1111-4111-8111-111111111111'
const project = '22222222-2222-4222-8222-222222222222'
const clientId = '33333333-3333-4333-8333-333333333333'
const brandId = '44444444-4444-4444-8444-444444444444'
const sourceId = '55555555-5555-4555-8555-555555555555'
const commentId = '66666666-6666-4666-8666-666666666666'
const memoryId = '77777777-7777-4777-8777-777777777777'
const reviewId = '88888888-8888-4888-8888-888888888888'

test('client and brand memory validates exact scope and receipts', async () => {
  const calls = []
  const repository = createClientBrandMemoryRepository({
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'get_client_brand_ai_memory') return Promise.resolve({ data: {
        organization_id: org, project_id: project, client_id: clientId, brand_id: brandId,
        confirmed: [{ id: memoryId, source_project_memory_id: sourceId,
          source_comment_id: commentId, project_id: project, client_id: clientId,
          brand_id: brandId, scope_kind: 'brand', statement: 'Approved wording' }],
        candidates: [],
      } })
      if (name === 'propose_client_brand_ai_memory') return Promise.resolve({
        data: { memory_id: memoryId, status: 'candidate' },
      })
      return Promise.resolve({ data: { memory_id: memoryId, status: 'confirmed' } })
    },
  })
  assert.equal((await repository.list(org, project)).confirmed.length, 1)
  await repository.propose({ organizationId: org, projectId: project,
    requestId: memoryId, sourceMemoryId: sourceId, scopeKind: 'brand' })
  assert.equal(calls[1].args.p_source_project_memory_id, sourceId)
  await repository.review({ organizationId: org, projectId: project,
    memoryId, requestId: reviewId, decision: 'confirm', evidence: ' Verified ' })
  assert.equal(calls[2].args.p_evidence, 'Verified')
  await assert.rejects(repository.propose({ organizationId: org, projectId: project,
    requestId: memoryId, sourceMemoryId: sourceId, scopeKind: 'organization' }), TypeError)
})

test('client and brand memory refuses a foreign scope row', async () => {
  const repository = createClientBrandMemoryRepository({
    rpc() { return Promise.resolve({ data: {
      organization_id: org, project_id: project, client_id: clientId, brand_id: brandId,
      confirmed: [{ id: memoryId, source_project_memory_id: sourceId,
        source_comment_id: commentId, project_id: project, client_id: clientId,
        brand_id: '99999999-9999-4999-8999-999999999999',
        scope_kind: 'brand', statement: 'Wrong brand' }],
      candidates: [],
    } }) },
  })
  await assert.rejects(repository.list(org, project), /did not match/)
})
