import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__promotedMemoryRetentionRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./promotedMemoryRetentionRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createPromotedMemoryRetentionRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '11111111-1111-4111-8111-111111111111'
const memory = '22222222-2222-4222-8222-222222222222'
const sourceId = '33333333-3333-4333-8333-333333333333'
const request = '44444444-4444-4444-8444-444444444444'
const fingerprint = 'a'.repeat(64)

test('promoted retention checks owner history, exact preview and purge receipt', async () => {
  const calls = []
  const repository = createPromotedMemoryRetentionRepository({
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'get_promoted_ai_memory_history') return Promise.resolve({ data: {
        organization_id: org,
        department: [{ id: memory, source_project_memory_id: sourceId,
          generalized_statement: 'Sanitized method' }],
        client_brand: [],
      } })
      if (name === 'preview_promoted_ai_memory_purge') return Promise.resolve({ data: {
        organization_id: org, memory_kind: 'department', memory_id: memory,
        source_project_memory_id: sourceId, fingerprint,
      } })
      return Promise.resolve({ data: { purged_memory_id: memory, memory_kind: 'department' } })
    },
  })
  assert.equal((await repository.list(org)).department.length, 1)
  assert.equal((await repository.preview(org, 'department', memory)).fingerprint, fingerprint)
  await repository.purge({ organizationId: org, memoryKind: 'department', memoryId: memory,
    requestId: request, fingerprint, confirmation: 'PURGE',
    reason: 'Owner reviewed exact record' })
  assert.equal(calls[2].args.p_expected_fingerprint, fingerprint)
  await assert.rejects(repository.purge({ organizationId: org, memoryKind: 'department',
    memoryId: memory, requestId: request, fingerprint,
    confirmation: 'DELETE', reason: 'Owner reviewed exact record' }), TypeError)
})

test('promoted retention refuses foreign scope and malformed fingerprint', async () => {
  const repository = createPromotedMemoryRetentionRepository({
    rpc() { return Promise.resolve({ data: { organization_id: org,
      memory_kind: 'client_brand', memory_id: memory,
      source_project_memory_id: sourceId, fingerprint: 'bad' } }) },
  })
  await assert.rejects(repository.preview(org, 'client_brand', memory), /did not match/)
})
