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

const FOUNDATION_FIELDS: Record<string, string[]> = {
  discovery: ['summary', 'objectives', 'offers', 'evidence', 'constraints'],
  vision: ['vision_statement', 'positioning', 'value_proposition', 'differentiators', 'values', 'voice_principles', 'messaging_pillars'],
  audience: ['primary_audience', 'segments', 'motivations', 'objections', 'desired_response', 'accessibility_considerations'],
}
const DISCOVERY_UNKNOWN_FIELDS = new Set(['evidence', 'constraints'])
export const MAX_KEYWORD_RECORDS = 500

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

function isUnknown(value: unknown) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'unknown'
}

function foundationExtras(type: string, input: Json) {
  const fields = FOUNDATION_FIELDS[type]
  if (!fields) return {}
  for (const field of fields) {
    const values = Array.isArray(input[field]) ? input[field] : [input[field]]
    if (values.some(isUnknown) && !(type === 'discovery' && DISCOVERY_UNKNOWN_FIELDS.has(field))) {
      throw new Error(`Unknown is not allowed for ${field.replaceAll('_', ' ')}`)
    }
  }
  const extra: Json = {}
  const language = text(input.language, 120)
  if (language) extra.language = language
  if (!Object.hasOwn(input, 'source_metadata')) return extra
  const raw = input.source_metadata
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('source metadata must be an object')
  const metadata = raw as Json
  const unknownKeys = Object.keys(metadata).filter(key => !fields.includes(key))
  if (unknownKeys.length) throw new Error(`source metadata contains unsupported field: ${unknownKeys[0]}`)
  extra.source_metadata = Object.fromEntries(Object.entries(metadata).map(([field, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`source metadata for ${field} is invalid`)
    const entry = value as Json
    const allowed = ['source_label', 'source_date', 'needs_confirmation', 'human_confirmed']
    const unexpected = Object.keys(entry).filter(key => !allowed.includes(key))
    if (unexpected.length || !allowed.every(key => Object.hasOwn(entry, key))) {
      throw new Error(`source metadata for ${field} must contain exactly source label, source date, needs confirmation, and human confirmed`)
    }
    const sourceDate = entry.source_date === null ? null : text(entry.source_date, 10)
    if (sourceDate) {
      const instant = /^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
        ? new Date(`${sourceDate}T00:00:00.000Z`) : null
      if (!instant || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== sourceDate) {
        throw new Error(`source date for ${field} must be a real calendar date using YYYY-MM-DD`)
      }
    }
    if (typeof entry.needs_confirmation !== 'boolean' || typeof entry.human_confirmed !== 'boolean') {
      throw new Error(`confirmation state for ${field} must be boolean`)
    }
    if (entry.needs_confirmation && entry.human_confirmed) {
      throw new Error(`${field.replaceAll('_', ' ')} cannot be both confirmation-needed and human-confirmed`)
    }
    return [field, {
      source_label: text(entry.source_label, 500), source_date: sourceDate,
      needs_confirmation: entry.needs_confirmation, human_confirmed: entry.human_confirmed,
    }]
  }))
  return extra
}

export function withGeneratedSourceMetadata(type: string, value: Json, sourceDate = new Date().toISOString().slice(0, 10)) {
  const fields = FOUNDATION_FIELDS[type]
  if (!fields) return value
  const existing = value.source_metadata && typeof value.source_metadata === 'object' && !Array.isArray(value.source_metadata)
    ? value.source_metadata as Json : {}
  return {
    ...value,
    source_metadata: Object.fromEntries(fields.map(field => [field, existing[field] || {
      source_label: 'Shared Department Chat proposal', source_date: sourceDate,
      needs_confirmation: true, human_confirmed: false,
    }])),
  }
}

function requiredNullableText(input: Json, key: string, max = 240) {
  if (!Object.hasOwn(input, key)) throw new Error(`${key.replaceAll('_', ' ')} is required`)
  if (input[key] === null) return null
  const value = text(input[key], max)
  if (!value) throw new Error(`${key.replaceAll('_', ' ')} must be text or null`)
  return value
}

export function normalizeWebsitePath(value: unknown) {
  const normalized = text(value, 1200)
    .normalize('NFKC')
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(segment => segment.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join('/')
  if (!normalized) throw new Error('Website page path is required')
  if (normalized.length > 1200 || normalized.split('/').some(segment => segment === '.' || segment === '..' || /[?#\u0000-\u001f]/u.test(segment))) {
    throw new Error('Website page path contains unsupported characters')
  }
  return normalized
}

export function legacyWebsitePageKey(value: unknown) {
  return `legacy:${normalizeWebsitePath(value)}`
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
    const slug = normalizeWebsitePath(page.slug)
    const pageKey = text(page.page_key, 1208) || legacyWebsitePageKey(slug)
    if (!/^[\p{L}\p{N}][\p{L}\p{N}:._~\/-]{0,1207}$/u.test(pageKey)) {
      throw new Error(`page key in website page ${index + 1} is invalid`)
    }
    const position = Object.hasOwn(page, 'position') ? Number(page.position) : (index + 1) * 1000
    if (!Number.isSafeInteger(position) || position < 1) {
      throw new Error(`position in website page ${index + 1} must be a positive integer`)
    }
    return {
      page_key: pageKey,
      slug,
      title: requiredText(page, 'title', 240),
      raw_parent_page_key: text(page.parent_page_key, 1208) || null,
      raw_parent_slug: Object.hasOwn(page, 'parent_slug') ? requiredNullableText(page, 'parent_slug', 1200) : null,
      position,
      page_type: pageType,
      purpose: requiredText(page, 'purpose', 1200),
    }
  })
  const pageKeys = pages.map(page => page.page_key)
  const paths = pages.map(page => page.slug)
  const positions = pages.map(page => page.position)
  if (new Set(pageKeys).size !== pageKeys.length) throw new Error('Website page keys must be unique')
  if (new Set(paths).size !== paths.length) throw new Error('Website page paths must be unique after normalization')
  if (new Set(positions).size !== positions.length) throw new Error('Website page positions must be unique')
  const pageByKey = new Map(pages.map(page => [page.page_key, page]))
  const keyByPath = new Map(pages.map(page => [page.slug, page.page_key]))
  const normalized = pages.map(page => {
    const parentFromSlug = page.raw_parent_slug ? keyByPath.get(normalizeWebsitePath(page.raw_parent_slug)) : null
    if (page.raw_parent_slug && !parentFromSlug) {
      throw new Error(`parent slug ${page.raw_parent_slug} does not reference a page in this website architecture`)
    }
    if (page.raw_parent_page_key && parentFromSlug && page.raw_parent_page_key !== parentFromSlug) {
      throw new Error(`parent page key and legacy parent path disagree for ${page.slug}`)
    }
    const parentPageKey = page.raw_parent_page_key || parentFromSlug || null
    if (parentPageKey && !pageByKey.has(parentPageKey)) {
      throw new Error(`parent page key ${parentPageKey} does not reference a page in this website architecture`)
    }
    return {
      page_key: page.page_key,
      slug: page.slug,
      title: page.title,
      parent_page_key: parentPageKey,
      parent_slug: parentPageKey ? pageByKey.get(parentPageKey)?.slug || null : null,
      position: page.position,
      page_type: page.page_type,
      purpose: page.purpose,
    }
  }).sort((left, right) => left.position - right.position)
  const parentByKey = new Map(normalized.map(page => [page.page_key, page.parent_page_key]))
  for (const page of normalized) {
    const visited = new Set<string>()
    let current: string | null = page.page_key
    while (current) {
      if (visited.has(current)) throw new Error(`Website page hierarchy contains an ancestor cycle involving ${page.slug}`)
      visited.add(current)
      current = parentByKey.get(current) || null
    }
  }
  return normalized
}

export function assertWebsitePageIdentityTransition(previous: unknown, next: unknown) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return
  const previousPages = websitePages((previous as Json).pages)
  const nextPages = websitePages(next)
  const previousByPath = new Map(previousPages.map(page => [page.slug, page.page_key]))
  for (const page of nextPages) {
    const previousKey = previousByPath.get(page.slug)
    if (previousKey && previousKey !== page.page_key) {
      throw new Error(`Stable page key for ${page.slug} cannot be changed; remove and add must be deliberate separate page operations`)
    }
  }
}

function keywordRecords(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error('At least one keyword is required')
  if (value.length > MAX_KEYWORD_RECORDS) throw new Error(`Keyword strategies support at most ${MAX_KEYWORD_RECORDS} rows`)
  return value.map((item, index) => {
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

function keywordText(value: unknown, max = 8000) {
  if (typeof value !== 'string') return ''
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (normalized.length > max) throw new Error(`Keyword text must be ${max} characters or fewer`)
  return normalized
}

function optionalKeywordMetric(keyword: Json, key: string, index: number, { integer = false } = {}) {
  if (keyword[key] === null || keyword[key] === undefined || keyword[key] === '') return null
  const value = keyword[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${key.replaceAll('_', ' ')} in keyword ${index + 1} must be a non-negative ${integer ? 'integer' : 'number'}`)
  }
  return value
}

function optionalKeywordDate(value: unknown, index: number) {
  if (value === null || value === undefined || value === '') return null
  const normalized = typeof value === 'string' ? value.trim() : ''
  const instant = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? new Date(`${normalized}T00:00:00.000Z`) : null
  if (!instant || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`observation date in keyword ${index + 1} must be a real calendar date using YYYY-MM-DD`)
  }
  return normalized
}

function keywordRecordsV2(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error('At least one keyword is required')
  if (value.length > MAX_KEYWORD_RECORDS) throw new Error(`Keyword strategies support at most ${MAX_KEYWORD_RECORDS} rows`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Keyword ${index + 1} is invalid`)
    const keyword = item as Json
    const term = keywordText(keyword.term, 500)
    const locale = keywordText(keyword.locale, 120)
    if (!term) throw new Error(`term is required in keyword ${index + 1}`)
    if (!locale) throw new Error(`locale is required in keyword ${index + 1}`)
    const targetKind = keywordText(keyword.target_kind, 40)
    if (!['page', 'content_request'].includes(targetKind)) throw new Error(`target kind in keyword ${index + 1} is invalid`)
    const targetPageKey = targetKind === 'page' ? keywordText(keyword.target_page_key, 1208) : ''
    const targetContentRequestId = targetKind === 'content_request' ? keywordText(keyword.target_content_request_id, 80) : ''
    if (targetKind === 'page' && !targetPageKey) throw new Error(`target page is required in keyword ${index + 1}`)
    if (targetKind === 'content_request' && !targetContentRequestId) throw new Error(`target content request is required in keyword ${index + 1}`)
    const evidenceSource = keywordText(keyword.evidence_source, 1000)
    const searchVolume = optionalKeywordMetric(keyword, 'search_volume', index, { integer: true })
    const difficulty = optionalKeywordMetric(keyword, 'difficulty', index)
    const observationDate = optionalKeywordDate(keyword.observation_date, index)
    if ((searchVolume !== null || difficulty !== null || observationDate !== null) && !evidenceSource) {
      throw new Error(`evidence source is required for measured data in keyword ${index + 1}`)
    }
    const category = keywordText(keyword.category, 40)
    if (category && !['industry', 'brand', 'volume'].includes(category)) throw new Error(`category in keyword ${index + 1} is invalid`)
    return {
      term,
      locale,
      intent: keywordText(keyword.intent, 500),
      topic_group: keywordText(keyword.topic_group, 500),
      priority: keywordText(keyword.priority, 120),
      evidence_source: evidenceSource,
      search_volume: searchVolume,
      difficulty,
      observation_date: observationDate,
      target_kind: targetKind,
      target_page_key: targetPageKey || null,
      target_content_request_id: targetContentRequestId || null,
      target_page_slug: targetKind === 'page' ? keywordText(keyword.target_page_slug, 1200) || null : null,
      category: category || null,
      notes: keywordText(keyword.notes, 2000),
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

const CONTENT_WRITER_OUTPUT_TYPES = new Set([
  'website_page_copy', 'blog_article', 'social_copy', 'campaign_copy', 'custom_text',
])

function writerText(input: Json, key: string, max: number, options: { optional: true }): string | null
function writerText(input: Json, key: string, max: number, options?: { optional?: false }): string
function writerText(input: Json, key: string, max: number, { optional = false }: { optional?: boolean } = {}): string | null {
  const raw = input[key]
  if (raw === null || raw === undefined) {
    if (optional) return null
    throw new Error(`${key.replaceAll('_', ' ')} is required`)
  }
  if (typeof raw !== 'string') throw new Error(`${key.replaceAll('_', ' ')} must be text`)
  const value = raw.trim()
  if (!value && optional) return null
  if (!value) throw new Error(`${key.replaceAll('_', ' ')} is required`)
  if (value.length > max) throw new Error(`${key.replaceAll('_', ' ')} must be ${max} characters or fewer`)
  return value
}

function writerList(value: unknown, key: string, maxItems: number, maxLength: number): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${key.replaceAll('_', ' ')} must contain at most ${maxItems} items`)
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${key.replaceAll('_', ' ')} item ${index + 1} is invalid`)
    }
    const normalized = item.trim()
    if (normalized.length > maxLength) {
      throw new Error(`${key.replaceAll('_', ' ')} item ${index + 1} must be ${maxLength} characters or fewer`)
    }
    return normalized
  })
}

function writerCitationList(value: unknown): string[] {
  return writerList(value, 'source_citations', 100, 1000).map((reference, index) => {
    if (reference.length < 3) throw new Error(`Source citation ${index + 1} must be at least 3 characters`)
    if (!reference.includes('://')) return reference
    try {
      const url = new URL(reference)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error()
    } catch {
      throw new Error(`Source citation ${index + 1} must be a label or valid HTTP(S) URL`)
    }
    return reference
  })
}

function writerLength(value: unknown, key: string, max: number): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${key.replaceAll('_', ' ')} must be a positive whole number no greater than ${max}`)
  }
  return Number(value)
}

function writerQualityRequirements(value: unknown): Json | null {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('quality requirements must be an object or null')
  }
  const input = value as Json
  const allowed = new Set([
    'required_sections', 'length_unit', 'min_length', 'max_length',
    'required_terms', 'require_source_citations',
  ])
  const unexpected = Object.keys(input).find(key => !allowed.has(key))
  if (unexpected) throw new Error(`Quality requirements contain unsupported field: ${unexpected}`)
  const requiredSections = writerList(input.required_sections, 'required_sections', 30, 120)
  const requiredTerms = writerList(input.required_terms, 'required_terms', 100, 200)
  const lengthUnit = input.length_unit === null || input.length_unit === undefined
    ? null : writerText(input, 'length_unit', 20)
  if (lengthUnit !== null && !['words', 'characters'].includes(lengthUnit)) {
    throw new Error('length unit must be words, characters, or null')
  }
  const lengthMaximum = lengthUnit === 'words' ? 30000 : 120000
  const minimum = writerLength(input.min_length, 'min_length', lengthMaximum)
  const maximum = writerLength(input.max_length, 'max_length', lengthMaximum)
  if (lengthUnit === null && (minimum !== null || maximum !== null)) {
    throw new Error('Length bounds require a configured length unit')
  }
  if (lengthUnit !== null && minimum === null && maximum === null) {
    throw new Error('A configured length unit requires at least one bound')
  }
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new Error('Minimum length cannot exceed maximum length')
  }
  if (typeof input.require_source_citations !== 'boolean') {
    throw new Error('require source citations must be true or false')
  }
  return {
    required_sections: requiredSections,
    length_unit: lengthUnit,
    min_length: minimum,
    max_length: maximum,
    required_terms: requiredTerms,
    require_source_citations: input.require_source_citations,
  }
}

function contentWriterV2(input: Json): Json {
  const allowed = new Set([
    'schema_version', 'output_type', 'working_title', 'source_architecture_version_id',
    'target_page_key', 'target_page_path', 'destination', 'objective', 'audience',
    'language', 'tone', 'body', 'cta', 'exclusions', 'variant_number',
    'quality_requirements', 'source_citations',
  ])
  const unexpected = Object.keys(input).find(key => !allowed.has(key))
  if (unexpected) throw new Error(`Content writer contains unsupported field: ${unexpected}`)
  const outputType = writerText(input, 'output_type', 40)
  if (!CONTENT_WRITER_OUTPUT_TYPES.has(outputType)) throw new Error('Unsupported Content writer output type')
  const workingTitle = writerText(input, 'working_title', 160)
  if (workingTitle.length < 3) throw new Error('Working title must be at least 3 characters')
  const website = outputType === 'website_page_copy'
  const sourceVersionId = website
    ? writerText(input, 'source_architecture_version_id', 80)
    : writerText(input, 'source_architecture_version_id', 80, { optional: true })
  const targetPageKey = website
    ? writerText(input, 'target_page_key', 1208)
    : writerText(input, 'target_page_key', 1208, { optional: true })
  const destination = website
    ? writerText(input, 'destination', 1000, { optional: true })
    : writerText(input, 'destination', 1000)
  if (!website && (sourceVersionId || targetPageKey || input.target_page_path)) {
    throw new Error('Only website page copy can select a Website Architecture target')
  }
  if (input.variant_number !== 1) throw new Error('This Content writer slice supports exactly one variant')
  const exclusions = input.exclusions
  if (!Array.isArray(exclusions) || exclusions.length > 100) throw new Error('Excluded phrases must contain at most 100 items')
  return {
    schema_version: 2,
    output_type: outputType,
    working_title: workingTitle,
    source_architecture_version_id: website ? sourceVersionId : null,
    target_page_key: website ? targetPageKey : null,
    target_page_path: website ? writerText(input, 'target_page_path', 1200, { optional: true }) : null,
    destination: website ? null : destination,
    objective: writerText(input, 'objective', 8000),
    audience: writerText(input, 'audience', 8000),
    language: writerText(input, 'language', 120),
    tone: writerText(input, 'tone', 1000, { optional: true }),
    body: writerText(input, 'body', 120000),
    cta: writerText(input, 'cta', 2000, { optional: true }),
    exclusions: exclusions.map((value, index) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Excluded phrase ${index + 1} is invalid`)
      const normalized = value.trim()
      if (normalized.length > 500) throw new Error(`Excluded phrase ${index + 1} must be 500 characters or fewer`)
      return normalized
    }),
    variant_number: 1,
    quality_requirements: writerQualityRequirements(input.quality_requirements),
    source_citations: writerCitationList(input.source_citations),
  }
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
    ...foundationExtras(type, input),
  }
  if (type === 'vision') return {
    vision_statement: requiredText(input, 'vision_statement'), positioning: requiredText(input, 'positioning'),
    value_proposition: requiredText(input, 'value_proposition'), differentiators: requiredList(input, 'differentiators'),
    values: requiredList(input, 'values'), voice_principles: requiredList(input, 'voice_principles'),
    messaging_pillars: requiredList(input, 'messaging_pillars'), ...foundationExtras(type, input),
  }
  if (type === 'audience') return {
    primary_audience: requiredText(input, 'primary_audience'), segments: requiredList(input, 'segments'),
    motivations: requiredList(input, 'motivations'), objections: requiredList(input, 'objections'),
    desired_response: requiredText(input, 'desired_response'),
    accessibility_considerations: requiredList(input, 'accessibility_considerations'),
    ...foundationExtras(type, input),
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
  if (type === 'keyword_strategy') {
    if (input.schema_version === 2) return {
      schema_version: 2,
      source_architecture_version_id: keywordText(input.source_architecture_version_id, 80) || null,
      keywords: keywordRecordsV2(input.keywords),
    }
    if (input.schema_version !== undefined && input.schema_version !== null) throw new Error('Unsupported keyword strategy schema version')
    return { keywords: keywordRecords(input.keywords) }
  }
  if (type === 'content') {
    if (input.schema_version === 2) return contentWriterV2(input)
    if (input.schema_version !== undefined && input.schema_version !== null) throw new Error('Unsupported Content schema version')
    return {
      content_strategy: requiredText(input, 'content_strategy'),
      pages: records(input.pages, [
        ['page_path', 'text'], ['page_brief', 'text'], ['draft_copy', 'text'],
        ['meta_title', 'text'], ['meta_description', 'text'], ['primary_cta', 'text'],
      ], 100),
    }
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
    vision: { vision_statement: stringSchema(), positioning: stringSchema(), value_proposition: stringSchema(), differentiators: listSchema(), values: listSchema(), voice_principles: listSchema(), messaging_pillars: listSchema() },
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

function keywordTargetSignature(keyword: Json) {
  return [
    keywordText(keyword.term, 500).toLocaleLowerCase(),
    keywordText(keyword.locale, 120).toLocaleLowerCase(),
    keywordText(keyword.intent, 500).toLocaleLowerCase(),
    text(keyword.target_kind, 40),
    text(keyword.target_page_key, 1208) || text(keyword.target_content_request_id, 80) || text(keyword.target_page_slug, 1200),
  ].join('\u0000')
}

function keywordTargetsChanged(previous: unknown, next: Json[]) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return false
  const before = Array.isArray((previous as Json).keywords)
    ? ((previous as Json).keywords as Json[]).map(keywordTargetSignature).sort() : []
  const after = next.map(keywordTargetSignature).sort()
  return before.length !== after.length || before.some((value, index) => value !== after[index])
}

function hasDuplicateKeywordLocale(keywords: Json[]) {
  const seen = new Set<string>()
  return keywords.some(keyword => {
    const key = `${keywordText(keyword.locale, 120).toLocaleLowerCase()}\u0000${keywordText(keyword.term, 500).toLocaleLowerCase()}`
    if (seen.has(key)) return true
    seen.add(key)
    return false
  })
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
  let content = validateContentArtifact(input.artifactType, input.content)
  const warnings: string[] = []
  let architectureArtifactId: string | null = null
  let contentRequestTargetIds: string[] = []
  if (input.artifactType === 'keyword_strategy') {
    const keywords = content.keywords as Json[]
    if (content.schema_version === 2) {
      const pageKeywords = keywords.filter(keyword => keyword.target_kind === 'page')
      contentRequestTargetIds = [...new Set(keywords
        .filter(keyword => keyword.target_kind === 'content_request')
        .map(keyword => String(keyword.target_content_request_id)))]
      if (pageKeywords.length) {
        const sourceVersionId = text(content.source_architecture_version_id, 80)
        if (!sourceVersionId) throw new Error('Exact Website architecture version is required for page targets')
        const { data: architecture, error: architectureError } = await admin.from('artifacts')
          .select('id').eq('organization_id', input.organizationId)
          .eq('engagement_id', input.engagement.id).eq('artifact_type', 'website_architecture')
          .order('created_at').limit(1).maybeSingle()
        if (architectureError) throw architectureError
        architectureArtifactId = architecture?.id || null
        if (!architectureArtifactId) throw new Error('Website architecture is required for page targets')
        const { data: architectureVersion, error: versionError } = await admin.from('artifact_versions')
          .select('id, content').eq('id', sourceVersionId).eq('organization_id', input.organizationId)
          .eq('artifact_id', architectureArtifactId).maybeSingle()
        if (versionError) throw versionError
        if (!architectureVersion) throw new Error('Selected Website architecture version is unavailable')
        const pages = websitePages(architectureVersion.content?.pages)
        const pageByKey = new Map(pages.map(page => [page.page_key, page]))
        const missing = [...new Set(pageKeywords.map(keyword => String(keyword.target_page_key))
          .filter(pageKey => !pageByKey.has(pageKey)))]
        if (missing.length) throw new Error(`Target page key${missing.length === 1 ? '' : 's'} not found in the selected Website architecture version: ${missing.join(', ')}`)
        content = {
          ...content,
          keywords: keywords.map(keyword => keyword.target_kind === 'page'
            ? { ...keyword, target_page_slug: pageByKey.get(String(keyword.target_page_key))?.slug || null }
            : keyword),
        }
      }
      if (contentRequestTargetIds.length) {
        const { data: requests, error: requestError } = await input.visibilityClient.from('content_requests')
          .select('id, organization_id, brand_id, mode, engagement_id')
          .in('id', contentRequestTargetIds)
        if (requestError) throw requestError
        const validIds = new Set((requests || []).filter((request: Json) => request.organization_id === input.organizationId
          && request.brand_id === input.engagement.brand_id
          && (request.mode === 'general' || request.engagement_id === input.engagement.id)).map((request: Json) => request.id))
        const unavailable = contentRequestTargetIds.filter(id => !validIds.has(id))
        if (unavailable.length) throw new Error('One or more selected content-request targets are unavailable in this workspace')
      }
      if (hasDuplicateKeywordLocale(content.keywords as Json[])) {
        warnings.push('Duplicate phrase and locale rows were retained without merging; review distinct intents explicitly.')
      }
    } else {
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
          const missing = [...new Set(keywords.map(keyword => String(keyword.target_page_slug)).filter(slug => !pageSlugs.has(slug)))]
          if (missing.length) throw new Error(`Target page slug${missing.length === 1 ? '' : 's'} not found in the latest website architecture: ${missing.join(', ')}`)
        }
      }
    }
  }
  if (input.artifactType === 'content' && content.schema_version === 2
    && content.output_type === 'website_page_copy') {
    const sourceVersionId = String(content.source_architecture_version_id)
    const { data: architectureVersion, error: versionError } = await admin.from('artifact_versions')
      .select('id, artifact_id, content').eq('id', sourceVersionId)
      .eq('organization_id', input.organizationId).maybeSingle()
    if (versionError) throw versionError
    if (!architectureVersion) throw new Error('Selected Website Architecture version is unavailable')
    const { data: architecture, error: architectureError } = await admin.from('artifacts')
      .select('id').eq('id', architectureVersion.artifact_id).eq('organization_id', input.organizationId)
      .eq('engagement_id', input.engagement.id).eq('brand_id', input.engagement.brand_id)
      .eq('artifact_type', 'website_architecture').maybeSingle()
    if (architectureError) throw architectureError
    if (!architecture) throw new Error('Selected Website Architecture version is unavailable in this workspace')
    architectureArtifactId = architecture.id
    const page = websitePages(architectureVersion.content?.pages)
      .find(candidate => candidate.page_key === content.target_page_key)
    if (!page) throw new Error('Selected page is unavailable in the exact Website Architecture version')
    content = { ...content, target_page_path: page.slug }
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
    .select('id, version_number, content').eq('artifact_id', artifactId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  if (latestError) throw latestError
  if (input.artifactType === 'website_architecture' && latest?.content) {
    assertWebsitePageIdentityTransition(latest.content, content.pages)
  }
  if (input.artifactType === 'keyword_strategy' && content.schema_version === 2
    && latest?.content && keywordTargetsChanged(latest.content, content.keywords as Json[])) {
    warnings.push('Keyword targets changed; affected downstream drafts require manual review and were not rewritten.')
  }
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
  for (const targetContentRequestId of contentRequestTargetIds) {
    await createArtifactRelation(input.visibilityClient, admin, {
      source_artifact_id: artifactId,
      target_content_request_id: targetContentRequestId,
      relation_type: 'targets_page',
    }, input.actorId, { allowExisting: true })
  }
  return { artifact_id: artifactId, version, warnings }
}
