import test from 'node:test'
import assert from 'node:assert/strict'
import { beginProjectWebsiteIntake, websiteIntakeUserExtract, prepareProjectWebsiteIntakeDraft } from './projectWebsiteIntake.js'
import { reviewWebsiteIntakeForSetup } from './projectWebsiteIntakeSetup.js'
import { defaultSetupItem } from './projectSetup.js'
import { SERVICE_CATALOGUE } from './serviceCatalogue.js'
import { createProjectDeliverySetupRepository } from './projectDeliverySetupRepository.js'
const id = n => `ee000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function fixture(text = 'Garden design services.') {
  const leaf = SERVICE_CATALOGUE.find(r => r.slug === 'setup_content_social_post_copy')
  const snapshot = { organization_id: id(1), project_id: id(2), token: 'a'.repeat(32), can_manage: true, leaves: SERVICE_CATALOGUE, scopes: [], catalog: [] }
  const serviceLine = { catalogue_version: 1, service_group: 'marketing', start_date: '2026-11-01', target_date: null, timezone: 'Asia/Karachi', generation_horizon: 1, scope_statement: '12 reviewed social posts per month', exclusions: 'Paid distribution excluded' }
  const plan = { service_line_version: 2, items: [{ ...defaultSetupItem(leaf), cadence: 'monthly', quantity: 12, service_line: serviceLine }], pipelines: ['marketing'], questions: [], explanation: 'Existing reviewed draft' }
  const source = await websiteIntakeUserExtract(beginProjectWebsiteIntake(snapshot, 'https://example.test/about'), text)
  const draft = await prepareProjectWebsiteIntakeDraft(snapshot, source, [{ label: 'Offer reference', passage_id: 'user-extract:1' }])
  const decision = { fact_index: 0, action: 'accept', service_id: leaf.id, edited_text: null }
  return { snapshot, plan, draft, decision }
}
test('accepted extract persists attribution through existing combined review and explicit apply only', async () => {
  const f = await fixture(), bridge = await reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [f.decision]), calls = []
  assert.equal(bridge.state, 'awaiting_existing_setup_review'); assert.equal(bridge.project_changes_applied, false)
  const scope = { organization_id: f.snapshot.organization_id, project_id: f.snapshot.project_id }
  const repository = createProjectDeliverySetupRepository({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'review_project_delivery_setup' ? { ...scope, engagement_id: id(3), review_sha256: 'b'.repeat(64) } : { ...scope, request_id: id(4), atomic: true, setup: scope, delivery: scope } } } })
  assert.equal(calls.length, 0)
  const review = await repository.review(f.snapshot, bridge.plan)
  assert.deepEqual(calls.map(c => c.name), ['review_project_delivery_setup'])
  await repository.apply(f.snapshot, review, id(4))
  assert.deepEqual(calls.map(c => c.name), ['review_project_delivery_setup', 'apply_project_delivery_setup'])
  const saved = calls[1].args.p_plan.items[0]
  assert.match(saved.evidence, /User-supplied website reference: https:\/\/example.test\/about/)
  assert.match(saved.evidence, /Supporting extract: Garden design services\./)
  assert.ok(saved.evidence.includes(f.draft.facts[0].source.content_sha256))
  assert.equal(saved.quantity, 12); assert.equal(saved.cadence, 'monthly'); assert.deepEqual(saved.service_line, f.plan.items[0].service_line)
  assert.deepEqual(calls[0].args.p_plan, calls[1].args.p_plan)
})
test('edited interpretation retains original source excerpt and existing setup fields', async () => {
  const f = await fixture(), before = structuredClone(f.plan)
  const reviewed = await reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [{ ...f.decision, action: 'edit', edited_text: 'Only use this as a draft offer reference.' }])
  assert.match(reviewed.plan.items[0].evidence, /Supporting extract: Garden design services\./)
  assert.match(reviewed.plan.items[0].evidence, /Reviewed interpretation: Only use this/)
  assert.deepEqual(reviewed.plan.items[0].service_line, before.items[0].service_line); assert.deepEqual(f.plan, before)
})
test('dismissed source leaves original plan unchanged and needs no apply', async () => {
  const f = await fixture(), reviewed = await reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [{ ...f.decision, action: 'dismiss', service_id: null }])
  assert.equal(reviewed.state, 'dismissed'); assert.equal(reviewed.review_required, false); assert.deepEqual(reviewed.plan, f.plan)
  assert.equal(reviewed.project_changes_applied, false)
})
test('dismiss preserves an incomplete editable proposal exactly while retaining scope and pending guards', async () => {
  const f = await fixture(); f.plan.items[0].evidence = ''; f.plan.items[0].quantity = null
  const before = structuredClone(f.plan), dismiss = [{ ...f.decision, action: 'dismiss', service_id: null }]
  const reviewed = await reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, dismiss)
  assert.equal(reviewed.state, 'dismissed'); assert.equal(reviewed.review_required, false)
  assert.deepEqual(reviewed.plan, before); assert.deepEqual(f.plan, before)
  await assert.rejects(reviewWebsiteIntakeForSetup({ ...f.snapshot, token: 'b'.repeat(32) }, f.plan, f.draft, dismiss), /Refresh/)
  await assert.rejects(reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, dismiss, { pendingRequestId: id(5) }), /Recover/)
  await assert.rejects(reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [{ ...dismiss[0], service_id: f.decision.service_id }]), /Dismissed/)
  const invalidChanged = structuredClone(f.plan); invalidChanged.items[0].cadence = 'invalid'
  await assert.rejects(reviewWebsiteIntakeForSetup(f.snapshot, invalidChanged, f.draft, [f.decision]), /cadence/)
})
test('permissions, stale scope, unresolved saves and evidence limits stop proposal modification', async () => {
  const f = await fixture()
  await assert.rejects(reviewWebsiteIntakeForSetup({ ...f.snapshot, can_manage: false }, f.plan, f.draft, [f.decision]), /permission/)
  await assert.rejects(reviewWebsiteIntakeForSetup({ ...f.snapshot, token: 'b'.repeat(32) }, f.plan, f.draft, [f.decision]), /Refresh/)
  await assert.rejects(reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [f.decision], { pendingRequestId: id(5) }), /Recover/)
  await assert.rejects(reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [{ ...f.decision, service_id: id(99) }]), /already selected/)
  const big = await fixture('x'.repeat(450))
  await assert.rejects(reviewWebsiteIntakeForSetup(big.snapshot, big.plan, big.draft, [big.decision]), /cannot be truncated/)
})
test('changed draft hash and server permission denial never become applied setup', async () => {
  const f = await fixture(), changed = structuredClone(f.draft); changed.facts[0].proposed_text = 'Substituted'
  await assert.rejects(reviewWebsiteIntakeForSetup(f.snapshot, f.plan, changed, [f.decision]), /Exact original/)
  const reviewed = await reviewWebsiteIntakeForSetup(f.snapshot, f.plan, f.draft, [f.decision]), calls = []
  const repository = createProjectDeliverySetupRepository({ rpc: async name => { calls.push(name); return { error: { code: '42501', message: 'Current authority required' } } } })
  await assert.rejects(repository.review(f.snapshot, reviewed.plan), e => e.code === '42501')
  assert.deepEqual(calls, ['review_project_delivery_setup'])
})
