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
  assert.equal(calls[0].name, 'post_project_discussion_message_with_links')
  assert.equal(calls[0].args.p_content, 'Project update')
  assert.equal(calls[0].args.p_parent_comment_id, actor)
  assert.deepEqual(calls[0].args.p_links, [])
  await assert.rejects(repository.post({ organizationId: org, projectId: actor,
    requestId: request, content: 'Project update' }), /did not match/)
})

test('project discussion post uses the current scope signal and stops before dispatch when aborted', async () => {
  const controller = new AbortController()
  let seenSignal
  let calls = 0
  const query = {
    abortSignal(signal) { seenSignal = signal; return this },
    then(resolve) { return Promise.resolve({ data: { organization_id: org, project_id: project,
      request_id: request, comment_id: request } }).then(resolve) },
  }
  const repository = createProjectDiscussionRepository({ rpc() { calls += 1; return query } })
  const input = { organizationId: org, projectId: project, requestId: request, content: 'A scoped update' }
  await repository.post(input, { signal: controller.signal })
  assert.equal(seenSignal, controller.signal)
  assert.equal(calls, 1)
  controller.abort()
  await assert.rejects(repository.post(input, { signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(calls, 1)
})

test('discussion references are scoped in options, posts, and resolved pages', async () => {
  const calls = []
  const link = { kind: 'file', id: actor }
  const repository = createProjectDiscussionRepository({ rpc(name, args) {
    calls.push({ name, args })
    if (name === 'get_project_discussion_reference_options') return Promise.resolve({
      data: { organization_id: org, project_id: project,
        options: [{ ...link, label: 'Source file.pdf' }] },
    })
    if (name === 'get_project_discussion') return Promise.resolve({
      data: { organization_id: org, project_id: project, has_older: false, cursor: null,
        messages: [{ id: request, author_id: actor, content: 'See file',
          links: [{ ...link, available: false, label: null }] }] },
    })
    return Promise.resolve({ data: { organization_id: org, project_id: project,
      request_id: request, comment_id: request, replayed: false } })
  } })
  assert.equal((await repository.referenceOptions(org, project))[0].label, 'Source file.pdf')
  await repository.post({ organizationId: org, projectId: project,
    requestId: request, content: 'See file', links: [link] })
  assert.deepEqual(calls[1].args.p_links, [link])
  assert.equal((await repository.page(org, project)).messages[0].links[0].available, false)
  await assert.rejects(repository.post({ organizationId: org, projectId: project,
    requestId: request, content: 'See file', links: [link, link] }), /Valid project message/)
  const foreign = createProjectDiscussionRepository({ rpc: () => Promise.resolve({
    data: { organization_id: actor, project_id: project, options: [] },
  }) })
  await assert.rejects(foreign.referenceOptions(org, project), /active project/)
})
