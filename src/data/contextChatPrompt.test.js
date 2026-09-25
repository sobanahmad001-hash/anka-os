import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrivateConversationPrompt, canonicalOpenAiContext, privateConversationScope, requireOwnerAuthoredPromptTurns } from '../../supabase/functions/_shared/contextChatPrompt.js'

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

test('a second owner turn may use only its own audited prior assistant reply', () => {
  const organizationId = 'a0000000-0000-4000-8000-000000000001'
  const conversationId = 'a0000000-0000-4000-8000-000000000002'
  const runId = 'a0000000-0000-4000-8000-000000000003'
  const claimId = 'a0000000-0000-4000-8000-000000000004'
  const replyId = 'a0000000-0000-4000-8000-000000000005'
  const nextId = 'a0000000-0000-4000-8000-000000000006'
  const ownerTurn = { ...sourceTurn, author_id: earlier, owner_id: earlier,
    organization_id: organizationId, conversation_id: conversationId, sequence: 1 }
  const assistant = { id: replyId, author_id: null, owner_id: earlier,
    organization_id: organizationId, conversation_id: conversationId,
    role: 'assistant', status: 'completed', body: 'Audited answer', sequence: 2,
    ai_run_id: runId, in_reply_to_message_id: source, client_request_id: claimId }
  const nextTurn = { ...ownerTurn, id: nextId, body: 'Follow-up question', sequence: 3 }
  const auditedRun = { id: runId, user_id: earlier, organization_id: organizationId,
    context_chat_conversation_id: conversationId, context_chat_message_id: source,
    status: 'completed', capability: 'context_chat_answer', output_text: assistant.body,
    context_manifest: { dispatch_claim_id: claimId, provider_response_id: 'provider-response' } }
  const rows = [ownerTurn, assistant, nextTurn]
  const evidence = { conversationId, organizationId, sourceTurns: [ownerTurn], auditedRuns: [auditedRun] }
  assert.doesNotThrow(() => requireOwnerAuthoredPromptTurns(rows, earlier, evidence))
  assert.doesNotThrow(() => requireOwnerAuthoredPromptTurns(rows, earlier,
    { ...evidence, auditedRuns: [{ ...auditedRun, output_text: '  Audited answer  ' }] }))
  const prompt = JSON.parse(buildPrivateConversationPrompt(rows, nextId,
    { context_kind: 'organization', project_id: null, department_id: null }))
  assert.deepEqual(prompt.turns.map(turn => turn.role), ['user', 'assistant', 'user'])
  assert.throws(() => requireOwnerAuthoredPromptTurns(
    [ownerTurn, { ...nextTurn, author_id: nextId }], earlier, evidence))
  assert.throws(() => requireOwnerAuthoredPromptTurns(rows, earlier,
    { ...evidence, auditedRuns: [] }))
  assert.throws(() => requireOwnerAuthoredPromptTurns(rows, earlier,
    { ...evidence, sourceTurns: [{ ...ownerTurn, author_id: nextId }] }))
  assert.throws(() => requireOwnerAuthoredPromptTurns(
    [ownerTurn, { ...assistant, owner_id: nextId }, nextTurn], earlier, evidence))
  assert.throws(() => requireOwnerAuthoredPromptTurns(rows, earlier,
    { ...evidence, auditedRuns: [{ ...auditedRun, user_id: nextId }] }))
  assert.throws(() => requireOwnerAuthoredPromptTurns(rows, earlier,
    { ...evidence, auditedRuns: [{ ...auditedRun, context_chat_conversation_id: nextId }] }))
  assert.throws(() => requireOwnerAuthoredPromptTurns(rows, earlier,
    { ...evidence, auditedRuns: [{ ...auditedRun, context_manifest: { dispatch_claim_id: nextId } }] }))
  assert.throws(() => requireOwnerAuthoredPromptTurns(
    [ownerTurn, { ...assistant, in_reply_to_message_id: nextId }, nextTurn], earlier, evidence))
})

test('private prompt binds each exact context without borrowing another scope', () => {
  const contexts = [
    [{ context_kind: 'organization', project_id: null, department_id: null },
      { scope: 'owner_private_organization_conversation' }],
    [{ context_kind: 'project_team', project_id: earlier, department_id: null },
      { scope: 'owner_private_project_conversation' }],
    [{ context_kind: 'department_private', project_id: null, department_id: 'design' },
      { scope: 'owner_private_department_conversation', department_id: 'design' }],
  ]
  for (const [context, expected] of contexts) {
    const prompt = JSON.parse(buildPrivateConversationPrompt([sourceTurn], source, context))
    assert.deepEqual(Object.fromEntries(Object.entries(prompt).filter(([key]) => key !== 'turns')), expected)
    assert.equal(JSON.stringify(prompt).includes(source), false)
    assert.equal(JSON.stringify(prompt).includes(earlier), false)
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

test('explicit OpenAI work context projects only approved bounded fields', () => {
  const workSummary = {
    scope: 'selected_project', as_of: '2026-09-25T00:00:00.000Z',
    private_note: 'never-send',
    coverage: { visible_projects_scanned: 1, projects_included: 1,
      more_visible_projects_possible: false, projects_omitted_from_bounded_summary: false,
      assignee_labels_available: true, private_email: 'never@send.test' },
    projects: [{ id: earlier, name: 'Website', status: 'active', health: 'at_risk',
      description: 'raw description never-send',
      sample: { project_tasks: 1, engagement_work_items: 0, linked_engagement: false,
        more_records_possible: false, project_task_statuses: { blocked: 1, private_count: 44 },
        engagement_work_item_statuses: {}, private_count: 44 },
      project_tasks: [{ id: earlier, title: 'Fix page alice@example.com', status: 'blocked',
        due: '2026-09-27', assignee: 'Jamie Example', description: 'never-send' }],
      engagement_work_items: [], review_states_in_recent_visible_version_sample: { ready_for_internal_review: 1 },
      raw_file: 'never-send' }],
  }
  const canonical = canonicalOpenAiContext(
    { id: earlier, name: 'Anka', private_note: 'never-send' },
    { id: earlier, name: 'Website', description: 'Scope for bob@example.com',
      status: 'active', health: 'at_risk', scope_statement: 'Launch', exclusions: 'None',
      private_note: 'never-send' }, workSummary)
  const payload = JSON.parse(buildPrivateConversationPrompt([sourceTurn], source,
    { context_kind: 'project_team', project_id: earlier }, canonical))
  assert.equal(payload.canonical_context.work_summary.projects[0].project_tasks[0].assignee, 'Jamie Example')
  assert.equal(payload.canonical_context.work_summary.projects[0].sample.project_task_statuses.blocked, 1)
  assert.equal(payload.canonical_context.work_summary.projects[0].review_states_in_recent_visible_version_sample.ready_for_internal_review, 1)
  const encoded = JSON.stringify(payload)
  for (const forbidden of [earlier, 'alice@example.com', 'bob@example.com', 'never@send.test',
    'never-send', 'raw description', 'raw_file', 'private_count']) {
    assert.equal(encoded.includes(forbidden), false, forbidden)
  }
  assert.equal(JSON.stringify(canonicalOpenAiContext({ name: 'Anka' })).includes('work_summary'), false)
  assert.throws(() => canonicalOpenAiContext({ name: 'Anka' }, null, { scope: 'wrong', projects: [] }))
})
