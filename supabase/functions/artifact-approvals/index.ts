import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const POLICIES = new Set(['sequential', 'parallel'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function relationRow(value: unknown): Json | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && typeof candidate === 'object' ? candidate as Json : null
}

export function approvalRequestInput(input: Json, minimumApprovers = 2) {
  const artifactVersionId = text(input.artifact_version_id, 80)
  const approvalPolicy = text(input.approval_policy, 30)
  const approverIds = Array.isArray(input.required_approver_ids)
    ? input.required_approver_ids.map(value => text(value, 80)).filter(Boolean)
    : []
  if (!artifactVersionId) throw new Error('Artifact version is required')
  if (!POLICIES.has(approvalPolicy)) throw new Error('Approval policy must be sequential or parallel')
  const minimum = minimumApprovers === 1 ? 1 : 2
  if (approverIds.length < minimum || approverIds.length > 50) throw new Error(`Select between ${minimum} and 50 required approvers`)
  if (new Set(approverIds).size !== approverIds.length) throw new Error('Required approvers must be unique')
  return { artifactVersionId, approvalPolicy, approverIds }
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
  return { userClient, admin, user }
}

async function readableVersion(userClient: Client, artifactVersionId: string) {
  const { data, error } = await userClient.from('artifact_versions')
    .select('id, organization_id, artifact_id, artifacts!inner(engagement_id, artifact_type, title)')
    .eq('id', artifactVersionId).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Artifact version is unavailable'), { status: 404 })
  return data
}

async function requireTeam(admin: Client, organizationId: string, userId: string) {
  const [{ data: organization, error: organizationError }, { data: membership, error: membershipError }] = await Promise.all([
    admin.from('organizations').select('id').eq('id', organizationId).eq('status', 'active').maybeSingle(),
    admin.from('organization_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId)
      .eq('member_kind', 'team').eq('status', 'active').maybeSingle(),
  ])
  if (organizationError) throw organizationError
  if (membershipError) throw membershipError
  if (!organization) throw Object.assign(new Error('Active organization required'), { status: 403 })
  if (!membership) throw Object.assign(new Error('Active team membership required'), { status: 403 })
}

async function listApprovers(admin: Client, organizationId: string) {
  const { data: memberships, error } = await admin.from('organization_memberships')
    .select('user_id, role, department_id').eq('organization_id', organizationId)
    .eq('member_kind', 'team').eq('status', 'active').order('role')
  if (error) throw error
  const userIds = (memberships || []).map((membership: Json) => String(membership.user_id))
  const { data: profiles, error: profileError } = userIds.length
    ? await admin.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [], error: null }
  if (profileError) throw profileError
  const profileById = new Map<string, Json>()
  for (const profile of profiles || []) profileById.set(String(profile.id), profile)
  return (memberships || []).map((membership: Json) => ({
    ...membership,
    full_name: text(profileById.get(String(membership.user_id))?.full_name) || 'Team member',
    email: text(profileById.get(String(membership.user_id))?.email),
  }))
}

async function createRequest(userClient: Client, admin: Client, body: Json, actorId: string) {
  const artifactVersionId = text(body.artifact_version_id, 80)
  if (!artifactVersionId) throw new Error('Artifact version is required')
  const version = await readableVersion(userClient, artifactVersionId)
  const isCampaignBrief = String(relationRow(version.artifacts)?.artifact_type) === 'campaign_brief'
  const input = approvalRequestInput(body, isCampaignBrief ? 1 : 2)
  await requireTeam(admin, String(version.organization_id), actorId)
  const rpc = isCampaignBrief
    ? 'create_marketing_campaign_brief_approval_request'
    : 'create_artifact_approval_request'
  const { data, error } = await admin.rpc(rpc, {
    p_artifact_version_id: input.artifactVersionId,
    p_approval_policy: input.approvalPolicy,
    p_required_approver_ids: input.approverIds,
    p_requested_by: actorId,
  })
  if (error) throw error
  return data
}

async function signOff(userClient: Client, admin: Client, body: Json, actorId: string) {
  const requestId = text(body.request_id, 80)
  if (!requestId) throw new Error('Approval request is required')
  const { data: request, error: requestError } = await userClient.from('artifact_approval_requests')
    .select('id, organization_id').eq('id', requestId).maybeSingle()
  if (requestError || !request) throw Object.assign(new Error('Approval request is unavailable'), { status: 404 })
  await requireTeam(admin, String(request.organization_id), actorId)
  const { data, error } = await admin.rpc('sign_off_artifact_approval', {
    p_request_id: requestId, p_actor_id: actorId,
  })
  if (error) throw error
  return data
}

export function approvalChangeRequestInput(input: Json) {
  const requestId = text(input.request_id, 80)
  const comment = text(input.comment, 8000)
  const idempotencyKey = text(input.idempotency_key, 80)
  if (!requestId) throw new Error('Approval request is required')
  if (!comment) throw new Error('A change request comment is required')
  if (!UUID_PATTERN.test(idempotencyKey)) throw new Error('A valid change request idempotency key is required')
  return { requestId, comment, idempotencyKey }
}

async function requestChanges(userClient: Client, admin: Client, body: Json, actorId: string) {
  const { requestId, comment, idempotencyKey } = approvalChangeRequestInput(body)
  const { data: request, error: requestError } = await userClient.from('artifact_approval_requests')
    .select('id').eq('id', requestId).maybeSingle()
  if (requestError || !request) throw Object.assign(new Error('Approval request is unavailable'), { status: 404 })
  const { data, error } = await admin.rpc('request_artifact_approval_changes', {
    p_request_id: requestId,
    p_actor_id: actorId,
    p_comment: comment,
    p_idempotency_key: idempotencyKey,
  })
  if (error) {
    const status = error.code === 'P0002' ? 404
      : error.code === '42501' ? 403
      : ['23505', '55000'].includes(error.code) ? 409 : 400
    throw Object.assign(new Error(error.message || 'Unable to request changes'), { status })
  }
  return data
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { userClient, admin, user } = await requireContext(request)
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (action === 'list_approvers') {
      const versionId = text(body.artifact_version_id, 80)
      if (!versionId) throw new Error('Artifact version is required')
      const version = await readableVersion(userClient, versionId)
      await requireTeam(admin, String(version.organization_id), user.id)
      return response({ data: await listApprovers(admin, String(version.organization_id)) })
    }
    if (action === 'create_request') {
      return response({ data: await createRequest(userClient, admin, body, user.id) })
    }
    if (action === 'sign_off') {
      return response({ data: await signOff(userClient, admin, body, user.id) })
    }
    if (action === 'request_changes') {
      return response({ data: await requestChanges(userClient, admin, body, user.id) })
    }
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected artifact approval error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
