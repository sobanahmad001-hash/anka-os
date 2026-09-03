import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const edge = read('supabase/functions/design-workshop/index.ts')
const ui = read('src/apps/DesignWorkshop.jsx')
const repository = read('src/data/designWorkshopRepository.js')

test('DS4 reuses direction slots as an ordered connected storyboard sequence', () => {
  assert.match(edge, /output_family, 80\) === 'video_motion'/)
  assert.match(edge, /sequence_mode: 'storyboard', frame_order: slot, frame_count: LANES\.length/)
  assert.match(edge, /direction_slot: index \+ 1/)
  assert.match(edge, /Continue directly from the prior frame content/)
  assert.match(edge, /JSON\.stringify\(priorFrames\)/)
  assert.match(edge, /const duplicate = !storyboard &&/)
  assert.match(edge, /if \(!storyboard && !directionsAreDistinct/)
})

test('DS4 renders storyboard frames as a filmstrip while leaving comparison copy available', () => {
  assert.match(ui, /serviceCatalog\(activeService\)\?\.slug === 'video_concepts_storyboards'/)
  assert.match(ui, /aria-label=\{storyboard \? 'Storyboard sequence' : 'Design direction comparison'\}/)
  assert.match(ui, /grid-flow-col[\s\S]*overflow-x-auto/)
  assert.match(ui, /\{storyboard \? 'Frame' : 'Direction'\}/)
  assert.match(ui, /Generate storyboard sequence/)
  assert.match(ui, /Generate three directions/)
})

test('DS4 reuses per-frame proofing and session release without adding video generation', () => {
  assert.match(ui, /Click the \{storyboard \? 'frame' : 'direction'\} preview to anchor a positional comment/)
  assert.match(ui, /VersionProofingPanel targetKind="design_direction"/)
  assert.match(ui, /Release whole storyboard sequence/)
  assert.match(repository, /releaseDirection: \(sessionId, releaseNotes = ''\) => invoke\('release_direction'/)
  assert.doesNotMatch(edge, /api\.openai\.com\/v1\/videos|animatic playback|timed preview/i)
  assert.match(ui, /allowVideo=\{!storyboard\}/)
})

test('DS4 leaves DS3 flow fields and the non-storyboard path present', () => {
  assert.match(edge, /const pageFlowId = text\(body\.flow_id, 80\) \|\| null/)
  assert.match(edge, /sessionValues\.page_flow_id = pageFlowId; sessionValues\.page_slug = pageSlug/)
  assert.match(edge, /MANDATORY DIRECTION LANE/)
  assert.match(edge, /Existing directions that this output must be materially different from/)
})
