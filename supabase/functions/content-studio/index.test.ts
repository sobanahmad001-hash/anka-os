import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { brandBriefInput, compiledBrandStatement, contentStudioScope, customFieldDefinitionInput, handleRequest, hasContentAuthority, requireBrandBriefMutationToken,
  figmaHandoffUrl, validateContentRequestInput, validateQueueEntryInput } from './index.ts'

import { CHAT_CONTENT_ARTIFACT_TYPE_SET, CONTENT_ARTIFACT_TYPES, contentArtifactResponseFormat, validateContentArtifact, withGeneratedSourceMetadata } from '../_shared/contentArtifacts.ts'

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
