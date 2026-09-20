import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectDiscussionRepositoryTest'
globalThis[key] = { rpc: () => Promise.resolve({ data: null }) }
const source = readFileSync(new URL('./projectDiscussionRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectDiscussionRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '00000000-0000-4000-8000-000000000001'
const project = '90000000-0000-4000-8000-000000000001'
const request = 'a0000000-0000-4000-8000-000000000001'
const actor = '10000000-0000-4000-8000-000000000002'

test('project discussion page rejects foreign projects and malformed thread identities', async () => {
  const result = { organization_id: org, project_id: project, messages: [{ id: request,
    author_id: actor, content: 'Hello', parent_comment_id: null }], has_older: false, cursor: null }
  const repository = createProjectDiscussionRepository({ rpc: () => Promise.resolve({ data: result }) })
  assert.equal((await repository.page(org, project)).messages.length, 1)
  await assert.rejects(repository.page(org, actor), /did not match/)
  await assert.rejects(repository.page(org, project, { id: 'bad', created_at: 'today' }), /cursor/)
})

test('project discussion post sends one exact scoped message and rejects a mismatched receipt', async () => {
  const calls = []
  const repository = createProjectDiscussionRepository({ rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: { organization_id: org, project_id: project,
      request_id: request, comment_id: request, replayed: false } })
  } })
  await repository.post({ organizationId: org, projectId: project, requestId: request,
    content: '  Project update  ', parentCommentId: actor })
  assert.equal(calls[0].name, 'post_project_discussion_message')
  assert.equal(calls[0].args.p_content, 'Project update')
  assert.equal(calls[0].args.p_parent_comment_id, actor)
  await assert.rejects(repository.post({ organizationId: org, projectId: actor,
    requestId: request, content: 'Project update' }), /did not match/)
})
