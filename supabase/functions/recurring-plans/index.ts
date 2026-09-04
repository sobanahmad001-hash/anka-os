import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Json = Record<string, unknown>
const ACTIONS = new Set([
  'create_plan', 'create_version', 'approve_version', 'reassign_template_item',
  'transition_plan', 'preview_period', 'confirm_period',
])
const FREQUENCIES = new Set(['weekly', 'monthly'])
const STATUSES = new Set(['active', 'paused', 'ended', 'archived'])
const ITEM_TYPES = new Set(['task', 'bug', 'request'])
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Json, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function text(value: unknown, max = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function id(value: unknown, label: string) {
  const normalized = text(value, 80)
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function date(value: unknown, label: string, optional = false) {
  const normalized = text(value, 10)
  if (!normalized && optional) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} must be an ISO date`)
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label} must be a real ISO date`)
  }
  return normalized
}

function uuid(value: unknown, label: string) {
  const normalized = id(value, label)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} must be a UUID`)
  }
  return normalized
}

function integer(value: unknown, label: string, fallback?: number) {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0) throw new Error(`${label} must be a non-negative integer`)
  return normalized
}

export function normalizePlanVersionInput(input: Json) {
  const title = text(input.title, 240)
  const frequency = text(input.frequency, 20)
  const timezone = text(input.timezone, 100)
  const effectiveStart = date(input.effectiveStart, 'Effective start') as string
  const effectiveEnd = date(input.effectiveEnd, 'Effective end', true)
  if (!title) throw new Error('Title is required')
  if (!FREQUENCIES.has(frequency)) throw new Error('Frequency must be weekly or monthly')
  if (!timezone) throw new Error('Timezone is required')
  if (effectiveEnd && effectiveEnd < effectiveStart) throw new Error('Effective end cannot precede effective start')
  const scheduleDefinition = input.scheduleDefinition ?? {}
  if (!scheduleDefinition || Array.isArray(scheduleDefinition) || typeof scheduleDefinition !== 'object') {
    throw new Error('Schedule definition must be an object')
  }
  if (!Array.isArray(input.templateItems) || input.templateItems.length === 0 || input.templateItems.length > 100) {
    throw new Error('One to 100 template items are required')
  }
  const keys = new Set<string>()
  const positions = new Set<number>()
  const templateItems = input.templateItems.map((raw, index) => {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Template items must be objects')
    const item = raw as Json
    const templateKey = text(item.templateKey, 80)
    const itemTitle = text(item.title, 240)
    const workItemType = text(item.workItemType, 20) || 'task'
    const priority = text(item.priority, 20) || 'medium'
    const position = integer(item.position, 'Template position', index)
    const startOffsetDays = integer(item.startOffsetDays, 'Start offset', 0)
    const dueOffsetDays = integer(item.dueOffsetDays, 'Due offset', 0)
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(templateKey)) throw new Error('Template key must be snake_case')
    if (!itemTitle) throw new Error('Template title is required')
    if (!ITEM_TYPES.has(workItemType)) throw new Error('Unsupported template work item type')
    if (!PRIORITIES.has(priority)) throw new Error('Unsupported template priority')
    if (dueOffsetDays < startOffsetDays) throw new Error('Due offset cannot precede start offset')
    if (keys.has(templateKey) || positions.has(position)) throw new Error('Template keys and positions must be unique')
    keys.add(templateKey); positions.add(position)
    return {
      template_key: templateKey, title: itemTitle, description: text(item.description),
      work_item_type: workItemType, priority,
      default_assignee_id: text(item.defaultAssigneeId, 80) || null,
      start_offset_days: startOffsetDays, due_offset_days: dueOffsetDays,
      acceptance_criteria: text(item.acceptanceCriteria), position,
    }
  })
  return {
    p_title: title, p_scope: text(input.scope), p_frequency: frequency, p_timezone: timezone,
    p_effective_start: effectiveStart, p_effective_end: effectiveEnd,
    p_schedule_definition: scheduleDefinition, p_template_items: templateItems,
  }
}

export function normalizeTransitionInput(input: Json) {
  const status = text(input.status, 20)
  if (!STATUSES.has(status)) throw new Error('Unsupported lifecycle transition target')
  const reason = text(input.reason, 2000)
  if (['paused', 'ended', 'archived'].includes(status) && !reason) throw new Error('A reason is required')
  return { p_status: status, p_reason: reason, p_impact: text(input.impact, 5000) }
}

export function normalizePeriodInput(input: Json, confirm = false) {
  const normalized: Json = {
    p_plan_id: uuid(input.planId, 'Recurring plan'),
    p_period_start: date(input.periodStart, 'Period start') as string,
    p_past_period_reason: text(input.pastPeriodReason, 2000),
  }
  if (confirm) normalized.p_request_key = uuid(input.requestKey, 'Request key')
  return normalized
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return { admin, user }
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const body = await request.json() as Json
    const action = text(body.action, 40)
    if (!ACTIONS.has(action)) return response({ error: 'Unsupported action' }, 400)
    const { admin, user } = await requireContext(request)
    let functionName: string
    let input: Json
    if (action === 'preview_period') {
      functionName = 'preview_recurring_work_period'
      input = normalizePeriodInput(body)
    } else if (action === 'confirm_period') {
      functionName = 'confirm_recurring_work_period'
      input = normalizePeriodInput(body, true)
    } else if (action === 'create_plan') {
      functionName = 'create_recurring_work_plan'
      input = { p_engagement_service_id: id(body.engagementServiceId, 'Activated service'), ...normalizePlanVersionInput(body) }
    } else if (action === 'create_version') {
      functionName = 'create_recurring_work_plan_version'
      input = { p_plan_id: id(body.planId, 'Recurring plan'), ...normalizePlanVersionInput(body) }
    } else if (action === 'approve_version') {
      functionName = 'approve_recurring_work_plan_version'
      input = {
        p_plan_id: id(body.planId, 'Recurring plan'),
        p_plan_version_id: id(body.planVersionId, 'Recurring plan version'),
        p_approval_note: text(body.approvalNote, 5000),
      }
    } else if (action === 'reassign_template_item') {
      functionName = 'reassign_recurring_plan_template_item'
      input = {
        p_plan_id: id(body.planId, 'Recurring plan'),
        p_template_key: id(body.templateKey, 'Template item'),
        p_assignee_id: text(body.assigneeId, 80) || null,
      }
    } else {
      functionName = 'transition_recurring_work_plan'
      input = { p_plan_id: id(body.planId, 'Recurring plan'), ...normalizeTransitionInput(body) }
    }
    const { data, error } = await admin.rpc(functionName, { ...input, p_actor_id: user.id })
    if (error) throw error
    return response({ data })
  } catch (error) {
    console.error('Recurring Plans failure', error)
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Recurring Plans error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
