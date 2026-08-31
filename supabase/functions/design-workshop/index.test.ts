import { directionSchema, directionsAreDistinct, generateOpenAiImage, hasWorkshopAuthority, mediaPrompt,
  mediaStoragePath, sha256, similarity, VIDEO_UNAVAILABLE_MESSAGE } from './index.ts'
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
})

Deno.test('OpenAI image adapter uses the registered model and decodes the returned image', async () => {
  let requestBody: Record<string, unknown> = {}
  const bytes = await generateOpenAiImage('secret', 'registered-image-model', 'Create a key visual', async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'))
    return new Response(JSON.stringify({ data: [{ b64_json: btoa('png') }] }), { status: 200 })
  })
  assert.equal(requestBody.model, 'registered-image-model')
  assert.equal(requestBody.prompt, 'Create a key visual')
  assert.equal(new TextDecoder().decode(bytes), 'png')
})

Deno.test('video placeholder is explicit and signing is available to invited reviewers', () => {
  assert.equal(VIDEO_UNAVAILABLE_MESSAGE,
    'Video generation is not yet configured. An API key and provider need to be added before this works.')
  assert.equal(hasWorkshopAuthority({ role: 'contributor', department_id: 'marketing' }, 'sign_media_assets'), true)
})
