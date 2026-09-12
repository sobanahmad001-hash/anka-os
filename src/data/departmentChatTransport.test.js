import assert from 'node:assert/strict'
import test from 'node:test'
import { createDepartmentChatRepository } from './departmentChatTransport.js'
import { createChatCompletionGuard, handleCurrentChatFailure } from './departmentChatIdentity.js'
import { isOrganizationAccessError } from './organizationScope.js'

function repository(envelope) {
  const query = { select: () => query, eq: () => query, single: async () => envelope }
  return createDepartmentChatRepository({ functions: { invoke: async () => envelope }, from: () => query })
}

const actions = {
  preview: repo => repo.proposeArtifact('content', {}, { organizationId: 'org' }),
  workPreview: repo => repo.proposeWorkItem('content', {}, { organizationId: 'org' }),
  confirm: repo => repo.confirmProposal('proposal', { organizationId: 'org' }),
  reject: repo => repo.rejectProposal('proposal', { organizationId: 'org' }),
  officialRead: repo => repo.getOfficialRecord('org', { work_item_id: 'item' }),
}

test('all WCH actions carry the selected organization and exact current abort signal', async () => {
  const calls = []
  const controller = new AbortController()
  const scope = { organizationId: 'B', signal: controller.signal }
  const repo = createDepartmentChatRepository({ functions: { invoke: async (name, options) => { calls.push({ name, ...options }); return { data: { data: {} } } } } })
  await repo.proposeArtifact('development', { organization_id: 'A', action: 'injected' }, scope)
  await repo.proposeWorkItem('development', { organization_id: 'A' }, scope)
  await repo.confirmProposal('proposal-B', scope)
  await repo.rejectProposal('proposal-B', scope)
  assert.deepEqual(calls.map(call => call.body.action), ['propose_artifact', 'propose_work_item', 'confirm_proposal', 'reject_proposal'])
  for (const call of calls) {
    assert.equal(call.body.organization_id, 'B')
    assert.equal(call.signal, controller.signal)
  }
})

test('saved conversation actions keep exact caller context and cannot override selected organization', async () => {
  const calls = []
  const controller = new AbortController()
  const scope = { organizationId: 'B', signal: controller.signal }
  const repo = createDepartmentChatRepository({
    functions: { invoke: async (name, options) => {
      calls.push({ name, ...options })
      return { data: { data: [] } }
    } },
  })
  const input = { organization_id: 'A', project_id: 'project-B', engagement_id: 'engagement-B' }
  await repo.listConversations('content', input, scope)
  await repo.searchConversations('content', { ...input, query: 'planning', limit: 25 }, scope)
  await repo.createConversation('content', { ...input, title: 'Private thread' }, scope)
  await repo.getConversation('content', { ...input, conversation_id: 'conversation-B' }, scope)
  await repo.renameConversation('content', { ...input, conversation_id: 'conversation-B', title: 'Renamed' }, scope)
  await repo.setConversationState('content', { ...input, conversation_id: 'conversation-B', state: 'archived' }, scope)
  await repo.getCapabilities('content', input, scope)
  assert.deepEqual(calls.map(call => call.body.action), [
    'list_conversations', 'search_conversations', 'create_conversation', 'get_conversation',
    'rename_conversation', 'set_conversation_state', 'get_capabilities',
  ])
  for (const call of calls) {
    assert.equal(call.body.organization_id, 'B')
    assert.equal(call.body.department_id, 'content')
    assert.equal(call.body.project_id, 'project-B')
    assert.equal(call.body.engagement_id, 'engagement-B')
    assert.equal(call.signal, controller.signal)
  }
  assert.equal(calls[1].body.query, 'planning')
  assert.equal(calls[1].body.limit, 25)
})

test('official read narrows to selected organization and forwards cancellation', async () => {
  const filters = []
  const controller = new AbortController()
  let seenSignal
  const query = { select: () => query, eq: (key, value) => { filters.push([key, value]); return query },
    abortSignal: signal => { seenSignal = signal; return query }, single: async () => ({ data: { id: 'item-B' } }) }
  const repo = createDepartmentChatRepository({ from: () => query })
  await repo.getOfficialRecord('B', { work_item_id: 'item-B' }, { signal: controller.signal })
  assert.deepEqual(filters, [['organization_id', 'B'], ['id', 'item-B']])
  assert.equal(seenSignal, controller.signal)
})

test('missing selection and already-aborted scope never invoke WCH', async () => {
  let called = false
  const repo = createDepartmentChatRepository({ functions: { invoke: async () => { called = true } } })
  await assert.rejects(repo.confirmProposal('proposal'), error => error.status === 400)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(repo.rejectProposal('proposal', { organizationId: 'B', signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(called, false)
})

for (const success of [true, false]) {
  test('delayed A transport after B selection cannot complete UI or recover organization: ' + success, async () => {
    let resolve
    const pending = new Promise(done => { resolve = done })
    const controller = new AbortController()
    const guard = createChatCompletionGuard(controller.signal)
    const current = guard.begin()
    let state = 'A'
    let refreshes = 0
    let receivedSignal
    const repo = createDepartmentChatRepository({ functions: { invoke: (_name, options) => { receivedSignal = options.signal; return pending } } })
    const operation = repo.confirmProposal('proposal-A', { organizationId: 'A', signal: controller.signal })
      .then(() => { if (current()) state = 'late A' })
      .catch(reason => handleCurrentChatFailure(current, reason, () => refreshes++, () => { state = 'late error' }))
    controller.abort(); guard.dispose(); state = 'B'
    resolve(success ? { data: { data: { outcome: 'accepted' } } } : { status: 403, error: { message: 'Denied' } })
    await operation
    assert.equal(receivedSignal.aborted, true)
    assert.equal(state, 'B')
    assert.equal(refreshes, 0)
  })
}

for (const [name, action] of Object.entries(actions)) {
  test(name + ' preserves envelope-only 403 and invokes current organization recovery', async () => {
    const repo = repository({ status: 403, data: null, error: { message: 'Forbidden' } })
    const guard = createChatCompletionGuard()
    let refreshes = 0
    await assert.rejects(action(repo), error => {
      handleCurrentChatFailure(guard.begin(), error, reason => { if (isOrganizationAccessError(reason)) refreshes++ }, () => {})
      assert.equal(error.status, 403)
      return true
    })
    assert.equal(refreshes, 1)
  })
  test(name + ' late old-context 403 cannot refresh or block new selection', async () => {
    let resolve
    const response = new Promise(done => { resolve = done })
    const query = { select: () => query, eq: () => query, single: () => response }
    const repo = createDepartmentChatRepository({ functions: { invoke: () => response }, from: () => query })
    const old = createChatCompletionGuard()
    const current = old.begin()
    let selection = 'A'
    let refreshes = 0
    let errors = 0
    const pending = action(repo).catch(error => handleCurrentChatFailure(current, error, () => { refreshes++; selection = null }, () => errors++))
    old.dispose()
    selection = 'B'
    resolve({ status: 403, error: { message: 'Forbidden' } })
    await pending
    assert.equal(selection, 'B')
    assert.equal(refreshes, 0)
    assert.equal(errors, 0)
  })
}

test('FunctionsHttpError context status wins and preserves terminal outcome', async () => {
  const repo = repository({ error: { status: 500, context: new Response(JSON.stringify({ error: 'Expired', outcome: 'expired' }), { status: 409 }) } })
  await assert.rejects(repo.confirmProposal('proposal', { organizationId: 'org' }), error => error.status === 409 && error.outcome === 'expired')
})

test('non-JSON function response preserves context status and fallback statuses', async () => {
  for (const error of [{ context: new Response('Forbidden', { status: 403 }) }, { status: 403 }, { statusCode: 403 }]) {
    await assert.rejects(repository({ error }).rejectProposal('proposal', { organizationId: 'org' }), reason => reason.status === 403)
  }
})

test('recovery abort suppresses remaining state completion', () => {
  const controller = new AbortController()
  const current = createChatCompletionGuard(controller.signal).begin()
  let shown = false
  handleCurrentChatFailure(current, { status: 403 }, () => controller.abort(), () => { shown = true })
  assert.equal(shown, false)
})
test('ordinary answer transport carries exact context and consumes genuine SSE events', async () => {
  const calls = []
  const events = []
  const stream = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"delta","delta":"Hi"}\n\n'))
      controller.enqueue(new TextEncoder().encode('data: {"type":"completed","answer":"Hi","ai_run_id":"run"}\n\n'))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  const repo = createDepartmentChatRepository({
    functions: { invoke: async (name, options) => { calls.push({ name, ...options }); return { data: stream, status: 200 } } },
  })
  const terminal = await repo.answer('content', {
    organization_id: 'A', conversation_id: 'conversation-B', project_id: 'project-B', engagement_id: 'engagement-B',
  }, { organizationId: 'B' }, { onEvent: event => events.push(event.type) })
  assert.equal(calls[0].body.action, 'answer')
  assert.equal(calls[0].body.organization_id, 'B')
  assert.deepEqual(events, ['delta', 'completed'])
  assert.equal(terminal.ai_run_id, 'run')
})
