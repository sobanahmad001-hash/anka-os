import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import {
  CHAT_MARKETING_ARTIFACT_TYPE_SET,
  attachmentContentDisposition,
  sha256AttachmentBytes,
  ENABLED_DEPARTMENTS,
  confirmProposal,
  departmentChatExternalEndpoint,
  freezeDepartmentChatContext,
  hasDepartmentChatAuthority,
  handleRequest,
  isDepartmentChatArtifactType,
  marketingArtifactResponseFormat,
  outputText,
  proposeArtifact,
  resolveContentProposalLanguage,
  proposeWorkItem,
  rejectProposal,
  requireDepartmentEngagement,
  resolveSingleOpenAiModel,
  selectApprovedModelConfiguration,
  selectSingleOpenAiModel,
  safeAttemptReason,
} from './index.ts'

Deno.test('CHAT-3 download disposition is ASCII-safe and preserves UTF-8 without header injection', () => {
  assertEquals(
    attachmentContentDisposition('quote" slash\\ line\r\n résumé.txt'),
    'attachment; filename="quote_ slash_ line__ r_sum_.txt"; filename*=UTF-8\'\'quote%22%20slash%5C%20line%0D%0A%20r%C3%A9sum%C3%A9.txt',
  )
  assertEquals(attachmentContentDisposition(''), 'attachment; filename="attachment"; filename*=UTF-8\'\'')
})

Deno.test('CHAT-3 attachment hashing copies into an ArrayBuffer-backed WebCrypto input', async () => {
  assertEquals(
    await sha256AttachmentBytes(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

Deno.test('B02 Content proposal language follows explicit, approved-brand, organization, then require-selection precedence', () => {
  const context = [{ artifact_type: 'vision', content: { language: 'Arabic' } }]
  assertEquals(resolveContentProposalLanguage({ language: 'Urdu' }, context, { default_language: 'French' }, 'discovery'), 'Urdu')
  assertEquals(resolveContentProposalLanguage({}, context, { default_language: 'French' }, 'audience'), 'Arabic')
  assertEquals(resolveContentProposalLanguage({}, [], { default_language: 'French' }, 'vision'), 'French')
  assertEquals(resolveContentProposalLanguage({}, [], {}, 'content'), null)
  assertThrows(() => resolveContentProposalLanguage({}, [], {}, 'discovery'), Error, 'Select a language')
})
import { contentArtifactResponseFormat } from '../_shared/contentArtifacts.ts'
import { departmentChatProfile } from '../_shared/departmentChatProfiles.ts'
import { createDurableDepartmentChatAnswerStream } from '../_shared/departmentChatResponseStream.ts'
import { developmentChatArtifactResponseFormat } from '../_shared/developmentChatArtifacts.ts'
import {
  CHAT_DESIGN_ARTIFACT_TYPE_SET,
  designArtifactResponseFormat,
  validateDesignSystemArtifact,
} from '../_shared/designSystemArtifacts.ts'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'

// Executes the real request, authorization, context, connector and RPC boundaries.
// The query double honors predicates; RPC results are synthetic, not SQL execution.
function selectedOrganizationFixture() {
  const rows: Record<string, any[]> = {}
  const queries: Array<{ table: string, filters: Array<[string, unknown]> }> = []
  const rpcCalls: Array<{ name: string, args: any }> = []
  let providerCalls = 0
  const providerRequests: RequestInit[] = []
  const backgroundTasks: Promise<void>[] = []
  let beginReplay = false
  let beginError: any = null
  let providerFailure = ''
  let modelDispatchError: any = null
  const events: string[] = []
  for (const org of ['A', 'B', 'C']) {
    const add = (table: string, value: any) => (rows[table] ||= []).push({ organization_id: org, ...value })
    add('organizations', { id: org, status: 'active', settings: { ai_monthly_budget_microusd: 100 } })
    if (org !== 'C') add('organization_memberships', { user_id: 'actor', status: 'active', member_kind: 'team', role: 'contributor', department_id: 'development' })
    add('engagements', { id: 'engagement-' + org, client_id: 'agency-' + org, project_id: 'project-' + org, brand_id: 'brand-' + org, status: 'active' })
    add('agency_clients', { id: 'agency-' + org, canonical_client_id: 'client-' + org })
    add('clients', { id: 'client-' + org })
    add('projects', { id: 'project-' + org, client_id: 'client-' + org, archived_at: null })
    add('brands', { id: 'brand-' + org, client_id: 'agency-' + org })
    add('engagement_services', { id: 'service-' + org, engagement_id: 'engagement-' + org, status: 'active', service_catalog: { department_id: 'development' } })
    add('engagement_stage_instances', { id: 'stage-' + org, engagement_id: 'engagement-' + org, accountable_department_id: 'development' })
    add('integration_connections', { id: 'connector-' + org, status: 'verified', provider: 'openai', archived_at: null,
      secret_name: 'SYNTHETIC', public_config: { model_id: 'offline' },
      integration_connection_departments: { department_id: 'development' },
      integration_connection_engagements: { engagement_id: 'engagement-' + org, department_id: 'development' } })
    for (const departmentId of ['content', 'design', 'marketing']) {
      add('department_chat_model_configurations', {
        id: `model-configuration-${org}-${departmentId}`,
        connector_connection_id: 'connector-' + org, department_id: departmentId,
        model_id: 'offline', display_name: 'Offline fixture', is_default: true,
        revoked_at: null, verified_at: '2026-09-11T00:00:00Z',
      })
    }
    add('department_chat_proposals', { ...pendingProposal, id: 'proposal-' + org, organization_id: org,
      engagement_id: 'engagement-' + org, project_id: 'project-' + org, proposer_id: 'actor', connector_connection_id: 'connector-' + org })
    add('department_chat_conversations', {
      id: 'conversation-' + org, project_id: 'project-' + org, engagement_id: 'engagement-' + org,
      department_id: 'development', owner_id: 'actor', title: 'Private thread', state: 'active',
      last_activity_at: '2026-09-10T00:00:00Z',
    })
  }
  const admin: any = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const entry = { table, filters }; queries.push(entry)
      const path = (row: any, key: string) => key.split('.').reduce((value, field) => value?.[field], row)
      const result = (single = false) => {
        const matching = (rows[table] || []).filter(row => filters.every(([key, value]) => path(row, key) === value))
        return { data: single ? matching[0] || null : matching, error: null, count: matching.length }
      }
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query },
        // No dated/approved rows are present in this fixture.
        gte: () => query, in: () => query, neq: () => query, order: () => query,
        single: async () => result(true), maybeSingle: async () => result(true),
        then: (resolve: any) => Promise.resolve(result()).then(resolve),
      }
      return query
    },
    async rpc(name: string, args: any) {
      rpcCalls.push({ name, args })
      events.push('rpc:' + name)
      if (name === 'assert_department_chat_model_dispatch' && modelDispatchError) {
        return { data: null, error: modelDispatchError }
      }
      if (name === 'begin_department_chat_turn_with_attachments' && beginError) return { data: null, error: beginError }
      if (name === 'can_access_department_chat_conversation') {
        const conversation = (rows.department_chat_conversations || []).find(row =>
          row.id === args.p_conversation_id && row.organization_id === args.p_organization_id
          && row.project_id === args.p_project_id && row.engagement_id === args.p_engagement_id
          && row.department_id === args.p_department_id)
        const organization = (rows.organizations || []).find(row =>
          row.id === args.p_organization_id && row.status === 'active')
        const membership = (rows.organization_memberships || []).find(row =>
          row.organization_id === args.p_organization_id && row.user_id === args.p_actor_id
          && row.member_kind === 'team' && row.status === 'active'
          && (row.department_id === args.p_department_id
            || ['system_owner', 'operations_admin', 'executive'].includes(row.role)))
        const engagement = (rows.engagements || []).find(row =>
          row.id === args.p_engagement_id && row.organization_id === args.p_organization_id
          && row.project_id === args.p_project_id && row.status !== 'cancelled')
        const project = (rows.projects || []).find(row =>
          row.id === args.p_project_id && row.organization_id === args.p_organization_id
          && row.archived_at === null)
        const service = (rows.engagement_services || []).find(row =>
          row.organization_id === args.p_organization_id && row.engagement_id === args.p_engagement_id
          && row.status === 'active' && row.service_catalog?.department_id === args.p_department_id)
        const shared = (rows.department_chat_conversation_shares || []).some(row =>
          row.conversation_id === args.p_conversation_id && row.organization_id === args.p_organization_id
          && row.recipient_id === args.p_actor_id && row.revoked_at === null)
        const currentContributor = Boolean(organization && membership && engagement && project && service)
        return { data: Boolean(conversation && currentContributor && (conversation.owner_id === args.p_actor_id || shared)), error: null }
      }
      return { data: name === 'begin_department_chat_turn_with_attachments' ? {
          message: { id: 'message-B', status: 'pending' }, replayed: beginReplay,
        }
        : name === 'save_department_chat_proposal' || name === 'save_department_chat_conversation_proposal'
          || name === 'save_department_chat_proposal_with_model'
          || name === 'save_department_chat_conversation_proposal_with_model'
          ? { status: 'pending', proposal_id: 'saved-B', ai_run_id: 'run-B' }
        : name === 'complete_department_chat_answer' ? {
          conversation_id: args.p_conversation_id, user_message_id: args.p_message_id,
          assistant_message_id: 'assistant-B', ai_run_id: 'run-answer-B',
          model_configuration_id: args.p_model_configuration_id, replayed: false,
        }
        : name === 'reject_department_chat_proposal' ? { outcome: 'rejected' }
        : { outcome: 'accepted', artifact_version_id: 'version-B' }, error: null }
    },
  }
  const request = (body: any) => handleRequest(new Request('http://offline/department-chat', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), {
    clients: { admin, userClient: { auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) } } as any },
    fetcher: (async (_url, init) => {
      providerCalls++
      providerRequests.push(init || {})
      events.push('provider')
      if (providerFailure === 'network') throw new TypeError('connection reset after dispatch')
      if (providerFailure === '408' || providerFailure === '504') return new Response(JSON.stringify({ error: { message: 'gateway timeout' } }), { status: Number(providerFailure) })
      if (providerFailure === '400') return new Response(JSON.stringify({ error: { message: 'rejected' } }), { status: 400 })
      const requestBody = JSON.parse(String(init?.body || '{}'))
      if (requestBody.stream === true) {
        const events = providerFailure === 'stream-drop'
          ? ['data: {"type":"response.output_text.delta","delta":"Partial"}\n\n']
          : providerFailure === 'stream-failed'
          ? ['data: {"type":"response.failed","response":{"status":"failed"}}\n\n']
          : [
            'data: {"type":"response.output_text.delta","delta":"Offline "}\n\n',
            'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
            'data: {"type":"response.completed","response":{"output_text":"Offline answer","usage":{"input_tokens":7,"output_tokens":2}}}\n\n',
          ]
        return new Response(new ReadableStream({
          start(controller) {
            for (const event of events) controller.enqueue(new TextEncoder().encode(event))
            controller.close()
          },
        }), { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return new Response(JSON.stringify({ output_text: JSON.stringify({ notes: 'Offline', checklist: ['Test'] }) }))
    }) as typeof fetch,
    waitUntil: promise => { backgroundTasks.push(promise) },
    proposal: { estimatedCost: () => 0, resolveSingleOpenAiModel: (client, engagement, department, organization, _credential, selected) =>
      resolveSingleOpenAiModel(client, engagement, department, organization, () => 'synthetic-key', selected) },
  })
  return {
    rows, queries, rpcCalls, request, events, admin, providerRequests, backgroundTasks,
    providerCalls: () => providerCalls,
    setBeginReplay: (value: boolean) => { beginReplay = value },
    setBeginError: (value: any) => { beginError = value },
    setProviderFailure: (value: string) => { providerFailure = value },
    setModelDispatchError: (value: any) => { modelDispatchError = value },
  }
}

Deno.test('P9 model selection accepts only an approved verified configuration identity', () => {
  const configurations = [
    { id: 'configuration-default', model_id: 'verified-default', display_name: 'Default', is_default: true },
    { id: 'configuration-other', model_id: 'verified-other', display_name: 'Other', is_default: false },
    { id: 'configuration-fabricated', model_id: 'browser-invented', display_name: 'Invented', is_default: false },
  ]
  assertEquals(selectApprovedModelConfiguration(
    configurations, ['verified-default', 'verified-other'], 'content', 'configuration-other',
  ).model, 'verified-other')
  assertEquals(selectApprovedModelConfiguration(
    configurations, ['verified-default'], 'content',
  ).configurationId, 'configuration-default')
  assertThrows(() => selectApprovedModelConfiguration(
    configurations, ['verified-default', 'verified-other'], 'content', 'configuration-stale',
  ), Error, 'stale or no longer approved')
  assertThrows(() => selectApprovedModelConfiguration(
    [{ id: 'configuration-fabricated', model_id: 'browser-invented' }],
    ['verified-default'], 'content', 'configuration-fabricated',
  ), Error, 'No administrator-approved model')
})

Deno.test('P9 stale model dispatch is rejected before provider call with no fallback', async () => {
  const fixture = selectedOrganizationFixture()
  Object.assign(fixture.rows.organization_memberships.find(row => row.organization_id === 'B'), {
    department_id: 'content', role: 'contributor',
  })
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  fixture.setModelDispatchError({ code: '23514', message: 'stale' })
  const response = await fixture.request({
    action: 'propose_work_item', organization_id: 'B', project_id: 'project-B',
    engagement_id: 'engagement-B', department_id: 'content',
    title: 'No paid retry', work_item_type: 'task', priority: 'medium',
    prompt: 'Do not dispatch', prompt_safe_for_ai: true,
    model_configuration_id: 'model-configuration-B-content',
  })
  assertEquals(response.status, 409)
  assertEquals((await response.json()).outcome, 'stale')
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'mark_department_chat_turn_dispatched'), false)
})

const selectedPreview = { action: 'propose_artifact', organization_id: 'B', engagement_id: 'engagement-B',
  department_id: 'development', artifact_type: 'technical_brief', engagement_stage_instance_id: 'stage-B',
  prompt: 'Offline fixture', prompt_safe_for_ai: true }

Deno.test('selected B succeeds through real request boundaries with every read, save and attempt scoped to B', async () => {
  const fixture = selectedOrganizationFixture()
  const response = await fixture.request(selectedPreview)
  assertEquals(response.status, 200)
  assertEquals(fixture.providerCalls(), 1)
  for (const { table, filters } of fixture.queries) {
    assertEquals(filters.some(([key, value]) => key === (table === 'organizations' ? 'id' : 'organization_id') && value === 'B'), true, table)
  }
  const save = fixture.rpcCalls.find(call => call.name === 'save_department_chat_proposal')!
  assertEquals(save.args.p_organization_id, 'B')
  assertEquals(save.args.p_engagement_id, 'engagement-B')
  assertEquals(save.args.p_project_id, 'project-B')
  assertEquals(save.args.p_connector_connection_id, 'connector-B')
  assertEquals(save.args.p_engagement_stage_instance_id, 'stage-B')
  assertEquals(fixture.rpcCalls.filter(call => call.name === 'record_department_chat_attempt').every(call =>
    call.args.p_organization_id === 'B' && !JSON.stringify(call.args).includes('Offline fixture')), true)
})

Deno.test('saved conversations list and open only the current actor exact B work context', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  const conversation = fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B')
  conversation.department_id = 'content'
  fixture.rows.department_chat_conversations.push({
    ...conversation, id: 'conversation-other', owner_id: 'other-user', title: 'Must stay private',
  })
  fixture.rows.department_chat_messages = []

  const scope = {
    organization_id: 'B', project_id: 'project-B', engagement_id: 'engagement-B', department_id: 'content',
  }
  const listed = await fixture.request({ action: 'list_conversations', ...scope })
  assertEquals(listed.status, 200)
  assertEquals((await listed.json()).data.map((item: any) => item.id), ['conversation-B'])

  const opened = await fixture.request({ action: 'get_conversation', ...scope, conversation_id: 'conversation-B' })
  assertEquals(opened.status, 200)
  assertEquals((await opened.json()).data.conversation.owner_id, 'actor')
  const expiry = fixture.rpcCalls.find(call => call.name === 'expire_department_chat_pending_turns')!
  assertEquals(expiry.args.p_conversation_id, 'conversation-B')
  assertEquals(expiry.args.p_organization_id, 'B')
})

Deno.test('a suspended owner cannot open or reply through the service-role access boundary', async () => {
  const fixture = selectedOrganizationFixture()
  const membership = fixture.rows.organization_memberships.find(row => row.organization_id === 'B')
  membership.status = 'suspended'
  const scope = {
    organization_id: 'B', project_id: 'project-B', engagement_id: 'engagement-B',
    department_id: 'development', conversation_id: 'conversation-B',
  }
  const access = await fixture.admin.rpc('can_access_department_chat_conversation', {
    p_conversation_id: 'conversation-B',
    p_organization_id: 'B',
    p_project_id: 'project-B',
    p_engagement_id: 'engagement-B',
    p_department_id: 'development',
    p_actor_id: 'actor',
  })
  assertEquals(access.data, false)
  const opened = await fixture.request({ action: 'get_conversation', ...scope })
  assertEquals(opened.status, 403)
  const reply = await fixture.request({
    action: 'propose_work_item', ...scope, client_request_id: 'suspended-owner-request',
    title: 'Blocked', work_item_type: 'task', priority: 'medium',
    prompt: 'This must not dispatch.', prompt_safe_for_ai: true,
  })
  assertEquals(reply.status, 403)
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'begin_department_chat_turn_with_attachments'), false)
})

Deno.test('an active internal recipient can list, open, and reply without becoming the owner', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  const conversation = fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B')
  conversation.department_id = 'content'
  conversation.owner_id = 'creator'
  fixture.rows.department_chat_conversation_shares = [{
    organization_id: 'B', project_id: 'project-B', engagement_id: 'engagement-B',
    department_id: 'content', conversation_id: 'conversation-B', owner_id: 'creator',
    recipient_id: 'actor', revoked_at: null,
  }]
  fixture.rows.department_chat_messages = []
  const scope = {
    organization_id: 'B', project_id: 'project-B', engagement_id: 'engagement-B', department_id: 'content',
  }
  const listed = await fixture.request({ action: 'list_conversations', ...scope })
  assertEquals(listed.status, 200)
  assertEquals((await listed.json()).data[0].access_role, 'recipient')
  const opened = await fixture.request({ action: 'get_conversation', ...scope, conversation_id: 'conversation-B' })
  assertEquals(opened.status, 200)
  assertEquals((await opened.json()).data.sharing.can_manage, false)
  const reply = await fixture.request({
    action: 'propose_work_item', ...scope, conversation_id: 'conversation-B',
    client_request_id: 'recipient-request', title: 'Collaborative reply',
    work_item_type: 'task', priority: 'medium', prompt: 'Reply as the actual author.',
    prompt_safe_for_ai: true,
  })
  assertEquals(reply.status, 200)
  assertEquals(fixture.rpcCalls.find(call => call.name === 'begin_department_chat_turn_with_attachments')!.args.p_actor_id, 'actor')
})

Deno.test('revocation removes later recipient reads and replies before provider dispatch', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  const conversation = fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B')
  conversation.department_id = 'content'
  conversation.owner_id = 'creator'
  fixture.rows.department_chat_conversation_shares = [{
    organization_id: 'B', project_id: 'project-B', engagement_id: 'engagement-B',
    department_id: 'content', conversation_id: 'conversation-B', owner_id: 'creator',
    recipient_id: 'actor', revoked_at: '2026-09-10T01:00:00Z',
  }]
  const scope = {
    organization_id: 'B', project_id: 'project-B', engagement_id: 'engagement-B',
    department_id: 'content', conversation_id: 'conversation-B',
  }
  const opened = await fixture.request({ action: 'get_conversation', ...scope })
  assertEquals(opened.status, 404)
  const reply = await fixture.request({
    action: 'propose_work_item', ...scope, client_request_id: 'revoked-request',
    title: 'Blocked', work_item_type: 'task', priority: 'medium',
    prompt: 'This must not dispatch.', prompt_safe_for_ai: true,
  })
  assertEquals(reply.status, 404)
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'begin_department_chat_turn_with_attachments'), false)
})

Deno.test('saved work-item turn reserves once and uses the atomic conversation proposal wrapper', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B').department_id = 'content'

  const response = await fixture.request({
    action: 'propose_work_item',
    organization_id: 'B',
    project_id: 'project-B',
    engagement_id: 'engagement-B',
    department_id: 'content',
    conversation_id: 'conversation-B',
    client_request_id: 'request-B',
    title: 'Saved request',
    work_item_type: 'task',
    priority: 'medium',
    prompt: 'Keep this creator-private.',
    prompt_safe_for_ai: true,
  })
  assertEquals(response.status, 200)
  assertEquals(fixture.providerCalls(), 1)
  const begin = fixture.rpcCalls.find(call => call.name === 'begin_department_chat_turn_with_attachments')!
  assertEquals(begin.args.p_conversation_id, 'conversation-B')
  assertEquals(begin.args.p_client_request_id, 'request-B')
  assertEquals(begin.args.p_attachment_ids, [])
  const save = fixture.rpcCalls.find(call => call.name === 'save_department_chat_conversation_proposal_with_model')!
  assertEquals(save.args.p_conversation_id, 'conversation-B')
  assertEquals(save.args.p_message_id, 'message-B')
  assertEquals(fixture.rpcCalls.some(call => call.name === 'save_department_chat_proposal'
    || call.name === 'save_department_chat_proposal_with_model'), false)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'fail_department_chat_turn'), false)
})

Deno.test('a replayed pending client request never starts a second provider run', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.setBeginReplay(true)
  const response = await fixture.request({
    action: 'propose_work_item', organization_id: 'B', project_id: 'project-B',
    engagement_id: 'engagement-B', department_id: 'content',
    conversation_id: 'conversation-B', client_request_id: 'request-B',
    title: 'Duplicate', work_item_type: 'task', priority: 'medium',
    prompt: 'Duplicate request', prompt_safe_for_ai: true,
  })
  assertEquals(response.status, 409)
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'assert_department_chat_model_dispatch'), false)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'save_department_chat_conversation_proposal'), false)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'fail_department_chat_turn'), false)
})

Deno.test('a conflicting replay payload maps deterministically to 409 before provider dispatch', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B').department_id = 'content'
  const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  fixture.setBeginError({ code: '23505', message: 'client_request_id conflicts with a different prompt.' })
  const response = await fixture.request({
    action: 'propose_work_item', organization_id: 'B', project_id: 'project-B',
    engagement_id: 'engagement-B', department_id: 'content',
    conversation_id: 'conversation-B', client_request_id: 'request-B',
    title: 'Conflict', work_item_type: 'task', priority: 'medium',
    prompt: 'Different payload', prompt_safe_for_ai: true,
  })
  assertEquals(response.status, 409)
  assertEquals((await response.json()).outcome, 'idempotency_conflict')
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'fail_department_chat_turn'), false)
})

for (const failure of ['network', '408', '504']) {
  Deno.test('post-dispatch ' + failure + ' records outcome unknown and never marks safe failure', async () => {
    const fixture = selectedOrganizationFixture()
    fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
    fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
    fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B').department_id = 'content'
    const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
    connection.integration_connection_departments.department_id = 'content'
    connection.integration_connection_engagements.department_id = 'content'
    fixture.setProviderFailure(failure)
    const response = await fixture.request({
      action: 'propose_work_item', organization_id: 'B', project_id: 'project-B',
      engagement_id: 'engagement-B', department_id: 'content',
      conversation_id: 'conversation-B', client_request_id: 'request-B',
      title: 'Unknown', work_item_type: 'task', priority: 'medium',
      prompt: 'Ambiguous request', prompt_safe_for_ai: true,
    })
    const payload = await response.json()
    assertEquals(response.status, 503)
    assertEquals(payload.outcome, 'outcome_unknown')
    assertEquals(fixture.events.indexOf('rpc:mark_department_chat_turn_dispatched') < fixture.events.indexOf('provider'), true)
    assertEquals(fixture.rpcCalls.some(call => call.name === 'mark_department_chat_turn_unknown'), true)
    assertEquals(fixture.rpcCalls.some(call => call.name === 'fail_department_chat_turn'), false)
  })
}

Deno.test('definite provider rejection remains a failed turn, not an unknown outcome', async () => {
  const fixture = selectedOrganizationFixture()
  fixture.rows.organization_memberships.find(row => row.organization_id === 'B').department_id = 'content'
  fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'content'
  fixture.rows.department_chat_conversations.find(row => row.organization_id === 'B').department_id = 'content'
  const connection = fixture.rows.integration_connections.find(row => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  fixture.setProviderFailure('400')
  const response = await fixture.request({
    action: 'propose_work_item', organization_id: 'B', project_id: 'project-B',
    engagement_id: 'engagement-B', department_id: 'content',
    conversation_id: 'conversation-B', client_request_id: 'request-B',
    title: 'Rejected', work_item_type: 'task', priority: 'medium',
    prompt: 'Rejected request', prompt_safe_for_ai: true,
  })
  assertEquals(response.status, 502)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'fail_department_chat_turn'), true)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'mark_department_chat_turn_unknown'), false)
})

for (const scenario of ['missing', 'nonmember', 'inactive-organization', 'inactive-membership', 'client-membership']) {
  Deno.test('selected organization fails closed before provider/audit/mutation: ' + scenario, async () => {
    const fixture = selectedOrganizationFixture()
    const body = { ...selectedPreview }
    if (scenario === 'missing') body.organization_id = ''
    if (scenario === 'nonmember') body.organization_id = 'C'
    if (scenario === 'inactive-organization') fixture.rows.organizations.find(row => row.id === 'B').status = 'inactive'
    if (scenario === 'inactive-membership') fixture.rows.organization_memberships.find(row => row.organization_id === 'B').status = 'inactive'
    if (scenario === 'client-membership') fixture.rows.organization_memberships.find(row => row.organization_id === 'B').member_kind = 'client'
    const response = await fixture.request(body)
    assertEquals(response.status, scenario === 'missing' ? 400 : 403)
    assertEquals(fixture.providerCalls(), 0)
    assertEquals(fixture.rpcCalls.length, 0)
  })
}

for (const scenario of ['engagement-A', 'project-A', 'department-mismatch', 'stage-A']) {
  Deno.test('B selection rejects mismatched canonical/department context: ' + scenario, async () => {
    const fixture = selectedOrganizationFixture()
    const body = { ...selectedPreview }
    if (scenario === 'engagement-A') body.engagement_id = 'engagement-A'
    if (scenario === 'project-A') fixture.rows.engagements.find(row => row.organization_id === 'B').project_id = 'project-A'
    if (scenario === 'department-mismatch') fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'design'
    if (scenario === 'stage-A') body.engagement_stage_instance_id = 'stage-A'
    const response = await fixture.request(body)
    assertEquals(response.status >= 400, true)
    assertEquals(fixture.providerCalls(), 0)
    assertEquals(fixture.rpcCalls.every(call => call.name === 'record_department_chat_attempt' && call.args.p_organization_id === 'B'), true)
    assertEquals(fixture.rpcCalls.at(-1)!.args.p_event_kind, 'preview_blocked')
  })
}

for (const action of ['confirm_proposal', 'reject_proposal']) {
  Deno.test(action + ' resolves only a B proposal before calling the unchanged atomic RPC', async () => {
    for (const org of ['A', 'B']) {
      const fixture = selectedOrganizationFixture()
      const response = await fixture.request({ action, organization_id: 'B', proposal_id: 'proposal-' + org })
      assertEquals(response.status, org === 'B' ? 200 : 404)
      assertEquals(fixture.providerCalls(), 0)
      assertEquals(fixture.rpcCalls.length, org === 'B' ? 1 : 0)
      if (org === 'B') assertEquals(fixture.rpcCalls[0].args.p_proposal_id, 'proposal-B')
      assertEquals(fixture.queries.every(({ table, filters }) => filters.some(([key, value]) => key === (table === 'organizations' ? 'id' : 'organization_id') && value === 'B')), true)
    }
  })
}

Deno.test('authenticated Department Chat campaign_brief confirmation is suggestions-only with zero canonical side effects', async () => {
  const fixture = selectedOrganizationFixture()
  Object.assign(fixture.rows.organization_memberships.find(row => row.organization_id === 'B'), {
    department_id: 'marketing', role: 'contributor',
  })
  Object.assign(fixture.rows.department_chat_proposals.find(row => row.organization_id === 'B'), {
    department_id: 'marketing', proposal_kind: 'artifact_version', target_key: 'campaign_brief',
  })
  const response = await fixture.request({ action: 'confirm_proposal', organization_id: 'B', proposal_id: 'proposal-B' })
  assertEquals(response.status, 409)
  assertEquals((await response.json()).error, 'Campaign brief proposals are suggestions only and cannot be confirmed from Department Chat')
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls, [])
})

Deno.test('selected B work-item preview keeps save and audit in B', async () => {
  const fixture = selectedOrganizationFixture()
  const response = await fixture.request({ ...selectedPreview, action: 'propose_work_item', title: 'Offline task', work_item_type: 'task' })
  assertEquals(response.status, 200)
  assertEquals(fixture.rpcCalls.every(call => call.args.p_organization_id === 'B'), true)
  assertEquals(fixture.rpcCalls.at(-1)!.args.p_proposal_kind, 'work_item')
})

function schemaFixture(schema: any, propertyName = ''): any {
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf) return schemaFixture(schema.anyOf.find((item: any) => item.type === 'null') || schema.anyOf[0], propertyName)
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) return null
    return schemaFixture({ ...schema, type: schema.type[0] }, propertyName)
  }
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, schemaFixture(value, key)]))
  if (schema.type === 'array') return [schemaFixture(schema.items, propertyName)]
  if (schema.type === 'number' || schema.type === 'integer') return 1
  if (schema.type === 'boolean') return false
  if (schema.type === 'null') return null
  if (schema.format === 'date' || propertyName === 'starts_on' || propertyName === 'ends_on') return '2026-09-04'
  return 'fixture'
}

for (const department of ['content','design','marketing','development']) {
  for (const target of departmentChatProfile(department).artifactTypes) {
    Deno.test('preview validates and saves only a pending ' + department + '/' + target, async () => {
      const format = department === 'content' ? contentArtifactResponseFormat(target)
        : department === 'design' ? designArtifactResponseFormat(target)
        : department === 'marketing' ? marketingArtifactResponseFormat(target)
        : developmentChatArtifactResponseFormat(target)
      const { admin, rpcCalls } = proposalAdmin()
      const fixture = schemaFixture(format.schema)
      if (target === 'design_system') fixture.color_tokens[0].value = '#123456'
      await proposeArtifact({} as any, admin as any, {
        department_id: department, engagement_id: 'engagement-1', artifact_type: target,
        language: department === 'content' && ['discovery', 'vision', 'audience'].includes(target) ? 'Urdu' : undefined,
        prompt: 'Fixture', prompt_safe_for_ai: true,
        organization_id: 'injected', project_id: 'injected', actor_id: 'injected', approval: true,
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({ output_text: JSON.stringify(fixture) })), contextDependencies)
      const save = rpcCalls.find(call => call.name === (department === 'development'
        ? 'save_department_chat_proposal' : 'save_department_chat_proposal_with_model'))!
      assertEquals(Boolean(save), true)
      assertEquals(save.args.p_actor_id, 'member-1')
      assertEquals(save.args.p_project_id, 'project-1')
      assertEquals(save.args.p_organization_id, ORGANIZATION_ID)
      assertEquals(save.args.p_target_key, target)
      const invalid = proposalAdmin()
      await assertRejects(() => proposeArtifact({} as any, invalid.admin as any, {
        department_id: department, engagement_id: 'engagement-1', artifact_type: target,
        language: department === 'content' && ['discovery', 'vision', 'audience'].includes(target) ? 'Urdu' : undefined,
        prompt: 'Fixture', prompt_safe_for_ai: true,
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({ output_text: '{}' })), contextDependencies))
      assertEquals(invalid.rpcCalls.some(call => call.name.startsWith('save_department_chat_')), false)
    })
  }
  for (const target of ['task','bug','request']) {
    Deno.test('preview creates only a pending ' + department + '/' + target, async () => {
      const { admin, rpcCalls } = proposalAdmin()
      await proposeWorkItem({} as any, admin as any, {
        department_id: department, engagement_id: 'engagement-1', work_item_type: target,
        title: 'Fixture', prompt: 'Fixture', prompt_safe_for_ai: true, status: 'done', assignee_id: 'injected',
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({output_text:'Fixture'})), contextDependencies)
      const save = rpcCalls.find(call => call.name === (department === 'development'
        ? 'save_department_chat_proposal' : 'save_department_chat_proposal_with_model'))!
      assertEquals(Boolean(save), true)
      assertEquals((save.args.p_preview_payload as any).status, 'not_started')
      assertEquals((save.args.p_validated_payload as any).assignee_id, undefined)
      const invalid = proposalAdmin()
      await assertRejects(() => proposeWorkItem({} as any, invalid.admin as any, {
        department_id: department, engagement_id: 'engagement-1', work_item_type: target,
        title: 'Fixture', prompt: 'Fixture', prompt_safe_for_ai: true,
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({ output_text: '' })), contextDependencies))
      assertEquals(invalid.rpcCalls.some(call => call.name.startsWith('save_department_chat_')), false)
    })
  }
}

Deno.test('audit reasons never contain provider secrets or raw failures', () => {
  for (const message of ['credential sk-secret', 'model_id token-secret', 'connector Bearer secret', 'OpenAI private failure']) {
    assertEquals(['credential_missing','model_missing','connector_unavailable','provider_failed'].includes(safeAttemptReason(new Error(message))), true)
  }
})

Deno.test('model-output validator failures are classified as invalid output', () => {
  for (const message of [
    'headline is required', 'color tokens must be an array',
    'Website page 1 is invalid', 'The configured model returned an empty draft',
  ]) assertEquals(safeAttemptReason(new Error(message)), 'invalid_output')
})

for (const department of ['content','design','marketing','development']) {
  Deno.test('connector failures call no provider or proposal path for ' + department, async () => {
    const badConnections = [[], [{id:'one'},{id:'two'}], [{id:'one',secret_name:'KEY',public_config:{model_id:'explicit'}}], [{id:'one',secret_name:'KEY',public_config:{}}]]
    for (const [index, connections] of badConnections.entries()) {
      for (const target of [...departmentChatProfile(department).artifactTypes, 'task','bug','request']) {
        const { admin, rpcCalls } = proposalAdmin()
        let providerCalls=0
        const dependencies={...contextDependencies,resolveSingleOpenAiModel:(async () => selectSingleOpenAiModel(connections,department,() => index===2 ? undefined : 'test-key')) as any}
        const body={department_id:department,engagement_id:'engagement-1',artifact_type:target,work_item_type:target,title:'Fixture',prompt:'Fixture',prompt_safe_for_ai:true,language:department==='content'&&['discovery','vision','audience'].includes(target)?'Urdu':undefined}
        const fetcher=(async () => { providerCalls++; return new Response('{}') }) as typeof fetch
        await assertRejects(() => ['task','bug','request'].includes(target)
          ? proposeWorkItem({} as any,admin as any,body,'member-1',ORGANIZATION_ID,fetcher,dependencies)
          : proposeArtifact({} as any,admin as any,body,'member-1',ORGANIZATION_ID,fetcher,dependencies))
        assertEquals(providerCalls,0)
        assertEquals(rpcCalls.length,0)
      }
    }
  })
}

Deno.test('expired and stale outcomes remain machine-readable for terminal UI state', async () => {
  for (const outcome of ['expired','stale','rejected']) {
    const {admin}=decisionAdmin({...pendingProposal,status:outcome},{outcome})
    const error=await assertRejects(() => confirmProposal(admin as any,'proposal-1','member-1',{organization_id:ORGANIZATION_ID,department_id:'development'},contextDependencies))
    assertEquals((error as any).outcome,outcome)
  }
})

Deno.test('unavailable changed context becomes stale without an official write', async () => {
  const {admin,rpcCalls}=decisionAdmin(pendingProposal,{outcome:'stale'})
  const error=await assertRejects(() => confirmProposal(admin as any,'proposal-1','member-1',{organization_id:ORGANIZATION_ID,department_id:'development'}, {
    ...contextDependencies, resolveSingleOpenAiModel:(async () => {throw new Error('No verified connector')}) as any,
  }))
  assertEquals((error as any).outcome,'stale')
  assertEquals(rpcCalls[0].args.p_context_checksum,null)
})

Deno.test('accepted replay does not require a still-available connector', async () => {
  const { admin, rpcCalls } = decisionAdmin({ ...pendingProposal, status: 'accepted' }, { outcome: 'accepted', replayed: true, artifact_version_id: 'saved-version' })
  const result = await confirmProposal(admin as any,'proposal-1','member-1',{organization_id:ORGANIZATION_ID,department_id:'development'}, {
    requireDepartmentEngagement: (async () => { throw new Error('Must not re-resolve accepted context') }) as any,
  })
  assertEquals(result.artifact_version_id,'saved-version')
  assertEquals(rpcCalls.length,1)
})

Deno.test('Shared Department Chat is department-scoped', () => {
  assertEquals(hasDepartmentChatAuthority({ organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'content' }, 'content'), true)
  assertEquals(hasDepartmentChatAuthority({ organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'design' }, 'content'), false)
  assertEquals(hasDepartmentChatAuthority({ organization_id: ORGANIZATION_ID, role: 'executive', department_id: null }, 'content'), true)
})

Deno.test('WCH3 enables all profiles while preserving narrow artifact allowlists', () => {
  assertEquals([...ENABLED_DEPARTMENTS].sort(), ['content', 'design', 'development', 'marketing'])
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_system'), true)
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_direction'), false)
  assertEquals([...CHAT_MARKETING_ARTIFACT_TYPE_SET].sort(), ['campaign_brief', 'channel_strategy', 'measurement_plan'])
  assertEquals(isDepartmentChatArtifactType('marketing', 'marketing_report'), false)
  assertEquals(isDepartmentChatArtifactType('development', 'technical_brief'), true)
  assertEquals(marketingArtifactResponseFormat('measurement_plan').schema.required.length, 5)
  assertEquals(developmentChatArtifactResponseFormat('launch_checklist').schema.required, ['notes', 'checklist'])
})

Deno.test('Design chat schema remains the Design System library schema', () => {
  const content = validateDesignSystemArtifact('design_system', {
    color_tokens: [{ name: 'Primary', value: '#4f46e5' }],
    typography_scale: [{ name: 'Body', font: 'Inter', size: '16px', weight: '400' }],
    components: [{ name: 'Button', description: 'Primary action.', usage_notes: 'Use once.' }],
    usage_rules: 'Keep sufficient contrast.',
  })
  assertEquals(Object.hasOwn(content, 'color_tokens'), true)
  assertEquals(designArtifactResponseFormat('design_system').name, 'anka_design_system_draft')
})

function resolved(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error })
}

Deno.test('canonical engagement resolution accepts an isolated active department service', async () => {
  const client = {
    from(table: string) {
      const rows: Record<string, unknown> = {
        engagements: { id: 'engagement-1', organization_id: ORGANIZATION_ID, client_id: 'agency-client-1', project_id: 'project-1', brand_id: 'brand-1' },
        agency_clients: { id: 'agency-client-1', organization_id: ORGANIZATION_ID, canonical_client_id: 'client-1', name: 'Operating client' },
        clients: { id: 'client-1', organization_id: ORGANIZATION_ID, name: 'Canonical client' },
        projects: { id: 'project-1', organization_id: ORGANIZATION_ID, client_id: 'client-1', name: 'Canonical project' },
        brands: { id: 'brand-1', organization_id: ORGANIZATION_ID, client_id: 'agency-client-1', name: 'Brand' },
        engagement_services: [{ id: 'design-service', service_catalog: { department_id: 'design' } }],
      }
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) chain[method] = () => chain
      chain.maybeSingle = () => resolved(rows[table])
      chain.then = (resolve: (value: unknown) => unknown) => resolved(rows[table]).then(resolve)
      return chain
    },
  }
  const result = await requireDepartmentEngagement(client as never, 'engagement-1', 'design', ORGANIZATION_ID)
  assertEquals(result.services.length, 1)
  assertEquals(result.commercialContext.canonical_client.id, 'client-1')
  assertEquals(result.commercialContext.project.id, 'project-1')
})

function proposalAdmin(rpcResult: Record<string, unknown> = {
  proposal_id: 'proposal-1', status: 'pending', proposal_kind: 'artifact_version',
  target_key: 'technical_brief', preview: { notes: 'Preview' },
  expires_at: '2099-01-01T00:00:00Z',
}) {
  const rpcCalls: Array<{ name: string, args: Record<string, unknown> }> = []
  const admin = {
    from(table: string) {
      const query: any = {
        select: () => query, eq: () => query, gte: () => query,
        single: async () => table === 'organizations'
          ? { data: { settings: {} }, error: null }
          : { data: null, error: null },
        then: (resolve: (value: unknown) => unknown) => resolve({ count: 0, data: null, error: null }),
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return { data: rpcResult, error: null }
    },
  }
  return { admin, rpcCalls }
}

const contextDependencies = {
  requireDepartmentEngagement: (async (_admin: unknown, engagementId: string) => ({
    engagement: { id: engagementId, brand_id: 'brand-1' },
    services: [{ id: 'service-1', service_catalog: { department_id: 'development' } }],
    commercialContext: {
      canonical_client: { id: 'client-1' }, agency_client: { id: 'agency-client-1' },
      project: { id: 'project-1' }, engagement: { id: engagementId }, brand: { id: 'brand-1' },
    },
  })) as any,
  safeStage: (async () => null) as any,
  approvedSafeContext: (async () => []) as any,
  resolveSingleOpenAiModel: (async (_admin: unknown, _engagementId: string, departmentId: string) => ({
    connectorId: 'connector-1', credential: 'test-key', model: 'gpt-test',
    ...(departmentId === 'development' ? {} : {
      configurationId: 'configuration-1',
      displayName: 'GPT test',
      approvedModels: [{
        configuration_id: 'configuration-1', model_id: 'gpt-test',
        display_name: 'GPT test', is_default: true,
      }],
    }),
  })) as any,
  estimatedCost: () => 12,
}

Deno.test('Development artifact preview persists only an atomic pending proposal', async () => {
  const { admin, rpcCalls } = proposalAdmin()
  const result = await proposeArtifact({} as any, admin as any, {
    department_id: 'development', engagement_id: 'engagement-1',
    artifact_type: 'technical_brief', title: 'Technical brief',
    prompt: 'Draft the implementation notes', prompt_safe_for_ai: true,
  }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ notes: 'Use the existing API.', checklist: ['Add tests'] }),
    usage: { input_tokens: 10, output_tokens: 20 },
  })), contextDependencies)
  assertEquals(result.status, 'pending')
  assertEquals(rpcCalls.length, 1)
  assertEquals(rpcCalls[0].name, 'save_department_chat_proposal')
  assertEquals(rpcCalls[0].args.p_proposal_kind, 'artifact_version')
  assertEquals(rpcCalls[0].args.p_target_key, 'technical_brief')
  assertEquals((rpcCalls[0].args.p_validated_payload as any).content.notes, 'Use the existing API.')
  assertEquals(rpcCalls[0].args.p_estimated_cost_microusd, 12)
})

Deno.test('work-item preview fixes the future official state to not_started without writing it', async () => {
  const { admin, rpcCalls } = proposalAdmin({
    proposal_id: 'proposal-2', status: 'pending', proposal_kind: 'work_item',
    target_key: 'bug', preview: { status: 'not_started' }, expires_at: '2099-01-01T00:00:00Z',
  })
  const result = await proposeWorkItem({} as any, admin as any, {
    department_id: 'development', engagement_id: 'engagement-1',
    work_item_type: 'bug', title: 'Fix the issue',
    prompt: 'Draft the bug description', prompt_safe_for_ai: true,
  }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({
    output_text: 'Reproduce and correct the issue.', usage: { input_tokens: 4, output_tokens: 8 },
  })), contextDependencies)
  assertEquals((result.preview as any).status, 'not_started')
  assertEquals(rpcCalls[0].name, 'save_department_chat_proposal')
  assertEquals(rpcCalls[0].args.p_proposal_kind, 'work_item')
  assertEquals(rpcCalls[0].args.p_target_key, 'bug')
})

Deno.test('schema-invalid model output creates no proposal', async () => {
  const { admin, rpcCalls } = proposalAdmin()
  await assertRejects(
    () => proposeArtifact({} as any, admin as any, {
      department_id: 'development', engagement_id: 'engagement-1',
      artifact_type: 'technical_brief', prompt: 'Draft', prompt_safe_for_ai: true,
    }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({
      output_text: JSON.stringify({ notes: '', checklist: [] }),
    })), contextDependencies),
    Error,
    'requires notes or checklist',
  )
  assertEquals(rpcCalls.length, 0)
})

function decisionAdmin(proposal: Record<string, unknown>, outcome: Record<string, unknown>) {
  const rpcCalls: Array<{ name: string, args: Record<string, unknown> }> = []
  return {
    rpcCalls,
    admin: {
      from() {
        const query: any = {
          select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: proposal, error: null }),
        }
        return query
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args })
        return { data: outcome, error: null }
      },
    },
  }
}

const pendingProposal = {
  id: 'proposal-1', organization_id: ORGANIZATION_ID, engagement_id: 'engagement-1',
  project_id: 'project-1', department_id: 'development', proposer_id: 'member-1',
  proposal_kind: 'artifact_version', target_key: 'technical_brief',
  artifact_id: null, engagement_stage_instance_id: null,
  context_checksum: 'a'.repeat(64), connector_connection_id: 'connector-1',
  model_id: 'gpt-test', status: 'pending', expires_at: '2099-01-01T00:00:00Z',
}

Deno.test('confirmation re-resolves context and returns the atomic official result', async () => {
  const { admin, rpcCalls } = decisionAdmin(pendingProposal, {
    outcome: 'accepted', replayed: false, artifact_version_id: 'version-1',
  })
  const result = await confirmProposal(admin as any, 'proposal-1', 'member-1', {
    organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'development',
  }, contextDependencies)
  assertEquals(result.artifact_version_id, 'version-1')
  assertEquals(rpcCalls[0].name, 'confirm_department_chat_proposal')
  assertEquals(rpcCalls[0].args.p_connector_connection_id, 'connector-1')
  assertEquals(typeof rpcCalls[0].args.p_context_checksum, 'string')
})

Deno.test('only the proposer may confirm, before context or official paths run', async () => {
  const { admin, rpcCalls } = decisionAdmin(pendingProposal, { outcome: 'accepted' })
  await assertRejects(
    () => confirmProposal(admin as any, 'proposal-1', 'other-member', {
      organization_id: ORGANIZATION_ID, role: 'executive', department_id: null,
    }, contextDependencies),
    Error,
    'Only the proposer',
  )
  assertEquals(rpcCalls.length, 0)
})

Deno.test('stale confirmation fails closed and requires regeneration', async () => {
  const { admin } = decisionAdmin(pendingProposal, { outcome: 'stale' })
  await assertRejects(
    () => confirmProposal(admin as any, 'proposal-1', 'member-1', {
      organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'development',
    }, contextDependencies),
    Error,
    'Regenerate a fresh preview',
  )
})

Deno.test('rejection is proposer-only and idempotent', async () => {
  const { admin, rpcCalls } = decisionAdmin(pendingProposal, {
    outcome: 'rejected', replayed: true, proposal_id: 'proposal-1',
  })
  const result = await rejectProposal(admin as any, 'proposal-1', 'member-1', {
    organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'development',
  })
  assertEquals(result.replayed, true)
  assertEquals(rpcCalls[0].name, 'reject_department_chat_proposal')
})

Deno.test('connector selection rejects ambiguity and missing explicit model', () => {
  assertThrows(() => selectSingleOpenAiModel([], 'content', () => 'test-key'), Error, 'No verified OpenAI connector')
  assertThrows(
    () => selectSingleOpenAiModel([{ id: 'one' }, { id: 'two' }], 'content', () => 'test-key'),
    Error,
    'Exactly one verified OpenAI connector',
  )
  assertThrows(
    () => selectSingleOpenAiModel([{ id: 'one', secret_name: 'KEY', public_config: {} }], 'content', () => 'test-key'),
    Error,
    'requires an explicit model_id',
  )
})

Deno.test('context freeze is deterministic across exact approved versions', async () => {
  const input = {
    departmentId: 'development',
    commercialContext: {
      canonical_client: { id: 'client' }, agency_client: { id: 'agency-client' },
      project: { id: 'project' }, engagement: { id: 'engagement' }, brand: { id: 'brand' },
    },
    services: [{ id: 'service-b' }, { id: 'service-a' }],
    approvedContext: [
      { artifact_id: 'artifact-b', artifact_version_id: 'version-b', artifact_type: 'design_system', content: { summary: 'B' } },
      { artifact_id: 'artifact-a', artifact_version_id: 'version-a', artifact_type: 'technical_brief', content: { summary: 'A' } },
    ],
    provider: { connectorId: 'connector', model: 'explicit-model' },
    stageId: 'stage',
  }
  const first = await freezeDepartmentChatContext(input)
  const second = await freezeDepartmentChatContext(input)
  assertEquals(first.manifest.context_checksum, second.manifest.context_checksum)
  assertEquals(first.manifest.active_service_ids, ['service-a', 'service-b'])
  assertEquals(first.manifest.approved_artifact_version_ids, ['version-a', 'version-b'])
})

Deno.test('Shared Department Chat exposes only the OpenAI Responses endpoint', () => {
  const endpoint = departmentChatExternalEndpoint()
  assertEquals(endpoint, 'https://api.openai.com/v1/responses')
  assertEquals(/connector|mutate|publish|send|upload|deploy|ads/i.test(endpoint), false)
  assertEquals(outputText({ output_text: '{"summary":"draft"}' }), '{"summary":"draft"}')
})
function enableSavedAnswerFixture(fixture: ReturnType<typeof selectedOrganizationFixture>, ownerId = 'actor') {
  Object.assign(fixture.rows.organization_memberships.find((row: any) => row.organization_id === 'B'), {
    department_id: 'content', role: 'contributor',
  })
  fixture.rows.engagement_services.find((row: any) => row.organization_id === 'B').service_catalog.department_id = 'content'
  const connection = fixture.rows.integration_connections.find((row: any) => row.organization_id === 'B')
  connection.integration_connection_departments.department_id = 'content'
  connection.integration_connection_engagements.department_id = 'content'
  Object.assign(fixture.rows.department_chat_conversations.find((row: any) => row.organization_id === 'B'), {
    department_id: 'content', owner_id: ownerId,
  })
}

const answerRequest = {
  action: 'answer', organization_id: 'B', project_id: 'project-B',
  engagement_id: 'engagement-B', department_id: 'content', conversation_id: 'conversation-B',
  client_request_id: '10000000-0000-4000-8000-000000000001',
  prompt: 'Explain the current evidence without creating work.', prompt_safe_for_ai: true,
  model_configuration_id: 'model-configuration-B-content', attachment_ids: [],
}

Deno.test('P9 ordinary answer streams genuine deltas then atomically saves a no-proposal durable result', async () => {
  const fixture = selectedOrganizationFixture()
  enableSavedAnswerFixture(fixture)
  fixture.rows.department_chat_messages = [
    { organization_id: 'B', conversation_id: 'conversation-B', role: 'user', body: 'Earlier question', status: 'completed', sequence: 1 },
    { organization_id: 'B', conversation_id: 'conversation-B', role: 'assistant', body: 'Earlier answer', status: 'completed', sequence: 2 },
  ]
  const response = await fixture.request(answerRequest)
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('content-type')?.startsWith('text/event-stream'), true)
  const streamText = await response.text()
  await Promise.all(fixture.backgroundTasks)
  assertEquals(streamText.includes('"type":"delta"'), true)
  assertEquals(streamText.includes('"type":"completed"'), true)
  const completed = fixture.rpcCalls.find(call => call.name === 'complete_department_chat_answer')!
  assertEquals(completed.args.p_model_configuration_id, 'model-configuration-B-content')
  assertEquals(completed.args.p_output_text, 'Offline answer')
  assertEquals(completed.args.p_context_manifest.model_configuration_id, 'model-configuration-B-content')
  assertEquals(fixture.rpcCalls.some(call => call.name.startsWith('save_department_chat_')), false)
  const providerBody = JSON.parse(String(fixture.providerRequests[0].body))
  assertEquals(providerBody.stream, true)
  assertEquals(providerBody.store, false)
  assertEquals(providerBody.tools, undefined)
  assertEquals(providerBody.input.map((item: any) => item.content), [
    'Earlier question', 'Earlier answer', answerRequest.prompt,
  ])
  assertEquals(fixture.events.indexOf('rpc:mark_department_chat_turn_dispatched') < fixture.events.indexOf('provider'), true)
})

Deno.test('P9 ordinary answer exact replay exits before fresh model validation or provider dispatch', async () => {
  const fixture = selectedOrganizationFixture()
  enableSavedAnswerFixture(fixture)
  fixture.setBeginReplay(true)
  const response = await fixture.request(answerRequest)
  assertEquals(response.status, 409)
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'assert_department_chat_model_dispatch'), false)
})

Deno.test('P9 ordinary answer rejects stale selected configuration before provider dispatch', async () => {
  const fixture = selectedOrganizationFixture()
  enableSavedAnswerFixture(fixture)
  fixture.setModelDispatchError({ code: '23514', message: 'revoked' })
  const response = await fixture.request(answerRequest)
  assertEquals(response.status, 409)
  assertEquals(fixture.providerCalls(), 0)
  assertEquals(fixture.rpcCalls.some(call => call.name === 'fail_department_chat_turn'), true)
})

Deno.test('P9 streamed disconnect becomes unknown while a definite provider failure becomes failed', async () => {
  for (const [failure, terminalRpc, terminalEvent] of [
    ['stream-drop', 'mark_department_chat_turn_unknown', '"type":"unknown"'],
    ['stream-failed', 'fail_department_chat_turn', '"type":"failed"'],
  ]) {
    const fixture = selectedOrganizationFixture()
    enableSavedAnswerFixture(fixture)
    fixture.setProviderFailure(failure)
    const response = await fixture.request({ ...answerRequest, client_request_id: crypto.randomUUID() })
    const streamText = await response.text()
    await Promise.all(fixture.backgroundTasks)
    assertEquals(streamText.includes(terminalEvent), true)
    assertEquals(fixture.rpcCalls.some(call => call.name === terminalRpc), true)
    assertEquals(fixture.rpcCalls.some(call => call.name === 'complete_department_chat_answer'), false)
  }
})

Deno.test('P9 deliberately shared contributor answer retains actual author and no added action authority', async () => {
  const fixture = selectedOrganizationFixture()
  enableSavedAnswerFixture(fixture, 'owner')
  fixture.rows.department_chat_conversation_shares = [{
    organization_id: 'B', conversation_id: 'conversation-B', recipient_id: 'actor', revoked_at: null,
  }]
  const response = await fixture.request({ ...answerRequest, client_request_id: crypto.randomUUID() })
  await response.text()
  await Promise.all(fixture.backgroundTasks)
  const begin = fixture.rpcCalls.find(call => call.name === 'begin_department_chat_turn_with_attachments')!
  const complete = fixture.rpcCalls.find(call => call.name === 'complete_department_chat_answer')!
  assertEquals(begin.args.p_actor_id, 'actor')
  assertEquals(complete.args.p_actor_id, 'actor')
  assertEquals(fixture.rpcCalls.some(call => call.name === 'confirm_department_chat_proposal'), false)
})
Deno.test('P9 stopping local observation does not cancel upstream durable finalization', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let pulled = false
  const upstream = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Still working"}\n\n'))
    },
    async pull(controller) {
      if (pulled) return
      pulled = true
      await gate
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"output_text":"Still working","usage":{}}}\n\n'))
      controller.close()
    },
  }))
  const background: Promise<void>[] = []
  let completed = false
  let unknown = false
  const response = createDurableDepartmentChatAnswerStream(upstream, {
    complete: async () => { completed = true; return { ai_run_id: 'run' } },
    fail: async () => {},
    unknown: async () => { unknown = true },
    waitUntil: promise => background.push(promise),
  })
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel('local stop')
  release()
  await Promise.all(background)
  assertEquals(completed, true)
  assertEquals(unknown, false)
})
