import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { CONTENT_ARTIFACT_TYPE_SET, createContentArtifactVersion } from '../_shared/contentArtifacts.ts'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const MANAGER_ROLES = new Set(['department_manager'])
const CLASSIFICATIONS = new Set(['internal', 'confidential', 'public', 'restricted'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function hasContentAuthority(membership: Json, action: string) {
  const role = text(membership.role, 60)
  if (LEADER_ROLES.has(role)) return true
  if (text(membership.department_id, 60) !== 'content') return false
  if (action === 'approve_artifact') return MANAGER_ROLES.has(role)
  return true
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
  const { data: membership } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind')
    .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).maybeSingle()
  if (!membership || membership.status !== 'active' || membership.member_kind !== 'team') {
    throw Object.assign(new Error('Active team membership required'), { status: 403 })
  }
  return { admin, user, membership }
}

export async function requireContentEngagement(admin: Client, engagementId: string) {
  const { data: engagement, error } = await admin.from('engagements')
    .select('id, organization_id, brand_id, name, status').eq('id', engagementId)
    .eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !engagement) throw Object.assign(new Error('Engagement not found'), { status: 404 })
  const { data: services, error: serviceError } = await admin.from('engagement_services')
    .select('id, service_catalog!inner(department_id)').eq('engagement_id', engagementId)
    .eq('status', 'active').eq('service_catalog.department_id', 'content').limit(1)
  if (serviceError || !services?.length) {
    throw Object.assign(new Error('This engagement has no active Content service'), { status: 409 })
  }
  return engagement
}

async function safeStage(admin: Client, engagementId: string, stageId: unknown) {
  const id = text(stageId, 80)
  if (!id) return null
  const { data: stage, error } = await admin.from('engagement_stage_instances')
    .select('id, accountable_department_id').eq('id', id).eq('engagement_id', engagementId)
    .eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !stage || stage.accountable_department_id !== 'content') {
    throw new Error('Content stage does not match this engagement')
  }
  return stage.id
}

async function saveArtifact(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const artifactType = text(body.artifact_type, 60)
  if (!CONTENT_ARTIFACT_TYPE_SET.has(artifactType)) throw new Error('Unsupported Content artifact')
  const engagement = await requireContentEngagement(admin, engagementId)
  const stageId = await safeStage(admin, engagement.id, body.engagement_stage_instance_id)
  const classification = text(body.data_classification, 30) || 'internal'
  if (!CLASSIFICATIONS.has(classification)) throw new Error('Unsupported data classification')
  return createContentArtifactVersion(admin, {
    organizationId: ORGANIZATION_ID, engagement, stageId,
    artifactId: text(body.artifact_id, 80) || null, artifactType,
    title: text(body.title, 240), content: body.content,
    changeSummary: text(body.change_summary, 1000), aiUseAllowed: body.ai_use_allowed === true,
    dataClassification: classification, actorId, source: 'manual',
  })
}

async function approveArtifact(admin: Client, body: Json, actorId: string) {
  const versionId = text(body.artifact_version_id, 80)
  const { data: version, error: versionError } = await admin.from('artifact_versions')
    .select('id, artifact_id, artifacts!inner(id, artifact_type, engagement_id, organization_id)')
    .eq('id', versionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  const artifactRelation = version?.artifacts
  const artifact = Array.isArray(artifactRelation) ? artifactRelation[0] : artifactRelation
  if (versionError || !version || !artifact || !CONTENT_ARTIFACT_TYPE_SET.has(artifact.artifact_type)) {
    throw Object.assign(new Error('Content artifact version not found'), { status: 404 })
  }
  await requireContentEngagement(admin, artifact.engagement_id)
  const { data: approval, error } = await admin.from('artifact_approvals').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifact.id, artifact_version_id: version.id,
    engagement_id: artifact.engagement_id, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (error) throw error
  const { error: eventError } = await admin.from('engagement_events').insert({
    organization_id: ORGANIZATION_ID, engagement_id: artifact.engagement_id,
    event_type: 'artifact_approved', actor_id: actorId,
    payload: {
      record_type: 'artifact', record_id: artifact.id, version_id: version.id,
      action: 'approved', artifact_type: artifact.artifact_type,
    },
  })
  if (eventError) throw eventError
  return approval
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { admin, user, membership } = await requireContext(request)
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (!hasContentAuthority(membership, action)) {
      return response({ error: action === 'approve_artifact'
        ? 'Content manager approval required' : 'Content department access required' }, 403)
    }
    if (action === 'save_artifact') return response({ data: await saveArtifact(admin, body, user.id) })
    if (action === 'approve_artifact') return response({ data: await approveArtifact(admin, body, user.id) })
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Content Studio error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
