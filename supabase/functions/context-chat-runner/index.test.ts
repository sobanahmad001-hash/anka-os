import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { buildPrivateConversationPrompt, handleRequest, privateConversationScope, requirePrivateChatPaidExecution } from './index.ts'

const source = '2dfc98d4-50a9-4c84-8f19-dab3d4e90a6e'
const earlier = '4e47d11a-7b84-4095-8657-93e9ead63c80'
Deno.test('private prompt includes only bounded completed conversation turns through source', () => {
  const prompt = buildPrivateConversationPrompt([
    { id: earlier, role: 'assistant', status: 'completed', body: 'Prior answer' },
    { id: source, role: 'user', status: 'completed', body: 'Current question' },
  ], source, { context_kind: 'organization' })
  const parsed = JSON.parse(prompt)
  assertEquals(parsed.turns.map((turn: { role: string }) => turn.role), ['assistant', 'user'])
  assertEquals(parsed.source_message_id, source)
  assertThrows(() => buildPrivateConversationPrompt([
    { id: source, role: 'user', status: 'pending', body: 'Not ready' },
  ], source, { context_kind: 'organization' }))
  assertThrows(() => buildPrivateConversationPrompt([
    { id: source, role: 'user', status: 'completed', body: 'x'.repeat(24001) },
  ], source, { context_kind: 'organization' }))
})
Deno.test('paid switch denies new submissions while the handler never calls a provider without auth', async () => {
  let calls = 0
  const result = await handleRequest(new Request('https://example.test/run', { method: 'POST' }),
    () => { calls += 1; throw new Error('provider must not run') },
    { get: () => undefined })
  assertEquals(result.status, 401)
  assertEquals(calls, 0)
  assertEquals((await result.json()).error, 'Authentication required')
  assertThrows(() => requirePrivateChatPaidExecution({ get: () => undefined }))
})

Deno.test('private prompt binds exact project and department scope without cross-context fields', () => {
  const rows = [{ id: source, role: 'user', status: 'completed', body: 'Current question' }]
  const project = JSON.parse(buildPrivateConversationPrompt(rows, source,
    { context_kind: 'project_team', project_id: earlier, department_id: null }))
  assertEquals(project.scope, 'owner_private_project_conversation')
  assertEquals(project.project_id, earlier)
  assertEquals(project.department_id, undefined)
  const department = JSON.parse(buildPrivateConversationPrompt(rows, source,
    { context_kind: 'department_private', department_id: 'design', project_id: null }))
  assertEquals(department.scope, 'owner_private_department_conversation')
  assertEquals(department.department_id, 'design')
  assertEquals(department.project_id, undefined)
  assertThrows(() => privateConversationScope({ context_kind: 'project_team', project_id: 'wrong' }))
  assertThrows(() => privateConversationScope({ context_kind: 'department_private', department_id: 'design', project_id: earlier }))
  assertThrows(() => privateConversationScope({ context_kind: 'organization', project_id: earlier }))
})
