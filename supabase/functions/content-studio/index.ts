import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { CONTENT_ARTIFACT_TYPE_SET, createContentArtifactVersion } from '../_shared/contentArtifacts.ts'
import { compileApprovedArtifactContext } from '../_shared/approvedArtifactContext.ts'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const MANAGER_ROLES = new Set(['department_manager'])
const CLASSIFICATIONS = new Set(['internal', 'confidential', 'public', 'restricted'])
const CUSTOM_FIELD_TYPES = new Set(['text', 'number', 'date', 'single_select', 'multi_select', 'checkbox'])
const BRAND_STATEMENT_SOURCE_TYPES = ['discovery', 'vision', 'audience']
const CONTENT_REQUEST_MODES = new Set(['project', 'general'])
const CONTENT_REQUEST_OUTPUT_PATHS = new Set(['internal_engine', 'figma_handoff'])
const CONTENT_REQUEST_FORMATS = new Set([
  'reel', 'carousel', 'single_image', 'stories',
  'carousel_stories', 'reel_carousel', 'web_design_element',
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

function textList(value: unknown, maxItems = 40, maxLength = 500) {
  return Array.isArray(value)
    ? value.map(item => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : []
}

export function brandBriefInput(body: Json) {
  const priceTier = text(body.price_tier, 20)
  if (!['', 'value', 'mid', 'premium'].includes(priceTier)) throw new Error('Unsupported price tier')
  const rawBrief = text(body.raw_brief, 50000)
  if (!rawBrief) throw new Error('Raw brief is required')
  return {
    target_market: text(body.target_market, 4000),
    price_tier: priceTier,
    operating_principles: textList(body.operating_principles),
    competitor_references: textList(body.competitor_references),
    raw_brief: rawBrief,
  }
}

export function compiledBrandStatement(brief: Json, contextManifest: Json) {
  const artifacts = contextManifest.artifacts && typeof contextManifest.artifacts === 'object'
    ? contextManifest.artifacts as Json : {}
  const contentFor = (type: string) => {
    const record = artifacts[type]
    return record && typeof record === 'object' && !Array.isArray(record)
      && (record as Json).content && typeof (record as Json).content === 'object'
      ? (record as Json).content as Json : {}
  }
  const discovery = contentFor('discovery')
  const vision = contentFor('vision')
  const audience = contentFor('audience')
  const targetMarket = text(brief.target_market, 4000) || text(audience.primary_audience, 4000)
  const positioning = text(vision.positioning, 8000)
  const valueProposition = text(vision.value_proposition, 8000)
  const statement = [positioning, valueProposition].filter(Boolean).join(' ')
  return {
    statement,
    target_market: targetMarket,
    price_tier: text(brief.price_tier, 20),
    positioning,
    value_proposition: valueProposition,
    audience_summary: [text(audience.primary_audience, 4000), text(audience.desired_response, 4000)]
      .filter(Boolean).join(' — '),
    operating_principles: textList(brief.operating_principles).length
      ? textList(brief.operating_principles)
      : textList(vision.values),
    proof_points: textList(discovery.evidence),
    competitor_references: textList(brief.competitor_references),
    source_manifest: {
      ...contextManifest,
      brand_brief: {
        id: brief.id,
        updated_at: brief.updated_at,
        target_market: brief.target_market,
        price_tier: brief.price_tier,
        operating_principles: brief.operating_principles,
        competitor_references: brief.competitor_references,
        raw_brief: brief.raw_brief,
      },
    },
  }
}

export function hasContentAuthority(membership: Json, action: string) {
  const role = text(membership.role, 60)
  if (LEADER_ROLES.has(role)) return true
  if (text(membership.department_id, 60) !== 'content') return false
  if (action === 'approve_artifact') return MANAGER_ROLES.has(role)
  return true
}

export function validateContentRequestInput(body: Json) {
  const mode = text(body.mode, 20) || 'project'
  const outputPath = text(body.output_path, 40)
  const format = text(body.format, 40)
  const brief = text(body.brief, 12000)
  const linkedEventId = text(body.linked_event_id, 80) || null
  const createEventLink = body.create_event_link === true
  const eventContentType = text(body.event_content_type, 20) || 'social'
  const leadTimeDays = Number(body.lead_time_days ?? 0)
  if (!CONTENT_REQUEST_MODES.has(mode)) throw new Error('Unsupported content request mode')
  if (!CONTENT_REQUEST_OUTPUT_PATHS.has(outputPath)) throw new Error('Unsupported content request output path')
  if (!CONTENT_REQUEST_FORMATS.has(format)) throw new Error('Unsupported content request format')
  if (!brief) throw new Error('Content request brief is required')
  if (createEventLink && !linkedEventId) throw new Error('Select an event before adding it to the event plan')
  if (!['social', 'blog'].includes(eventContentType)) throw new Error('Event-plan content type must be social or blog')
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0) throw new Error('Lead time must be a non-negative whole number')
  return {
    mode,
    engagementId: text(body.engagement_id, 80) || null,
    brandId: text(body.brand_id, 80) || null,
    linkedEventId,
    outputPath,
    format,
    brief,
    queueEntryId: text(body.queue_entry_id, 80) || null,
    createEventLink,
    eventContentType,
    leadTimeDays,
  }
}

export function customFieldDefinitionInput(body: Json) {
  const artifactType = text(body.artifact_type, 60)
  const name = text(body.name, 80)
  const fieldType = text(body.field_type, 30)
  if (!CONTENT_ARTIFACT_TYPE_SET.has(artifactType)) throw new Error('Unsupported Content artifact type')
  if (!name) throw new Error('Custom field name is required')
  if (!CUSTOM_FIELD_TYPES.has(fieldType)) throw new Error('Unsupported custom field type')
  const options = Array.isArray(body.options)
    ? body.options.map(option => text(option, 80)).filter(Boolean)
    : []
  if (fieldType === 'single_select' || fieldType === 'multi_select') {
    if (!options.length || options.length > 50) throw new Error('Select fields require between 1 and 50 options')
    if (new Set(options).size !== options.length) throw new Error('Select options must be unique')
  } else if (options.length) {
    throw new Error('Only select fields can define options')
  }
  return { artifactType, name, fieldType, options: options.length ? options : null }
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

async function createContentRequest(admin: Client, body: Json, actorId: string) {
  const input = validateContentRequestInput(body)
  let engagementId = input.engagementId
  let brandId = input.brandId
  if (input.mode === 'project') {
    if (!engagementId) throw new Error('Project content requests require an engagement')
    const engagement = await requireContentEngagement(admin, engagementId)
    brandId = engagement.brand_id
  } else {
    engagementId = null
  }
  const { data, error } = await admin.rpc('create_content_request', {
    p_organization_id: ORGANIZATION_ID,
    p_mode: input.mode,
    p_engagement_id: engagementId,
    p_brand_id: brandId,
    p_linked_event_id: input.linkedEventId,
    p_output_path: input.outputPath,
    p_format: input.format,
    p_brief: input.brief,
    p_queue_entry_id: input.queueEntryId,
    p_actor_id: actorId,
    p_create_event_link: input.createEventLink,
    p_event_content_type: input.eventContentType,
    p_lead_time_days: input.leadTimeDays,
  })
  if (error) throw error
  return data
}

async function saveArtifact(userClient: Client, admin: Client, body: Json, actorId: string) {
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
    dataClassification: classification, actorId, source: 'manual', visibilityClient: userClient,
  })
}

async function saveBrandBrief(admin: Client, body: Json, actorId: string) {
  const engagement = await requireContentEngagement(admin, text(body.engagement_id, 80))
  const input = brandBriefInput(body)
  const { data: existing, error: existingError } = await admin.from('brand_briefs').select('id')
    .eq('organization_id', ORGANIZATION_ID).eq('brand_id', engagement.brand_id).maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    const { data, error } = await admin.from('brand_briefs').update({
      ...input, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('organization_id', ORGANIZATION_ID).select('*').single()
    if (error) throw error
    return data
  }
  const { data, error } = await admin.from('brand_briefs').insert({
    organization_id: ORGANIZATION_ID, brand_id: engagement.brand_id,
    ...input, created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function generateBrandStatement(userClient: Client, admin: Client, body: Json, actorId: string) {
  const engagement = await requireContentEngagement(admin, text(body.engagement_id, 80))
  const stageId = await safeStage(admin, engagement.id, body.engagement_stage_instance_id)
  const { data: brief, error: briefError } = await admin.from('brand_briefs').select('*')
    .eq('organization_id', ORGANIZATION_ID).eq('brand_id', engagement.brand_id).maybeSingle()
  if (briefError) throw briefError
  if (!brief) throw new Error('Save the brand brief before generating a brand statement')
  const { manifest } = await compileApprovedArtifactContext(admin, {
    organizationId: ORGANIZATION_ID,
    brandId: engagement.brand_id,
    artifactTypes: BRAND_STATEMENT_SOURCE_TYPES,
  })
  const { data: existingArtifact, error: artifactError } = await admin.from('artifacts').select('id')
    .eq('organization_id', ORGANIZATION_ID).eq('engagement_id', engagement.id)
    .eq('brand_id', engagement.brand_id).eq('artifact_type', 'brand_statement')
    .order('created_at').limit(1).maybeSingle()
  if (artifactError) throw artifactError
  return createContentArtifactVersion(admin, {
    organizationId: ORGANIZATION_ID,
    engagement,
    stageId,
    artifactId: existingArtifact?.id || null,
    artifactType: 'brand_statement',
    title: 'Brand statement',
    content: compiledBrandStatement(brief, manifest as Json),
    changeSummary: 'Compiled from the current brand brief and latest approved Discovery, Vision, and Audience versions.',
    aiUseAllowed: false,
    dataClassification: 'internal',
    actorId,
    source: 'brand_brief_compilation',
    visibilityClient: userClient,
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
  const { data: pendingRequest, error: requestError } = await admin.from('artifact_approval_requests')
    .select('id').eq('artifact_version_id', version.id).eq('status', 'pending').maybeSingle()
  if (requestError) throw requestError
  if (pendingRequest) {
    throw Object.assign(new Error('This version is governed by a pending multi-approver request'), { status: 409 })
  }
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

async function createCustomFieldDefinition(admin: Client, body: Json, actorId: string) {
  const input = customFieldDefinitionInput(body)
  const { data, error } = await admin.rpc('create_artifact_custom_field_definition', {
    p_organization_id: ORGANIZATION_ID,
    p_artifact_type: input.artifactType,
    p_name: input.name,
    p_field_type: input.fieldType,
    p_options: input.options,
    p_actor_id: actorId,
  })
  if (error) throw error
  return data
}

async function saveCustomFieldValue(admin: Client, body: Json, actorId: string) {
  const artifactVersionId = text(body.artifact_version_id, 80)
  const fieldDefId = text(body.field_def_id, 80)
  if (!artifactVersionId || !fieldDefId) throw new Error('Artifact version and custom field are required')
  const { data, error } = await admin.rpc('save_artifact_custom_field_value', {
    p_artifact_version_id: artifactVersionId,
    p_field_def_id: fieldDefId,
    p_value: body.value ?? null,
    p_actor_id: actorId,
  })
  if (error) throw error
  return data
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { userClient, admin, user, membership } = await requireContext(request)
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (!hasContentAuthority(membership, action)) {
      return response({ error: action === 'approve_artifact'
        ? 'Content manager approval required' : 'Content department access required' }, 403)
    }
    if (action === 'save_artifact') return response({ data: await saveArtifact(userClient, admin, body, user.id) })
    if (action === 'create_content_request') {
      return response({ data: await createContentRequest(admin, body, user.id) })
    }
    if (action === 'save_brand_brief') return response({ data: await saveBrandBrief(admin, body, user.id) })
    if (action === 'generate_brand_statement') {
      return response({ data: await generateBrandStatement(userClient, admin, body, user.id) })
    }
    if (action === 'approve_artifact') return response({ data: await approveArtifact(admin, body, user.id) })
    if (action === 'create_custom_field_definition') {
      return response({ data: await createCustomFieldDefinition(admin, body, user.id) })
    }
    if (action === 'save_custom_field_value') {
      return response({ data: await saveCustomFieldValue(admin, body, user.id) })
    }
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Content Studio error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
