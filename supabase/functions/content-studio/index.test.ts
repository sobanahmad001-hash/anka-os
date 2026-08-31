import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { brandBriefInput, compiledBrandStatement, customFieldDefinitionInput, hasContentAuthority,
  validateContentRequestInput } from './index.ts'
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
