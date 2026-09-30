// Isolated, provider-free fixture. This module is never imported by production.
import { contextChatTitleFromMessage } from '../src/data/contextChatTitle.js'
export const actor = 'a0000000-0000-4000-8000-000000000001'
export const organizationId = 'a0000000-0000-4000-8000-000000000002'
export const projectId = 'a0000000-0000-4000-8000-000000000003'
export const modelId = 'a0000000-0000-4000-8000-000000000004'
export const threadId = 'a0000000-0000-4000-8000-000000000005'
export const requestId = 'a0000000-0000-4000-8000-000000000006'
export const humanId = 'a0000000-0000-4000-8000-000000000007'
export const dispatchId = 'a0000000-0000-4000-8000-000000000008'
export const assistantId = 'a0000000-0000-4000-8000-000000000009'
export const ready = { paid_execution_enabled: true, spend_tracking_configured: true, model_status: 'configured', spend_guard_mode: 'local_monthly_cap' }
export const allowlist = { connections: [{ id: 'preview-connection', provider: 'openai', display_name: 'Approved text · fixture', organization_level: true, status: 'verified', context_model_configurations: [{ id: modelId, model_id: 'Approved text model · fixture' }] }] }
const failure = (message, status) => Object.assign(new Error(message), { status })

export function createDirectChatFixture({ surface = 'content', state = 'empty', stored, persist = () => {} } = {}) {
  const scope = surface === 'project' ? { context_kind: 'project_team', project_id: projectId, department_id: null } : { context_kind: 'department_private', department_id: 'content', project_id: null }
  const seeded = state !== 'empty'
  const conversation = { id: threadId, ...scope, organization_id: organizationId, engagement_id: null, owner_id: actor, title: 'A clear introduction', state: 'active' }
  const human = { id: humanId, conversation_id: threadId, client_request_id: requestId, author_id: actor, role: 'user', body: 'Write a clear introduction for our project.', status: 'completed', sequence: 1 }
  const assistant = { id: assistantId, conversation_id: threadId, in_reply_to_message_id: humanId, role: 'assistant', status: 'completed', sequence: 2,
    body: 'OFFLINE FIXTURE · No provider call\n\nA clear introduction starts with the people we serve and the problem we help them solve. This saved reply is illustrative preview content.' }
  const data = stored || { rows: seeded ? [conversation] : [], messages: seeded ? [human, ...(['populated', 'output-open'].includes(state) ? [assistant] : [])] : [], counters: { created: 0, messages: 0, run: 0, recover: 0 } }
  const fixture = { data, scope, readiness: ready, runFailure: false, createUncertain: false, recoveryAvailable: !['failed', 'uncertain'].includes(state), beforeStart: null, beforeRun: null }
  fixture.engagements = [{ id: 'a0000000-0000-4000-8000-000000000020', organization_id: organizationId, project_id: projectId, name: 'Website Content' }]
  fixture.workstreams = [{ project_id: projectId, projects: { name: 'Launch project' } }]
  const save = () => persist(data)
  function append(input) {
    const existing = data.messages.find(row => row.conversation_id === input.conversation_id && row.client_request_id === input.client_request_id)
    if (existing) { if (existing.body !== input.message) throw failure('Request body mismatch', 409); return existing }
    const message = { id: crypto.randomUUID(), conversation_id: input.conversation_id, client_request_id: input.client_request_id, author_id: actor,
      role: 'user', body: input.message, status: 'completed', sequence: data.messages.filter(row => row.conversation_id === input.conversation_id).length + 1 }
    data.messages.push(message); data.counters.messages++; save(); return message
  }
  function reply(messageId) {
    const source = data.messages.find(row => row.id === messageId)
    let message = data.messages.find(row => row.in_reply_to_message_id === messageId)
    if (!message) {
      message = { ...assistant, id: crypto.randomUUID(), conversation_id: source.conversation_id, in_reply_to_message_id: messageId,
        sequence: data.messages.filter(row => row.conversation_id === source.conversation_id).length + 1 }
      data.messages.push(message); save()
    }
    return { status: 'completed', message }
  }
  fixture.chat = {
    searchConversations: async (_department, input) => ({ items: 'Page brief · separate project history'.toLowerCase().includes((input.query || '').toLowerCase()) ? [{ id: 'a0000000-0000-4000-8000-000000000021', organization_id: organizationId, department_id: 'content', project_id: input.project_id, engagement_id: input.engagement_id, title: 'Page brief · separate project history', state: 'active', access_role: 'owner' }] : [], next_cursor: null }),
    listContextConversations: async input => data.rows.filter(row => row.context_kind === input.context_kind && (row.project_id || '') === (input.project_id || '') && (row.department_id || '') === (input.department_id || '')).slice(input.offset || 0, (input.offset || 0) + 51),
    getContextConversation: async input => {
      const row = data.rows.find(item => item.id === input.conversation_id)
      if (!row) throw failure('Conversation unavailable', 404)
      return { conversation: { ...row }, messages: data.messages.filter(item => item.conversation_id === row.id && (!input.before_sequence || item.sequence < input.before_sequence)).map(item => ({ ...item })), has_older: false }
    },
    startContextConversation: async input => {
      await fixture.beforeStart?.(input)
      let row = data.rows.find(item => item.id === input.conversation_id)
      if (!row) { row = { ...conversation, ...scope, id: input.conversation_id, title: contextChatTitleFromMessage(input.message) }; data.rows.push(row); data.counters.created++; save() }
      const message = append(input)
      if (fixture.createUncertain) { fixture.createUncertain = false; throw failure('Creation response lost · fixture', 503) }
      return { conversation: { ...row }, message }
    },
    appendContextHumanMessage: async input => append(input),
    getContextChatReadiness: async () => fixture.readiness,
    renameContextConversation: async input => { const row = data.rows.find(item => item.id === input.conversation_id); row.title = input.title; save(); return { ...row } },
    getProjectContextSharing: async () => ({ candidates: [], recipients: [] }),
    setProjectContextSharing: async () => ({}),
  }
  fixture.runner = {
    run: async input => {
      data.counters.run++; save(); await fixture.beforeRun?.(input)
      if (fixture.runFailure) throw failure('Reply outcome uncertain · fixture. Check recovery.', 503)
      return reply(input.message_id)
    },
    recover: async messageId => { data.counters.recover++; save(); if (!fixture.recoveryAvailable) throw failure('No settled reply yet · fixture. No provider request was sent.', 409); return reply(messageId) },
  }
  return fixture
}
