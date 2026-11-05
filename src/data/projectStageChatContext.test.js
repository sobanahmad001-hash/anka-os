import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectProjectStageContext, createProjectStageChatContextAdapter, createRepositoryProjectStageChatContextAdapter } from './projectStageChatContext.js'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture() {
  const scope = { organization_id: id(1), project_id: id(2), engagement_id: id(3) }
  const selected = { ...scope, version: 1, plan_id: id(4), group_id: id(5), phase: 'website.content', partition: { kind: 'website_page', id: id(6), architecture_version_id: id(7) }, context_sha256: 'a'.repeat(64) }
  const header = { ...scope, state: 'available', plan_id: id(4), groups: [{ id: id(5), publication_id: id(8), steps: [{ key: 'draft' }] }], bindings: [{ group_id: id(5), publication_id: id(8), phase: 'website.content', step_key: 'draft' }] }
  const unit = { ...structuredClone(selected), state: 'current', steps: [{ key: 'draft', phase: 'website.content', items: [{ instance: 1, work_item_id: id(9), work_status: 'done', output_approved: true, material_current: true, needs_update: false,
    output: { artifact_id: id(10), artifact_version_id: id(11), version_number: 1, content_checksum: 'b'.repeat(64), approval_id: id(12), ai_use_allowed: false, body: 'private body' } }] }] }
  return { scope, selected, header, unit }
}
test('selected metadata is bounded and inspectable; bodies/attachment consent are never transferred', () => {
  const f = fixture(), before = structuredClone(f)
  const result = inspectProjectStageContext(f.selected, f.scope, f.header, f.unit, { versionIds: [id(11)] })
  assert.equal(result.outputs[0].artifact_version_id, id(11))
  assert.equal(result.outputs[0].approval_id, id(12))
  assert.equal(result.outputs[0].ai_use_allowed, false)
  assert.equal(result.body_included, false)
  assert.equal(result.attachments_included, false)
  assert.equal(JSON.stringify(result).includes('private body'), false)
  assert.deepEqual(f, before)
  assert.equal(inspectProjectStageContext(f.selected, f.scope, f.header, f.unit).outputs.length, 0)
})

test('selected output rejects malformed, missing approved or conflicting exact approval evidence', () => {
  for (const change of [f => f.unit.steps[0].items[0].output.approval_id = 'foreign-invalid',
    f => f.unit.steps[0].items[0].output.approval_id = null,
    f => { const other = structuredClone(f.unit.steps[0].items[0]); other.instance = 2; other.output.approval_id = id(20); f.unit.steps[0].items.push(other) }]) {
    const f = fixture(); change(f)
    assert.throws(() => inspectProjectStageContext(f.selected, f.scope, f.header, f.unit, { versionIds: [id(11)] }))
  }
})

test('unapproved exact selected output retains null approval for review', () => {
  const f = fixture(), item = f.unit.steps[0].items[0]
  item.output_approved = false
  item.output.approval_id = null
  const result = inspectProjectStageContext(f.selected, f.scope, f.header, f.unit, { versionIds: [id(11)] })
  assert.equal(result.outputs[0].approval_id, null)
  assert.equal(result.outputs[0].approved, false)
})
test('scope, material checksum, page architecture and configured binding changes fail closed', () => {
  for (const change of [f => f.scope.project_id = id(20), f => f.header.plan_id = id(20), f => f.unit.context_sha256 = 'c'.repeat(64),
    f => f.unit.partition.architecture_version_id = id(20), f => f.unit.state = 'stale', f => f.header.bindings = [],
    f => f.unit.steps = [], f => f.unit.steps[0].items = Array(51).fill({})]) {
    const f = fixture(); change(f)
    assert.throws(() => inspectProjectStageContext(f.selected, f.scope, f.header, f.unit))
  }
  const f = fixture()
  assert.throws(() => inspectProjectStageContext(f.selected, f.scope, f.header, f.unit, { versionIds: [id(20)] }))
})
test('before Send re-reads exact current header and partition while preserving human text separately', async () => {
  const f = fixture(), calls = []
  const adapter = createProjectStageChatContextAdapter({ readHeader: async scope => { calls.push(scope); return f.header }, readPartition: async (scope, selection) => { calls.push(selection); return f.unit } })
  const result = await adapter.beforeSend({ ...f, text: '  Review homepage\nwithout edits  ', versionIds: [id(11)] })
  assert.equal(result.text, '  Review homepage\nwithout edits  ')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], { plan_id: id(4), group_id: id(5), partition: f.selected.partition })
  f.unit.context_sha256 = 'c'.repeat(64)
  await assert.rejects(adapter.beforeSend({ ...f, text: 'Review' }), /changed/)
})
test('abort during context refresh prevents a send envelope and never dispatches or retries', async () => {
  const f = fixture(), controller = new AbortController()
  let reads = 0
  const adapter = createProjectStageChatContextAdapter({ readHeader: async () => { controller.abort(); return f.header }, readPartition: async () => { reads++; return f.unit } })
  await assert.rejects(adapter.beforeSend({ ...f, text: 'Review' }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(reads, 0)
})

test('canonical repository bridge preserves camel scope, exact selection, timeout and abort options', async () => {
  const f = fixture(), calls = [], signal = new AbortController().signal
  const scope = { organizationId: f.scope.organization_id, projectId: f.scope.project_id, engagementId: f.scope.engagement_id }
  const adapter = createRepositoryProjectStageChatContextAdapter({
    read: async (...args) => { calls.push(args); return f.header },
    refreshSelection: async (...args) => { calls.push(args); return f.unit },
  })
  const result = await adapter.beforeSend({ text: 'Review homepage', scope, selected: f.selected, versionIds: [id(11)] }, { signal, timeoutMs: 5000 })
  assert.deepEqual(calls[0], [scope, { signal, timeoutMs: 5000 }])
  assert.deepEqual(calls[1], [scope, f.selected, { signal, timeoutMs: 5000 }])
  assert.equal(result.stage.outputs[0].artifact_version_id, id(11))
})

test('repository unknown/timeout failures propagate without changing original request or draft', async () => {
  const f = fixture(), input = { text: '  Keep my draft  ', scope: { organizationId: f.scope.organization_id, projectId: f.scope.project_id, engagementId: f.scope.engagement_id }, selected: f.selected }
  const before = structuredClone(input), failure = Object.assign(new Error('read timed out'), { code: 'PROJECT_STAGE_READ_TIMEOUT' })
  let reads = 0
  const adapter = createRepositoryProjectStageChatContextAdapter({ read: async () => f.header, refreshSelection: async () => { reads++; throw failure } })
  await assert.rejects(adapter.beforeSend(input), error => error === failure)
  assert.deepEqual(input, before)
  assert.equal(reads, 1)
})
