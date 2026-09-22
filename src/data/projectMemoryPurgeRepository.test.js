import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectMemoryPurgeRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./projectMemoryPurgeRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectMemoryPurgeRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]
const org = '11111111-1111-4111-8111-111111111111'
const project = '55555555-5555-4555-8555-555555555555'
const memory = '88888888-8888-4888-8888-888888888888'
const next = '99999999-9999-4999-8999-999999999999'
const request = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('purge preview requires exact selected project and complete linked identity', async () => {
  const repository = createProjectMemoryPurgeRepository({ rpc: () => Promise.resolve({
    data: { organization_id: org, project_id: project,
      memory_ids: [memory, next], records: [{ id: memory }, { id: next }] },
  }) })
  assert.equal((await repository.preview(org, project, memory)).memory_ids.length, 2)
  await assert.rejects(repository.preview(org, project, request), /selected project/)
  await assert.rejects(repository.preview(org, 'bad', memory), /Valid memory/)
})

test('purge sends exact reviewed IDs, typed confirmation and a stable request', async () => {
  const calls = []
  const repository = createProjectMemoryPurgeRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { purged_memory_ids: [memory, next] } })
  } })
  await repository.purge({ organizationId: org, projectId: project, memoryId: memory,
    requestId: request, memoryIds: [memory, next], confirmation: 'PURGE',
    reason: '  Explicit owner request  ' })
  assert.equal(calls[0].name, 'purge_project_ai_memory')
  assert.deepEqual(calls[0].args.p_expected_memory_ids, [memory, next])
  assert.equal(calls[0].args.p_reason, 'Explicit owner request')
  await assert.rejects(repository.purge({ organizationId: org, projectId: project,
    memoryId: memory, requestId: request, memoryIds: [memory],
    confirmation: 'PURGE', reason: 'Owner request' }), /receipt did not match/)
  await assert.rejects(repository.purge({ organizationId: org, projectId: project,
    memoryId: memory, requestId: request, memoryIds: [memory, next],
    confirmation: 'purge', reason: 'Explicit owner request' }), /Exact approved/)
})
