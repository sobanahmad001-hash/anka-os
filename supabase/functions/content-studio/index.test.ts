import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { brandBriefInput, compiledBrandStatement, customFieldDefinitionInput, handleRequest, hasContentAuthority,
  figmaHandoffUrl, validateContentRequestInput, validateQueueEntryInput } from './index.ts'

import { CHAT_CONTENT_ARTIFACT_TYPE_SET, CONTENT_ARTIFACT_TYPES, contentArtifactResponseFormat, validateContentArtifact } from '../_shared/contentArtifacts.ts'

Deno.test('Content authority keeps exact-version approval manager-controlled', () => {
  assertEquals(hasContentAuthority({ role: 'contributor', department_id: 'content' }, 'save_artifact'), true)
  assertEquals(hasContentAuthority({ role: 'contributor', department_id: 'content' }, 'approve_artifact'), false)
  assertEquals(hasContentAuthority({ role: 'department_manager', department_id: 'content' }, 'approve_artifact'), true)
  assertEquals(hasContentAuthority({ role: 'executive', department_id: null }, 'approve_artifact'), true)
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
  class Query {
    inserted: Record<string, unknown> | null = null
    constructor(private table: string) {}
    select() { return this }
    eq() { return this }
    order() { return this }
    limit() { return this }
    insert(value: Record<string, unknown>) {
      this.inserted = value
      writes[this.table] = [...(writes[this.table] || []), value]
      return this
    }
    async maybeSingle() {
      if (this.table === 'organization_memberships') {
        return { data: { organization_id: organizationId, role: 'contributor', department_id: 'content', status: 'active', member_kind: 'team' }, error: null }
      }
      if (this.table === 'engagements') {
        return { data: { id: 'content-engagement', organization_id: organizationId, brand_id: 'content-brand', name: 'Content only', status: 'active' }, error: null }
      }
      return { data: null, error: null }
    }
    async single() {
      const id = this.table === 'artifacts' ? 'website-content-artifact' : 'website-content-version'
      return { data: { id, ...this.inserted }, error: null }
    }
    then(resolve: (value: unknown) => unknown) {
      const data = this.table === 'engagement_services'
        ? [{ id: 'website-content-service', status: 'active', service_catalog: { slug: 'website_content', department_id: 'content' } }]
        : this.inserted ? [this.inserted] : []
      return Promise.resolve(resolve({ data, error: null }))
    }
  }
  const admin = { from: (table: string) => { tables.push(table); return new Query(table) } }
  let clientCount = 0
  const factory = () => clientCount++ === 0
    ? { auth: { getUser: async () => ({ data: { user: { id: 'content-actor' } }, error: null }) } }
    : admin
  return { factory: factory as never, writes, tables }
}

Deno.test('UW4 Content saves the website_content service artifact with no brand statement or upstream artifacts', async () => {
  const path = isolatedContentServerPath()
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
  const response = await handleRequest(request, {
    createClient: path.factory,
    environment: { supabaseUrl: 'https://project.supabase.co', publishableKey: 'publishable', secretKey: 'secret' },
  })
  const body = await response.json() as { data?: { artifact_id?: string } }
  assertEquals(response.status, 200)
  assertEquals(body.data?.artifact_id, 'website-content-artifact')
  assertEquals(path.writes.artifacts?.[0]?.artifact_type, 'content')
  assertEquals(path.writes.artifact_versions?.length, 1)
  assertEquals(path.writes.engagement_events?.length, 1)
  assertEquals(path.tables.includes('brand_briefs'), false)
  assertEquals(path.tables.includes('artifact_approvals'), false)
})
