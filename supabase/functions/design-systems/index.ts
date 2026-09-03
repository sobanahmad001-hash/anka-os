import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { stableJson } from '../_shared/approvedArtifactContext.ts'
import {
  resolveServerOrganizationContext,
  type ServerOrganizationContext,
  type ServerOrganizationScope,
} from '../_shared/serverOrganizationContext.ts'
import {
  hasWorkshopAuthority,
  requireActiveDesignService,
  sha256,
} from '../design-workshop/index.ts'

type Client = ReturnType<typeof createClient<any>>
type ScopedClient = Client & { organizationId: string }
type DesignSystemsOrganizationContext = Pick<ServerOrganizationContext, 'admin' | 'organizationId'>
type Json = Record<string, unknown>

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

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status })
}

function requiredId(value: unknown, label: string) {
  const id = text(value, 80)
  if (!id) throw new Error(label + ' is required')
  return id
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
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
  if (action !== 'save_design_system' && action !== 'release_design_system') return false
  return action === 'release_design_system'
    ? hasWorkshopAuthority(membership, 'release_direction')
    : hasWorkshopAuthority(membership, 'create_session')
}

type CallerIdentity = { userClient: Client; userId: string }
type DesignSystemsPreflight = {
  action: 'save_design_system' | 'release_design_system'
  scope: ServerOrganizationScope
  organizationId: string
  engagementId: string
  brandId: string
  artifactId?: string
  artifactVersionId?: string
  membership: Json
}

export function designSystemsScope(body: Json): ServerOrganizationScope {
  const action = text(body.action, 80)
  if (action !== 'save_design_system' && action !== 'release_design_system') throw new Error('Unsupported action')
  requiredId(body.engagement_service_id, 'Engagement service')
  const requestedOrganizationId = text(body.organization_id, 80) || null
  if (action === 'save_design_system') {
    return {
      root: { kind: 'engagement', id: requiredId(body.engagement_id, 'Engagement') },
      requestedOrganizationId,
    }
  }
  if (action === 'release_design_system') {
    return {
      root: { kind: 'artifact_version', id: requiredId(body.artifact_version_id, 'Artifact version') },
      requestedOrganizationId,
    }
  }
  throw new Error('Unsupported action')
}

function publicApiKey() {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')?.split(',').map(value => value.trim()).find(Boolean)
    || Deno.env.get('SUPABASE_ANON_KEY') || ''
}

async function callerIdentity(request: Request): Promise<CallerIdentity> {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) {
    throw httpError('Authentication required', 401)
  }
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = publicApiKey()
  if (!url || !key) throw new Error('Function environment is incomplete')
  const userClient = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw httpError('Authentication required', 401)
  return { userClient, userId: user.id }
}

export async function preflightDesignSystemsRequest(
  userClient: Client,
  userId: string,
  body: Json,
  scope = designSystemsScope(body),
): Promise<DesignSystemsPreflight> {
  const action = text(body.action, 80)
  if (action !== 'save_design_system' && action !== 'release_design_system') throw new Error('Unsupported action')
  let organizationId: string
  let engagementId: string
  let brandId: string
  let artifactId: string | undefined
  let artifactVersionId: string | undefined

  if (action === 'save_design_system') {
    engagementId = requiredId(body.engagement_id, 'Engagement')
    const { data: engagement, error } = await userClient.from('engagements')
      .select('id, organization_id, brand_id').eq('id', engagementId).maybeSingle()
    if (error || !engagement) throw httpError('Engagement not found', 404)
    organizationId = requiredId(engagement.organization_id, 'Engagement organization')
    brandId = requiredId(engagement.brand_id, 'Engagement brand')
    artifactId = text(body.artifact_id, 80) || undefined
    if (artifactId) {
      const { data: artifact, error: artifactError } = await userClient.from('artifacts')
        .select('id, organization_id, engagement_id, brand_id, artifact_type').eq('id', artifactId).maybeSingle()
      if (artifactError || !artifact) throw httpError('Design system not found', 404)
      if (artifact.organization_id !== organizationId || artifact.engagement_id !== engagementId
        || artifact.brand_id !== brandId || artifact.artifact_type !== DESIGN_SYSTEM_TYPE) {
        throw httpError('Design system does not match this engagement', 409)
      }
    }
  } else {
    artifactVersionId = requiredId(body.artifact_version_id, 'Artifact version')
    const { data: version, error } = await userClient.from('artifact_versions')
      .select('id, organization_id, artifact_id, artifact:artifacts!inner(id, organization_id, engagement_id, brand_id, artifact_type)')
      .eq('id', artifactVersionId).maybeSingle()
    const artifact = one(version?.artifact)
    if (error || !version || !artifact || artifact.artifact_type !== DESIGN_SYSTEM_TYPE) {
      throw httpError('Design system version not found', 404)
    }
    if (artifact.id !== version.artifact_id || artifact.organization_id !== version.organization_id) {
      throw httpError('Design system version has an invalid organization chain', 409)
    }
    organizationId = requiredId(version.organization_id, 'Artifact version organization')
    engagementId = requiredId(artifact.engagement_id, 'Design system engagement')
    brandId = requiredId(artifact.brand_id, 'Design system brand')
    artifactId = requiredId(artifact.id, 'Design system')
  }

  const requestedOrganizationId = text(body.organization_id, 80)
  if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
    throw httpError('Requested organization does not match the root resource', 403)
  }

  const { data: membership, error: membershipError } = await userClient.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind, organization:organizations!inner(id, status)')
    .eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'active')
    .eq('member_kind', 'team').eq('organization.status', 'active').maybeSingle()
  if (membershipError || !membership || membership.organization_id !== organizationId
    || membership.status !== 'active' || membership.member_kind !== 'team'
    || one(membership.organization)?.status !== 'active') {
    throw httpError('Active team membership required', 403)
  }
  if (!hasDesignSystemsAuthority(membership as Json, action)) {
    throw httpError('Your department role cannot perform this action', 403)
  }

  const engagementServiceId = requiredId(body.engagement_service_id, 'Engagement service')
  const { data: service, error: serviceError } = await userClient.from('engagement_services')
    .select('id, organization_id, engagement_id, status, service_catalog!inner(slug, department_id, is_active)')
    .eq('id', engagementServiceId).eq('organization_id', organizationId).eq('engagement_id', engagementId)
    .eq('status', 'active').eq('service_catalog.department_id', 'design')
    .eq('service_catalog.is_active', true).maybeSingle()
  const catalog = one(service?.service_catalog)
  if (serviceError || !service || service.organization_id !== organizationId
    || service.engagement_id !== engagementId || service.status !== 'active'
    || catalog?.slug !== DESIGN_SYSTEM_SERVICE || catalog?.department_id !== 'design'
    || catalog?.is_active !== true) {
    throw httpError('Select the active Design Systems service for this engagement', 404)
  }

  return {
    action,
    scope,
    organizationId,
    engagementId,
    brandId,
    artifactId,
    artifactVersionId,
    membership: membership as Json,
  }
}

export async function requireActiveDesignSystemsService(
  context: DesignSystemsOrganizationContext,
  engagementId: string,
  engagementServiceId: string,
) {
  const result = await requireActiveDesignService(context, engagementId, engagementServiceId)
  if (result.catalog?.slug !== DESIGN_SYSTEM_SERVICE) {
    throw new Error('Select the active Design Systems service for this engagement')
  }
  return result
}

async function requireEngagement(admin: ScopedClient, engagementId: string) {
  const { data, error } = await admin.from('engagements').select('id, organization_id, brand_id')
    .eq('id', engagementId).eq('organization_id', admin.organizationId).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Engagement not found'), { status: 404 })
  return data
}

export async function saveDesignSystem(admin: ScopedClient, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const engagementServiceId = text(body.engagement_service_id, 80)
  const engagement = await requireEngagement(admin, engagementId)
  await requireActiveDesignSystemsService({ admin, organizationId: admin.organizationId }, engagement.id, engagementServiceId)
  const content = designSystemContent(body.content)
  const classification = text(body.data_classification, 30) || 'internal'
  if (!CLASSIFICATIONS.has(classification)) throw new Error('Unsupported data classification')
  let artifactId = text(body.artifact_id, 80)
  let createdArtifact = false
  if (artifactId) {
    const { data: artifact, error } = await admin.from('artifacts')
      .select('id, engagement_id, brand_id, artifact_type').eq('id', artifactId)
      .eq('organization_id', admin.organizationId).maybeSingle()
    if (error || !artifact || artifact.artifact_type !== DESIGN_SYSTEM_TYPE
      || artifact.engagement_id !== engagement.id || artifact.brand_id !== engagement.brand_id) {
      throw new Error('Design system does not match this engagement')
    }
  } else {
    const { data: artifact, error } = await admin.from('artifacts').insert({
      organization_id: admin.organizationId, engagement_id: engagement.id, brand_id: engagement.brand_id,
      artifact_type: DESIGN_SYSTEM_TYPE, title: text(body.title, 240) || 'Design system', created_by: actorId,
    }).select('id').single()
    if (error) throw error
    artifactId = artifact.id
    createdArtifact = true
  }
  const { data: latest, error: latestError } = await admin.from('artifact_versions')
    .select('id, version_number').eq('artifact_id', artifactId).eq('organization_id', admin.organizationId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  if (latestError) throw latestError
  const { data: version, error: versionError } = await admin.from('artifact_versions').insert({
    organization_id: admin.organizationId, artifact_id: artifactId,
    version_number: (latest?.version_number || 0) + 1, parent_version_id: latest?.id || null,
    content, content_checksum: await sha256(stableJson(content)),
    change_summary: text(body.change_summary, 1000), ai_use_allowed: false,
    data_classification: classification, created_by: actorId,
  }).select('*').single()
  if (versionError) {
    if (createdArtifact) await admin.from('artifacts').delete().eq('id', artifactId).eq('organization_id', admin.organizationId)
    throw versionError
  }
  const { error: eventError } = await admin.from('engagement_events').insert({
    organization_id: admin.organizationId, engagement_id: engagement.id,
    event_type: 'artifact_version_created', actor_id: actorId,
    payload: { record_type: 'artifact', record_id: artifactId, version_id: version.id,
      action: 'version_created', artifact_type: DESIGN_SYSTEM_TYPE, source: 'manual', ai_run_id: null },
  })
  if (eventError) throw eventError
  return { artifact_id: artifactId, version }
}

export async function releaseDesignSystem(admin: ScopedClient, body: Json, actorId: string) {
  const versionId = text(body.artifact_version_id, 80)
  const engagementServiceId = text(body.engagement_service_id, 80)
  const { data: version, error } = await admin.from('artifact_versions')
    .select('id, artifact_id, artifacts!inner(id, artifact_type, engagement_id, organization_id)')
    .eq('id', versionId).eq('organization_id', admin.organizationId)
    .eq('artifacts.organization_id', admin.organizationId).maybeSingle()
  const artifactRelation = version?.artifacts
  const artifact = Array.isArray(artifactRelation) ? artifactRelation[0] : artifactRelation
  if (error || !version || !artifact || artifact.artifact_type !== DESIGN_SYSTEM_TYPE
    || artifact.id !== version.artifact_id || artifact.organization_id !== admin.organizationId) {
    throw Object.assign(new Error('Design system version not found'), { status: 404 })
  }
  await requireActiveDesignSystemsService({ admin, organizationId: admin.organizationId }, artifact.engagement_id, engagementServiceId)
  const { data: existing, error: existingError } = await admin.from('artifact_approvals')
    .select('*').eq('artifact_version_id', version.id).eq('artifact_id', artifact.id)
    .eq('organization_id', admin.organizationId).maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing
  const { data: pending, error: pendingError } = await admin.from('artifact_approval_requests')
    .select('id').eq('artifact_version_id', version.id).eq('organization_id', admin.organizationId)
    .eq('status', 'pending').maybeSingle()
  if (pendingError) throw pendingError
  if (pending) throw Object.assign(new Error('This version has a pending multi-approver request'), { status: 409 })
  const { data: approval, error: approvalError } = await admin.from('artifact_approvals').insert({
    organization_id: admin.organizationId, artifact_id: artifact.id, artifact_version_id: version.id,
    engagement_id: artifact.engagement_id, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (approvalError) throw approvalError
  const { error: eventError } = await admin.from('engagement_events').insert({
    organization_id: admin.organizationId, engagement_id: artifact.engagement_id,
    event_type: 'artifact_approved', actor_id: actorId,
    payload: { record_type: 'artifact', record_id: artifact.id, version_id: version.id,
      action: 'approved', artifact_type: DESIGN_SYSTEM_TYPE },
  })
  if (eventError) throw eventError
  return approval
}

type HandlerDependencies = {
  createCallerIdentity?: (request: Request) => Promise<CallerIdentity>
  resolveContext?: typeof resolveServerOrganizationContext
}

export async function handleRequest(request: Request, dependencies: HandlerDependencies = {}) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Request body must be an object')
    }
    const body = parsed as Json
    const scope = designSystemsScope(body)
    if (text(body.action, 80) === 'save_design_system') {
      designSystemContent(body.content)
      const classification = text(body.data_classification, 30) || 'internal'
      if (!CLASSIFICATIONS.has(classification)) throw new Error('Unsupported data classification')
    }
    const identity = await (dependencies.createCallerIdentity || callerIdentity)(request)
    const preflight = await preflightDesignSystemsRequest(identity.userClient, identity.userId, body, scope)
    const context = await (dependencies.resolveContext || resolveServerOrganizationContext)(request, scope)
    if (context.organizationId !== preflight.organizationId
      || context.engagementId !== preflight.engagementId
      || context.brandId !== preflight.brandId
      || (preflight.action === 'release_design_system' && context.artifactId !== preflight.artifactId)
      || (preflight.action === 'release_design_system' && context.artifactType !== DESIGN_SYSTEM_TYPE)) {
      throw httpError('Resolved Design Systems context changed after caller validation', 409)
    }
    if (!hasDesignSystemsAuthority(context.membership as Json, preflight.action)) {
      throw httpError('Your department role cannot perform this action', 403)
    }
    const admin = context.admin as ScopedClient
    admin.organizationId = context.organizationId
    if (preflight.action === 'save_design_system') {
      return response({ data: await saveDesignSystem(admin, body, context.user.id) })
    }
    return response({ data: await releaseDesignSystem(admin, body, context.user.id) })
  } catch (error) {
    console.error('Design Systems failure', error)
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Design Systems failed' },
      Number.isFinite(status) ? status : 400)
  }
}
if (import.meta.main) Deno.serve(request => handleRequest(request))
