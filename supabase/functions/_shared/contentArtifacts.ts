import { sha256 } from './googleOAuthTokens.ts'
import { createArtifactRelation } from './artifactRelations.ts'

type Json = Record<string, unknown>
type AdminClient = { from: (table: string) => any }

export const CONTENT_ARTIFACT_TYPES = Object.freeze([
  'discovery', 'vision', 'audience', 'brand_statement', 'website_architecture',
  'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
])

export const CONTENT_ARTIFACT_TYPE_SET = new Set(CONTENT_ARTIFACT_TYPES)
export const CHAT_CONTENT_ARTIFACT_TYPE_SET = new Set(
  CONTENT_ARTIFACT_TYPES.filter(type => type !== 'brand_statement'),
)

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

function requiredNullableText(input: Json, key: string, max = 240) {
  if (!Object.hasOwn(input, key)) throw new Error(`${key.replaceAll('_', ' ')} is required`)
  if (input[key] === null) return null
  const value = text(input[key], max)
  if (!value) throw new Error(`${key.replaceAll('_', ' ')} must be text or null`)
  return value
}

function websitePages(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error('At least one website page is required')
  const pages = value.slice(0, 200).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Website page ${index + 1} is invalid`)
    }
    const page = item as Json
    const pageType = requiredText(page, 'page_type', 40)
    if (!['hub', 'service', 'supporting'].includes(pageType)) {
      throw new Error(`page type in website page ${index + 1} must be hub, service, or supporting`)
    }
    return {
      slug: requiredText(page, 'slug', 240),
      title: requiredText(page, 'title', 240),
      parent_slug: requiredNullableText(page, 'parent_slug', 240),
      page_type: pageType,
      purpose: requiredText(page, 'purpose', 1200),
    }
  })
  const slugs = pages.map(page => page.slug)
  if (new Set(slugs).size !== slugs.length) throw new Error('Website page slugs must be unique')
  const knownSlugs = new Set(slugs)
  for (const page of pages) {
    if (page.parent_slug === page.slug) throw new Error(`parent slug for ${page.slug} must reference another page`)
    if (page.parent_slug && !knownSlugs.has(page.parent_slug)) {
      throw new Error(`parent slug ${page.parent_slug} does not reference a page in this website architecture`)
    }
  }
  return pages
}

function keywordRecords(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error('At least one keyword is required')
  return value.slice(0, 500).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Keyword ${index + 1} is invalid`)
    }
    const keyword = item as Json
    const category = requiredText(keyword, 'category', 40)
    if (!['industry', 'brand', 'volume'].includes(category)) {
      throw new Error(`category in keyword ${index + 1} must be industry, brand, or volume`)
    }
    const searchVolume = keyword.search_volume
    if (typeof searchVolume !== 'number' || !Number.isSafeInteger(searchVolume) || searchVolume < 0) {
      throw new Error(`search volume in keyword ${index + 1} must be a non-negative integer`)
    }
    if (!Object.hasOwn(keyword, 'notes') || typeof keyword.notes !== 'string') {
      throw new Error(`notes is required in keyword ${index + 1}`)
    }
    return {
      term: requiredText(keyword, 'term', 500),
      category,
      search_volume: searchVolume,
      target_page_slug: requiredText(keyword, 'target_page_slug', 240),
      notes: text(keyword.notes, 2000),
    }
  })
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
  if (type === 'brand_statement') {
    const sourceManifest = input.source_manifest
    if (!sourceManifest || typeof sourceManifest !== 'object' || Array.isArray(sourceManifest)) {
      throw new Error('source manifest is required')
    }
    const priceTier = text(input.price_tier, 20)
    if (!['', 'value', 'mid', 'premium'].includes(priceTier)) throw new Error('price tier is invalid')
    return {
      statement: requiredText(input, 'statement'),
      target_market: requiredText(input, 'target_market'),
      price_tier: priceTier,
      positioning: requiredText(input, 'positioning'),
      value_proposition: requiredText(input, 'value_proposition'),
      audience_summary: requiredText(input, 'audience_summary'),
      operating_principles: list(input.operating_principles),
      proof_points: list(input.proof_points),
      competitor_references: list(input.competitor_references),
      source_manifest: sourceManifest as Json,
    }
  }
  if (type === 'website_architecture') return { pages: websitePages(input.pages) }
  if (type === 'keyword_strategy') return { keywords: keywordRecords(input.keywords) }
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
function nullableStringSchema() { return { type: ['string', 'null'] } }
function enumSchema(values: string[]) { return { type: 'string', enum: values } }
function listSchema() { return { type: 'array', minItems: 1, items: stringSchema() } }
function objectArray(properties: Json) {
  return {
    type: 'array', minItems: 1,
    items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  }
}

export function contentArtifactResponseFormat(type: string) {
  if (!CHAT_CONTENT_ARTIFACT_TYPE_SET.has(type)) throw new Error('Unsupported Content chat artifact')
  const simple: Record<string, Json> = {
    discovery: { summary: stringSchema(), objectives: listSchema(), offers: listSchema(), evidence: listSchema(), constraints: listSchema() },
    vision: { vision_statement: stringSchema(), positioning: stringSchema(), value_proposition: stringSchema(), values: listSchema(), voice_principles: listSchema() },
    audience: { primary_audience: stringSchema(), segments: listSchema(), motivations: listSchema(), objections: listSchema(), desired_response: stringSchema(), accessibility_considerations: listSchema() },
    website_architecture: {
      pages: objectArray({
        slug: stringSchema(), title: stringSchema(), parent_slug: nullableStringSchema(),
        page_type: enumSchema(['hub', 'service', 'supporting']), purpose: stringSchema(),
      }),
    },
    keyword_strategy: {
      keywords: objectArray({
        term: stringSchema(), category: enumSchema(['industry', 'brand', 'volume']),
        search_volume: { type: 'integer', minimum: 0 }, target_page_slug: stringSchema(), notes: stringSchema(),
      }),
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
  source: 'manual' | 'department_chat' | 'brand_brief_compilation'
  aiRunId?: string | null
  visibilityClient: AdminClient
}) {
  const content = validateContentArtifact(input.artifactType, input.content)
  const warnings: string[] = []
  let architectureArtifactId: string | null = null
  if (input.artifactType === 'keyword_strategy') {
    const { data: architecture, error: architectureError } = await admin.from('artifacts')
      .select('id').eq('organization_id', input.organizationId)
      .eq('engagement_id', input.engagement.id).eq('artifact_type', 'website_architecture')
      .order('created_at').limit(1).maybeSingle()
    if (architectureError) throw architectureError
    architectureArtifactId = architecture?.id || null
    if (!architectureArtifactId) {
      warnings.push('No website architecture exists yet, so target page slugs could not be checked or linked.')
    } else {
      const { data: architectureVersion, error: versionError } = await admin.from('artifact_versions')
        .select('content').eq('organization_id', input.organizationId)
        .eq('artifact_id', architectureArtifactId)
        .order('version_number', { ascending: false }).limit(1).maybeSingle()
      if (versionError) throw versionError
      const pageSlugs = new Set(Array.isArray(architectureVersion?.content?.pages)
        ? architectureVersion.content.pages.map((page: Json) => text(page.slug, 240)).filter(Boolean)
        : [])
      if (!architectureVersion || !pageSlugs.size) {
        warnings.push('The website architecture has no saved RP2 page list, so target page slugs could not be checked.')
      } else {
        const missing = [...new Set((content.keywords as Json[])
          .map(keyword => String(keyword.target_page_slug)).filter(slug => !pageSlugs.has(slug)))]
        if (missing.length) {
          throw new Error(`Target page slug${missing.length === 1 ? '' : 's'} not found in the latest website architecture: ${missing.join(', ')}`)
        }
      }
    }
  }
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
  if (architectureArtifactId) {
    await createArtifactRelation(input.visibilityClient, admin, {
      source_artifact_id: artifactId,
      target_artifact_id: architectureArtifactId,
      relation_type: 'targets_page',
    }, input.actorId, { allowExisting: true })
  }
  return { artifact_id: artifactId, version, warnings }
}
