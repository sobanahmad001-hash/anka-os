import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrivateConversationPrompt, privateConversationScope, requireOwnerAuthoredPromptTurns } from '../../supabase/functions/_shared/contextChatPrompt.js'

const source = '2dfc98d4-50a9-4c84-8f19-dab3d4e90a6e'
const earlier = '4e47d11a-7b84-4095-8657-93e9ead63c80'
const sourceTurn = { id: source, role: 'user', status: 'completed', body: 'Current question' }

test('shared teammate text cannot enter the private provider prompt', () => {
  assert.doesNotThrow(() => requireOwnerAuthoredPromptTurns([
    { ...sourceTurn, author_id: earlier },
  ], earlier))
  assert.throws(() => requireOwnerAuthoredPromptTurns([
    { ...sourceTurn, author_id: source },
  ], earlier))
})

test('private prompt binds each exact context without borrowing another scope', () => {
  const contexts = [
    [{ context_kind: 'organization', project_id: null, department_id: null },
      { scope: 'owner_private_organization_conversation' }],
    [{ context_kind: 'project_team', project_id: earlier, department_id: null },
      { scope: 'owner_private_project_conversation', project_id: earlier }],
    [{ context_kind: 'department_private', project_id: null, department_id: 'design' },
      { scope: 'owner_private_department_conversation', department_id: 'design' }],
  ]
  for (const [context, expected] of contexts) {
    const prompt = JSON.parse(buildPrivateConversationPrompt([sourceTurn], source, context))
    assert.deepEqual(Object.fromEntries(Object.entries(prompt).filter(([key]) => key !== 'source_message_id' && key !== 'turns')), expected)
    assert.equal(prompt.source_message_id, source)
    assert.deepEqual(prompt.turns, [{ role: 'user', text: 'Current question' }])
  }
  assert.throws(() => privateConversationScope({ context_kind: 'project_team', project_id: 'wrong' }))
  assert.throws(() => privateConversationScope({ context_kind: 'organization', project_id: earlier }))
  assert.throws(() => privateConversationScope({ context_kind: 'department_private', department_id: 'design', project_id: earlier }))
})

test('private prompt drops oldest turns to fit its bound but never drops the current human turn', () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    role: 'assistant', status: 'completed', body: 'x'.repeat(7900) }))
  rows.push(sourceTurn)
  const prompt = buildPrivateConversationPrompt(rows, source, { context_kind: 'organization' })
  const parsed = JSON.parse(prompt)
  assert.ok(new TextEncoder().encode(prompt).length <= 24000)
  assert.equal(parsed.turns.at(-1).text, 'Current question')
  assert.ok(parsed.turns.length < rows.length)
  assert.throws(() => buildPrivateConversationPrompt([{ ...sourceTurn, status: 'pending' }], source,
    { context_kind: 'organization' }))
  assert.throws(() => buildPrivateConversationPrompt([{ ...sourceTurn, body: 'x'.repeat(24001) }], source,
    { context_kind: 'organization' }))
})
