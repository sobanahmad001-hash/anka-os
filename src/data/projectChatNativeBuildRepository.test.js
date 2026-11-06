import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectChatNativeBuildRepository } from './projectChatNativeBuildRepository.js'
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hash = 'a'.repeat(64)
function fixture() {
  const i = { organization_id: id(1), project_id: id(2), conversation_id: id(3), source_message_id: id(4), request_id: id(5) }
  const selection = { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: id(6), plan_id: id(7), group_id: id(8), phase: 'website.content', partition: { kind: 'website_page', id: id(9), architecture_version_id: id(10) }, context_sha256: hash }
  const c = { engagement_id: id(6), selection, design_request_id: id(11), design_id: id(12), page_id: id(9) }
  const origin = { ...i, request_id: c.design_request_id, source_message_id: id(13), version: 1, kind: 'save_native_design', status: 'design_draft_saved', engagement_id: c.engagement_id, actor_id: id(14), selection: { ...selection, context_sha256: 'b'.repeat(64) }, handoff_request_id: id(15), source_work: { id: id(16), row_version: 2 }, receiving_work: { id: id(17), row_version: 1 }, review_required: true, output: { kind: 'website_native_design', design_id: c.design_id, page_id: c.page_id, parent_design_id: null, version_number: 1, request_sha256: hash } }
  const r = { organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, design_id: c.design_id, page_id: c.page_id, manifest: { scope: { organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, page_id: c.page_id } }, stale_sources: [], delivery_approved: false, staging: false, published: false, review_sha256: hash, chat_review_sha256: 'c'.repeat(64), chat_context: { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, conversation_id: i.conversation_id, source_message_id: i.source_message_id, actor_id: origin.actor_id, context: structuredClone(c), origin_receipt: origin } }
  const receipt = { ...i, version: 1, kind: 'build_native_package', status: 'claimed', engagement_id: c.engagement_id, actor_id: origin.actor_id, selection: structuredClone(selection), origin_request_id: c.design_request_id, output: { kind: 'website_native_package', job_id: id(18), design_id: c.design_id, page_id: c.page_id } }
  const state = { kind: 'website_native_package', status: 'complete', original_status: 'complete', execution_window_expired: false, artifact_sha256: hash, source_sha256: 'd'.repeat(64), package_bytes: 120, source_bytes: 80, stale_sources: [], failure_reason: null }
  return { i, c, r, receipt, state }
}
function mock(f, invoke) {
  const calls = []
  return { calls, rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: name.includes('review') ? f.r : name.startsWith('read_') ? { items: [{ receipt: f.receipt, state: f.state }], limit: 25, offset: 0, has_more: false } : { status: 'recorded', receipt: f.receipt, state: f.state, must_not_submit: true } }) }, functions: { async invoke(name, args) { calls.push({ name, ...args }); return invoke ? invoke() : { data: { data: { receipt: f.receipt, state: f.state, replayed: false } } } } } }
}
const reviewIdentity = ({ request_id: _request, ...i }) => i
test('review and explicit build use exact authenticated fields, frozen origin and opaque hashes', async () => {
  const f = fixture(), api = mock(f), repo = createProjectChatNativeBuildRepository(api)
  const r = await repo.review(reviewIdentity(f.i), f.c), p = await repo.prepare(f.i, f.c, r)
  assert.ok(Object.isFrozen(p.review.chat_context.origin_receipt.selection))
  assert.deepEqual((await repo.confirm(p)).receipt, f.receipt)
  assert.deepEqual(api.calls[0], { name: 'get_project_chat_native_build_review', args: { ...Object.fromEntries(Object.entries(reviewIdentity(f.i)).map(([k, v]) => [`p_${k}`, v])), p_context: f.c } })
  assert.deepEqual(api.calls[1].body, { action: 'build_chat', ...f.i, engagement_id: f.c.engagement_id, context: f.c, review_sha256: f.r.review_sha256, chat_review_sha256: f.r.chat_review_sha256 })
  assert.notEqual(f.r.chat_context.origin_receipt.source_message_id, f.i.source_message_id)
})
test('origin stage/hash refresh allowed, stage drop/substitution or foreign origin rejected', async () => {
  for (const mutate of [f => f.r.chat_context.origin_receipt.selection = null, f => f.r.chat_context.origin_receipt.selection.group_id = id(99), f => f.r.chat_context.origin_receipt.actor_id = id(99), f => f.r.chat_context.origin_receipt.output.design_id = id(99), f => f.r.stale_sources = ['Content']]) {
    const f = fixture(); mutate(f)
    await assert.rejects(createProjectChatNativeBuildRepository(mock(f)).prepare(f.i, f.c, f.r))
  }
})
test('explicit unscoped origin stays null without inventing a stage', async () => {
  const f = fixture(); f.c.selection = null; f.r.chat_context.context.selection = null; f.r.chat_context.origin_receipt.selection = null; f.receipt.selection = null
  const repo = createProjectChatNativeBuildRepository(mock(f)), p = await repo.prepare(f.i, f.c, f.r)
  assert.equal((await repo.confirm(p)).receipt.selection, null)
})
test('proposal tamper and cancellation send no request', async () => {
  const f = fixture(), api = mock(f), repo = createProjectChatNativeBuildRepository(api), p = await repo.prepare(f.i, f.c, f.r), changed = structuredClone(p)
  changed.context.design_id = id(99)
  await assert.rejects(repo.confirm(changed), /proposal changed/)
  await assert.rejects(repo.confirm(p, { signal: AbortSignal.abort() }))
  assert.equal(api.calls.length, 0)
})
test('foreign claim or incomplete package is unknown original outcome with no automatic retry', async () => {
  for (const mutate of [f => f.receipt.request_id = id(99), f => f.receipt.actor_id = id(99), f => f.receipt.output.design_id = id(99), f => f.receipt.selection = null, f => f.state.source_sha256 = null, f => f.state.published = true]) {
    const f = fixture(), api = mock(f), repo = createProjectChatNativeBuildRepository(api), p = await repo.prepare(f.i, f.c, f.r); mutate(f)
    await assert.rejects(repo.confirm(p), e => e.outcome === 'unknown' && e.proposal.identity.request_id === f.i.request_id)
    assert.equal(api.calls.length, 1)
  }
})
test('observed expiration preserves original processing, local recovery/history never invoke compiler', async () => {
  const f = fixture(); f.state = { ...f.state, status: 'failed', original_status: 'processing', execution_window_expired: true, artifact_sha256: null, source_sha256: null, package_bytes: null, source_bytes: null, failure_reason: 'Execution window expired' }
  const api = mock(f), repo = createProjectChatNativeBuildRepository(api), recovered = await repo.recover(f.i)
  assert.equal(recovered.state.original_status, 'processing'); assert.equal(recovered.must_not_submit, true)
  const { organization_id, project_id, conversation_id } = f.i
  assert.deepEqual((await repo.list({ organization_id, project_id, conversation_id })).items[0].receipt.selection, f.receipt.selection)
  assert.deepEqual(api.calls.map(x => x.name), ['recover_project_chat_native_build_action', 'read_project_chat_native_build_actions'])
  f.state.execution_window_expired = false
  await assert.rejects(repo.recover(f.i), /state required/)
})
test('missing local association never authorizes resend and pagination is bounded', async () => {
  const f = fixture(), api = mock(f); api.rpc = async () => ({ data: { status: 'not_recorded', must_not_submit: true } })
  const repo = createProjectChatNativeBuildRepository(api)
  assert.equal((await repo.recover(f.i)).must_not_submit, true)
  api.rpc = async () => ({ data: { status: 'not_recorded' } })
  await assert.rejects(repo.recover(f.i), /never authorizes/)
  const { organization_id, project_id, conversation_id } = f.i
  await assert.rejects(repo.list({ organization_id, project_id, conversation_id }, { offset: 10001 }))
})
test('retained claim overrides rollback flag and preserves unknown; verified preclaim conflict is stale', async () => {
  for (const retained of [true, false]) {
    const f = fixture(), api = mock(f, () => ({ data: { error: 'Conflict', code: '40001', rollback_verified: true, request_retained: retained } })), repo = createProjectChatNativeBuildRepository(api), p = await repo.prepare(f.i, f.c, f.r)
    await assert.rejects(repo.confirm(p), e => e.outcome === (retained ? 'unknown' : 'stale') && e.requestRetained === retained)
    assert.equal(api.calls.length, 1)
  }
})
