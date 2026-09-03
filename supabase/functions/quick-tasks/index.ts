import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Json = Record<string, unknown>
const ACTIONS = new Set(['create', 'append', 'fork'])
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

function response(body: Json, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }
function text(value: unknown, max = 50000) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function id(value: unknown) { return text(value, 80) || null }

export function normalizeQuickTaskInput(action: string, input: Json) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported action')
  if (action === 'create') {
    const title = text(input.title, 240); const organizationId = id(input.organizationId)
    if (!organizationId) throw new Error('Organization is required')
    if (!title) throw new Error('Title is required')
    if (!input.content || typeof input.content !== 'object' || Array.isArray(input.content)) throw new Error('Content must be an object')
    return { p_organization_id: organizationId, p_title: title, p_content: input.content }
  }
  if (action === 'append') {
    const quickTaskId = id(input.quickTaskId); const expectedRevisionId = id(input.expectedRevisionId); const title = text(input.title, 240)
    if (!quickTaskId || !expectedRevisionId) throw new Error('Quick Task and expected revision are required')
    if (!title) throw new Error('Title is required')
    if (!input.content || typeof input.content !== 'object' || Array.isArray(input.content)) throw new Error('Content must be an object')
    return { p_quick_task_id: quickTaskId, p_expected_revision_id: expectedRevisionId, p_title: title, p_content: input.content }
  }
  const quickTaskId = id(input.quickTaskId); const revisionId = id(input.revisionId)
  if (!quickTaskId || !revisionId) throw new Error('Quick Task and source revision are required')
  return { p_source_quick_task_id: quickTaskId, p_source_revision_id: revisionId, p_title: text(input.title, 240) || null }
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const publishable = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'); const secret = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publishable || !secret) throw new Error('Function environment is incomplete')
  const userClient = createClient(url, publishable, { global: { headers: { Authorization: authorization } } })
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return { admin, user }
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const body = await request.json() as Json; const action = text(body.action, 20); const input = normalizeQuickTaskInput(action, body); const { admin, user } = await requireContext(request)
    const functionName = action === 'create' ? 'create_quick_task' : action === 'append' ? 'append_quick_task_revision' : 'fork_quick_task'
    const { data, error } = await admin.rpc(functionName, { ...input, p_actor_id: user.id })
    if (error) throw error
    return response({ data })
  } catch (error) {
    console.error('Quick Tasks failure', error)
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Quick Tasks error' }, Number.isFinite(status) ? status : 400)
  }
}
if (import.meta.main) Deno.serve(handleRequest)
