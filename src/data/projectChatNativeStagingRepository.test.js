import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectChatNativeStagingRepository } from './projectChatNativeStagingRepository.js'
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hash = 'a'.repeat(64), base = 'https://stage.example.test'
function fixture() {
  const i = { organization_id: id(1), project_id: id(2), conversation_id: id(3), source_message_id: id(4), request_id: id(5) }
  const selection = { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: id(6), plan_id: id(7), group_id: id(8), phase: 'website.content', partition: { kind: 'website_page', id: id(9), architecture_version_id: id(10) }, context_sha256: hash }
  const c = { engagement_id: id(6), selection, build_request_id: id(11), job_id: id(12), design_id: id(13), page_id: id(9), target_id: id(14), previous_run_id: null }
  const origin = { ...i, version: 1, kind: 'build_native_package', status: 'claimed', request_id: c.build_request_id, source_message_id: id(15), engagement_id: c.engagement_id, actor_id: id(16), selection: { ...selection, context_sha256: 'b'.repeat(64) }, origin_request_id: id(17), output: { kind: 'website_native_package', job_id: c.job_id, design_id: c.design_id, page_id: c.page_id } }
  const r = { organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, target_id: c.target_id, job_id: c.job_id, page_id: c.page_id, site_id: id(18), base_url: base, remote_head: null, package_sha256: hash, review_sha256: 'c'.repeat(64), chat_review_sha256: 'd'.repeat(64), environment: 'staging', published: false, chat_context: { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, conversation_id: i.conversation_id, source_message_id: i.source_message_id, actor_id: origin.actor_id, context: structuredClone(c), origin_receipt: origin } }
  const receipt = { ...i, version: 1, kind: 'stage_native_package', status: 'claimed', engagement_id: c.engagement_id, actor_id: origin.actor_id, selection: structuredClone(selection), origin_request_id: c.build_request_id, output: { kind: 'website_private_staging', run_id: id(19), job_id: c.job_id, design_id: c.design_id, page_id: c.page_id, target_id: c.target_id, site_id: r.site_id, previous_run_id: null, package_sha256: hash, base_url: base } }
  const state = { kind: 'website_private_staging', status: 'staged', evidence: { status: 'staged', environment: 'staging', published: false, request_id: i.request_id, site_id: r.site_id, package_sha256: hash, base_url: base, preview_verified: true, preview_url: base + '/?anka_staging_preview=' + i.request_id } }
  return { i, c, r, receipt, state }
}
function mock(f, invoke) {
  const calls = []
  return { calls, rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: name.startsWith('read_') ? { items: [{ receipt: f.receipt, state: f.state }], limit: 25, offset: 0, has_more: false } : { status: 'recorded', receipt: f.receipt, state: f.state, must_not_submit: true } }) }, functions: { async invoke(name, args) { calls.push({ name, ...args }); return invoke ? invoke(args.body) : { data: { data: args.body.action === 'dry-run-chat' ? f.r : { receipt: f.receipt, state: f.state, replayed: false } } } } } }
}
const reviewIdentity = ({ request_id: _request, ...i }) => i
test('explicit dry-run and deploy use bound target, original build and opaque review only', async () => {
  const f = fixture(), api = mock(f), repo = createProjectChatNativeStagingRepository(api)
  const r = await repo.review(reviewIdentity(f.i), f.c), p = await repo.prepare(f.i, f.c, r)
  assert.ok(Object.isFrozen(p.review.chat_context.origin_receipt))
  assert.deepEqual((await repo.confirm(p)).receipt, f.receipt)
  assert.deepEqual(api.calls.map(x => x.body), [{ action: 'dry-run-chat', ...reviewIdentity(f.i), engagement_id: f.c.engagement_id, context: f.c }, { action: 'deploy-chat', ...f.i, engagement_id: f.c.engagement_id, context: f.c, remote_head: null, review_sha256: f.r.review_sha256, chat_review_sha256: f.r.chat_review_sha256 }])
})
test('foreign build, dropped stage, unbound URL and invalid remote head reject review', async () => {
  for (const mutate of [f => f.r.chat_context.origin_receipt.output.job_id = id(99), f => f.r.chat_context.origin_receipt.selection = null, f => f.r.base_url = 'https://stage.example.test/path', f => f.r.remote_head = 'latest', f => f.r.target_id = id(99)]) {
    const f = fixture(); mutate(f)
    await assert.rejects(createProjectChatNativeStagingRepository(mock(f)).prepare(f.i, f.c, f.r))
  }
})
test('claim and verified evidence must retain exact package, site, origin, request and parent', async () => {
  for (const mutate of [f => f.receipt.actor_id = id(99), f => f.receipt.output.package_sha256 = 'e'.repeat(64), f => f.receipt.output.base_url = 'https://foreign.example.test', f => f.receipt.output.previous_run_id = id(99), f => f.state.evidence.site_id = id(99), f => f.state.evidence.request_id = id(99), f => f.state.evidence.package_sha256 = 'e'.repeat(64), f => f.state.evidence.preview_url = 'javascript:alert(1)', f => f.state.evidence.preview_verified = false, f => f.state.evidence.published = true]) {
    const f = fixture(), api = mock(f), repo = createProjectChatNativeStagingRepository(api), p = await repo.prepare(f.i, f.c, f.r); mutate(f)
    await assert.rejects(repo.confirm(p), e => e.outcome === 'unknown' && e.proposal.identity.request_id === f.i.request_id)
    assert.equal(api.calls.length, 1)
  }
})
test('local recovery/history remain separate from explicit original remote reconciliation', async () => {
  const f = fixture(), api = mock(f), repo = createProjectChatNativeStagingRepository(api)
  assert.deepEqual((await repo.recover(f.i)).receipt, f.receipt)
  const { organization_id, project_id, conversation_id } = f.i
  assert.deepEqual((await repo.list({ organization_id, project_id, conversation_id })).items[0].receipt, f.receipt)
  assert.deepEqual((await repo.reconcile(f.i, f.c.engagement_id)).state, f.state)
  assert.deepEqual(api.calls.map(x => x.name), ['recover_project_chat_native_staging_action', 'read_project_chat_native_staging_actions', 'website-staging'])
  assert.deepEqual(api.calls[2].body, { action: 'recover-chat', ...f.i, engagement_id: f.c.engagement_id })
  assert.equal(api.calls.filter(x => x.body?.action === 'deploy-chat').length, 0)
})
test('local recovery rejects checksum substitution without a current dry-run snapshot', async () => {
  const f = fixture(), repo = createProjectChatNativeStagingRepository(mock(f)); f.state.evidence.package_sha256 = 'e'.repeat(64)
  await assert.rejects(repo.recover(f.i), /evidence differs/)
})
test('pending and missing remote results stay uncertain with no preview or resend', async () => {
  const f = fixture(); f.state = { kind: 'website_private_staging', status: 'uncertain', evidence: null }
  const api = mock(f), repo = createProjectChatNativeStagingRepository(api)
  assert.equal((await repo.reconcile(f.i, f.c.engagement_id)).state.status, 'uncertain')
  f.state = { kind: 'website_private_staging', status: 'processing', evidence: { ...fixture().state.evidence } }
  await assert.rejects(repo.recover(f.i), /cannot provide a preview/)
  assert.equal(api.calls.length, 2)
})
test('aborted confirmation and changed proposal never dispatch; remote errors retain identity', async () => {
  const f = fixture(), api = mock(f), repo = createProjectChatNativeStagingRepository(api), p = await repo.prepare(f.i, f.c, f.r), changed = structuredClone(p)
  changed.review.remote_head = id(99)
  await assert.rejects(repo.confirm(changed), /proposal changed/)
  await assert.rejects(repo.confirm(p, { signal: AbortSignal.abort() }))
  assert.equal(api.calls.length, 0)
  const broken = createProjectChatNativeStagingRepository(mock(f, () => { throw Error('Disconnected') }))
  await assert.rejects(broken.reconcile(f.i, f.c.engagement_id), e => e.outcome === 'unknown' && e.proposal.identity.request_id === f.i.request_id)
})
