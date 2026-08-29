import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { customFieldDefinitionInput, hasContentAuthority } from './index.ts'
import { CONTENT_ARTIFACT_TYPES, contentArtifactResponseFormat, validateContentArtifact } from '../_shared/contentArtifacts.ts'

Deno.test('Content authority keeps exact-version approval manager-controlled', () => {
  assertEquals(hasContentAuthority({ role: 'contributor', department_id: 'content' }, 'save_artifact'), true)
  assertEquals(hasContentAuthority({ role: 'contributor', department_id: 'content' }, 'approve_artifact'), false)
  assertEquals(hasContentAuthority({ role: 'department_manager', department_id: 'content' }, 'approve_artifact'), true)
  assertEquals(hasContentAuthority({ role: 'executive', department_id: null }, 'approve_artifact'), true)
})

Deno.test('all eight Content artifacts use strict structured validation', () => {
  assertEquals(CONTENT_ARTIFACT_TYPES.length, 8)
  const architecture = validateContentArtifact('website_architecture', {
    site_goal: 'Explain and convert', navigation_principles: ['Clear paths'],
    pages: [{ page_name: 'Home', path: '/', page_goal: 'Orient', primary_audience: 'Buyer', primary_cta: 'Book' }],
  })
  assertEquals((architecture.pages as Array<Record<string, unknown>>)[0].path, '/')
  const keywords = validateContentArtifact('keyword_strategy', {
    strategy_summary: 'Map intent to pages', measurement_notes: ['Review quarterly'],
    page_keywords: [{ page_path: '/', service_keywords: ['strategy'], search_demand_keywords: ['agency'], brand_identity_keywords: ['Anka'] }],
  })
  assertEquals((keywords.page_keywords as Array<Record<string, unknown>>)[0].service_keywords, ['strategy'])
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
