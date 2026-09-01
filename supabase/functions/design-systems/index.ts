import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { stableJson } from '../_shared/approvedArtifactContext.ts'
import { namedKey } from '../_shared/googleOAuthTokens.ts'
import {
  hasWorkshopAuthority,
  requireActiveDesignService,
  sha256,
} from '../design-workshop/index.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const DESIGN_SYSTEM_TYPE = 'design_system'
const DESIGN_SYSTEM_SERVICE = 'design_systems'
const CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted'])
const CONTENT_KEYS = new Set(['color_tokens', 'typography_scale', 'components', 'usage_rules'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Json
}

function exactKeys(value: Json, keys: string[], label: string) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}`)
  }
}

function structuredList(value: unknown, label: string, keys: string[], normalize: (row: Json) => Json) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > 100) throw new Error(`${label} cannot contain more than 100 entries`)
  return value.map((entry, index) => {
    const row = object(entry, `${label} item ${index + 1}`)
    exactKeys(row, keys, `${label} item ${index + 1}`)
    return normalize(row)
  })
}

export function designSystemContent(value: unknown) {
  const content = object(value, 'Design system content')
  exactKeys(content, [...CONTENT_KEYS], 'Design system content')
  const colorTokens = structuredList(content.color_tokens, 'Color tokens', ['name', 'value'], row => {
    const name = text(row.name, 120); const tokenValue = text(row.value, 40)
    if (!name || !/^#[0-9a-f]{3,8}$/i.test(tokenValue)) throw new Error('Color tokens require a name and hexadecimal value')
    return { name, value: tokenValue }
  })
  const typographyScale = structuredList(
    content.typography_scale,
    'Typography scale',
    ['name', 'font', 'size', 'weight'],
    row => {
      const normalized = {
        name: text(row.name, 120), font: text(row.font, 160),
        size: text(row.size, 80), weight: text(row.weight, 80),
      }
      if (Object.values(normalized).some(value => !value)) throw new Error('Typography entries require name, font, size, and weight')
      return normalized
    },
  )
  const components = structuredList(
    content.components,
    'Components',
    ['name', 'description', 'usage_notes'],
    row => {
      const normalized = {
        name: text(row.name, 160), description: text(row.description, 4000),
        usage_notes: text(row.usage_notes, 4000),
      }
      if (Object.values(normalized).some(value => !value)) throw new Error('Components require name, description, and usage notes')
      return normalized
    },
  )
  return {
    color_tokens: colorTokens,
    typography_scale: typographyScale,
    components,
    usage_rules: text(content.usage_rules, 12000),
  }
}

export function hasDesignSystemsAuthority(membership: Json, action: string) {
  return action === 'release_design_system'
    ? hasWorkshopAuthority(membership, 'release_direction')
    : hasWorkshopAuthority(membership, 'create_session')
}

export async function requireActiveDesignSystemsService(
  admin: Client,
  engagementId: string,
  engagementServiceId: string,
) {
  const result = await requireActiveDesignService(admin, engagementId, engagementServiceId)
  if (result.catalog?.slug !== DESIGN_SYSTEM_SERVICE) {
    throw new Error('Select the active Design Systems service for this engagement')
  }
  return result
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const url = Deno.env.get('SUPABASE_URL') || ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } })
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const { data: membership } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id, member_kind, status')
    .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).maybeSingle()
  if (!membership || membership.member_kind !== 'team' || membership.status !== 'active') {
    throw Object.assign(new Error('Active team membership required'), { status: 403 })
  }
  return { admin, user, membership }
}

async function requireEngagement(admin: Client, engagementId: string) {
  const { data, error } = await admin.from('engagements').select('id, organization_id, brand_id')
    .eq('id', engagementId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Engagement not found'), { status: 404 })
  return data
}

async function saveDesignSystem(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const engagementServiceId = text(body.engagement_service_id, 80)
  const engagement = await requireEngagement(admin, engagementId)
  await requireActiveDesignSystemsService(admin, engagement.id, engagementServiceId)
  const content = designSystemContent(body.content)
  const classification = text(body.data_classification, 30) || 'internal'
  if (!CLASSIFICATIONS.has(classification)) throw new Error('Unsupported data classification')
  let artifactId = text(body.artifact_id, 80)
  let createdArtifact = false
  if (artifactId) {
    const { data: artifact, error } = await admin.from('artifacts')
      .select('id, engagement_id, brand_id, artifact_type').eq('id', artifactId)
      .eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (error || !artifact || artifact.artifact_type !== DESIGN_SYSTEM_TYPE
      || artifact.engagement_id !== engagement.id || artifact.brand_id !== engagement.brand_id) {
      throw new Error('Design system does not match this engagement')
    }
  } else {
    const { data: artifact, error } = await admin.from('artifacts').insert({
      organization_id: ORGANIZATION_ID, engagement_id: engagement.id, brand_id: engagement.brand_id,
      artifact_type: DESIGN_SYSTEM_TYPE, title: text(body.title, 240) || 'Design system', created_by: actorId,
    }).select('id').single()
    if (error) throw error
    artifactId = artifact.id
    createdArtifact = true
  }
  const { data: latest, error: latestError } = await admin.from('artifact_versions')
    .select('id, version_number').eq('artifact_id', artifactId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  if (latestError) throw latestError
  const { data: version, error: versionError } = await admin.from('artifact_versions').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifactId,
    version_number: (latest?.version_number || 0) + 1, parent_version_id: latest?.id || null,
    content, content_checksum: await sha256(stableJson(content)),
    change_summary: text(body.change_summary, 1000), ai_use_allowed: false,
    data_classification: classification, created_by: actorId,
  }).select('*').single()
  if (versionError) {
    if (createdArtifact) await admin.from('artifacts').delete().eq('id', artifactId)
    throw versionError
  }
  const { error: eventError } = await admin.from('engagement_events').insert({
    organization_id: ORGANIZATION_ID, engagement_id: engagement.id,
    event_type: 'artifact_version_created', actor_id: actorId,
    payload: { record_type: 'artifact', record_id: artifactId, version_id: version.id,
      action: 'version_created', artifact_type: DESIGN_SYSTEM_TYPE, source: 'manual', ai_run_id: null },
  })
  if (eventError) throw eventError
  return { artifact_id: artifactId, version }
}

async function releaseDesignSystem(admin: Client, body: Json, actorId: string) {
  const versionId = text(body.artifact_version_id, 80)
  const engagementServiceId = text(body.engagement_service_id, 80)
  const { data: version, error } = await admin.from('artifact_versions')
    .select('id, artifact_id, artifacts!inner(id, artifact_type, engagement_id, organization_id)')
    .eq('id', versionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  const artifactRelation = version?.artifacts
  const artifact = Array.isArray(artifactRelation) ? artifactRelation[0] : artifactRelation
  if (error || !version || !artifact || artifact.artifact_type !== DESIGN_SYSTEM_TYPE) {
    throw Object.assign(new Error('Design system version not found'), { status: 404 })
  }
  await requireActiveDesignSystemsService(admin, artifact.engagement_id, engagementServiceId)
  const { data: existing, error: existingError } = await admin.from('artifact_approvals')
    .select('*').eq('artifact_version_id', version.id).maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing
  const { data: pending, error: pendingError } = await admin.from('artifact_approval_requests')
    .select('id').eq('artifact_version_id', version.id).eq('status', 'pending').maybeSingle()
  if (pendingError) throw pendingError
  if (pending) throw Object.assign(new Error('This version has a pending multi-approver request'), { status: 409 })
  const { data: approval, error: approvalError } = await admin.from('artifact_approvals').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifact.id, artifact_version_id: version.id,
    engagement_id: artifact.engagement_id, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (approvalError) throw approvalError
  const { error: eventError } = await admin.from('engagement_events').insert({
    organization_id: ORGANIZATION_ID, engagement_id: artifact.engagement_id,
    event_type: 'artifact_approved', actor_id: actorId,
    payload: { record_type: 'artifact', record_id: artifact.id, version_id: version.id,
      action: 'approved', artifact_type: DESIGN_SYSTEM_TYPE },
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
    const action = text(body.action, 80)
    if (!hasDesignSystemsAuthority(membership as Json, action)) {
      return response({ error: 'Your department role cannot perform this action' }, 403)
    }
    if (action === 'save_design_system') return response({ data: await saveDesignSystem(admin, body, user.id) })
    if (action === 'release_design_system') return response({ data: await releaseDesignSystem(admin, body, user.id) })
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    console.error('Design Systems failure', error)
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Design Systems failed' }, status)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
