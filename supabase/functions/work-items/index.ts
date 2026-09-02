import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Json = Record<string, unknown>

const ACTIONS = new Set([
  'save', 'delete', 'add_dependency', 'remove_dependency',
  'acknowledge_automation_flag', 'generate_content_tasks',
])
const WORK_ITEM_TYPES = new Set(['task', 'bug', 'request'])
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'done'])
const CREATED_VIA = new Set(['manual', 'ai_chat_proposal', 'automation_rule'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function text(value: unknown, max = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function optionalId(value: unknown) {
  return text(value, 80) || null
}

function optionalDate(value: unknown) {
  const normalized = text(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

export function normalizeWorkItemInput(input: Json) {
  const title = text(input.title, 240)
  const engagementId = optionalId(input.engagementId)
  const workItemType = text(input.workItemType, 20) || 'task'
  const priority = text(input.priority, 20) || 'medium'
  const status = text(input.status, 20) || 'not_started'
  if (!engagementId) throw new Error('Engagement is required')
  if (!title) throw new Error('Title is required')
  if (!WORK_ITEM_TYPES.has(workItemType)) throw new Error('Unsupported work item type')
  if (!PRIORITIES.has(priority)) throw new Error('Unsupported priority')
  if (!STATUSES.has(status)) throw new Error('Unsupported work item status')
  const startDate = optionalDate(input.startDate)
  const dueDate = optionalDate(input.dueDate)
  const createdVia = text(input.created_via, 20) || 'manual'
  if (startDate && dueDate && dueDate < startDate) throw new Error('Due date cannot be before start date')
  if (!CREATED_VIA.has(createdVia)) throw new Error('Unsupported created_via value')
  return {
    p_work_item_id: optionalId(input.workItemId),
    p_engagement_id: engagementId,
    p_title: title,
    p_description: text(input.description),
    p_work_item_type: workItemType,
    p_priority: priority,
    p_status: status,
    p_assignee_id: optionalId(input.assigneeId),
    p_department_id: optionalId(input.departmentId),
    p_linked_artifact_id: optionalId(input.linkedArtifactId),
    p_linked_artifact_version_id: optionalId(input.linkedArtifactVersionId),
    p_linked_engagement_stage_instance_id: optionalId(input.linkedEngagementStageInstanceId),
    p_start_date: startDate,
    p_due_date: dueDate,
    p_position: Math.max(0, Number.isInteger(input.position) ? Number(input.position) : 0),
    p_parent_work_item_id: optionalId(input.parentWorkItemId),
    p_created_via: createdVia,
  }
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authentication required'), { status: 401 })
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
  })
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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
    if (action === 'generate_content_tasks') {
      const engagementId = optionalId(body.engagementId)
      if (!engagementId) return response({ error: 'Engagement is required' }, 400)
      const { data, error } = await admin.rpc('generate_content_page_work_items', {
        p_engagement_id: engagementId,
        p_actor_id: user.id,
      })
      if (error) throw error
      return response({ data })
    }
    if (action === 'acknowledge_automation_flag') {
      const workItemId = optionalId(body.workItemId)
      if (!workItemId) return response({ error: 'Work item is required' }, 400)
      const { data, error } = await admin.rpc('acknowledge_work_item_automation_flag', {
        p_work_item_id: workItemId,
        p_actor_id: user.id,
      })
      if (error) throw error
      return response({ data })
    }
    if (action === 'add_dependency' || action === 'remove_dependency') {
      const workItemId = optionalId(body.workItemId)
      const dependsOnWorkItemId = optionalId(body.dependsOnWorkItemId)
      if (!workItemId || !dependsOnWorkItemId) return response({ error: 'Both work items are required' }, 400)
      const functionName = action === 'add_dependency' ? 'save_work_item_dependency' : 'remove_work_item_dependency'
      const { data, error } = await admin.rpc(functionName, {
        p_work_item_id: workItemId,
        p_depends_on_work_item_id: dependsOnWorkItemId,
        p_actor_id: user.id,
      })
      if (error) throw error
      return response({ data })
    }
    if (action === 'delete') {
      const workItemId = optionalId(body.workItemId)
      if (!workItemId) return response({ error: 'Work item is required' }, 400)
      const { data, error } = await admin.rpc('soft_delete_work_item', {
        p_work_item_id: workItemId,
        p_actor_id: user.id,
      })
      if (error) throw error
      return response({ data })
    }
    const input = normalizeWorkItemInput(body)
    const { data, error } = await admin.rpc('save_work_item', {
      ...input,
      p_actor_id: user.id,
    })
    if (error) throw error
    return response({ data })
  } catch (error) {
    console.error('Work Items failure', error)
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 400
    return response(
      { error: error instanceof Error ? error.message : 'Unexpected Work Items error' },
      Number.isFinite(status) ? status : 400,
    )
  }
}

if (import.meta.main) Deno.serve(handleRequest)
