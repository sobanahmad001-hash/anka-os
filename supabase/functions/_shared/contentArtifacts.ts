import { sha256 } from './googleOAuthTokens.ts'

type Json = Record<string, unknown>
type AdminClient = { from: (table: string) => any }

export const CONTENT_ARTIFACT_TYPES = Object.freeze([
  'discovery', 'vision', 'audience', 'website_architecture',
  'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
])

export const CONTENT_ARTIFACT_TYPE_SET = new Set(CONTENT_ARTIFACT_TYPES)

function text(value: unknown, max = 8000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function list(value: unknown, maxItems = 80, maxLength = 1200) {
  return Array.isArray(value)
    ? value.map(item => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : []
}

function requiredText(input: Json, key: string, max = 8000) {
  const value = text(input[key], max)
  if (!value) throw new Error(`${key.replaceAll('_', ' ')} is required`)
  return value
}

function requiredList(input: Json, key: string, maxItems = 80) {
  const value = list(input[key], maxItems)
  if (!value.length) throw new Error(`${key.replaceAll('_', ' ')} is required`)
  return value
}

function records(value: unknown, fields: Array<[string, 'text' | 'list']>, maxItems = 80) {
  if (!Array.isArray(value) || !value.length) throw new Error('At least one structured record is required')
  return value.slice(0, maxItems).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Structured record ${index + 1} is invalid`)
    }
    const source = item as Json
    return Object.fromEntries(fields.map(([key, kind]) => {
      const normalized = kind === 'list' ? list(source[key], 30, 500) : text(source[key], 12000)
      if (kind === 'list' ? !(normalized as string[]).length : !normalized) {
        throw new Error(`${key.replaceAll('_', ' ')} is required in record ${index + 1}`)
      }
      return [key, normalized]
    }))
  })
}

export function validateContentArtifact(type: string, value: unknown): Json {
  if (!CONTENT_ARTIFACT_TYPE_SET.has(type) || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unsupported Content artifact')
  }
  const input = value as Json
  if (type === 'discovery') return {
    summary: requiredText(input, 'summary'), objectives: requiredList(input, 'objectives'),
    offers: requiredList(input, 'offers'), evidence: requiredList(input, 'evidence'),
    constraints: requiredList(input, 'constraints'),
  }
  if (type === 'vision') return {
    vision_statement: requiredText(input, 'vision_statement'), positioning: requiredText(input, 'positioning'),
    value_proposition: requiredText(input, 'value_proposition'), values: requiredList(input, 'values'),
    voice_principles: requiredList(input, 'voice_principles'),
  }
  if (type === 'audience') return {
    primary_audience: requiredText(input, 'primary_audience'), segments: requiredList(input, 'segments'),
    motivations: requiredList(input, 'motivations'), objections: requiredList(input, 'objections'),
    desired_response: requiredText(input, 'desired_response'),
    accessibility_considerations: requiredList(input, 'accessibility_considerations'),
  }
  if (type === 'website_architecture') return {
    site_goal: requiredText(input, 'site_goal'),
    navigation_principles: requiredList(input, 'navigation_principles'),
    pages: records(input.pages, [
      ['page_name', 'text'], ['path', 'text'], ['page_goal', 'text'],
      ['primary_audience', 'text'], ['primary_cta', 'text'],
    ]),
  }
  if (type === 'keyword_strategy') return {
    strategy_summary: requiredText(input, 'strategy_summary'),
    page_keywords: records(input.page_keywords, [
      ['page_path', 'text'], ['service_keywords', 'list'],
      ['search_demand_keywords', 'list'], ['brand_identity_keywords', 'list'],
    ]),
    measurement_notes: requiredList(input, 'measurement_notes'),
  }
  if (type === 'content') return {
    content_strategy: requiredText(input, 'content_strategy'),
    pages: records(input.pages, [
      ['page_path', 'text'], ['page_brief', 'text'], ['draft_copy', 'text'],
      ['meta_title', 'text'], ['meta_description', 'text'], ['primary_cta', 'text'],
    ], 100),
  }
  if (type === 'campaign_messaging') return {
    campaign_goal: requiredText(input, 'campaign_goal'), audience: requiredText(input, 'audience'),
    message_framework: records(input.message_framework, [
      ['message_pillar', 'text'], ['promise', 'text'], ['proof', 'text'], ['objection_response', 'text'],
    ]),
    channel_adaptations: requiredList(input, 'channel_adaptations'),
  }
  return {
    script_purpose: requiredText(input, 'script_purpose'), audience: requiredText(input, 'audience'),
    format: requiredText(input, 'format'), estimated_duration: requiredText(input, 'estimated_duration'),
    hook: requiredText(input, 'hook'), script_beats: requiredList(input, 'script_beats'),
    call_to_action: requiredText(input, 'call_to_action'),
  }
}

function stringSchema() { return { type: 'string' } }
function listSchema() { return { type: 'array', minItems: 1, items: stringSchema() } }
function objectArray(properties: Json) {
  return {
    type: 'array', minItems: 1,
    items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  }
}

export function contentArtifactResponseFormat(type: string) {
  if (!CONTENT_ARTIFACT_TYPE_SET.has(type)) throw new Error('Unsupported Content artifact')
  const simple: Record<string, Json> = {
    discovery: { summary: stringSchema(), objectives: listSchema(), offers: listSchema(), evidence: listSchema(), constraints: listSchema() },
    vision: { vision_statement: stringSchema(), positioning: stringSchema(), value_proposition: stringSchema(), values: listSchema(), voice_principles: listSchema() },
    audience: { primary_audience: stringSchema(), segments: listSchema(), motivations: listSchema(), objections: listSchema(), desired_response: stringSchema(), accessibility_considerations: listSchema() },
    website_architecture: {
      site_goal: stringSchema(), navigation_principles: listSchema(),
      pages: objectArray({ page_name: stringSchema(), path: stringSchema(), page_goal: stringSchema(), primary_audience: stringSchema(), primary_cta: stringSchema() }),
    },
    keyword_strategy: {
      strategy_summary: stringSchema(), measurement_notes: listSchema(),
      page_keywords: objectArray({ page_path: stringSchema(), service_keywords: listSchema(), search_demand_keywords: listSchema(), brand_identity_keywords: listSchema() }),
    },
    content: {
      content_strategy: stringSchema(),
      pages: objectArray({ page_path: stringSchema(), page_brief: stringSchema(), draft_copy: stringSchema(), meta_title: stringSchema(), meta_description: stringSchema(), primary_cta: stringSchema() }),
    },
    campaign_messaging: {
      campaign_goal: stringSchema(), audience: stringSchema(), channel_adaptations: listSchema(),
      message_framework: objectArray({ message_pillar: stringSchema(), promise: stringSchema(), proof: stringSchema(), objection_response: stringSchema() }),
    },
    scripts: {
      script_purpose: stringSchema(), audience: stringSchema(), format: stringSchema(),
      estimated_duration: stringSchema(), hook: stringSchema(), script_beats: listSchema(), call_to_action: stringSchema(),
    },
  }
  const properties = simple[type]
  return {
    type: 'json_schema', name: `anka_${type}_draft`, strict: true,
    schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Json)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export async function createContentArtifactVersion(admin: AdminClient, input: {
  organizationId: string
  engagement: { id: string; brand_id: string }
  stageId?: string | null
  artifactId?: string | null
  artifactType: string
  title: string
  content: unknown
  changeSummary: string
  aiUseAllowed: boolean
  dataClassification: string
  actorId: string
  source: 'manual' | 'department_chat'
  aiRunId?: string | null
}) {
  const content = validateContentArtifact(input.artifactType, input.content)
  let artifactId = text(input.artifactId, 80)
  let createdArtifact = false
  if (artifactId) {
    const { data: artifact, error } = await admin.from('artifacts')
      .select('id, artifact_type, engagement_id, brand_id').eq('id', artifactId)
      .eq('organization_id', input.organizationId).maybeSingle()
    if (error) throw error
    if (!artifact || artifact.artifact_type !== input.artifactType
      || artifact.engagement_id !== input.engagement.id || artifact.brand_id !== input.engagement.brand_id) {
      throw new Error('Content artifact does not match this engagement and type')
    }
  } else {
    const { data: artifact, error } = await admin.from('artifacts').insert({
      organization_id: input.organizationId, engagement_id: input.engagement.id,
      brand_id: input.engagement.brand_id, engagement_stage_instance_id: input.stageId || null,
      artifact_type: input.artifactType,
      title: text(input.title, 240) || `${input.artifactType.replaceAll('_', ' ')} artifact`,
      created_by: input.actorId,
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
    organization_id: input.organizationId, artifact_id: artifactId,
    version_number: (latest?.version_number || 0) + 1, parent_version_id: latest?.id || null,
    content, content_checksum: await sha256(stableJson(content)),
    change_summary: text(input.changeSummary, 1000), ai_use_allowed: input.aiUseAllowed,
    data_classification: input.dataClassification, created_by: input.actorId,
  }).select('*').single()
  if (versionError) {
    if (createdArtifact) await admin.from('artifacts').delete().eq('id', artifactId)
    throw versionError
  }
  const eventType = input.source === 'department_chat'
    ? 'artifact_draft_proposed_via_chat' : 'artifact_version_created'
  const { error: eventError } = await admin.from('engagement_events').insert({
    organization_id: input.organizationId, engagement_id: input.engagement.id,
    event_type: eventType, actor_id: input.actorId,
    payload: {
      record_type: 'artifact', record_id: artifactId, version_id: version.id,
      action: input.source === 'department_chat' ? 'draft_proposed_via_chat' : 'version_created',
      artifact_type: input.artifactType, source: input.source, ai_run_id: input.aiRunId || null,
    },
  })
  if (eventError) throw eventError
  return { artifact_id: artifactId, version }
}
