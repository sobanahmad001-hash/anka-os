import test from 'node:test'
import assert from 'node:assert/strict'
import { createServiceRecurringBridgeRepository } from './serviceRecurringBridgeRepository.js'

const uuid = n => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = () => ({ organizationId: uuid(1), projectId: uuid(2), engagementId: uuid(3), actorId: uuid(4) })
const proposal = () => ({ version: 1, effective_start: '2028-01-31', scheduler: null })
function fixture() {
  const calls = []; let user = uuid(4); let error = null
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: user } } }) },
    rpc(name, args) {
      calls.push({ name, args })
      const result = Promise.resolve({ data: { can_apply: true, review_sha256: 'a'.repeat(64), compiled: { deliverable_count: 12, work_card_count: 36, dependency_count: 24 } }, error })
      result.abortSignal = signal => { calls.at(-1).signal = signal; return result }
      return result
    },
  }
  return { repository: createServiceRecurringBridgeRepository(client), calls, user: value => { user = value }, fail: value => { error = value } }
}

test('context reads exact saved scope and optional plan with cancellation and no writes', async () => {
  const f = fixture(); const signal = new AbortController().signal
  const result = await f.repository.context(scope(), uuid(5), { planId: uuid(6), signal })
  assert.equal(result.compiled.deliverable_count, 12)
  assert.equal(result.compiled.work_card_count, 36)
  assert.deepEqual(f.calls, [{ name: 'get_service_recurring_plan_context', args: { p_organization_id: uuid(1), p_project_id: uuid(2), p_engagement_id: uuid(3), p_scope_id: uuid(5), p_plan_id: uuid(6) }, signal }])
})

test('review and apply retain original immutable actor, scope, quantities and explicit consent choice', async () => {
  const f = fixture(); const original = scope(); const draft = proposal()
  const reviewed = await f.repository.review(original, uuid(5), draft)
  original.projectId = uuid(99); draft.effective_start = '2030-01-01'; draft.scheduler = { enabled: true }
  assert.throws(() => { reviewed.review.compiled.work_card_count = 999 }, TypeError)
  await f.repository.apply(reviewed, uuid(7))
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[1], { name: 'apply_service_recurring_plan', args: { p_organization_id: uuid(1), p_project_id: uuid(2), p_engagement_id: uuid(3), p_scope_id: uuid(5), p_plan_id: null, p_proposal: proposal(), p_review_sha256: 'a'.repeat(64), p_request_id: uuid(7) } })
})

test('account changes block apply and recovery before any new RPC', async () => {
  const f = fixture(); const reviewed = await f.repository.review(scope(), uuid(5), proposal())
  f.user(uuid(99))
  await assert.rejects(f.repository.apply(reviewed, uuid(7)), /original account/)
  await assert.rejects(f.repository.recover(scope(), uuid(7)), /original account/)
  assert.equal(f.calls.length, 1)
})

test('uncertain apply never retries, falls back, activates, generates or automatically recovers', async () => {
  const f = fixture(); const reviewed = await f.repository.review(scope(), uuid(5), proposal())
  f.fail({ message: 'Connection ended', code: 'NETWORK' })
  await assert.rejects(f.repository.apply(reviewed, uuid(7)), error => error.code === 'NETWORK' && !error.knownRollback)
  assert.deepEqual(f.calls.map(c => c.name), ['review_service_recurring_plan', 'apply_service_recurring_plan'])
  f.fail(null); await f.repository.recover(scope(), uuid(7))
  assert.deepEqual(f.calls[2], { name: 'recover_service_recurring_plan', args: { p_organization_id: uuid(1), p_project_id: uuid(2), p_engagement_id: uuid(3), p_request_id: uuid(7) } })
})

test('missing consent choice, invalid scope and stale review remain errors without source adoption', async () => {
  const f = fixture()
  await assert.rejects(f.repository.review(scope(), uuid(5), { version: 1 }), /explicit scheduler/)
  await assert.rejects(f.repository.context(scope(), 'latest'), /exact|Exact/)
  await assert.rejects(f.repository.apply({ review: { can_apply: false } }, uuid(7)), /review the exact/)
  assert.equal(f.calls.length, 0)
  const reviewed = await f.repository.review(scope(), uuid(5), proposal()); f.fail({ message: 'Source changed', code: '40001' })
  await assert.rejects(f.repository.apply(reviewed, uuid(7)), error => error.code === '40001' && error.knownRollback)
  assert.equal(f.calls.length, 2)
})
