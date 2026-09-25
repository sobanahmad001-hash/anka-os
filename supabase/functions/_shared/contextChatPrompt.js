const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
import { safeText } from './contextChatRecordSummary.js'
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

const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 50 ? value : 0
const taskStates = new Set(['backlog', 'ready', 'in_progress', 'blocked',
  'ready_for_review', 'changes_required', 'done', 'cancelled', 'unknown'])
const workStates = new Set(['not_started', 'in_progress', 'blocked', 'done', 'unknown'])
const reviewStates = new Set(['in_production', 'ready_for_internal_review',
  'changes_required', 'ready_for_client_review', 'client_reviewing',
  'revision_requested', 'client_approved', 'delivered_published', 'superseded', 'unknown'])
const statusCounts = (value, allowed) => Object.fromEntries(Object.entries(value || {})
  .filter(([key, amount]) => allowed.has(key) && Number.isSafeInteger(amount)
    && amount >= 0 && amount <= 50).slice(0, 12))
const workItem = (item, allowed) => ({
  title: safeText(item?.title, 160),
  status: allowed.has(item?.status) ? item.status : 'unknown',
  due: /^\d{4}-\d{2}-\d{2}$/.test(item?.due || '') ? item.due : null,
  assignee: safeText(item?.assignee, 80),
})
function approvedWorkSummary(summary) {
  if (!summary || !['selected_project', 'current_organization_visible_project_sample']
    .includes(summary.scope) || !Array.isArray(summary.projects)) {
    throw fail('Authorized work summary is unavailable')
  }
  return {
    scope: summary.scope,
    as_of: typeof summary.as_of === 'string' && !Number.isNaN(Date.parse(summary.as_of))
      ? new Date(summary.as_of).toISOString() : null,
    coverage: {
      visible_projects_scanned: count(summary.coverage?.visible_projects_scanned),
      projects_included: count(summary.coverage?.projects_included),
      more_visible_projects_possible: summary.coverage?.more_visible_projects_possible === true,
      projects_omitted_from_bounded_summary: summary.coverage?.projects_omitted_from_bounded_summary === true,
      assignee_labels_available: summary.coverage?.assignee_labels_available === true,
      counts_describe_recent_visible_samples_only: true,
    },
    projects: summary.projects.slice(0, 4).map(row => ({
      name: safeText(row?.name, 160), status: safeText(row?.status, 40),
      health: safeText(row?.health, 40),
      sample: {
        project_tasks: count(row?.sample?.project_tasks),
        engagement_work_items: count(row?.sample?.engagement_work_items),
        linked_engagement: row?.sample?.linked_engagement === true,
        more_records_possible: row?.sample?.more_records_possible === true,
        project_task_statuses: statusCounts(row?.sample?.project_task_statuses, taskStates),
        engagement_work_item_statuses: statusCounts(row?.sample?.engagement_work_item_statuses, workStates),
      },
      project_tasks: Array.isArray(row?.project_tasks)
        ? row.project_tasks.slice(0, 6).map(item => workItem(item, taskStates)) : [],
      engagement_work_items: Array.isArray(row?.engagement_work_items)
        ? row.engagement_work_items.slice(0, 6).map(item => workItem(item, workStates)) : [],
      latest_visible_review_states_in_sample: statusCounts(row?.latest_visible_review_states_in_sample, reviewStates),
    })),
  }
}

/** @param {Record<string, unknown>} organization
 * @param {Record<string, unknown> | null} [project]
 * @param {Record<string, unknown> | null} [workSummary] */
export function canonicalOpenAiContext(organization, project = null, workSummary = null) {
  const field = (value, max) => safeText(value, max)
  if (!organization || !field(organization.name, 200)) {
    throw fail('Current organization name is required for OpenAI grounding')
  }
  if (project && !field(project.name, 200)) {
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
    ...(workSummary ? { work_summary: approvedWorkSummary(workSummary) } : {}),
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
