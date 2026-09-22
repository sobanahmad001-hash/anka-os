import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__departmentMemoryRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./departmentMemoryRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createDepartmentMemoryRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]
const org = '11111111-1111-4111-8111-111111111111'
const project = '55555555-5555-4555-8555-555555555555'
const memory = '88888888-8888-4888-8888-888888888888'
const sourceId = '99999999-9999-4999-8999-999999999999'
const comment = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('department read rejects another scope or malformed source identities', async () => {
  const repository = createDepartmentMemoryRepository({ rpc: () => Promise.resolve({
    data: { organization_id: org, department_id: 'design', confirmed: [], candidates: [] },
  }) })
  assert.deepEqual((await repository.list(org, 'design')).confirmed, [])
  await assert.rejects(repository.list(org, 'content'), /active department/)
  const malformed = createDepartmentMemoryRepository({ rpc: () => Promise.resolve({
    data: { organization_id: org, department_id: 'design', candidates: [],
      confirmed: [{ id: memory, source_project_memory_id: sourceId,
        source_comment_id: comment, project_id: 'wrong', generalized_statement: 'Method' }] },
  }) })
  await assert.rejects(malformed.list(org, 'design'), /active department/)
})

test('sanitized promotion and independent decision use exact request identities', async () => {
  const calls = []
  const repository = createDepartmentMemoryRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: name === 'propose_department_ai_memory'
      ? { memory_id: memory, status: 'candidate' }
      : { memory_id: memory, status: 'confirmed' } })
  } })
  await repository.propose({ organizationId: org, projectId: project, departmentId: 'design',
    requestId: memory, sourceMemoryId: sourceId, statement: '  General method  ',
    sanitizationNote: '  Removed all client references  ' })
  assert.equal(calls[0].args.p_source_project_memory_id, sourceId)
  assert.equal(calls[0].args.p_sanitization_note, 'Removed all client references')
  await repository.review({ organizationId: org, departmentId: 'design', memoryId: memory,
    requestId: comment, decision: 'confirm', evidence: '  Sanitization checked  ' })
  assert.equal(calls[1].args.p_evidence, 'Sanitization checked')
  await assert.rejects(repository.review({ organizationId: org, departmentId: 'design',
    memoryId: memory, requestId: comment, decision: 'retire', evidence: 'Review complete' }), /receipt did not match/)
})
