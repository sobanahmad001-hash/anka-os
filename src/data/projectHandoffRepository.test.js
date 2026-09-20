import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectHandoffRepositoryTest'
globalThis[key] = { from() {}, rpc() {} }
const source = readFileSync(new URL('./projectHandoffRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectHandoffRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '00000000-0000-4000-8000-000000000001'
const project = '90000000-0000-4000-8000-000000000001'
const request = 'e0000000-0000-4000-8000-000000000001'
const sourceComment = 'a0000000-0000-4000-8000-000000000001'
const receiver = 'd0000000-0000-4000-8000-000000000002'

test('handoff creation binds exact project, receiving workstream, and discussion source', async () => {
  const calls = []
  const repository = createProjectHandoffRepository({ from() {}, rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { id: request, organization_id: org, project_id: project,
      receiving_workstream_id: receiver, request_type: 'internal_handoff' } })
  } })
  await repository.create({ organizationId: org, projectId: project, requestId: request,
    sourceCommentId: sourceComment, receivingWorkstreamId: receiver,
    title: '  Design to development  ', requestedOutput: '  Build  ', acceptanceCriteria: '  Matches version  ' })
  assert.equal(calls[0].name, 'create_project_handoff_request')
  assert.equal(calls[0].args.p_source_comment_id, sourceComment)
  assert.equal(calls[0].args.p_title, 'Design to development')
  assert.equal(calls[0].args.p_acceptance_criteria, 'Matches version')
  await assert.rejects(repository.create({ organizationId: org, projectId: project,
    requestId: request, receivingWorkstreamId: receiver, requestingWorkstreamId: receiver,
    title: 'Handoff', requestedOutput: 'Build' }), /Complete/)
})

test('handoff list keeps the canonical project scope and legacy unassigned requests', async () => {
  const query = { select() { return this }, eq() { return this }, is() { return this },
    order() { return this }, limit() { return Promise.resolve({ data: [{ id: request,
      organization_id: org, project_id: project, receiving_workstream_id: null }] }) } }
  const repository = createProjectHandoffRepository({ from(table) {
    assert.equal(table, 'requests'); return query
  }, rpc() {} })
  assert.equal((await repository.list(org, project)).length, 1)
  await assert.rejects(repository.list(org, receiver), /did not match/)
})
