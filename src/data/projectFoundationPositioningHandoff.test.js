import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectFoundationPositioningHandoff } from './projectFoundationPositioningHandoff.js'
const id = n => `ee000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { organization_id: id(1), project_id: id(2), engagement_id: id(3), actor_id: id(4), conversation_id: id(5) }
const binding = { request_id: id(6), checkpoint_id: id(7), source_version: 2, brief_sha256: 'a'.repeat(64) }
const text = 'Public business summary.\nExact reviewed audience.\nUnselected private-like detail.'
function fixture() {
  const data = { ...scope, current_binding: binding, options: [{ checkpoint_id: binding.checkpoint_id, source_version: 2 }], has_more: false, selected: { checkpoint_id: binding.checkpoint_id, source_version: 2, brief_sha256: binding.brief_sha256, brief_text: text, matches_current_brief: true } }
  const calls = [], client = { rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data }) } }
  return { data, calls, api: createProjectFoundationPositioningHandoff(client) }
}
test('exact bound checkpoint selection stages only reviewed text and preserves existing draft without sends', async () => {
  const f = fixture(), r = await f.api.review(scope, binding), start = text.indexOf('Exact'), end = text.indexOf('\nUnselected')
  const result = await f.api.stage(r, { start, end }, 'Keep my existing draft', scope)
  assert.ok(result.text.startsWith('Keep my existing draft\n\nContinue with brand positioning'))
  assert.ok(result.text.includes('Exact reviewed audience.')); assert.doesNotMatch(result.text, /Public business summary|Unselected private-like/)
  assert.ok(Object.isFrozen(result.handoff.binding))
  assert.equal((await f.api.beforeSend({ text: result.text, handoff: result.handoff, scope })).text, result.text)
  assert.ok(f.calls.every(c => c.name === 'read_project_foundation_brief'))
  assert.deepEqual(f.calls[0].args, { p_organization_id: scope.organization_id, p_project_id: scope.project_id, p_engagement_id: scope.engagement_id, p_checkpoint_id: binding.checkpoint_id, p_offset: 0 })
  assert.equal(Object.hasOwn(result.handoff, 'project_stage_context'), false)
})
test('stale binding, source, current brief and foreign actor fail closed', async () => {
  for (const change of [f => f.data.current_binding = null, f => f.data.current_binding = { ...binding, request_id: id(99) }, f => f.data.selected.source_version++, f => f.data.selected.brief_sha256 = 'b'.repeat(64), f => f.data.selected.matches_current_brief = false, f => f.data.actor_id = id(99), f => f.data.project_id = id(99)]) {
    const f = fixture(); change(f)
    await assert.rejects(f.api.review(scope, binding))
  }
})
test('binding drift at explicit disclosure and at Send keeps original draft and identity', async () => {
  const f = fixture(), r = await f.api.review(scope, binding)
  f.data.selected.matches_current_brief = false
  await assert.rejects(f.api.stage(r, { start: 0, end: 10 }, 'Original draft', scope), /no longer matches/)
  f.data.selected.matches_current_brief = true
  const staged = await f.api.stage(r, { start: 0, end: 10 }, 'Original draft', scope)
  f.data.current_binding = { ...binding, source_version: 3 }
  await assert.rejects(f.api.beforeSend({ text: staged.text, handoff: staged.handoff, scope }), /binding changed/)
  assert.ok(staged.text.startsWith('Original draft'))
})
test('pending recovery, changed conversation and oversized draft prevent staging', async () => {
  const f = fixture(), r = await f.api.review(scope, binding)
  await assert.rejects(f.api.stage(r, { start: 0, end: 10 }, 'Original', scope, { pending: true }), /recovery/)
  await assert.rejects(f.api.stage(r, { start: 0, end: 10 }, 'Original', { ...scope, conversation_id: id(99) }), /conversation changed/)
  await assert.rejects(f.api.stage(r, { start: 0, end: 10 }, 'x'.repeat(7990), scope), /shorten/)
})
test('edited selected passage and tampered handoff cannot silently send as verified source', async () => {
  const f = fixture(), r = await f.api.review(scope, binding), staged = await f.api.stage(r, { start: 0, end: 10 }, '', scope)
  await assert.rejects(f.api.beforeSend({ text: staged.text.replace(staged.handoff.selected_text, 'Substituted'), handoff: staged.handoff, scope }), /edited/)
  const changed = structuredClone(staged.handoff); changed.selected_text = 'Other'
  await assert.rejects(f.api.beforeSend({ text: staged.text, handoff: changed, scope }), /handoff.*changed/)
})
test('valid long existing brief permits a short selected passage beyond 64k without widening disclosure limits', async () => {
  const f = fixture(), prefix = 'x'.repeat(110000), passage = 'Exact later positioning passage.'
  f.data.selected.brief_text = prefix + passage + 'UNSELECTED_TAIL'
  const r = await f.api.review(scope, binding)
  const staged = await f.api.stage(r, { start: prefix.length, end: prefix.length + passage.length }, 'Original draft', scope)
  assert.equal(staged.handoff.selected_text, passage)
  assert.doesNotMatch(staged.text, /xxx|UNSELECTED_TAIL/)
  assert.ok(staged.text.startsWith('Original draft'))
  assert.equal((await f.api.beforeSend({ text: staged.text, handoff: staged.handoff, scope })).text, staged.text)
  await assert.rejects(f.api.stage(r, { start: 70000, end: 73001 }, '', scope), /3000/)
  await assert.rejects(f.api.stage(r, { start: prefix.length, end: prefix.length + passage.length }, 'x'.repeat(7990), scope), /shorten/)
})
