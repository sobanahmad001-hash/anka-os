import test from 'node:test'
import assert from 'node:assert/strict'
import { validateContextChatScope, validateContextChatListOffset, validateContextChatMessage, isContextChatUuid } from '../../supabase/functions/department-chat/contextChatScope.mjs'

const projectId = 'a0000000-0000-4000-8000-000000000001'

test('context chat accepts only the requested organization, private department, or project shape', () => {
  assert.deepEqual(validateContextChatScope({ context_kind: 'organization' }), {
    context_kind: 'organization', project_id: null, engagement_id: null, department_id: null,
  })
  assert.deepEqual(validateContextChatScope({ context_kind: 'department_private', department_id: 'design' }), {
    context_kind: 'department_private', project_id: null, engagement_id: null, department_id: 'design',
  })
  assert.deepEqual(validateContextChatScope({ context_kind: 'project_team', project_id: projectId }), {
    context_kind: 'project_team', project_id: projectId, engagement_id: null, department_id: null,
  })
  for (const input of [
    { context_kind: 'organization', project_id: projectId },
    { context_kind: 'department_private', department_id: 'development' },
    { context_kind: 'department_private', department_id: 'design', engagement_id: projectId },
    { context_kind: 'project_team', project_id: 'bad-id' },
    { context_kind: 'project_team', project_id: projectId, department_id: 'content' },
    { context_kind: 'department_project', project_id: projectId },
  ]) assert.throws(() => validateContextChatScope(input))
})

test('human turns require bounded text and valid request identity', () => {
  assert.equal(validateContextChatMessage('  hello  '), 'hello')
  for (const value of ['', '   ', 'x'.repeat(8001), null]) assert.throws(() => validateContextChatMessage(value))
  assert.equal(isContextChatUuid(projectId), true)
  assert.equal(isContextChatUuid('not-a-uuid'), false)
})

test('conversation list paging accepts only bounded whole-number offsets', () => {
  assert.equal(validateContextChatListOffset(undefined), 0)
  assert.equal(validateContextChatListOffset(50), 50)
  for (const value of [-1, 1.5, '50', Number.NaN, 1000001]) {
    assert.throws(() => validateContextChatListOffset(value))
  }
})
