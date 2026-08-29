import { directionSchema, directionsAreDistinct, generateOpenAiImage, hasWorkshopAuthority, mediaPrompt,
  mediaStoragePath, sha256, similarity, VIDEO_UNAVAILABLE_MESSAGE } from './index.ts'

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
