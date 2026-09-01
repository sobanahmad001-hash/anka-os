import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const CONTENT_TYPES = new Set([
  'discovery', 'vision', 'audience', 'brand_statement', 'website_architecture',
  'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
])
const MARKETING_TYPES = new Set([
  'channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report',
])
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

function artifactDepartment(artifactType: string) {
  if (CONTENT_TYPES.has(artifactType)) return 'content'
  if (MARKETING_TYPES.has(artifactType)) return 'marketing'
  return null
}

export function hasResolveAuthority(membership: Json, targetDepartment: string | null, isAuthor: boolean) {
  if (isAuthor) return true
  const role = text(membership.role, 60)
  if (LEADER_ROLES.has(role)) return true
  return role === 'department_manager'
    && Boolean(targetDepartment)
    && text(membership.department_id, 60) === targetDepartment
}

export function normalizeCommentPosition(value: unknown) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Comment position is invalid')
  const input = value as Json
  const keys = Object.keys(input)
  if (keys.length === 1 && keys[0] === 'region') {
    const region = text(input.region, 200)
    if (!region) throw new Error('Comment region is required')
    return { region }
  }
  if (keys.length === 2 && keys.includes('x') && keys.includes('y')) {
    const x = Number(input.x); const y = Number(input.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error('Comment coordinates must be normalized between zero and one')
    }
    return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 }
  }
  throw new Error('Comment position must contain either a region or normalized x/y coordinates')
}

export function exactTarget(input: Json) {
  const artifactVersionId = text(input.artifact_version_id, 80)
  const directionVersionId = text(input.design_direction_version_id, 80)
  const contentRequestId = text(input.content_request_id, 80)
  const selected = [
    artifactVersionId ? 1 : 0,
    directionVersionId ? 1 : 0,
    contentRequestId ? 1 : 0,
  ].reduce((sum, item) => sum + item, 0)

  if (selected !== 1) {
    throw new Error('Select exactly one version target')
  }

  return {
    artifactVersionId: artifactVersionId || null,
    directionVersionId: directionVersionId || null,
    contentRequestId: contentRequestId || null,
  }
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
  return { userClient, admin, user, membership }
}

async function readableTarget(userClient: Client, input: Json) {
  const target = exactTarget(input)
  if (target.artifactVersionId) {
    const { data: version, error } = await userClient.from('artifact_versions')
      .select('id, organization_id, artifacts!inner(id, artifact_type, engagement_id)')
      .eq('id', target.artifactVersionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    const relation = version?.artifacts
    const artifact = Array.isArray(relation) ? relation[0] : relation
    if (error || !version || !artifact) throw Object.assign(new Error('Artifact version is unavailable'), { status: 404 })
    const department = artifactDepartment(text(artifact.artifact_type, 60))
    if (!department) throw Object.assign(new Error('This artifact type is not enabled for proofing'), { status: 409 })
    return { ...target, department, organizationId: version.organization_id }
  }
  if (target.directionVersionId) {
    const { data: version, error } = await userClient.from('design_direction_versions')
      .select('id, organization_id').eq('id', target.directionVersionId)
      .eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (error || !version) throw Object.assign(new Error('Design direction version is unavailable'), { status: 404 })
    return { ...target, department: 'design', organizationId: version.organization_id }
  }
  const { data: request, error } = await userClient.from('content_requests')
    .select('id, organization_id').eq('id', target.contentRequestId)
    .eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !request) throw Object.assign(new Error('Content request is unavailable'), { status: 404 })
  return { ...target, department: 'content', organizationId: request.organization_id }
}

async function addComment(userClient: Client, admin: Client, body: Json, actorId: string) {
  const target = await readableTarget(userClient, body)
  const commentBody = text(body.body, 8000)
  if (!commentBody) throw new Error('Comment body is required')
  const { data, error } = await admin.from('artifact_version_comments').insert({
    organization_id: target.organizationId,
    artifact_version_id: target.artifactVersionId,
    design_direction_version_id: target.directionVersionId,
    content_request_id: target.contentRequestId,
    author_id: actorId,
    body: commentBody,
    comment_position: normalizeCommentPosition(body.comment_position),
  }).select('*').single()
  if (error) throw error
  return data
}

async function resolveComment(userClient: Client, admin: Client, body: Json, actorId: string, membership: Json) {
  const commentId = text(body.comment_id, 80)
  if (!commentId) throw new Error('Comment ID is required')
  const { data: comment, error } = await userClient.from('artifact_version_comments')
    .select('*').eq('id', commentId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !comment) throw Object.assign(new Error('Proofing comment is unavailable'), { status: 404 })
  if (comment.resolved) throw Object.assign(new Error('This comment is already resolved'), { status: 409 })
  const target = await readableTarget(userClient, comment)
  if (!hasResolveAuthority(membership, target.department, comment.author_id === actorId)) {
    throw Object.assign(new Error('Only the comment author or an approver-eligible manager may resolve this comment'), { status: 403 })
  }
  const { data, error: updateError } = await admin.from('artifact_version_comments').update({
    resolved: true, resolved_by: actorId, resolved_at: new Date().toISOString(),
  }).eq('id', comment.id).eq('organization_id', ORGANIZATION_ID).eq('resolved', false).select('*').maybeSingle()
  if (updateError) throw updateError
  if (!data) throw Object.assign(new Error('This comment was resolved by another reviewer'), { status: 409 })
  return data
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { userClient, admin, user, membership } = await requireContext(request)
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (action === 'add_comment') return response({ data: await addComment(userClient, admin, body, user.id) })
    if (action === 'resolve_comment') {
      return response({ data: await resolveComment(userClient, admin, body, user.id, membership) })
    }
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected proofing error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)