import { CONTENT_ARTIFACT_TYPE_SET, createContentArtifactVersion } from '../_shared/contentArtifacts.ts'
import { compileApprovedArtifactContext } from '../_shared/approvedArtifactContext.ts'
import {
  requireSameOrganizationResource,
  resolveServerOrganizationContext,
  type ServerOrganizationContext,
  type ServerOrganizationScope,
} from '../_shared/serverOrganizationContext.ts'

type Json = Record<string, unknown>

const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const MANAGER_ROLES = new Set(['department_manager'])
const CLASSIFICATIONS = new Set(['internal', 'confidential', 'public', 'restricted'])
const CUSTOM_FIELD_TYPES = new Set(['text', 'number', 'date', 'single_select', 'multi_select', 'checkbox'])
const BRAND_STATEMENT_SOURCE_TYPES = ['discovery', 'vision', 'audience']
const CONTENT_REQUEST_MODES = new Set(['project', 'general'])
const CONTENT_REQUEST_OUTPUT_PATHS = new Set(['internal_engine', 'figma_handoff'])
const CONTENT_REQUEST_FORMATS = new Set([
  'reel', 'carousel', 'single_image', 'stories',
  'carousel_stories', 'reel_carousel', 'web_design_element', 'article',
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

export function requireBrandBriefMutationToken(existingUpdatedAt: unknown, requestedUpdatedAt: unknown) {
  const existing = text(existingUpdatedAt, 80)
  const requested = text(requestedUpdatedAt, 80)
  if (existing ? requested !== existing : Boolean(requested)) {
    throw Object.assign(new Error('This brief changed since you opened it. Reload before saving.'), { status: 409 })
  }
  return requested || null
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
  if (format === 'article' && outputPath !== 'internal_engine') throw new Error('Article requests do not support Figma handoff')
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

const GENERATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GENERATION_TYPES = new Set(['website_page_copy', 'blog_article', 'social_copy', 'campaign_copy', 'custom_text'])

export function blockedContentGenerationInput(body: Json) {
  const requestId = text(body.request_id, 80)
  const sourceVersionId = text(body.source_artifact_version_id, 80)
  const modelConfigurationId = text(body.model_configuration_id, 80)
  const engagementId = text(body.engagement_id, 80)
  const requestKind = text(body.request_kind, 20)
  const variantCount = Number(body.variant_count)
  const snapshot = body.input_snapshot
  if (![requestId, sourceVersionId, modelConfigurationId, engagementId].every(value => GENERATION_UUID.test(value))) {
    throw new Error('Generation request, engagement, source version, and model IDs must be valid UUIDs')
  }
  if (!['draft', 'rewrite'].includes(requestKind)) throw new Error('Unsupported generation request kind')
  if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 3) {
    throw new Error('Generation variant count must be between 1 and 3')
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Generation input snapshot is required')
  }
  const fields = snapshot as Json
  const allowed = new Set(['output_type', 'working_title', 'objective', 'audience', 'language',
    'destination', 'tone', 'body', 'selected_text', 'selection_start', 'selection_end'])
  if (Object.keys(fields).some(key => !allowed.has(key))) throw new Error('Unsupported generation input field')
  const normalized: Json = {}
  for (const [key, max] of [['output_type', 40], ['working_title', 160], ['objective', 8000],
    ['audience', 8000], ['language', 120], ['destination', 1000], ['tone', 1000],
    ['body', 120000], ['selected_text', 120000]] as const) {
    if (fields[key] !== undefined && typeof fields[key] !== 'string') throw new Error(`Generation ${key} must be text`)
    const value = fields[key] as string | undefined
    if (value && value.length > max) throw new Error(`Generation ${key} is too long`)
    normalized[key] = value || ''
  }
  if (!GENERATION_TYPES.has(normalized.output_type as string)
    || !String(normalized.working_title).trim() || !String(normalized.objective).trim()
    || !String(normalized.audience).trim() || !String(normalized.language).trim()) {
    throw new Error('Generation type, title, objective, audience, and language are required')
  }
  if (requestKind === 'rewrite') {
    const start = fields.selection_start
    const end = fields.selection_end
    const bodyText = normalized.body as string
    if (typeof start !== 'number' || typeof end !== 'number'
      || !Number.isInteger(start) || !Number.isInteger(end) || start < 0
      || end <= start || end > bodyText.length
      || bodyText.slice(start, end) !== normalized.selected_text
      || !String(normalized.selected_text).trim()) {
      throw new Error('Rewrite selection must match the exact draft text')
    }
    normalized.selection_start = start
    normalized.selection_end = end
  } else if (fields.selection_start !== undefined || fields.selection_end !== undefined || normalized.selected_text) {
    throw new Error('Draft generation cannot include a rewrite selection')
  }
  return { requestId, sourceVersionId, modelConfigurationId, engagementId, requestKind,
    variantCount, snapshot: normalized }
}

export function validateQueueEntryInput(body: Json) {
  const brandId = text(body.brand_id, 80)
  const plannedDate = text(body.planned_date, 10)
  const format = text(body.format, 40)
  const briefTemplate = text(body.brief_template, 12000)
  const linkedEventId = text(body.linked_event_id, 80) || null
  if (!brandId) throw new Error('Content queue entries require a brand')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)
    || Number.isNaN(Date.parse(`${plannedDate}T00:00:00Z`))) {
    throw new Error('Content queue entries require a valid planned date')
  }
  if (!CONTENT_REQUEST_FORMATS.has(format)) throw new Error('Unsupported content queue format')
  return { brandId, plannedDate, format, briefTemplate, linkedEventId }
}

export function figmaHandoffUrl(contentRequestId: string, appUrl = Deno.env.get('ANKA_APP_URL') || 'https://anka-os.vercel.app') {
  const requestId = text(contentRequestId, 80)
  if (!requestId) throw new Error('Content request is required')
  const url = new URL(appUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ANKA_APP_URL must use HTTP or HTTPS')
  url.pathname = `/sphere/content/requests/${encodeURIComponent(requestId)}/figma-handoff`
  url.search = ''
  url.hash = ''
  return url.toString()
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

function requiredActionId(value: unknown, label: string) {
  const id = text(value, 80)
  if (!id) throw new Error(`${label} is required`)
  return id
}

export function contentStudioScope(body: Json): ServerOrganizationScope {
  const action = text(body.action, 60)
  const requestedOrganizationId = text(body.organization_id, 80) || null
  if (action === 'save_artifact') {
    const artifactId = text(body.artifact_id, 80)
    return { root: artifactId
      ? { kind: 'artifact', id: artifactId }
      : { kind: 'engagement', id: requiredActionId(body.engagement_id, 'Engagement') },
    requestedOrganizationId }
  }
  if (action === 'request_content_generation') {
    const input = blockedContentGenerationInput(body)
    return { root: { kind: 'engagement', id: input.engagementId }, requestedOrganizationId }
  }
  if (action === 'create_content_request') {
    const input = validateContentRequestInput(body)
    if (input.mode === 'project') return {
      root: { kind: 'engagement', id: requiredActionId(input.engagementId, 'Engagement') },
      requestedOrganizationId,
    }
    if (input.brandId) return { root: { kind: 'brand', id: input.brandId }, requestedOrganizationId }
    return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
  }
  if (action === 'create_queue_entry') {
    const input = validateQueueEntryInput(body)
    return { root: { kind: 'brand', id: input.brandId }, requestedOrganizationId }
  }
  if (action === 'action_queue_entry' || action === 'skip_queue_entry') return {
    root: { kind: 'content_queue_entry', id: requiredActionId(body.queue_entry_id, 'Content queue entry') },
    requestedOrganizationId,
  }
  if (action === 'ensure_figma_handoff') return {
    root: { kind: 'content_request', id: requiredActionId(body.content_request_id, 'Content request') },
    requestedOrganizationId,
  }
  if (action === 'save_brand_brief' || action === 'generate_brand_statement') return {
    root: { kind: 'engagement', id: requiredActionId(body.engagement_id, 'Engagement') },
    requestedOrganizationId,
  }
  if (action === 'approve_artifact' || action === 'save_custom_field_value') return {
    root: { kind: 'artifact_version', id: requiredActionId(body.artifact_version_id, 'Artifact version') },
    requestedOrganizationId,
  }
  if (action === 'create_custom_field_definition') {
    customFieldDefinitionInput(body)
    return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
  }
  throw new Error('Unsupported action')
}

export async function requireContentEngagement(context: ServerOrganizationContext, engagementId: string) {
  const engagement = await requireSameOrganizationResource(context, {
    kind: 'engagement', id: engagementId,
  })
  const { data: services, error: serviceError } = await context.admin.from('engagement_services')
    .select('id, service_catalog!inner(department_id)').eq('engagement_id', engagementId)
    .eq('organization_id', context.organizationId)
    .eq('status', 'active').eq('service_catalog.department_id', 'content').limit(1)
  if (serviceError || !services?.length) {
    throw Object.assign(new Error('This engagement has no active Content service'), { status: 409 })
  }
  const brandId = text(engagement.brand_id, 80)
  if (!brandId) throw Object.assign(new Error('Content engagement requires a brand'), { status: 409 })
  return { ...engagement, brand_id: brandId }
}

async function safeStage(context: ServerOrganizationContext, engagementId: string, stageId: unknown) {
  const id = text(stageId, 80)
  if (!id) return null
  const { data: stage, error } = await context.admin.from('engagement_stage_instances')
    .select('id, accountable_department_id').eq('id', id).eq('engagement_id', engagementId)
    .eq('organization_id', context.organizationId).maybeSingle()
  if (error || !stage || stage.accountable_department_id !== 'content') {
    throw new Error('Content stage does not match this engagement')
  }
  return stage.id
}

async function recordBlockedContentGeneration(context: ServerOrganizationContext, body: Json, actorId: string) {
  const input = blockedContentGenerationInput(body)
  const engagement = await requireContentEngagement(context, input.engagementId)
  const projectId = text(engagement.project_id, 80)
  if (!GENERATION_UUID.test(projectId)) throw Object.assign(new Error('Content engagement has no project'), { status: 409 })
  const { data: version, error: versionError } = await context.admin.from('artifact_versions')
    .select('id, artifact_id, content, content_checksum, ai_use_allowed, data_classification')
    .eq('id', input.sourceVersionId).eq('organization_id', context.organizationId).maybeSingle()
  if (versionError || !version) throw Object.assign(new Error('Generation source version is unavailable'), { status: 404 })
  const { data: artifact, error: artifactError } = await context.admin.from('artifacts')
    .select('id, engagement_id, artifact_type').eq('id', version.artifact_id)
    .eq('organization_id', context.organizationId).maybeSingle()
  if (artifactError || !artifact || artifact.engagement_id !== input.engagementId
    || !CONTENT_ARTIFACT_TYPE_SET.has(artifact.artifact_type)
    || version.ai_use_allowed !== true || version.data_classification === 'restricted') {
    throw Object.assign(new Error('Generation source is not approved for AI context in this engagement'), { status: 403 })
  }
  const { data: approved, error: approvalError } = await context.admin.from('artifact_approvals')
    .select('id').eq('organization_id', context.organizationId)
    .eq('artifact_version_id', version.id).limit(1)
  if (approvalError || !approved?.length) {
    throw Object.assign(new Error('Generation requires an approved exact source version'), { status: 409 })
  }
  if (input.requestKind === 'rewrite' && (version.content as Json | null)?.body !== input.snapshot.body) {
    throw Object.assign(new Error('Rewrite text no longer matches the exact source version'), { status: 409 })
  }
  const { data: model, error: modelError } = await context.admin.from('department_chat_model_configurations')
    .select('id, connector_connection_id, model_id')
    .eq('id', input.modelConfigurationId).eq('organization_id', context.organizationId)
    .eq('department_id', 'content').is('revoked_at', null).maybeSingle()
  if (modelError || !model) throw Object.assign(new Error('Content text model is unavailable'), { status: 409 })
  const { data: connection, error: connectionError } = await context.admin.from('integration_connections')
    .select('id, public_config').eq('id', model.connector_connection_id)
    .eq('organization_id', context.organizationId).eq('provider', 'openai')
    .eq('status', 'verified').is('archived_at', null).maybeSingle()
  if (connectionError || !connection) throw Object.assign(new Error('Verified Content model connector is unavailable'), { status: 409 })
  const publicConfig = connection.public_config && typeof connection.public_config === 'object'
    ? connection.public_config as Json : {}
  if (model.model_id !== publicConfig.model_id
    && !(Array.isArray(publicConfig.verified_model_ids) && publicConfig.verified_model_ids.includes(model.model_id))) {
    throw Object.assign(new Error('Content model is not in the connector verified set'), { status: 409 })
  }
  const { data: departmentMapping, error: departmentMappingError } = await context.admin
    .from('integration_connection_departments').select('connection_id')
    .eq('organization_id', context.organizationId).eq('connection_id', connection.id)
    .eq('department_id', 'content').limit(1)
  if (departmentMappingError || !departmentMapping?.length) {
    throw Object.assign(new Error('Content model connector is not mapped to the department'), { status: 409 })
  }
  const { data: mapping, error: mappingError } = await context.admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', context.organizationId)
    .eq('connection_id', connection.id).eq('engagement_id', input.engagementId)
    .eq('department_id', 'content').limit(1)
  if (mappingError || !mapping?.length) throw Object.assign(new Error('Content model is not mapped to this engagement'), { status: 409 })
  const serialized = JSON.stringify(input.snapshot)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const { data: job, error } = await context.admin.rpc('record_blocked_content_generation_job', {
    p_organization_id: context.organizationId, p_project_id: projectId,
    p_engagement_id: input.engagementId, p_source_artifact_version_id: version.id,
    p_model_configuration_id: model.id, p_actor_id: actorId, p_request_id: input.requestId,
    p_request_kind: input.requestKind, p_variant_count: input.variantCount, p_input_checksum: checksum,
    p_input_manifest: { source_version_id: version.id, source_checksum: version.content_checksum,
      output_type: input.snapshot.output_type, input_characters: serialized.length },
  })
  if (error) throw error
  return job
}

async function createContentRequest(context: ServerOrganizationContext, body: Json, actorId: string) {
  const input = validateContentRequestInput(body)
  let engagementId = input.engagementId
  let brandId = input.brandId
  if (input.mode === 'project') {
    if (!engagementId) throw new Error('Project content requests require an engagement')
    const engagement = await requireContentEngagement(context, engagementId)
    brandId = engagement.brand_id
  } else {
    engagementId = null
  }
  const { data, error } = await context.admin.rpc('create_content_request', {
    p_organization_id: context.organizationId,
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

async function createQueueEntry(context: ServerOrganizationContext, body: Json, actorId: string) {
  const input = validateQueueEntryInput(body)
  if (context.brandId !== input.brandId) throw Object.assign(new Error('Content queue brand mismatch'), { status: 409 })
  const { data, error } = await context.admin.from('content_queue_entries').insert({
    organization_id: context.organizationId,
    brand_id: input.brandId,
    planned_date: input.plannedDate,
    format: input.format,
    brief_template: input.briefTemplate,
    linked_event_id: input.linkedEventId,
    created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function actionQueueEntry(context: ServerOrganizationContext, body: Json, actorId: string) {
  const queueEntryId = text(body.queue_entry_id, 80)
  const outputPath = text(body.output_path, 40)
  if (!queueEntryId) throw new Error('Content queue entry is required')
  if (!CONTENT_REQUEST_OUTPUT_PATHS.has(outputPath)) throw new Error('Unsupported content request output path')
  const { data, error } = await context.admin.rpc('action_content_queue_entry', {
    p_organization_id: context.organizationId,
    p_queue_entry_id: queueEntryId,
    p_output_path: outputPath,
    p_actor_id: actorId,
  })
  if (error) throw error
  if (outputPath !== 'figma_handoff') return data
  const request = data?.request as Json | undefined
  const handoff = await ensureFigmaHandoff(context, {
    content_request_id: request?.id,
  })
  return { ...data, figma_handoff: handoff }
}

async function skipQueueEntry(context: ServerOrganizationContext, body: Json) {
  const queueEntryId = text(body.queue_entry_id, 80)
  if (!queueEntryId) throw new Error('Content queue entry is required')
  const { data, error } = await context.admin.rpc('skip_content_queue_entry', {
    p_organization_id: context.organizationId,
    p_queue_entry_id: queueEntryId,
  })
  if (error) throw error
  return data
}

async function ensureFigmaHandoff(context: ServerOrganizationContext, body: Json) {
  const contentRequestId = text(body.content_request_id, 80)
  if (!contentRequestId) throw new Error('Content request is required')
  await requireSameOrganizationResource(context, {
    kind: 'content_request', id: contentRequestId,
  })
  const { data: request, error: requestError } = await context.admin.from('content_requests')
    .select('id, organization_id, engagement_id, output_path')
    .eq('id', contentRequestId).eq('organization_id', context.organizationId).maybeSingle()
  if (requestError || !request) throw Object.assign(new Error('Content request not found'), { status: 404 })
  if (request.output_path !== 'figma_handoff') {
    throw Object.assign(new Error('Only Figma-handoff requests can receive a handoff URL'), { status: 409 })
  }
  if (request.engagement_id) await requireContentEngagement(context, request.engagement_id)
  const { data: existing, error: existingError } = await context.admin.from('content_request_assets')
    .select('id, content_request_id, figma_handoff_url, created_at')
    .eq('organization_id', context.organizationId).eq('content_request_id', request.id)
    .not('figma_handoff_url', 'is', null).order('created_at').limit(1).maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing
  const { data, error } = await context.admin.from('content_request_assets').insert({
    id: request.id,
    organization_id: context.organizationId,
    content_request_id: request.id,
    figma_handoff_url: figmaHandoffUrl(request.id),
  }).select('id, content_request_id, figma_handoff_url, created_at').single()
  if (error) throw error
  return data
}

async function saveArtifact(context: ServerOrganizationContext, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const artifactType = text(body.artifact_type, 60)
  if (!CONTENT_ARTIFACT_TYPE_SET.has(artifactType)) throw new Error('Unsupported Content artifact')
  const engagement = await requireContentEngagement(context, engagementId)
  const stageId = await safeStage(context, engagement.id, body.engagement_stage_instance_id)
  const classification = text(body.data_classification, 30) || 'internal'
  if (!CLASSIFICATIONS.has(classification)) throw new Error('Unsupported data classification')
  const artifactId = text(body.artifact_id, 80) || null
  const writerContent = body.content && typeof body.content === 'object' && !Array.isArray(body.content)
    ? body.content as Record<string, unknown> : null
  const writerContinuation = artifactType === 'content' && writerContent?.schema_version === 2
  const parentId = typeof body.expected_parent_version_id === 'string' ? body.expected_parent_version_id : null
  if (writerContinuation && artifactId && (!parentId?.trim() || parentId.length > 80)) {
    throw Object.assign(new Error('Reopen the latest writer version before saving.'), { status: 409 })
  }
  if (writerContinuation && !artifactId && parentId != null) throw new Error('A new writer draft cannot have a parent version')
  return createContentArtifactVersion(context.admin, {
    organizationId: context.organizationId, engagement, stageId,
    artifactId, expectedParentVersionId: writerContinuation && artifactId ? parentId?.trim() : undefined, artifactType,
    title: text(body.title, 240), content: body.content,
    changeSummary: text(body.change_summary, 1000), aiUseAllowed: body.ai_use_allowed === true,
    dataClassification: classification, actorId, source: 'manual', visibilityClient: context.userClient,
  })
}

async function saveBrandBrief(context: ServerOrganizationContext, body: Json, actorId: string) {
  const engagement = await requireContentEngagement(context, text(body.engagement_id, 80))
  const input = brandBriefInput(body)
  const { data: existing, error: existingError } = await context.admin.from('brand_briefs').select('id, updated_at')
    .eq('organization_id', context.organizationId).eq('brand_id', engagement.brand_id).maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    const expectedUpdatedAt = requireBrandBriefMutationToken(existing.updated_at, body.expected_updated_at)
    const { data, error } = await context.admin.from('brand_briefs').update({
      ...input, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('organization_id', context.organizationId)
      .eq('updated_at', expectedUpdatedAt).select('*').maybeSingle()
    if (error) throw error
    if (!data) throw Object.assign(new Error('This brief changed since you opened it. Reload before saving.'), { status: 409 })
    return data
  }
  requireBrandBriefMutationToken(null, body.expected_updated_at)
  const { data, error } = await context.admin.from('brand_briefs').insert({
    organization_id: context.organizationId, brand_id: engagement.brand_id,
    ...input, created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function generateBrandStatement(context: ServerOrganizationContext, body: Json, actorId: string) {
  const engagement = await requireContentEngagement(context, text(body.engagement_id, 80))
  const stageId = await safeStage(context, engagement.id, body.engagement_stage_instance_id)
  const { data: brief, error: briefError } = await context.admin.from('brand_briefs').select('*')
    .eq('organization_id', context.organizationId).eq('brand_id', engagement.brand_id).maybeSingle()
  if (briefError) throw briefError
  if (!brief) throw new Error('Save the brand brief before generating a brand statement')
  const { manifest } = await compileApprovedArtifactContext(context.admin, {
    organizationId: context.organizationId,
    brandId: engagement.brand_id,
    artifactTypes: BRAND_STATEMENT_SOURCE_TYPES,
  })
  const { data: existingArtifact, error: artifactError } = await context.admin.from('artifacts').select('id')
    .eq('organization_id', context.organizationId).eq('engagement_id', engagement.id)
    .eq('brand_id', engagement.brand_id).eq('artifact_type', 'brand_statement')
    .order('created_at').limit(1).maybeSingle()
  if (artifactError) throw artifactError
  return createContentArtifactVersion(context.admin, {
    organizationId: context.organizationId,
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
    visibilityClient: context.userClient,
  })
}

async function approveArtifact(context: ServerOrganizationContext, body: Json, actorId: string) {
  const versionId = text(body.artifact_version_id, 80)
  const version = await requireSameOrganizationResource(context, {
    kind: 'artifact_version', id: versionId,
  })
  const artifactRelation = version?.artifact
  const artifact = Array.isArray(artifactRelation) ? artifactRelation[0] : artifactRelation
  const artifactId = text(artifact?.id, 80)
  const artifactType = text(artifact?.artifact_type, 60)
  const engagementId = text(artifact?.engagement_id, 80)
  if (!version || !artifactId || !engagementId || !CONTENT_ARTIFACT_TYPE_SET.has(artifactType)) {
    throw Object.assign(new Error('Content artifact version not found'), { status: 404 })
  }
  await requireContentEngagement(context, engagementId)
  const { data: pendingRequest, error: requestError } = await context.admin.from('artifact_approval_requests')
    .select('id').eq('organization_id', context.organizationId)
    .eq('artifact_version_id', version.id).eq('status', 'pending').maybeSingle()
  if (requestError) throw requestError
  if (pendingRequest) {
    throw Object.assign(new Error('This version is governed by a pending multi-approver request'), { status: 409 })
  }
  const { data: approval, error } = await context.admin.from('artifact_approvals').insert({
    organization_id: context.organizationId, artifact_id: artifactId, artifact_version_id: version.id,
    engagement_id: engagementId, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (error) throw error
  const { error: eventError } = await context.admin.from('engagement_events').insert({
    organization_id: context.organizationId, engagement_id: engagementId,
    event_type: 'artifact_approved', actor_id: actorId,
    payload: {
      record_type: 'artifact', record_id: artifactId, version_id: version.id,
      action: 'approved', artifact_type: artifactType,
    },
  })
  if (eventError) throw eventError
  return approval
}

async function createCustomFieldDefinition(context: ServerOrganizationContext, body: Json, actorId: string) {
  const input = customFieldDefinitionInput(body)
  const { data, error } = await context.admin.rpc('create_artifact_custom_field_definition', {
    p_organization_id: context.organizationId,
    p_artifact_type: input.artifactType,
    p_name: input.name,
    p_field_type: input.fieldType,
    p_options: input.options,
    p_actor_id: actorId,
  })
  if (error) throw error
  return data
}

async function saveCustomFieldValue(context: ServerOrganizationContext, body: Json, actorId: string) {
  const artifactVersionId = text(body.artifact_version_id, 80)
  const fieldDefId = text(body.field_def_id, 80)
  if (!artifactVersionId || !fieldDefId) throw new Error('Artifact version and custom field are required')
  await requireSameOrganizationResource(context, {
    kind: 'artifact_custom_field_definition', id: fieldDefId,
  })
  const { data, error } = await context.admin.rpc('save_artifact_custom_field_value', {
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
    const body = await request.json() as Json
    const action = text(body.action, 60)
    const context = await resolveServerOrganizationContext(request, contentStudioScope(body))
    if (!hasContentAuthority(context.membership, action)) {
      return response({ error: action === 'approve_artifact'
        ? 'Content manager approval required' : 'Content department access required' }, 403)
    }
    if (action === 'save_artifact') return response({ data: await saveArtifact(context, body, context.user.id) })
    if (action === 'request_content_generation') {
      return response({ data: await recordBlockedContentGeneration(context, body, context.user.id) })
    }
    if (action === 'create_content_request') {
      return response({ data: await createContentRequest(context, body, context.user.id) })
    }
    if (action === 'create_queue_entry') {
      return response({ data: await createQueueEntry(context, body, context.user.id) })
    }
    if (action === 'action_queue_entry') {
      return response({ data: await actionQueueEntry(context, body, context.user.id) })
    }
    if (action === 'skip_queue_entry') {
      return response({ data: await skipQueueEntry(context, body) })
    }
    if (action === 'ensure_figma_handoff') {
      return response({ data: await ensureFigmaHandoff(context, body) })
    }
    if (action === 'save_brand_brief') return response({ data: await saveBrandBrief(context, body, context.user.id) })
    if (action === 'generate_brand_statement') {
      return response({ data: await generateBrandStatement(context, body, context.user.id) })
    }
    if (action === 'approve_artifact') return response({ data: await approveArtifact(context, body, context.user.id) })
    if (action === 'create_custom_field_definition') {
      return response({ data: await createCustomFieldDefinition(context, body, context.user.id) })
    }
    if (action === 'save_custom_field_value') {
      return response({ data: await saveCustomFieldValue(context, body, context.user.id) })
    }
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Content Studio error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
