import test from 'node:test'
import assert from 'node:assert/strict'
import { websiteNativeFixture } from '../../tools/website-native-fixture.js'
import { websiteNativeLayout } from '../../supabase/functions/_shared/websiteNativeDraft.js'
import { createProjectChatNativeDesignRepository, prepareProjectChatNativeDesignAction } from './projectChatNativeDesignRepository.js'

const uuid = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function fixture(parent = null) {
  const f = await websiteNativeFixture()
  const i = { organization_id: f.scope.organization_id, project_id: f.scope.project_id, conversation_id: uuid(20), source_message_id: uuid(21), request_id: uuid(22) }
  const c = { engagement_id: f.scope.engagement_id, selection: null, handoff_request_id: uuid(23), source_work: { id: uuid(24), row_version: 3 }, receiving_work: { id: uuid(25), row_version: 4 }, page_id: f.scope.page_id, architecture_version_id: f.sources.architecture.version_id, brief_version_id: f.sources.brief.version_id, site_version_id: f.sources.site_system.version_id, direction_version_id: null, expected_parent_design_id: parent }
  const s = { scope: f.scope, architecture: { artifact_version_id: c.architecture_version_id, approval_id: uuid(26), content_checksum: f.sources.architecture.checksum }, page: { title: 'Home' }, content_version: { id: f.sources.content.version_id, content_checksum: f.sources.content.checksum }, brief_version: { id: c.brief_version_id, content_checksum: f.sources.brief.checksum }, site_version: { id: c.site_version_id, request_sha256: f.sources.site_system.checksum, site: { ...f.site, navigation: [{ label: 'Home', path: '/home' }] } }, content_page: { source_format: 'writer_v2', page_brief: 'Context objective', draft_copy: 'Exact approved copy.', meta_title: 'Home', meta_description: '', primary_cta: null }, design_head: parent, review_sha256: 'a'.repeat(64), chat_review_sha256: 'b'.repeat(64) }
  const r = { version: 1, kind: 'save_native_design', status: 'design_draft_saved', ...i, engagement_id: c.engagement_id, actor_id: uuid(27), selection: null, handoff_request_id: c.handoff_request_id, source_work: c.source_work, receiving_work: c.receiving_work, output: { kind: 'website_native_design', design_id: uuid(28), page_id: c.page_id, parent_design_id: parent, version_number: parent ? 2 : 1, request_sha256: 'c'.repeat(64) }, review_required: true }
  const output = { artifact_id: uuid(30), artifact_version_id: s.content_version.id, version_number: 2, content_checksum: s.content_version.content_checksum }
  s.chat_context = { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, conversation_id: i.conversation_id, source_message_id: i.source_message_id, actor_id: r.actor_id, context: structuredClone(c), source_work: structuredClone(c.source_work), receiving_work: structuredClone(c.receiving_work), content_approval: { artifact_id: output.artifact_id, artifact_version_id: output.artifact_version_id, content_checksum: output.content_checksum, approval_id: uuid(31) }, handoff_receipt: { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, conversation_id: i.conversation_id, source_message_id: uuid(32), actor_id: r.actor_id, request_id: c.handoff_request_id, kind: 'handoff_design', status: 'handoff_recorded', selection: null, source_work: { id: c.source_work.id, row_version: 1 }, output, handoff: { request_id: c.handoff_request_id, approval_id: uuid(31), receiving_service_id: uuid(33), receiving_workstream_id: uuid(34), receiving_work_item_id: c.receiving_work.id }, review_required: false } }
  return { i, c, s, r, layout: websiteNativeLayout(s) }
}
function client(data, invoke) {
  const calls = []
  return { calls, rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data }) }, functions: { async invoke(name, args) { calls.push({ name, ...args }); return invoke ? invoke() : { data: { data } } } } }
}
test('source read uses exact authenticated Chat arguments and freezes reviewed source', async () => {
  const { i, c, s } = await fixture(), api = client(s), result = await createProjectChatNativeDesignRepository(api).load(i, c)
  assert.deepEqual(api.calls, [{ name: 'get_project_chat_native_design_source', args: { p_organization_id: i.organization_id, p_project_id: i.project_id, p_conversation_id: i.conversation_id, p_source_message_id: i.source_message_id, p_context: c } }])
  assert.ok(Object.isFrozen(result.content_page))
  s.design_head = uuid(99)
  await assert.rejects(createProjectChatNativeDesignRepository(api).load(i, c), /exact reviewed/)
})
test('create and explicit revision send one server-compiled action and retain native result lineage', async () => {
  for (const parent of [null, uuid(29)]) {
    const { i, c, s, r, layout } = await fixture(parent), api = client(r), repo = createProjectChatNativeDesignRepository(api)
    const proposal = await repo.prepare(i, c, s, layout)
    assert.ok(Object.isFrozen(proposal.manifest.content))
    assert.equal(proposal.manifest.content.sections[0].paragraphs[0], s.content_page.draft_copy)
    assert.deepEqual(await repo.confirm(proposal), r)
    assert.equal(api.calls.length, 1)
    assert.deepEqual(Object.keys(api.calls[0].body).sort(), ['action', ...Object.keys(i), 'engagement_id', 'context', 'chat_review_sha256', 'review_sha256', 'architecture_approval_id', 'manifest'].sort())
    assert.equal(api.calls[0].body.action, 'save_chat_design')
    assert.equal(api.calls[0].body.context.expected_parent_design_id, parent)
  }
})
test('changed proposal is rejected before transport', async () => {
  const { i, c, s, r, layout } = await fixture(), api = client(r), p = structuredClone(await prepareProjectChatNativeDesignAction(i, c, s, layout))
  p.context.receiving_work.row_version++
  await assert.rejects(createProjectChatNativeDesignRepository(api).confirm(p), /proposal changed/)
  assert.equal(api.calls.length, 0)
})
test('source rejects absent or substituted handoff metadata without rewriting historical message or Work version', async () => {
  for (const change of [s => delete s.chat_context, s => s.source_work = s.chat_context.source_work,
    s => s.chat_context.source_message_id = uuid(99), s => s.chat_context.context.selection = {},
    s => s.chat_context.handoff_receipt.actor_id = uuid(99), s => s.chat_context.handoff_receipt.source_work.id = uuid(99),
    s => s.chat_context.handoff_receipt.handoff.receiving_work_item_id = uuid(99), s => s.chat_context.content_approval.approval_id = uuid(99),
    s => s.chat_context.content_approval.artifact_version_id = uuid(99), s => s.chat_context.content_approval.content_checksum = 'f'.repeat(64)]) {
    const { i, c, s, layout } = await fixture(); change(s)
    await assert.rejects(prepareProjectChatNativeDesignAction(i, c, s, layout))
  }
  const { i, c, s, layout } = await fixture(), before = structuredClone(s.chat_context.handoff_receipt)
  const p = await prepareProjectChatNativeDesignAction(i, c, s, layout)
  assert.equal(p.chat_review_sha256, s.chat_review_sha256)
  assert.notEqual(before.source_message_id, i.source_message_id)
  assert.notEqual(before.source_work.row_version, c.source_work.row_version)
  assert.deepEqual(s.chat_context.handoff_receipt, before)
})
test('foreign request, Work, parent and artifact receipts preserve unknown original proposal without retry', async () => {
  for (const change of [r => r.request_id = uuid(99), r => r.receiving_work = { id: uuid(99), row_version: 4 }, r => r.output.parent_design_id = uuid(99), r => r.output.artifact_version_id = uuid(99), r => r.review_required = false]) {
    const { i, c, s, r, layout } = await fixture(); change(r)
    const api = client(r), repo = createProjectChatNativeDesignRepository(api), p = await repo.prepare(i, c, s, layout)
    await assert.rejects(repo.confirm(p), e => e.outcome === 'unknown' && e.proposal.sha256 === p.sha256)
    assert.equal(api.calls.length, 1)
  }
})
test('only explicit verified rollback classifies stale; network outcome retains original identity', async () => {
  for (const verified of [true, false]) {
    const { i, c, s, layout } = await fixture(), api = client(null, () => ({ data: { error: 'conflict', code: '40001', rollback_verified: verified } })), repo = createProjectChatNativeDesignRepository(api), p = await repo.prepare(i, c, s, layout)
    await assert.rejects(repo.confirm(p), e => e.outcome === (verified ? 'stale' : 'unknown') && e.proposal.identity.request_id === i.request_id)
    assert.equal(api.calls.length, 1)
  }
})
test('recovery and paged history are read only and do not authorize resend', async () => {
  const { i, r } = await fixture(), api = client({ status: 'recorded', receipt: r }), repo = createProjectChatNativeDesignRepository(api)
  assert.deepEqual((await repo.recover(i)).receipt, r)
  const missing = client({ status: 'not_recorded', must_not_submit: true })
  assert.equal((await createProjectChatNativeDesignRepository(missing).recover(i)).must_not_submit, true)
  await assert.rejects(createProjectChatNativeDesignRepository(client({ status: 'not_recorded' })).recover(i), /resend/)
  const scope = { organization_id: i.organization_id, project_id: i.project_id, conversation_id: i.conversation_id }
  const history = client({ items: [r], limit: 25, offset: 0, has_more: false })
  assert.deepEqual((await createProjectChatNativeDesignRepository(history).list(scope)).items, [r])
  assert.deepEqual([api, missing, history].map(x => x.calls[0].name), ['recover_project_chat_native_design_action', 'recover_project_chat_native_design_action', 'read_project_chat_native_design_actions'])
})
test('saved design read rejects another design identity and abort prevents a write', async () => {
  const { i, c, s, layout } = await fixture(), scope = { organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id }
  const api = client({ ...scope, design_id: uuid(28) }), repo = createProjectChatNativeDesignRepository(api)
  assert.equal((await repo.design(scope, uuid(28))).design_id, uuid(28))
  await assert.rejects(repo.design(scope, uuid(99)), /another context/)
  const p = await repo.prepare(i, c, s, layout), before = api.calls.length
  await assert.rejects(repo.confirm(p, { signal: AbortSignal.abort() }))
  assert.equal(api.calls.length, before)
})
