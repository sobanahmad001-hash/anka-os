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
    return { scope: 'owner_private_project_conversation',
      project_id: requiredId(context.project_id, 'project') }
  }
  if (context?.context_kind === 'department_private'
    && context.project_id == null
    && ['content', 'design', 'marketing'].includes(context.department_id)) {
    return { scope: 'owner_private_department_conversation', department_id: context.department_id }
  }
  throw fail('Exact private conversation context is required')
}

export function buildPrivateConversationPrompt(rows, messageId, context) {
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
  let prompt = JSON.stringify({ ...boundScope, source_message_id: messageId, turns })
  while (turns.length > 1 && new TextEncoder().encode(prompt).length > 24000) {
    turns.shift()
    prompt = JSON.stringify({ ...boundScope, source_message_id: messageId, turns })
  }
  if (new TextEncoder().encode(prompt).length > 24000) throw fail('Conversation context exceeds the model bound')
  return prompt
}
