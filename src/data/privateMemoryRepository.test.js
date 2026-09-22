import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__privateMemoryRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./privateMemoryRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createPrivateMemoryRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]
const org = '11111111-1111-4111-8111-111111111111'
const owner = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const memory = '88888888-8888-4888-8888-888888888888'
const sourceId = '99999999-9999-4999-8999-999999999999'

test('owner-private read rejects another owner receipt', async () => {
  const repository = createPrivateMemoryRepository({ rpc: () => Promise.resolve({
    data: { organization_id: org, owner_id: owner, confirmed: [], history: [] },
  }) })
  assert.deepEqual((await repository.list(org, owner)).confirmed, [])
  await assert.rejects(repository.list(org, other), /did not match its owner/)
})

test('private note and experiment require exact explicit sources', async () => {
  const calls = []
  const repository = createPrivateMemoryRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { memory_id: memory, status: 'confirmed' } })
  } })
  await repository.save({ organizationId: org, requestId: memory, sourceKind: 'owner_note',
    sourceNote: '  My exact note  ', statement: '  My lesson  ' })
  assert.equal(calls[0].args.p_source_note, 'My exact note')
  await repository.save({ organizationId: org, requestId: memory, sourceKind: 'design_experiment',
    sourceJobId: sourceId, statement: 'Design lesson' })
  assert.equal(calls[1].args.p_source_job_id, sourceId)
  await assert.rejects(repository.save({ organizationId: org, requestId: memory,
    sourceKind: 'design_experiment', sourceJobId: other,
    sourceNote: 'Cannot mix sources', statement: 'Design lesson' }), /Exact owner-private/)
})

test('private purge verifies exact preview and receipt', async () => {
  const repository = createPrivateMemoryRepository({ rpc(name) {
    return Promise.resolve({ data: name === 'preview_private_ai_memory_purge'
      ? { organization_id: org, owner_id: owner, memory_ids: [memory, sourceId],
        records: [{ id: memory }, { id: sourceId }] }
      : { purged_memory_ids: [memory, sourceId] } })
  } })
  assert.equal((await repository.previewPurge(org, memory, owner)).memory_ids.length, 2)
  await repository.purge({ organizationId: org, memoryId: memory, requestId: other,
    memoryIds: [memory, sourceId], confirmation: 'PURGE', reason: 'Explicit owner purge' })
  await assert.rejects(repository.purge({ organizationId: org, memoryId: memory, requestId: other,
    memoryIds: [memory], confirmation: 'PURGE', reason: 'Explicit owner purge' }), /receipt did not match/)
})
