import assert from 'node:assert/strict'
import test from 'node:test'
import { contextChatAction } from '../../supabase/functions/department-chat/contextChatActions.ts'
import { actor, organizationId, projectId, threadId, requestId } from '../../tools/direct-chat-fixture.js'
function fixture() {
  const calls = [], result = { conversation: { id: threadId, owner_id: actor }, message: { id: crypto.randomUUID() } }
  const admin = {
    from(table) {
      assert.ok(['projects', 'organization_department_memberships'].includes(table), 'Edge must not insert a separate empty chat')
      let exists = table === 'projects'
      const query = { select() { return query }, eq(key, value) { if (key === 'id' && value !== projectId) exists = false; return query }, is() { return query }, async maybeSingle() { return { data: exists ? { id: projectId } : null } } }
      return query
    },
    async rpc(name, input) { calls.push({ name, input }); return { data: result } },
  }
  const input = { context_kind: 'department_private', department_id: 'content', conversation_id: threadId, client_request_id: requestId, message: '  First direction  ', owner_id: crypto.randomUUID(), organization_id: crypto.randomUUID() }
  const start = (body = input, membership = { department_id: 'content', role: 'contributor' }) => contextChatAction('start_context_conversation', admin, body, actor, organizationId, membership)
  return { admin, calls, result, input, start }
}
test('First Send uses one atomic RPC with authenticated identity and validated scope/body', async () => {
  const f = fixture()
  assert.equal(await f.start(), f.result)
  assert.deepEqual(f.calls, [{ name: 'start_context_chat_human_message', input: {
    p_conversation_id: threadId, p_organization_id: organizationId, p_actor_id: actor,
    p_context_kind: 'department_private', p_project_id: null, p_department_id: 'content',
    p_request_id: requestId, p_body: 'First direction',
  } }])
})
test('invalid request, text, mixed context and lost access cannot reach atomic write', async () => {
  const f = fixture()
  for (const patch of [{ conversation_id: 'invalid' }, { client_request_id: '' }, { message: ' ' }, { message: 'x'.repeat(8001) }, { project_id: projectId }, { engagement_id: projectId }]) await assert.rejects(f.start({ ...f.input, ...patch }))
  await assert.rejects(f.start(f.input, { department_id: 'design', role: 'contributor' }), /department access/)
  await assert.rejects(f.start({ ...f.input, context_kind: 'project_team', department_id: '', project_id: crypto.randomUUID() }), /project access/)
  assert.equal(f.calls.length, 0)
})
test('project First Send forwards only the exact validated project scope', async () => {
  const f = fixture()
  await f.start({ ...f.input, context_kind: 'project_team', department_id: '', project_id: projectId })
  assert.equal(f.calls[0].input.p_project_id, projectId)
  assert.equal(f.calls[0].input.p_department_id, null)
})
test('atomic persistence failure is propagated without a fallback insert or second request', async () => {
  const f = fixture(), error = new Error('Atomic transaction rolled back')
  f.admin.rpc = async (name, input) => { f.calls.push({ name, input }); return { error } }
  await assert.rejects(f.start(), reason => reason === error)
  assert.equal(f.calls.length, 1)
})
