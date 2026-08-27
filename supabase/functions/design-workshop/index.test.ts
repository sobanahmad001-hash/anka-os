import { directionSchema, directionsAreDistinct, hasWorkshopAuthority, sha256, similarity, validateArtifactContent } from './index.ts'

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

Deno.test('artifact forms require the agreed structured human fields', () => {
  const discovery = validateArtifactContent('discovery', {
    summary: 'A clear starting point', objectives: ['Grow trust'], offers: ['Strategy'],
    evidence: ['Interview evidence'], constraints: ['Keep the current name'],
  })
  assert.equal(discovery.summary, 'A clear starting point')
  assert.throws(() => validateArtifactContent('vision', { vision_statement: 'Only one field' }))
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

Deno.test('artifact approval and design release preserve accountable human authority', () => {
  assert.equal(hasWorkshopAuthority({ role: 'member', department_id: 'content' }, 'save_artifact'), true)
  assert.equal(hasWorkshopAuthority({ role: 'member', department_id: 'content' }, 'approve_artifact'), false)
  assert.equal(hasWorkshopAuthority({ role: 'department_manager', department_id: 'content' }, 'approve_artifact'), true)
  assert.equal(hasWorkshopAuthority({ role: 'member', department_id: 'design' }, 'release_direction'), false)
  assert.equal(hasWorkshopAuthority({ role: 'department_manager', department_id: 'design' }, 'release_direction'), true)
})
