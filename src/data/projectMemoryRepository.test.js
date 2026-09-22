import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectMemoryRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./projectMemoryRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectMemoryRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]
const org = '11111111-1111-4111-8111-111111111111'
const project = '55555555-5555-4555-8555-555555555555'
const sourceId = '66666666-6666-4666-8666-666666666666'
const request = '88888888-8888-4888-8888-888888888888'

test('project memory rejects a foreign scope or malformed sourced rows', async () => {
  const repository = createProjectMemoryRepository({ rpc: () => Promise.resolve({
    data: { organization_id: org, project_id: project, confirmed: [], candidates: [] },
  }) })
  assert.deepEqual((await repository.list(org, project)).confirmed, [])
  await assert.rejects(repository.list(org, sourceId), /active project/)
  const malformed = createProjectMemoryRepository({ rpc: () => Promise.resolve({
    data: { organization_id: org, project_id: project,
      confirmed: [{ id: request, statement: 'Missing source' }], candidates: [] },
  }) })
  await assert.rejects(malformed.list(org, project), /active project/)
})

test('proposal and review preserve exact request identity and decision', async () => {
  const calls = []
  const repository = createProjectMemoryRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: name === 'propose_project_ai_memory'
      ? { memory_id: request, status: 'candidate' }
      : { memory_id: request, status: 'confirmed' } })
  } })
  await repository.propose({ organizationId: org, projectId: project,
    requestId: request, sourceCommentId: sourceId, statement: '  Check latest brief  ' })
  assert.equal(calls[0].args.p_source_comment_id, sourceId)
  assert.equal(calls[0].args.p_statement, 'Check latest brief')
  await repository.review({ organizationId: org, projectId: project,
    memoryId: request, requestId: sourceId, decision: 'confirm', evidence: '  Verified source  ' })
  assert.equal(calls[1].args.p_evidence, 'Verified source')
  await assert.rejects(repository.review({ organizationId: org, projectId: project,
    memoryId: request, requestId: sourceId, decision: 'retire', evidence: 'Verified source' }), /did not match/)
})
