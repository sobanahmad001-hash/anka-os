const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = message => Object.assign(new Error(message), { status: 409 })
const requiredId = (value, label) => {
  if (typeof value !== 'string' || !uuid.test(value)) throw fail(`Valid ${label} is required`)
  return value
}

export function privateConversationScope(context) {
  if (context?.context_kind === 'organization'
    && context.project_id == null && context.department_id == null) {
    return { scope: 'owner_private_organization_conversation' }
  }
  if (context?.context_kind === 'project_team' && context.department_id == null) {
    requiredId(context.project_id, 'project')
    return { scope: 'owner_private_project_conversation' }
  }
  if (context?.context_kind === 'department_private'
    && context.project_id == null
    && ['content', 'design', 'marketing'].includes(context.department_id)) {
    return { scope: 'owner_private_department_conversation', department_id: context.department_id }
  }
  throw fail('Exact private conversation context is required')
}

export function requireOwnerAuthoredPromptTurns(rows, ownerId, evidence = {}) {
  requiredId(ownerId, 'conversation owner')
  if (!Array.isArray(rows) || rows.some(row => row.role === 'user' && row.author_id !== ownerId)) {
    throw fail('A teammate message is not approved for provider use in this conversation')
  }
  const { conversationId, organizationId, auditedRuns = [], sourceTurns = [] } = evidence
  for (const row of rows) {
    if (row.role === 'user' && (!conversationId || !organizationId)) continue
    if (row.owner_id !== ownerId || row.conversation_id !== conversationId
      || row.organization_id !== organizationId) throw fail('Conversation history has another owner or scope')
    if (row.role === 'user') continue
    if (row.role !== 'assistant' || row.author_id !== null
      || row.status !== 'completed' || !uuid.test(row.ai_run_id || '')
      || !uuid.test(row.in_reply_to_message_id || '')
      || !uuid.test(row.client_request_id || '')) throw fail('Unaudited assistant turn is unavailable')
    const source = sourceTurns.find(turn => turn.id === row.in_reply_to_message_id)
    const run = auditedRuns.find(item => item.id === row.ai_run_id)
    if (!source || source.role !== 'user' || source.status !== 'completed'
      || source.author_id !== ownerId || source.owner_id !== ownerId
      || source.conversation_id !== conversationId || source.organization_id !== organizationId
      || source.sequence >= row.sequence
      || !run || run.user_id !== ownerId || run.organization_id !== organizationId
      || run.context_chat_conversation_id !== conversationId
      || run.context_chat_message_id !== source.id
      || run.status !== 'completed' || run.capability !== 'context_chat_answer'
      || run.context_manifest?.dispatch_claim_id !== row.client_request_id
      || typeof run.context_manifest?.provider_response_id !== 'string'
      || !run.context_manifest.provider_response_id.trim()
      || typeof run.output_text !== 'string'
      || run.output_text.trim() !== row.body) throw fail('Unaudited assistant turn is unavailable')
  }
}

/** @param {Record<string, unknown>} organization
 * @param {Record<string, unknown> | null} [project] */
export function canonicalOpenAiContext(organization, project = null) {
  const field = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
  if (!organization || !field(organization.name, 200).trim()) {
    throw fail('Current organization name is required for OpenAI grounding')
  }
  if (project && !field(project.name, 200).trim()) {
    throw fail('Current project name is required for OpenAI grounding')
  }
  return {
    organization_name: field(organization.name, 200),
    ...(project ? { project: {
      name: field(project.name, 200),
      description: field(project.description, 1000),
      status: field(project.status, 80),
      health: field(project.health, 80),
      scope: field(project.scope_statement, 1000),
      exclusions: field(project.exclusions, 1000),
    } } : {}),
  }
}

/** @param {Record<string, unknown> | null} [canonicalContext] */
export function buildPrivateConversationPrompt(rows, messageId, context, canonicalContext = null) {
  const boundScope = privateConversationScope(context)
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 12
    || rows[rows.length - 1]?.id !== messageId
    || rows[rows.length - 1]?.role !== 'user') throw fail('Current human turn is unavailable')
  const turns = rows.map(row => {
    if (!uuid.test(row.id || '') || !['user', 'assistant'].includes(row.role)
      || row.status !== 'completed' || typeof row.body !== 'string'
      || row.body.trim().length < 1 || row.body.length > 40000
      || (row.role === 'user' && row.body.length > 8000)) {
      throw fail('Conversation history is not ready')
    }
    return { role: row.role, text: row.body.slice(-8000) }
  })
  const payload = () => ({ ...boundScope,
    ...(canonicalContext ? { canonical_context: canonicalContext } : {}), turns })
  let prompt = JSON.stringify(payload())
  while (turns.length > 1 && new TextEncoder().encode(prompt).length > 24000) {
    turns.shift()
    prompt = JSON.stringify(payload())
  }
  if (new TextEncoder().encode(prompt).length > 24000) throw fail('Conversation context exceeds the model bound')
  return prompt
}
