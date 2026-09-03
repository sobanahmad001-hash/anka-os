import { contentRequestMediaStoragePath, createSession, cropResizePng, designEventLink, directionSchema,
  directionGenerationPrompt, directionsAreDistinct, generateOpenAiImage, hasWorkshopAuthority, isStoryboardSession, mediaPrompt, mediaStoragePath,
  mediaTargetColumns, outputFamilyForService, pngDimensions, requireActiveDesignService,
  requireReleasedVariantSource, runIndependentVariantJobs, sha256, similarity, variantFormatSpec, variantPrompt,
  VIDEO_UNAVAILABLE_MESSAGE } from './index.ts'
import { compileApprovedArtifactContext } from '../_shared/approvedArtifactContext.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

assert.equal = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

assert.throws = (callback: () => unknown) => {
  try { callback() } catch { return }
  throw new Error('Expected callback to throw')
}

Deno.test('Content members cannot call Design Workshop actions after authoring relocation', () => {
  assert.equal(hasWorkshopAuthority({ role: 'member', department_id: 'content' }, 'create_session'), false)
  assert.equal(hasWorkshopAuthority({ role: 'department_manager', department_id: 'content' }, 'generate_directions'), false)
})

Deno.test('all eight Design services derive a compatible display family', () => {
  const expected = {
    brand_visual_identity: 'brand_identity', design_systems: 'brand_identity',
    website_ux_ui: 'website_design', campaign_creative: 'marketing_asset',
    social_assets: 'marketing_asset', advertising_assets: 'marketing_asset',
    video_concepts_storyboards: 'video_motion', visual_production: 'marketing_asset',
  }
  for (const [slug, family] of Object.entries(expected)) assert.equal(outputFamilyForService(slug), family)
  assert.throws(() => outputFamilyForService('content_strategy'))
})

Deno.test('storyboard mode is isolated to the storyboard service family', () => {
  assert.equal(isStoryboardSession({ output_family: 'video_motion' }), true)
  assert.equal(isStoryboardSession({ output_family: 'marketing_asset' }, 'video_concepts_storyboards'), true)
  for (const outputFamily of ['brand_identity', 'website_design', 'marketing_asset']) {
    assert.equal(isStoryboardSession({ output_family: outputFamily }), false)
  }
})

Deno.test('storyboard prompts carry exact prior-frame narrative context while comparisons stay distinct', () => {
  const first = directionGenerationPrompt(true, 1, 3, [], 'unused comparison lane')
  assert(first.instructions.includes('connected static sequence'))
  assert(first.context.includes('1 of 3'))
  assert(first.context.includes('Establish the opening frame'))
  assert(!first.context.includes('materially different'))

  const prior = { title: 'Arrival', creative_thesis: 'The courier enters the rain-lit city', palette: [{ name: 'Neon', hex: '#7c3aed' }] }
  const second = directionGenerationPrompt(true, 2, 3, [prior], 'unused comparison lane')
  assert(second.context.includes('Continue directly from the prior frame content'))
  assert(second.context.includes('"frame_order":1'))
  assert(second.context.includes('The courier enters the rain-lit city'))
  assert(second.context.includes('Do not restart or propose an alternative concept'))

  const comparison = directionGenerationPrompt(false, 2, 3, [prior], 'Pragmatic comparison lane')
  assert(comparison.context.includes('MANDATORY DIRECTION LANE'))
  assert(comparison.context.includes('materially different'))
  assert(!comparison.context.includes('STORYBOARD SEQUENCE'))
})

Deno.test('session service validation accepts active Design service and rejects inactive service', async () => {
  class Query {
    constructor(private row: Record<string, unknown> | null) {}
    select() { return this }
    eq() { return this }
    async maybeSingle() { return { data: this.row, error: null } }
  }
  const active = {
    id: 'active-service', engagement_id: 'engagement-1', status: 'active',
    service_catalog: { slug: 'brand_visual_identity', department_id: 'design', is_active: true },
  }
  const accepted = await requireActiveDesignService({ from: () => new Query(active) } as never, 'engagement-1', 'active-service')
  assert.equal(accepted.outputFamily, 'brand_identity')

  const inactive = { ...active, id: 'inactive-service', status: 'planned' }
  let rejected = false
  try {
    await requireActiveDesignService({ from: () => new Query(inactive) } as never, 'engagement-1', 'inactive-service')
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('not active')
  }
  assert(rejected, 'Expected inactive engagement service to be rejected')
})

Deno.test('session creation combines active service enforcement with optional event linking without regressing core families', async () => {
  const inserted: Record<string, unknown[]> = {}
  const artifacts = ['discovery', 'vision', 'audience'].map(type => ({
    id: `${type}-artifact`, organization_id: 'org-1', engagement_id: 'engagement-1',
    brand_id: 'brand-1', artifact_type: type,
  }))
  const approvals = artifacts.map((artifact, index) => ({
    id: `${artifact.artifact_type}-approval`, artifact_id: artifact.id,
    artifact_version_id: `${artifact.artifact_type}-version`, approved_at: `2026-08-3${index + 1}T00:00:00Z`,
  }))
  const versions = artifacts.map(artifact => ({
    id: `${artifact.artifact_type}-version`, version_number: 1,
    content_checksum: `${artifact.artifact_type}-checksum`, content: { approved: artifact.artifact_type },
    ai_use_allowed: true, data_classification: 'internal',
  }))

  class Query {
    private insertedValue: unknown = null
    constructor(private table: string, private fixtures: Record<string, unknown[]>) {}
    select() { return this }
    eq() { return this }
    in() { return this }
    order() { return this }
    delete() { return this }
    insert(value: unknown) {
      this.insertedValue = value
      inserted[this.table] = [...(inserted[this.table] || []), value]
      return this
    }
    async maybeSingle() { return { data: this.fixtures[this.table]?.[0] || null, error: null } }
    async single() {
      const value = this.insertedValue as Record<string, unknown>
      return { data: { ...value, id: value.id || 'generated-session' }, error: null }
    }
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(resolve({ data: this.insertedValue ? this.insertedValue : this.fixtures[this.table] || [], error: null }))
    }
  }

  for (const [serviceSlug, expectedFamily, externalEventId] of [
    ['brand_visual_identity', 'brand_identity', 'event-1'],
    ['campaign_creative', 'marketing_asset', null],
  ] as const) {
    const fixtures: Record<string, unknown[]> = {
      engagements: [{ id: 'engagement-1', brand_id: 'brand-1', engagement_type: 'project' }],
      external_events: externalEventId ? [{ id: externalEventId }] : [],
      engagement_services: [{
        id: `${serviceSlug}-engagement-service`, engagement_id: 'engagement-1', status: 'active',
        service_catalog: { slug: serviceSlug, department_id: 'design', is_active: true },
      }],
      design_model_registry: [{ id: 'model-1', is_active: true, supported_output_types: ['design_direction'] }],
      artifacts, artifact_approvals: approvals, artifact_versions: versions,
    }
    const admin = { from: (table: string) => new Query(table, fixtures) }
    const session = await createSession(admin as never, {
      engagement_id: 'engagement-1', brand_id: 'brand-1',
      engagement_service_id: `${serviceSlug}-engagement-service`,
      model_registry_ids: ['model-1'], output_brief: { goal: 'Combined regression test' },
      designer_instructions: 'Use approved context only.', instructions_safe_for_ai: true,
      external_event_id: externalEventId,
    }, 'actor-1')
    assert.equal(session.engagement_service_id, `${serviceSlug}-engagement-service`)
    assert.equal(session.output_family, expectedFamily)
  }

  const eventLinks = inserted.content_event_links || []
  assert.equal(eventLinks.length, 1)
  const linked = eventLinks[0] as Record<string, unknown>
  assert.equal(linked.external_event_id, 'event-1')
  assert.equal(linked.content_type, 'design_asset')
})

Deno.test('CP1 grants Content only its request-scoped media actions', () => {
  const member = { role: 'member', department_id: 'content' }
  assert.equal(hasWorkshopAuthority(member, 'generate_content_request_image'), true)
  assert.equal(hasWorkshopAuthority(member, 'create_content_request_video_placeholder'), true)
  assert.equal(hasWorkshopAuthority(member, 'generate_image'), false)
  assert.equal(hasWorkshopAuthority(member, 'create_session'), false)
})

Deno.test('direction schema is strict and includes traceable recommendation fields', () => {
  const format = directionSchema()
  assert.equal(format.type, 'json_schema')
  assert.equal(format.strict, true)
  assert(format.schema.required.includes('production_feasibility'))
  assert(format.schema.required.includes('preview_spec'))
})

Deno.test('distinctness gate rejects cosmetic duplicates', () => {
  const first = { title: 'Quiet confidence', rationale: 'Editorial clarity for a trusted brand', creative_thesis: 'Calm authority', visual_principles: ['space', 'clarity'], imagery_direction: 'documentary', layout_direction: 'editorial grid' }
  const duplicate = { ...first, title: 'Calm confidence' }
  const different = { title: 'Kinetic signal', rationale: 'Bold modular energy for rapid action', creative_thesis: 'Motion creates momentum', visual_principles: ['contrast', 'motion'], imagery_direction: 'abstract light trails', layout_direction: 'asymmetric modules' }
  assert(similarity(first, duplicate) >= 0.62)
  assert.equal(directionsAreDistinct([first, duplicate]), false)
  assert.equal(directionsAreDistinct([first, different]), true)
})

Deno.test('context and output checksums are stable', async () => {
  assert.equal(await sha256('approved-context'), await sha256('approved-context'))
  assert((await sha256('approved-context')).match(/^[a-f0-9]{64}$/))
})

Deno.test('shared compiler selects the latest approved exact version for every requested type', async () => {
  const fixtures: Record<string, Array<Record<string, unknown>>> = {
    artifacts: [
      { id: 'discovery-artifact', organization_id: 'org-1', brand_id: 'brand-1', artifact_type: 'discovery' },
      { id: 'vision-artifact', organization_id: 'org-1', brand_id: 'brand-1', artifact_type: 'vision' },
      { id: 'audience-artifact', organization_id: 'org-1', brand_id: 'brand-1', artifact_type: 'audience' },
    ],
    artifact_approvals: [
      { id: 'discovery-approval-2', artifact_id: 'discovery-artifact', artifact_version_id: 'discovery-v2', approved_at: '2026-08-31T03:00:00Z' },
      { id: 'vision-approval-3', artifact_id: 'vision-artifact', artifact_version_id: 'vision-v3', approved_at: '2026-08-31T02:00:00Z' },
      { id: 'audience-approval-4', artifact_id: 'audience-artifact', artifact_version_id: 'audience-v4', approved_at: '2026-08-31T01:00:00Z' },
      { id: 'discovery-approval-1', artifact_id: 'discovery-artifact', artifact_version_id: 'discovery-v1', approved_at: '2026-08-30T03:00:00Z' },
    ],
    artifact_versions: [
      { id: 'discovery-v1', version_number: 1, content_checksum: 'old', content: { summary: 'Old' }, ai_use_allowed: true, data_classification: 'internal' },
      { id: 'discovery-v2', version_number: 2, content_checksum: 'd2', content: { summary: 'Current' }, ai_use_allowed: true, data_classification: 'internal' },
      { id: 'vision-v3', version_number: 3, content_checksum: 'v3', content: { positioning: 'Position' }, ai_use_allowed: true, data_classification: 'internal' },
      { id: 'audience-v4', version_number: 4, content_checksum: 'a4', content: { primary_audience: 'Audience' }, ai_use_allowed: true, data_classification: 'internal' },
    ],
  }
  class Query {
    constructor(private rows: Array<Record<string, unknown>>) {}
    select() { return this }
    eq() { return this }
    in() { return this }
    order() { return this }
    then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: this.rows, error: null })) }
  }
  const admin = { from: (table: string) => new Query(fixtures[table] || []) }
  const result = await compileApprovedArtifactContext(admin, {
    organizationId: 'org-1', brandId: 'brand-1',
    artifactTypes: ['discovery', 'vision', 'audience'], requireAiSafe: true,
  })
  const artifacts = result.manifest.artifacts as Record<string, Record<string, unknown>>
  assert.equal(artifacts.discovery.artifact_version_id, 'discovery-v2')
  assert.equal(artifacts.vision.artifact_version_id, 'vision-v3')
  assert.equal(artifacts.audience.artifact_version_id, 'audience-v4')
  assert.equal(result.selected.length, 3)
})

Deno.test('design release preserves accountable human authority', () => {
  assert.equal(hasWorkshopAuthority({ role: 'member', department_id: 'design' }, 'release_direction'), false)
  assert.equal(hasWorkshopAuthority({ role: 'department_manager', department_id: 'design' }, 'release_direction'), true)
})

Deno.test('an invited cross-functional reviewer may request promotion but not Design authoring', () => {
  const reviewer = { role: 'contributor', department_id: 'marketing' }
  assert.equal(hasWorkshopAuthority(reviewer, 'promote_direction_experiment'), true)
  assert.equal(hasWorkshopAuthority(reviewer, 'list_experiment_reviewers'), true)
  assert.equal(hasWorkshopAuthority(reviewer, 'create_direction_revision'), false)
})

Deno.test('media defaults come from the exact direction version and storage stays version scoped', () => {
  assert.equal(mediaPrompt({ imagery_direction: 'Documentary portraits', creative_thesis: 'Human expertise, made visible' }, ''),
    'Documentary portraits\n\nHuman expertise, made visible')
  assert.equal(mediaPrompt({ imagery_direction: 'Ignored' }, 'Explicit campaign key visual'), 'Explicit campaign key visual')
  assert(mediaStoragePath('version-1', 'asset-1').endsWith('/version-1/asset-1.png'))
  assert.equal(mediaTargetColumns('version-1', null).design_direction_version_id, 'version-1')
  assert.equal('content_request_id' in mediaTargetColumns('version-1', null), false)
})

Deno.test('content-request media uses the same private bucket namespace with exactly one target', () => {
  assert(contentRequestMediaStoragePath('request-1', 'asset-1').endsWith('/content-requests/request-1/asset-1.png'))
  assert.equal(mediaTargetColumns(null, 'request-1').content_request_id, 'request-1')
  assert.throws(() => mediaTargetColumns(null, null))
  assert.throws(() => mediaTargetColumns('version-1', 'request-1'))
})

Deno.test('OpenAI image adapter uses the registered model and decodes the returned image', async () => {
  let requestBody: Record<string, unknown> = {}
  const bytes = await generateOpenAiImage('secret', 'registered-image-model', 'Create a key visual', async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'))
    return new Response(JSON.stringify({ data: [{ b64_json: btoa('png') }] }), { status: 200 })
  })
  assert.equal(requestBody.model, 'registered-image-model')
  assert.equal(requestBody.prompt, 'Create a key visual')
  assert.equal('size' in requestBody, false)
  assert.equal(new TextDecoder().decode(bytes), 'png')
})

Deno.test('variant formats use verified platform targets and supported provider canvases', () => {
  assert.equal(variantFormatSpec('square_1x1').providerSize, '1024x1024')
  assert.equal(variantFormatSpec('story_9x16').providerSize, '1024x1536')
  assert.equal(variantFormatSpec('landscape_1_91x1').providerSize, '1536x1024')
  assert.equal(variantFormatSpec('banner_728x90').width, 728)
  assert.equal(variantFormatSpec('banner_300x250').height, 250)
  assert.equal(variantFormatSpec('portrait_4x5').height, 1350)
  assert.throws(() => variantFormatSpec('landscape_16x9'))
  const prompt = variantPrompt({ imagery_direction: 'Human-led editorial photography', creative_thesis: 'Trusted guidance' }, 'banner_728x90')
  assert(prompt.includes('728x90px'))
  assert(prompt.includes('already-approved creative direction'))
})

Deno.test('OpenAI image adapter receives the variant provider canvas through the shared pipeline', async () => {
  let requestBody: Record<string, unknown> = {}
  await generateOpenAiImage('secret', 'registered-image-model', 'Adapt the released direction', '1024x1536', async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'))
    return new Response(JSON.stringify({ data: [{ b64_json: btoa('png') }] }), { status: 200 })
  })
  assert.equal(requestBody.size, '1024x1536')
})

Deno.test('variant image processing exports and verifies the exact declared PNG dimensions', async () => {
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
  const source = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
  const output = await cropResizePng(source, 728, 90)
  assert.equal(pngDimensions(output).width, 728)
  assert.equal(pngDimensions(output).height, 90)
})

Deno.test('variant source validation rejects drafts and non-variant services', async () => {
  class Query {
    constructor(private row: Record<string, unknown> | null) {}
    select() { return this }
    eq() { return this }
    async maybeSingle() { return { data: this.row, error: null } }
  }
  const userFixtures: Record<string, Record<string, unknown>> = {
    design_direction_versions: { id: 'version-1', direction_id: 'direction-1', content: { imagery_direction: 'Approved imagery' } },
    design_directions: { id: 'direction-1', session_id: 'session-1' },
    design_workshop_sessions: { id: 'session-1', engagement_id: 'engagement-1', engagement_service_id: 'service-1' },
  }
  const userClient = { from: (table: string) => new Query(userFixtures[table] || null) }
  const admin = (released: boolean, slug = 'social_assets') => ({ from: (table: string) => new Query(
    table === 'design_direction_releases' ? (released ? { id: 'release-1', direction_version_id: 'version-1' } : null)
      : table === 'engagement_services' ? { id: 'service-1', service_catalog: { slug } } : null,
  ) })

  let draftRejected = false
  try { await requireReleasedVariantSource(admin(false) as never, userClient as never, 'version-1') } catch (error) {
    draftRejected = error instanceof Error && error.message.includes('released direction version')
  }
  assert(draftRejected, 'Expected an unreleased source to be rejected')
  const accepted = await requireReleasedVariantSource(admin(true) as never, userClient as never, 'version-1')
  assert.equal(accepted.serviceSlug, 'social_assets')
  let serviceRejected = false
  try { await requireReleasedVariantSource(admin(true, 'brand_visual_identity') as never, userClient as never, 'version-1') } catch (error) {
    serviceRejected = error instanceof Error && error.message.includes('Social Assets and Advertising Assets')
  }
  assert(serviceRejected, 'Expected a non-variant Design service to be rejected')
})

Deno.test('one failed variant does not block sibling formats in the same request', async () => {
  const attempted: string[] = []
  const results = await runIndependentVariantJobs(['square_1x1', 'story_9x16', 'banner_300x250'], async format => {
    attempted.push(format)
    if (format === 'story_9x16') throw new Error('provider rejected only this format')
    return { variant_format: format, status: 'ready' }
  })
  assert.equal(attempted.length, 3)
  assert.equal((results[0] as Record<string, unknown>).status, 'ready')
  assert.equal((results[1] as Record<string, unknown>).status, 'failed')
  assert.equal((results[2] as Record<string, unknown>).status, 'ready')
})

Deno.test('video placeholder is explicit and signing is available to invited reviewers', () => {
  assert.equal(VIDEO_UNAVAILABLE_MESSAGE,
    'Video generation is not yet configured. An API key and provider need to be added before this works.')
  assert.equal(hasWorkshopAuthority({ role: 'contributor', department_id: 'marketing' }, 'sign_media_assets'), true)
})

Deno.test('event-linked sessions use one exact identity and keep ordinary sessions optional', () => {
  const link = designEventLink('session-1', 'event-1', 'actor-1')
  assert.equal(link.id, 'session-1')
  assert.equal(link.external_event_id, 'event-1')
  assert.equal(link.organization_id, '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25')
  assert.equal(link.content_type, 'design_asset')
  assert.equal(link.linked_work_item_id, null)
  assert.equal(link.status, 'in_progress')
})
