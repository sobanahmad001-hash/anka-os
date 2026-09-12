import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { brandBriefInput, compiledBrandStatement, contentStudioScope, customFieldDefinitionInput, handleRequest, hasContentAuthority, requireBrandBriefMutationToken,
  figmaHandoffUrl, validateContentRequestInput, validateQueueEntryInput } from './index.ts'

import { assertWebsitePageIdentityTransition, CHAT_CONTENT_ARTIFACT_TYPE_SET, CONTENT_ARTIFACT_TYPES, contentArtifactResponseFormat, createContentArtifactVersion, MAX_KEYWORD_RECORDS, validateContentArtifact, withGeneratedSourceMetadata } from '../_shared/contentArtifacts.ts'

Deno.test('B02 foundation contract preserves language and exact per-field source state', () => {
  const discovery = validateContentArtifact('discovery', {
    summary: 'Accepted context', objectives: ['Grow'], offers: ['Advisory'], evidence: ['Unknown'], constraints: ['Budget'],
    language: 'Urdu',
    source_metadata: { evidence: {
      source_label: 'Client workshop', source_date: '2026-09-04',
      needs_confirmation: true, human_confirmed: false,
    } },
  })
  assertEquals(discovery.language, 'Urdu')
  assertEquals((discovery.source_metadata as Record<string, any>).evidence.needs_confirmation, true)
  assertThrows(() => validateContentArtifact('discovery', {
    summary: 'Unknown', objectives: ['Grow'], offers: ['Advisory'], evidence: ['Known'], constraints: ['Known'],
  }), Error, 'Unknown is not allowed')
  const audience = (sourceDate: string | null) => ({
    primary_audience: 'Leaders', segments: ['Operators'], motivations: ['Clarity'], objections: ['Time'],
    desired_response: 'Book', accessibility_considerations: ['Plain language'],
    source_metadata: { primary_audience: {
      source_label: 'Interview', source_date: sourceDate, needs_confirmation: false, human_confirmed: true,
    } },
  })
  assertThrows(() => validateContentArtifact('audience', audience('04/09/2026')), Error, 'real calendar date')
  assertThrows(() => validateContentArtifact('audience', audience('2026-99-99')), Error, 'real calendar date')
  assertThrows(() => validateContentArtifact('audience', audience('2026-02-30')), Error, 'real calendar date')
  assertEquals((validateContentArtifact('audience', audience('2028-02-29')).source_metadata as Record<string, any>).primary_audience.source_date, '2028-02-29')
  assertEquals((validateContentArtifact('audience', audience(null)).source_metadata as Record<string, any>).primary_audience.source_date, null)
})

Deno.test('B02 Vision owns differentiators and messaging pillars', () => {
  const vision = validateContentArtifact('vision', {
    vision_statement: 'A calmer future', positioning: 'Calm operators', value_proposition: 'Complex work made clear',
    differentiators: ['Evidence-led'], values: ['Care'], voice_principles: ['Direct'], messaging_pillars: ['Clarity'],
  })
  assertEquals(vision.differentiators, ['Evidence-led'])
  assertEquals(contentArtifactResponseFormat('vision').schema.required.includes('messaging_pillars'), true)
})

Deno.test('B02 generated foundations are visibly confirmation-needed', () => {
  const generated = withGeneratedSourceMetadata('audience', {
    primary_audience: 'Leaders', segments: ['Operators'], motivations: ['Clarity'], objections: ['Time'],
    desired_response: 'Book', accessibility_considerations: ['Plain language'],
  }, '2026-09-04')
  assertEquals((generated.source_metadata as Record<string, any>).primary_audience, {
    source_label: 'Shared Department Chat proposal', source_date: '2026-09-04',
    needs_confirmation: true, human_confirmed: false,
  })
})

Deno.test('B02 mutable brief updates require the exact prior updated_at', () => {
  assertEquals(requireBrandBriefMutationToken('2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z'), '2026-09-04T10:00:00Z')
  assertEquals(requireBrandBriefMutationToken(null, null), null)
  assertThrows(() => requireBrandBriefMutationToken('2026-09-04T10:00:00Z', null), Error, 'Reload before saving')
  try { requireBrandBriefMutationToken('2026-09-04T10:00:00Z', '2026-09-04T09:00:00Z') } catch (error) {
    assertEquals((error as { status?: number }).status, 409)
  }
})

Deno.test('Content authority keeps exact-version approval manager-controlled', () => {
  assertEquals(hasContentAuthority({ role: 'contributor', department_id: 'content' }, 'save_artifact'), true)
  assertEquals(hasContentAuthority({ role: 'contributor', department_id: 'content' }, 'approve_artifact'), false)
  assertEquals(hasContentAuthority({ role: 'department_manager', department_id: 'content' }, 'approve_artifact'), true)
  assertEquals(hasContentAuthority({ role: 'executive', department_id: null }, 'approve_artifact'), true)
})

Deno.test('Gate 0 maps every legacy Content action to a closed literal organization root', () => {
  const organization_id = 'org-b'
  const requestFields = { organization_id, output_path: 'internal_engine', format: 'reel', brief: 'Brief' }
  assertEquals(contentStudioScope({ action: 'save_artifact', engagement_id: 'engagement-b' }), {
    root: { kind: 'engagement', id: 'engagement-b' }, requestedOrganizationId: null,
  })
  assertEquals(contentStudioScope({ action: 'save_artifact', artifact_id: 'artifact-b' }), {
    root: { kind: 'artifact', id: 'artifact-b' }, requestedOrganizationId: null,
  })
  assertEquals(contentStudioScope({ action: 'create_content_request', mode: 'project', engagement_id: 'engagement-b', ...requestFields }), {
    root: { kind: 'engagement', id: 'engagement-b' }, requestedOrganizationId: organization_id,
  })
  assertEquals(contentStudioScope({ action: 'create_content_request', mode: 'general', brand_id: 'brand-b', ...requestFields }), {
    root: { kind: 'brand', id: 'brand-b' }, requestedOrganizationId: organization_id,
  })
  assertEquals(contentStudioScope({ action: 'create_content_request', mode: 'general', ...requestFields }), {
    root: null, requestedOrganizationId: organization_id,
  })
  assertEquals(contentStudioScope({ action: 'create_queue_entry', brand_id: 'brand-b', planned_date: '2026-09-04', format: 'reel' }), {
    root: { kind: 'brand', id: 'brand-b' }, requestedOrganizationId: null,
  })
  for (const action of ['action_queue_entry', 'skip_queue_entry']) {
    assertEquals(contentStudioScope({ action, queue_entry_id: 'queue-b' }), {
      root: { kind: 'content_queue_entry', id: 'queue-b' }, requestedOrganizationId: null,
    })
  }
  assertEquals(contentStudioScope({ action: 'ensure_figma_handoff', content_request_id: 'request-b' }), {
    root: { kind: 'content_request', id: 'request-b' }, requestedOrganizationId: null,
  })
  for (const action of ['save_brand_brief', 'generate_brand_statement']) {
    assertEquals(contentStudioScope({ action, engagement_id: 'engagement-b' }), {
      root: { kind: 'engagement', id: 'engagement-b' }, requestedOrganizationId: null,
    })
  }
  for (const action of ['approve_artifact', 'save_custom_field_value']) {
    assertEquals(contentStudioScope({ action, artifact_version_id: 'version-b' }), {
      root: { kind: 'artifact_version', id: 'version-b' }, requestedOrganizationId: null,
    })
  }
  assertEquals(contentStudioScope({
    action: 'create_custom_field_definition', organization_id,
    artifact_type: 'content', name: 'channel', field_type: 'text',
  }), { root: null, requestedOrganizationId: organization_id })
})

Deno.test('CP1 validates linked and unlinked project requests without client-type assumptions', () => {
  const routine = validateContentRequestInput({
    mode: 'project', engagement_id: 'engagement-1', brand_id: 'brand-1',
    output_path: 'internal_engine', format: 'single_image', brief: 'Routine service post',
  })
  assertEquals(routine.linkedEventId, null)
  assertEquals(routine.createEventLink, false)
  const eventPost = validateContentRequestInput({
    mode: 'project', engagement_id: 'engagement-1', brand_id: 'brand-1', linked_event_id: 'event-1',
    output_path: 'figma_handoff', format: 'carousel_stories', brief: 'Conference carousel',
    create_event_link: true, event_content_type: 'social', lead_time_days: 10,
  })
  assertEquals(eventPost.linkedEventId, 'event-1')
  assertEquals(eventPost.createEventLink, true)
  assertEquals(eventPost.leadTimeDays, 10)
})

Deno.test('CP1 rejects event-plan linking without an event and unsupported formats', () => {
  assertThrows(() => validateContentRequestInput({
    mode: 'project', output_path: 'internal_engine', format: 'single_image', brief: 'Post',
    create_event_link: true,
  }), Error, 'Select an event')
  assertThrows(() => validateContentRequestInput({
    mode: 'project', output_path: 'internal_engine', format: 'speculative_format', brief: 'Post',
  }), Error, 'format')
})

Deno.test('CP2 reuses CP1 validation for branded and unbranded general requests', () => {
  const unbranded = validateContentRequestInput({
    mode: 'general', engagement_id: null, brand_id: null,
    output_path: 'internal_engine', format: 'reel', brief: 'A fast general reel request',
  })
  assertEquals(unbranded.mode, 'general')
  assertEquals(unbranded.engagementId, null)
  assertEquals(unbranded.brandId, null)

  const branded = validateContentRequestInput({
    mode: 'general', engagement_id: null, brand_id: 'brand-1',
    output_path: 'figma_handoff', format: 'carousel', brief: 'A branded carousel request',
  })
  assertEquals(branded.mode, 'general')
  assertEquals(branded.engagementId, null)
  assertEquals(branded.brandId, 'brand-1')
})

Deno.test('CP3 creates only a stable authenticated in-app handoff route', () => {
  assertEquals(
    figmaHandoffUrl('request-1', 'https://anka.example/base?old=1#fragment'),
    'https://anka.example/sphere/content/requests/request-1/figma-handoff',
  )
  assertThrows(() => figmaHandoffUrl('request-1', 'ftp://anka.example'), Error, 'HTTP or HTTPS')
})

Deno.test('CP4 validates brand-scoped plans with the exact CP1 format vocabulary', () => {
  assertEquals(validateQueueEntryInput({
    brand_id: 'brand-1', planned_date: '2026-09-12', format: 'reel_carousel',
    brief_template: 'Launch-week paired assets', linked_event_id: 'event-1',
  }), {
    brandId: 'brand-1', plannedDate: '2026-09-12', format: 'reel_carousel',
    briefTemplate: 'Launch-week paired assets', linkedEventId: 'event-1',
  })
  assertEquals(validateQueueEntryInput({
    brand_id: 'brand-1', planned_date: '2026-09-13', format: 'single_image',
    brief_template: '',
  }).briefTemplate, '')
})

Deno.test('CP4 rejects unbranded, malformed-date, and unknown-format plans', () => {
  assertThrows(() => validateQueueEntryInput({
    planned_date: '2026-09-12', format: 'reel',
  }), Error, 'brand')
  assertThrows(() => validateQueueEntryInput({
    brand_id: 'brand-1', planned_date: '12/09/2026', format: 'reel',
  }), Error, 'planned date')
  assertThrows(() => validateQueueEntryInput({
    brand_id: 'brand-1', planned_date: '2026-09-12', format: 'podcast',
  }), Error, 'format')
})

Deno.test('eight chat artifacts and the compiled brand statement use strict validation', () => {
  assertEquals(CONTENT_ARTIFACT_TYPES.length, 9)
  assertEquals(CHAT_CONTENT_ARTIFACT_TYPE_SET.size, 8)
  assertEquals(CHAT_CONTENT_ARTIFACT_TYPE_SET.has('brand_statement'), false)
  const architecture = validateContentArtifact('website_architecture', {
    pages: [{ slug: 'home', title: 'Homepage', parent_slug: null, page_type: 'hub', purpose: 'Orient visitors' }],
  })
  assertEquals((architecture.pages as Array<Record<string, unknown>>)[0].slug, 'home')
  const keywords = validateContentArtifact('keyword_strategy', {
    keywords: [{ term: 'strategy agency', category: 'industry', search_volume: 1200, target_page_slug: 'home', notes: '' }],
  })
  assertEquals((keywords.keywords as Array<Record<string, unknown>>)[0].target_page_slug, 'home')
})

Deno.test('RP2 rejects malformed sitemap hierarchy and keyword categories server-side', () => {
  assertThrows(() => validateContentArtifact('website_architecture', {
    pages: [{ slug: 'home', title: 'Homepage', parent_slug: null, page_type: 'landing', purpose: 'Orient' }],
  }), Error, 'page type')
  assertThrows(() => validateContentArtifact('website_architecture', {
    pages: [{ slug: 'services', title: 'Services', parent_slug: 'missing', page_type: 'hub', purpose: 'Navigate' }],
  }), Error, 'does not reference')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    keywords: [{ term: 'agency', category: 'transactional', search_volume: 12, target_page_slug: 'home', notes: '' }],
  }), Error, 'category')
})

Deno.test('B04 validates evidence-aware keywords while retaining absent metrics as unavailable', () => {
  const strategy = validateContentArtifact('keyword_strategy', {
    schema_version: 2,
    source_architecture_version_id: 'architecture-v2',
    keywords: [{
      term: '  strategy   agency ', locale: 'en-PK', intent: 'commercial', topic_group: 'services',
      priority: 'high', evidence_source: '', search_volume: null, difficulty: null, observation_date: null,
      target_kind: 'page', target_page_key: 'page:home', target_content_request_id: null,
      target_page_slug: 'stale-client-snapshot', category: null, notes: '',
    }],
  })
  assertEquals(strategy.schema_version, 2)
  assertEquals((strategy.keywords as Array<Record<string, unknown>>)[0].term, 'strategy agency')
  assertEquals((strategy.keywords as Array<Record<string, unknown>>)[0].search_volume, null)
})

Deno.test('B04 rejects unlabelled measurements, invalid dates, and incomplete targets', () => {
  const keyword = {
    term: 'strategy agency', locale: 'en-PK', intent: '', topic_group: '', priority: '',
    evidence_source: '', search_volume: 100, difficulty: null, observation_date: null,
    target_kind: 'content_request', target_page_key: null, target_content_request_id: 'request-1',
    target_page_slug: null, category: null, notes: '',
  }
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null, keywords: [keyword],
  }), Error, 'evidence source')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: [{ ...keyword, search_volume: null, evidence_source: 'Provider', observation_date: '2026-02-30' }],
  }), Error, 'real calendar date')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: [{ ...keyword, search_volume: null, target_content_request_id: null }],
  }), Error, 'target content request')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: [{ ...keyword, search_volume: null, observation_date: '2026-01-01extra', evidence_source: 'Provider' }],
  }), Error, 'real calendar date')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: [{ ...keyword, term: 'x'.repeat(501), search_volume: null }],
  }), Error, '500 characters or fewer')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: [{ ...keyword, search_volume: 1.5, evidence_source: 'Provider' }],
  }), Error, 'non-negative integer')
})

Deno.test('B04 accepts 500 keyword rows and rejects 501 without silent truncation', () => {
  const keyword = (index: number) => ({
    term: `Keyword ${index}`, locale: 'en-PK', intent: '', topic_group: '', priority: '',
    evidence_source: '', search_volume: null, difficulty: null, observation_date: null,
    target_kind: 'content_request', target_page_key: null, target_content_request_id: 'request-1',
    target_page_slug: null, category: null, notes: '',
  })
  const atLimit = validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: Array.from({ length: MAX_KEYWORD_RECORDS }, (_, index) => keyword(index)),
  })
  assertEquals((atLimit.keywords as unknown[]).length, MAX_KEYWORD_RECORDS)
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    schema_version: 2, source_architecture_version_id: null,
    keywords: Array.from({ length: MAX_KEYWORD_RECORDS + 1 }, (_, index) => keyword(index)),
  }), Error, 'at most 500 rows')
  assertThrows(() => validateContentArtifact('keyword_strategy', {
    keywords: Array.from({ length: MAX_KEYWORD_RECORDS + 1 }, (_, index) => ({
      term: `Legacy ${index}`, category: 'industry', search_volume: 0, target_page_slug: 'home', notes: '',
    })),
  }), Error, 'at most 500 rows')
})

function b04SaveFixture(options: {
  requests?: Array<Record<string, unknown>>
  visibleRequestIds?: string[]
  sourceVersionId?: string
  pages?: Array<Record<string, unknown>>
} = {}) {
  const organizationId = 'org-a'
  const engagementId = 'engagement-a'
  const brandId = 'brand-a'
  const rows: Record<string, Array<Record<string, unknown>>> = {
    artifacts: [
      { id: 'keyword-artifact', organization_id: organizationId, engagement_id: engagementId, brand_id: brandId, artifact_type: 'keyword_strategy', title: 'Keywords' },
      { id: 'architecture-artifact', organization_id: organizationId, engagement_id: engagementId, brand_id: brandId, artifact_type: 'website_architecture', title: 'Architecture' },
    ],
    artifact_versions: [
      { id: options.sourceVersionId || 'architecture-v2', organization_id: organizationId, artifact_id: 'architecture-artifact', version_number: 2, content: { pages: options.pages || [
        { page_key: 'page:home', slug: 'home', title: 'Home', parent_page_key: null, position: 1000, page_type: 'hub', purpose: 'Orient' },
      ] } },
      { id: 'keyword-v1', organization_id: organizationId, artifact_id: 'keyword-artifact', version_number: 1, content: { schema_version: 2, source_architecture_version_id: 'architecture-v2', keywords: [] } },
    ],
    content_requests: options.requests || [],
    organization_memberships: [{ id: 'membership-a', organization_id: organizationId, user_id: 'actor-a', member_kind: 'team', status: 'active' }],
    artifact_relations: [],
    engagement_events: [],
  }
  const writes: Array<{ table: string; value: Record<string, unknown> }> = []
  const visibleRequestIds = new Set(options.visibleRequestIds ?? (options.requests || []).map(request => String(request.id)))

  class Query {
    table: string
    role: 'admin' | 'user'
    filters: Array<{ kind: 'eq' | 'in'; key: string; value: unknown }> = []
    operation: 'read' | 'insert' | 'delete' = 'read'
    value: Record<string, unknown> | null = null
    orderBy: { key: string; ascending: boolean } | null = null
    rowLimit: number | null = null
    constructor(table: string, role: 'admin' | 'user') { this.table = table; this.role = role }
    select() { return this }
    eq(key: string, value: unknown) { this.filters.push({ kind: 'eq', key, value }); return this }
    in(key: string, value: unknown[]) { this.filters.push({ kind: 'in', key, value }); return this }
    order(key: string, options: { ascending?: boolean } = {}) { this.orderBy = { key, ascending: options.ascending !== false }; return this }
    limit(value: number) { this.rowLimit = value; return this }
    insert(value: Record<string, unknown>) { this.operation = 'insert'; this.value = value; return this }
    delete() { this.operation = 'delete'; return this }
    maybeSingle() { return Promise.resolve(this.execute(true)) }
    single() { return Promise.resolve(this.execute(true)) }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(this.execute(false)).then(resolve, reject) }
    matchingRows() {
      let result = [...(rows[this.table] || [])]
      if (this.role === 'user' && this.table === 'content_requests') result = result.filter(row => visibleRequestIds.has(String(row.id)))
      for (const filter of this.filters) {
        result = result.filter(row => filter.kind === 'eq'
          ? String(row[filter.key] ?? '') === String(filter.value ?? '')
          : (filter.value as unknown[]).map(String).includes(String(row[filter.key])))
      }
      if (this.orderBy) result.sort((left, right) => {
        const comparison = Number(left[this.orderBy!.key] || 0) - Number(right[this.orderBy!.key] || 0)
        return this.orderBy!.ascending ? comparison : -comparison
      })
      return this.rowLimit === null ? result : result.slice(0, this.rowLimit)
    }
    execute(single: boolean) {
      if (this.operation === 'insert') {
        const id = this.table === 'artifact_versions' ? 'keyword-v2'
          : this.table === 'artifact_relations' ? `relation-${rows.artifact_relations.length + 1}`
          : this.table === 'engagement_events' ? `event-${rows.engagement_events.length + 1}` : `new-${this.table}`
        const inserted = { id, ...(this.value || {}) }
        rows[this.table] = [...(rows[this.table] || []), inserted]
        writes.push({ table: this.table, value: inserted })
        return { data: single ? inserted : [inserted], error: null }
      }
      if (this.operation === 'delete') {
        const deleting = new Set(this.matchingRows())
        rows[this.table] = (rows[this.table] || []).filter(row => !deleting.has(row))
        return { data: null, error: null }
      }
      const result = this.matchingRows()
      return { data: single ? result[0] || null : result, error: null }
    }
  }

  const client = (role: 'admin' | 'user') => ({ from: (table: string) => new Query(table, role) })
  return { admin: client('admin'), user: client('user'), writes, rows, organizationId, engagementId, brandId }
}

function b04VersionInput(fixture: ReturnType<typeof b04SaveFixture>, content: Record<string, unknown>) {
  return {
    organizationId: fixture.organizationId,
    engagement: { id: fixture.engagementId, brand_id: fixture.brandId },
    artifactId: 'keyword-artifact', artifactType: 'keyword_strategy', title: 'Keywords', content,
    changeSummary: 'B04 verification', aiUseAllowed: false, dataClassification: 'internal',
    actorId: 'actor-a', source: 'manual' as const, visibilityClient: fixture.user,
  }
}

function b04KeywordTarget(target: { pageKey?: string; requestId?: string }) {
  return {
    term: 'Strategy agency', locale: 'en-PK', intent: 'commercial', topic_group: 'services', priority: 'high',
    evidence_source: '', search_volume: null, difficulty: null, observation_date: null,
    target_kind: target.pageKey ? 'page' : 'content_request', target_page_key: target.pageKey || null,
    target_content_request_id: target.requestId || null, target_page_slug: 'untrusted-client-slug', category: null, notes: '',
  }
}

Deno.test('B04 save binds an exact page version, derives slug, and creates a consistent revision and relation', async () => {
  const fixture = b04SaveFixture()
  const result = await createContentArtifactVersion(fixture.admin, b04VersionInput(fixture, {
    schema_version: 2, source_architecture_version_id: 'architecture-v2', keywords: [b04KeywordTarget({ pageKey: 'page:home' })],
  }))
  const version = fixture.writes.find(write => write.table === 'artifact_versions')?.value as Record<string, unknown>
  const savedKeyword = (version.content as Record<string, unknown>).keywords as Array<Record<string, unknown>>
  assertEquals(savedKeyword[0].target_page_slug, 'home')
  assertEquals(version.version_number, 2)
  assertEquals(version.parent_version_id, 'keyword-v1')
  assertEquals(result.artifact_id, 'keyword-artifact')
  const relation = fixture.writes.find(write => write.table === 'artifact_relations')?.value
  assertEquals(relation?.source_artifact_id, 'keyword-artifact')
  assertEquals(relation?.target_artifact_id, 'architecture-artifact')
  assertEquals(relation?.relation_type, 'targets_page')
})

Deno.test('B04 save accepts a visible scoped standalone request and creates the existing relation shape', async () => {
  const request = { id: 'request-1', organization_id: 'org-a', brand_id: 'brand-a', mode: 'general', engagement_id: null, format: 'reel' }
  const fixture = b04SaveFixture({ requests: [request] })
  await createContentArtifactVersion(fixture.admin, b04VersionInput(fixture, {
    schema_version: 2, source_architecture_version_id: null, keywords: [b04KeywordTarget({ requestId: 'request-1' })],
  }))
  const relation = fixture.writes.find(write => write.table === 'artifact_relations')?.value
  assertEquals(relation?.source_artifact_id, 'keyword-artifact')
  assertEquals(relation?.target_content_request_id, 'request-1')
  assertEquals(relation?.target_artifact_id, null)
  assertEquals(relation?.relation_type, 'targets_page')
})

Deno.test('B04 save rejects stale page versions and keys before any write', async () => {
  for (const content of [
    { schema_version: 2, source_architecture_version_id: 'missing-version', keywords: [b04KeywordTarget({ pageKey: 'page:home' })] },
    { schema_version: 2, source_architecture_version_id: 'architecture-v2', keywords: [b04KeywordTarget({ pageKey: 'page:missing' })] },
  ]) {
    const fixture = b04SaveFixture()
    await assertRejects(() => createContentArtifactVersion(fixture.admin, b04VersionInput(fixture, content)))
    assertEquals(fixture.writes.length, 0)
  }
})

Deno.test('B04 save rejects hidden, foreign-organization, foreign-brand, and foreign-engagement request targets before writes', async () => {
  const scenarios = [
    { request: { id: 'request-1', organization_id: 'org-a', brand_id: 'brand-a', mode: 'general', engagement_id: null }, visibleRequestIds: [] },
    { request: { id: 'request-1', organization_id: 'org-b', brand_id: 'brand-a', mode: 'general', engagement_id: null } },
    { request: { id: 'request-1', organization_id: 'org-a', brand_id: 'brand-b', mode: 'general', engagement_id: null } },
    { request: { id: 'request-1', organization_id: 'org-a', brand_id: 'brand-a', mode: 'project', engagement_id: 'engagement-b' } },
  ]
  for (const scenario of scenarios) {
    const fixture = b04SaveFixture({ requests: [scenario.request], visibleRequestIds: scenario.visibleRequestIds })
    await assertRejects(() => createContentArtifactVersion(fixture.admin, b04VersionInput(fixture, {
      schema_version: 2, source_architecture_version_id: null, keywords: [b04KeywordTarget({ requestId: 'request-1' })],
    })), Error, 'unavailable')
    assertEquals(fixture.writes.length, 0)
  }
})

Deno.test('B04 over-limit save fails before target reads or writes', async () => {
  const fixture = b04SaveFixture({ requests: [{ id: 'request-1', organization_id: 'org-a', brand_id: 'brand-a', mode: 'general', engagement_id: null }] })
  await assertRejects(() => createContentArtifactVersion(fixture.admin, b04VersionInput(fixture, {
    schema_version: 2, source_architecture_version_id: null,
    keywords: Array.from({ length: MAX_KEYWORD_RECORDS + 1 }, () => b04KeywordTarget({ requestId: 'request-1' })),
  })), Error, 'at most 500 rows')
  assertEquals(fixture.writes.length, 0)
})

function b05WriterContent(outputType = 'website_page_copy') {
  const website = outputType === 'website_page_copy'
  return {
    schema_version: 2, output_type: outputType, working_title: 'Homepage draft',
    source_architecture_version_id: website ? 'architecture-v2' : null,
    target_page_key: website ? 'page:home' : null, target_page_path: null,
    destination: website ? null : 'September launch', objective: 'Explain the service',
    audience: 'Operations leaders', language: 'English', tone: 'Direct and calm',
    body: 'A clear manually authored draft.', cta: 'Book a call', exclusions: ['guaranteed'],
    variant_number: 1,
  }
}

function b05VersionInput(fixture: ReturnType<typeof b04SaveFixture>, content: Record<string, unknown>) {
  return {
    organizationId: fixture.organizationId,
    engagement: { id: fixture.engagementId, brand_id: fixture.brandId },
    artifactId: null, artifactType: 'content', title: 'Homepage draft', content,
    changeSummary: 'B05 manual writer preview', aiUseAllowed: false, dataClassification: 'internal',
    actorId: 'actor-a', source: 'manual' as const, visibilityClient: fixture.user,
  }
}

Deno.test('B05a validates five strict writer types while preserving the legacy Content schema', () => {
  for (const outputType of ['website_page_copy', 'blog_article', 'social_copy', 'campaign_copy', 'custom_text']) {
    const content = validateContentArtifact('content', b05WriterContent(outputType))
    assertEquals(content.output_type, outputType)
    assertEquals(content.variant_number, 1)
  }
  const legacy = validateContentArtifact('content', {
    content_strategy: 'Page plan', pages: [{ page_path: 'home', page_brief: 'Orient', draft_copy: 'Copy', meta_title: 'Home', meta_description: 'Description', primary_cta: 'Book' }],
  })
  assertEquals(legacy.content_strategy, 'Page plan')
  assertThrows(() => validateContentArtifact('content', { ...b05WriterContent('blog_article'), variant_number: 2 }), Error, 'exactly one variant')
  assertThrows(() => validateContentArtifact('content', { ...b05WriterContent('blog_article'), target_page_key: 'page:home' }), Error, 'Only website page copy')
  assertThrows(() => validateContentArtifact('content', { ...b05WriterContent(), source_architecture_version_id: null }), Error, 'source architecture version id is required')
  assertThrows(() => validateContentArtifact('content', { ...b05WriterContent(), working_title: 'x'.repeat(161) }), Error, '160 characters or fewer')
  assertThrows(() => validateContentArtifact('content', { ...b05WriterContent(), approved: true }), Error, 'unsupported field')
})

Deno.test('B05b validates bounded additive quality rules and preserves B05a payloads without configuration', () => {
  const legacyWriter = validateContentArtifact('content', b05WriterContent('blog_article'))
  assertEquals(legacyWriter.quality_requirements, null)
  assertEquals(legacyWriter.source_citations, [])

  const qualityRequirements = {
    required_sections: ['Summary', 'Sources'],
    length_unit: 'words',
    min_length: 100,
    max_length: 500,
    required_terms: ['Anka Sphere'],
    require_source_citations: true,
  }
  const content = validateContentArtifact('content', {
    ...b05WriterContent('blog_article'),
    quality_requirements: qualityRequirements,
    source_citations: ['Client brief v2', 'https://example.test/source'],
  })
  assertEquals(content.quality_requirements, qualityRequirements)
  assertEquals(content.source_citations, ['Client brief v2', 'https://example.test/source'])

  for (const [value, message] of [
    [{ ...qualityRequirements, unexpected: true }, 'unsupported field'],
    [{ ...qualityRequirements, length_unit: 'sentences' }, 'length unit'],
    [{ ...qualityRequirements, min_length: 600 }, 'Minimum length'],
    [{ ...qualityRequirements, min_length: null, max_length: null }, 'at least one bound'],
    [{ ...qualityRequirements, required_sections: Array.from({ length: 31 }, () => 'Section') }, 'at most 30 items'],
    [{ ...qualityRequirements, required_terms: ['x'.repeat(201)] }, '200 characters or fewer'],
  ] as const) {
    assertThrows(() => validateContentArtifact('content', {
      ...b05WriterContent('blog_article'), quality_requirements: value, source_citations: [],
    }), Error, message)
  }
  assertThrows(() => validateContentArtifact('content', {
    ...b05WriterContent('blog_article'),
    quality_requirements: qualityRequirements,
    source_citations: ['x'.repeat(1001)],
  }), Error, '1000 characters or fewer')
  assertThrows(() => validateContentArtifact('content', {
    ...b05WriterContent('blog_article'),
    quality_requirements: qualityRequirements,
    source_citations: ['ftp://example.test/source'],
  }), Error, 'valid HTTP(S) URL')
})

Deno.test('B05b persists advisory request configuration without checks, approval, provider, or structure effects', async () => {
  const fixture = b04SaveFixture({ sourceVersionId: 'unrelated-version', pages: [] })
  await createContentArtifactVersion(fixture.admin, b05VersionInput(fixture, {
    ...b05WriterContent('custom_text'),
    quality_requirements: {
      required_sections: [], length_unit: 'characters', min_length: null, max_length: 500,
      required_terms: ['Anka Sphere'], require_source_citations: true,
    },
    source_citations: [],
  }))
  const version = fixture.writes.find(write => write.table === 'artifact_versions')?.value as Record<string, unknown>
  const saved = version.content as Record<string, unknown>
  assertEquals((saved.quality_requirements as Record<string, unknown>).max_length, 500)
  assertEquals(saved.source_citations, [])
  assertEquals(Object.hasOwn(saved, 'check_results'), false)
  assertEquals(Object.hasOwn(version, 'approval'), false)
  assertEquals(fixture.writes.some(write => write.table === 'artifact_relations'), false)
})

Deno.test('B05a save binds exact website version and page before creating one unapproved canonical draft', async () => {
  const fixture = b04SaveFixture()
  const result = await createContentArtifactVersion(fixture.admin, b05VersionInput(fixture, b05WriterContent()))
  const artifact = fixture.writes.find(write => write.table === 'artifacts')?.value
  const version = fixture.writes.find(write => write.table === 'artifact_versions')?.value as Record<string, unknown>
  assertEquals(result.artifact_id, artifact?.id)
  assertEquals(version.version_number, 1)
  assertEquals(version.parent_version_id, null)
  assertEquals(version.ai_use_allowed, false)
  assertEquals((version.content as Record<string, unknown>).target_page_path, 'home')
  assertEquals(Object.hasOwn(version, 'approval'), false)
  const relation = fixture.writes.find(write => write.table === 'artifact_relations')?.value
  assertEquals(relation?.source_artifact_id, artifact?.id)
  assertEquals(relation?.target_artifact_id, 'architecture-artifact')
})

Deno.test('B05a rejects stale website targets before output writes and saves isolated text without structure', async () => {
  for (const content of [
    { ...b05WriterContent(), source_architecture_version_id: 'missing-version' },
    { ...b05WriterContent(), target_page_key: 'page:missing' },
  ]) {
    const fixture = b04SaveFixture()
    await assertRejects(() => createContentArtifactVersion(fixture.admin, b05VersionInput(fixture, content)))
    assertEquals(fixture.writes.length, 0)
  }
  const isolated = b04SaveFixture({ sourceVersionId: 'unrelated-version', pages: [] })
  await createContentArtifactVersion(isolated.admin, b05VersionInput(isolated, b05WriterContent('blog_article')))
  const version = isolated.writes.find(write => write.table === 'artifact_versions')?.value as Record<string, unknown>
  assertEquals((version.content as Record<string, unknown>).source_architecture_version_id, null)
  assertEquals(isolated.writes.some(write => write.table === 'artifact_relations'), false)
})

Deno.test('B03a normalizes paths, sorts deterministically and derives legacy keys', () => {
  const architecture = validateContentArtifact('website_architecture', { pages: [
    { page_key: 'page:child', slug: ' /Services//Web Design/ ', title: 'Web', parent_page_key: 'page:root', position: 2000, page_type: 'service', purpose: 'Explain' },
    { page_key: 'page:root', slug: 'Home', title: 'Home', parent_page_key: null, position: 1000, page_type: 'hub', purpose: 'Orient' },
  ] })
  const pages = architecture.pages as Array<Record<string, unknown>>
  assertEquals(pages.map(page => [page.page_key, page.slug, page.position]), [
    ['page:root', 'home', 1000],
    ['page:child', 'services/web-design', 2000],
  ])
  const legacy = validateContentArtifact('website_architecture', { pages: [
    { slug: 'About', title: 'About', parent_slug: null, page_type: 'supporting', purpose: 'Explain' },
  ] })
  assertEquals((legacy.pages as Array<Record<string, unknown>>)[0].page_key, 'legacy:about')
})

Deno.test('B03a rejects normalized duplicate paths, duplicate order and all ancestor cycles', () => {
  const page = (page_key: string, slug: string, parent_page_key: string | null, position: number) => ({
    page_key, slug, title: slug, parent_page_key, position, page_type: 'supporting', purpose: 'Explain',
  })
  assertThrows(() => validateContentArtifact('website_architecture', { pages: [
    page('page:a', '/About//Team/', null, 1000), page('page:b', 'about/team', null, 2000),
  ] }), Error, 'unique after normalization')
  assertThrows(() => validateContentArtifact('website_architecture', { pages: [
    page('page:a', 'a', null, 1000), page('page:b', 'b', null, 1000),
  ] }), Error, 'positions must be unique')
  assertThrows(() => validateContentArtifact('website_architecture', { pages: [
    page('page:a', 'a', 'page:b', 1000), page('page:b', 'b', 'page:c', 2000), page('page:c', 'c', 'page:a', 3000),
  ] }), Error, 'ancestor cycle')
  assertThrows(() => validateContentArtifact('website_architecture', { pages: [
    page('page:a', 'a', 'page:a', 1000),
  ] }), Error, 'ancestor cycle')
})

Deno.test('B03a retains page identity across rename and rejects same-path key replacement', () => {
  const previous = { pages: [{ slug: 'home', title: 'Home', parent_slug: null, page_type: 'hub', purpose: 'Orient' }] }
  assertWebsitePageIdentityTransition(previous, [{
    page_key: 'legacy:home', slug: 'welcome', title: 'Welcome', parent_page_key: null, position: 1000, page_type: 'hub', purpose: 'Orient',
  }])
  assertThrows(() => assertWebsitePageIdentityTransition(previous, [{
    page_key: 'page:replacement', slug: 'home', title: 'Home', parent_page_key: null, position: 1000, page_type: 'hub', purpose: 'Orient',
  }]), Error, 'cannot be changed')
})

Deno.test('RP1 normalizes a mutable brief and compiles exact source context', () => {
  const brief = { id: 'brief-1', updated_at: '2026-08-31T00:00:00Z', target_market: 'Operators',
    price_tier: 'premium', operating_principles: ['Clarity'], competitor_references: ['Reference A'],
    raw_brief: 'Build trust before asking for action.' }
  assertEquals(brandBriefInput(brief).price_tier, 'premium')
  const statement = compiledBrandStatement(brief, { artifacts: {
    discovery: { artifact_version_id: 'discovery-v2', content: { evidence: ['Ten-year track record'] } },
    vision: { artifact_version_id: 'vision-v3', content: { positioning: 'The calm operator.', value_proposition: 'Complex work made clear.', values: ['Care'] } },
    audience: { artifact_version_id: 'audience-v4', content: { primary_audience: 'Leaders', desired_response: 'Book a workshop' } },
  } })
  assertEquals(statement.statement, 'The calm operator. Complex work made clear.')
  assertEquals((statement.source_manifest as Record<string, unknown>).brand_brief !== undefined, true)
})

Deno.test('brand statement cannot be generated through Department Chat', () => {
  assertThrows(() => contentArtifactResponseFormat('brand_statement'), Error, 'chat artifact')
})

Deno.test('chat response format is strict and type-specific', () => {
  const format = contentArtifactResponseFormat('content')
  assertEquals(format.type, 'json_schema')
  assertEquals(format.strict, true)
  assertEquals(format.schema.additionalProperties, false)
  assertEquals(format.schema.required, ['content_strategy', 'pages'])
})

Deno.test('D5 accepts typed Content definitions and preserves select options', () => {
  assertEquals(customFieldDefinitionInput({
    artifact_type: 'content', name: 'channel', field_type: 'single_select',
    options: ['blog', 'email'],
  }), {
    artifactType: 'content', name: 'channel', fieldType: 'single_select', options: ['blog', 'email'],
  })
})

Deno.test('D5 rejects invalid custom-field definitions before the database call', () => {
  assertThrows(() => customFieldDefinitionInput({
    artifact_type: 'content', name: 'channel', field_type: 'single_select',
    options: ['blog', 'blog'],
  }), Error, 'unique')
  assertThrows(() => customFieldDefinitionInput({
    artifact_type: 'campaign_brief', name: 'channel', field_type: 'text',
  }), Error, 'Content artifact type')
  assertThrows(() => customFieldDefinitionInput({
    artifact_type: 'content', name: 'keyword', field_type: 'text', options: ['unexpected'],
  }), Error, 'Only select')
})

function isolatedContentServerPath() {
  const writes: Record<string, Array<Record<string, unknown>>> = {}
  const tables: string[] = []
  const organizationId = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
  const artifactTypeReads: string[] = []
  const activeServices = [{ id: 'website-content-service', status: 'active', service_catalog: { slug: 'website_content', department_id: 'content' } }]
  const originalFetch = globalThis.fetch
  const originalEnvGet = Deno.env.get
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  Deno.env.get = (name: string) => ({
    SUPABASE_URL: 'https://isolated-content.example',
    SUPABASE_ANON_KEY: 'publishable',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  } as Record<string, string>)[name]
  globalThis.fetch = async (input: Request | URL | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/auth/v1/user') return json({ id: 'content-actor' })
    const table = decodeURIComponent(url.pathname.replace('/rest/v1/', ''))
    tables.push(table)
    const artifactType = url.searchParams.get('artifact_type')
    if (table === 'artifacts' && artifactType) artifactTypeReads.push(artifactType.replace(/^eq\./, ''))
    if (request.method === 'GET') {
      if (table === 'organization_memberships') {
        return json([{ organization_id: organizationId, role: 'contributor', department_id: 'content', status: 'active', member_kind: 'team' }])
      }
      if (table === 'engagements') {
        return json([{ id: 'content-engagement', organization_id: organizationId, brand_id: 'content-brand', name: 'Content only', status: 'active' }])
      }
      if (table === 'engagement_services') return json(activeServices)
      if (table === 'artifact_versions') return json([])
      return json([])
    }
    const value = await request.json() as Record<string, unknown>
    writes[table] = [...(writes[table] || []), value]
    if (table === 'artifacts') return json({ id: 'website-content-artifact', ...value }, 201)
    if (table === 'artifact_versions') return json({ id: 'website-content-version', ...value }, 201)
    return new Response(null, { status: 201 })
  }
  return {
    writes, tables, organizationId, artifactTypeReads, activeServices,
    restore() {
      globalThis.fetch = originalFetch
      Deno.env.get = originalEnvGet
    },
  }
}

function organizationBoundaryPath(options: {
  rows?: Record<string, Array<Record<string, unknown>>>,
  organizations?: Record<string, string>,
} = {}) {
  const calls: Array<{ client: string, table: string, method: string, body?: Record<string, unknown> }> = []
  const originalFetch = globalThis.fetch
  const originalEnvGet = Deno.env.get
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  Deno.env.get = (name: string) => ({
    SUPABASE_URL: 'https://content-boundary.example',
    SUPABASE_ANON_KEY: 'publishable',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  } as Record<string, string>)[name]
  globalThis.fetch = async (input: Request | URL | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/auth/v1/user') return json({ id: 'content-actor' })
    const table = decodeURIComponent(url.pathname.replace('/rest/v1/', ''))
    const client = request.headers.get('apikey') === 'secret' ? 'admin' : 'user'
    const body = request.method === 'GET' ? undefined : await request.json() as Record<string, unknown>
    calls.push({ client, table, method: request.method, body })
    if (request.method === 'GET') {
      let rows = [...(options.rows?.[table] || [])]
      for (const [column, raw] of url.searchParams.entries()) {
        if (!raw.startsWith('eq.')) continue
        const value = raw.slice(3)
        if (column === 'organization.status') {
          rows = rows.filter(row => options.organizations?.[String(row.organization_id)] === value)
        } else rows = rows.filter(row => String(row[column] ?? '') === value)
      }
      return json(rows)
    }
    if (table === 'rpc/action_content_queue_entry') return json({ request: { id: 'request-b' } })
    if (table === 'artifact_approvals') return json({ id: 'approval-b', ...body }, 201)
    return json(body || {}, 201)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
      Deno.env.get = originalEnvGet
    },
  }
}

function boundaryRequest(body: Record<string, unknown>) {
  return new Request('https://functions.example/content-studio', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

Deno.test('Gate 0 rootless Content actions require explicit active team organization before side effects', async () => {
  for (const scenario of [
    { name: 'missing selection', organization_id: undefined, memberships: [] },
    { name: 'inactive or revoked membership', organization_id: 'org-b', memberships: [] },
    { name: 'client-only membership', organization_id: 'org-b', memberships: [{
      organization_id: 'org-b', user_id: 'content-actor', role: 'client_viewer',
      department_id: null, status: 'active', member_kind: 'client',
    }] },
  ]) {
    const path = organizationBoundaryPath({
      rows: { organization_memberships: scenario.memberships },
      organizations: { 'org-b': 'active' },
    })
    try {
      const response = await handleRequest(boundaryRequest({
        action: 'create_content_request', organization_id: scenario.organization_id,
        mode: 'general', output_path: 'internal_engine', format: 'reel', brief: scenario.name,
      }))
      assertEquals(response.status, scenario.organization_id ? 403 : 400)
      assertEquals(path.calls.some(call => call.client === 'admin'), false)
      assertEquals(path.calls.some(call => call.method !== 'GET'), false)
    } finally { path.restore() }
  }
})

Deno.test('Gate 0 queue actions derive organization B and reject requested A before RPC or admin access', async () => {
  const rows = {
    content_queue_entries: [{ id: 'same-shaped-queue', organization_id: 'org-b', brand_id: 'brand-b' }],
    organization_memberships: [{
      organization_id: 'org-b', user_id: 'content-actor', role: 'contributor',
      department_id: 'content', status: 'active', member_kind: 'team',
    }],
  }
  const accepted = organizationBoundaryPath({ rows, organizations: { 'org-b': 'active' } })
  try {
    const response = await handleRequest(boundaryRequest({
      action: 'action_queue_entry', organization_id: 'org-b',
      queue_entry_id: 'same-shaped-queue', output_path: 'internal_engine',
    }))
    assertEquals(response.status, 200)
    const rpc = accepted.calls.find(call => call.table === 'rpc/action_content_queue_entry')
    assertEquals(rpc?.body?.p_organization_id, 'org-b')
  } finally { accepted.restore() }

  const mismatched = organizationBoundaryPath({ rows, organizations: { 'org-b': 'active' } })
  try {
    const response = await handleRequest(boundaryRequest({
      action: 'skip_queue_entry', organization_id: 'org-a', queue_entry_id: 'same-shaped-queue',
    }))
    assertEquals(response.status, 403)
    assertEquals(mismatched.calls.some(call => call.client === 'admin'), false)
    assertEquals(mismatched.calls.some(call => call.table.startsWith('rpc/')), false)
  } finally { mismatched.restore() }
})

Deno.test('Gate 0 unreadable queue and artifact-version roots fail before privileged access', async () => {
  for (const body of [
    { action: 'skip_queue_entry', organization_id: 'org-b', queue_entry_id: 'foreign-queue' },
    { action: 'approve_artifact', organization_id: 'org-b', artifact_version_id: 'foreign-version' },
  ]) {
    const path = organizationBoundaryPath({
      rows: { organization_memberships: [{
        organization_id: 'org-b', user_id: 'content-actor', role: 'department_manager',
        department_id: 'content', status: 'active', member_kind: 'team',
      }] },
      organizations: { 'org-b': 'active' },
    })
    try {
      const response = await handleRequest(boundaryRequest(body))
      assertEquals(response.status, 404)
      assertEquals(path.calls.some(call => call.client === 'admin'), false)
      assertEquals(path.calls.some(call => call.method !== 'GET'), false)
    } finally { path.restore() }
  }
})

Deno.test('Gate 0 version-rooted custom values reject foreign field definitions before RPC', async () => {
  const path = organizationBoundaryPath({
    rows: {
      artifact_versions: [{
        id: 'version-b', organization_id: 'org-b', artifact_id: 'artifact-b',
        artifact: { id: 'artifact-b', organization_id: 'org-b', project_id: 'project-b',
          engagement_id: 'engagement-b', brand_id: 'brand-b', artifact_type: 'content' },
      }],
      organization_memberships: [{
        organization_id: 'org-b', user_id: 'content-actor', role: 'contributor',
        department_id: 'content', status: 'active', member_kind: 'team',
      }],
      artifact_custom_field_defs: [{
        id: 'field-a', organization_id: 'org-a', artifact_type: 'content',
      }],
    },
    organizations: { 'org-b': 'active' },
  })
  try {
    const response = await handleRequest(boundaryRequest({
      action: 'save_custom_field_value', organization_id: 'org-b',
      artifact_version_id: 'version-b', field_def_id: 'field-a', value: 'blocked',
    }))
    assertEquals(response.status, 404)
    assertEquals(path.calls.some(call => call.table === 'rpc/save_artifact_custom_field_value'), false)
    assertEquals(path.calls.some(call => ['provider', 'storage'].some(name => call.table.includes(name))), false)
  } finally { path.restore() }
})

Deno.test('UW4 Content saves website content with only its active service and no upstream artifacts', async () => {
  const path = isolatedContentServerPath()
  try {
    const request = new Request('https://functions.example/content-studio', {
      method: 'POST',
      headers: { Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_artifact', engagement_id: 'content-engagement', artifact_type: 'content',
        title: 'Website content', change_summary: 'Initial isolated-service website content.',
        data_classification: 'internal', ai_use_allowed: false,
        content: {
          content_strategy: 'Explain the service clearly and invite a consultation.',
          pages: [{
            page_path: '/', page_brief: 'Homepage value proposition.', draft_copy: 'Clear expertise for complex work.',
            meta_title: 'Content only engagement', meta_description: 'A standalone Content service.', primary_cta: 'Book a consultation',
          }],
        },
      }),
    })
    const response = await handleRequest(request)
    const body = await response.json() as { data?: { artifact_id?: string } }
    assertEquals(response.status, 200)
    assertEquals(body.data?.artifact_id, 'website-content-artifact')
    assertEquals(path.writes.artifacts?.[0]?.artifact_type, 'content')
    assertEquals(path.writes.artifacts?.[0]?.brand_id, 'content-brand')
    assertEquals(path.writes.artifact_versions?.length, 1)
    assertEquals(path.writes.engagement_events?.length, 1)
    assertEquals(path.writes.engagement_events?.[0]?.organization_id, path.organizationId)
    assertEquals(path.tables.includes('brand_briefs'), false)
    assertEquals(path.activeServices.length, 1)
    assertEquals(path.activeServices[0].service_catalog.slug, 'website_content')
    for (const artifactType of ['brand_statement', 'discovery', 'vision', 'audience']) {
      assertEquals(path.artifactTypeReads.includes(artifactType), false)
    }
    assertEquals(path.tables.includes('artifact_approvals'), false)
  } finally {
    path.restore()
  }
})
