import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Json = Record<string, unknown>
type Client = ReturnType<typeof createClient<any>>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const DEVELOPMENT_ARTIFACT_TYPES = new Set(['technical_brief', 'launch_checklist'])
const DEVELOPMENT_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'complete'])
const CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted'])
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

function text(value: unknown, max = 12000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function optionalId(value: unknown) {
  return text(value, 80) || null
}

export function hasDevelopmentAuthority(membership: Json) {
  return LEADER_ROLES.has(text(membership.role, 60))
    || text(membership.department_id, 60) === 'development'
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
  const { data: membership } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind')
    .eq('organization_id', ORGANIZATION_ID)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership || membership.status !== 'active' || membership.member_kind !== 'team') {
    throw Object.assign(new Error('Active team membership required'), { status: 403 })
  }
  if (!hasDevelopmentAuthority(membership)) {
    throw Object.assign(new Error('Development department access required'), { status: 403 })
  }
  return { admin, user }
}

async function requireDevelopmentEngagement(admin: Client, engagementId: string) {
  const { data: engagement, error } = await admin.from('engagements')
    .select('id, organization_id, brand_id')
    .eq('id', engagementId)
    .eq('organization_id', ORGANIZATION_ID)
    .maybeSingle()
  if (error || !engagement) throw Object.assign(new Error('Engagement not found'), { status: 404 })
  const { data: services, error: serviceError } = await admin.from('engagement_services')
    .select('id, service_catalog!inner(department_id)')
    .eq('engagement_id', engagementId)
    .eq('status', 'active')
    .eq('service_catalog.department_id', 'development')
    .limit(1)
  if (serviceError || !services?.length) {
    throw Object.assign(new Error('This engagement has no active Development service'), { status: 409 })
  }
  return engagement
}

async function updateStage(admin: Client, body: Json, actorId: string) {
  const stageId = text(body.stage_id, 80)
  const status = text(body.status, 30)
  if (!stageId) throw new Error('Development stage is required')
  if (!DEVELOPMENT_STATUSES.has(status)) throw new Error('Unsupported Development stage status')
  const { data: stage, error: stageError } = await admin.from('engagement_stage_instances')
    .select('id, engagement_id, accountable_department_id')
    .eq('id', stageId)
    .eq('organization_id', ORGANIZATION_ID)
    .maybeSingle()
  if (stageError || !stage || stage.accountable_department_id !== 'development') {
    throw Object.assign(new Error('Development stage not found'), { status: 404 })
  }
  await requireDevelopmentEngagement(admin, stage.engagement_id)
  const { data, error } = await admin.rpc('update_development_stage_tracking', {
    p_stage_id: stage.id,
    p_status: status,
    p_notes: text(body.notes),
    p_actor_id: actorId,
  })
  if (error) throw error
  return data
}

async function saveArtifact(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const artifactType = text(body.artifact_type, 60)
  const classification = text(body.data_classification, 30) || 'internal'
  if (!DEVELOPMENT_ARTIFACT_TYPES.has(artifactType)) throw new Error('Unsupported Development artifact type')
  if (!CLASSIFICATIONS.has(classification)) throw new Error('Unsupported data classification')
  const content = body.content
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error('Development artifact content must be an object')
  }
  await requireDevelopmentEngagement(admin, engagementId)
  const { data, error } = await admin.rpc('save_development_artifact_version', {
    p_engagement_id: engagementId,
    p_stage_id: optionalId(body.stage_id),
    p_artifact_id: optionalId(body.artifact_id),
    p_artifact_type: artifactType,
    p_title: text(body.title, 240),
    p_content: content,
    p_change_summary: text(body.change_summary, 1000),
    p_data_classification: classification,
    p_ai_use_allowed: body.ai_use_allowed === true,
    p_actor_id: actorId,
  })
  if (error) throw error
  return data
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { admin, user } = await requireContext(request)
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (action === 'update_stage') return response({ data: await updateStage(admin, body, user.id) })
    if (action === 'save_artifact') return response({ data: await saveArtifact(admin, body, user.id) })
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response(
      { error: error instanceof Error ? error.message : 'Unexpected Development Studio error' },
      Number.isFinite(status) ? status : 400,
    )
  }
}

if (import.meta.main) Deno.serve(handleRequest)
