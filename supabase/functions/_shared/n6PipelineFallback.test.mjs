import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { confirmedRetryableRejection, runConfirmedPipelineFallback } from './n6PipelineFallback.ts'

test('only a confirmed rate or overload refusal permits fallback', () => {
  assert.equal(confirmedRetryableRejection(429,
    { error: { type: 'rate_limit_error', code: 'slow_down' } }), 'slow_down')
  assert.equal(confirmedRetryableRejection(429,
    { error: { type: 'rate_limit_error' } }), 'rate_limit_error')
  assert.equal(confirmedRetryableRejection(503,
    { error: { code: 'server_is_overloaded' } }), 'server_is_overloaded')
  for (const [status, body] of [
    [429, { error: { code: 'credit_balance_exhausted' } }],
    [429, { error: { code: 'organization_spend_limit_exceeded' } }],
    [401, { error: { code: 'unauthorized' } }],
    [400, { error: { code: 'content_policy_violation' } }],
    [500, { error: { code: 'server_error' } }],
    [503, { error: { code: 'server_error' } }],
    [429, { error: { code: 'rate_limit_exceeded' }, id: 'resp-accepted' }],
    [429, { error: { code: 'rate_limit_exceeded' }, output: [] }],
    [503, { error: { code: 'server_is_overloaded' }, usage: { input_tokens: 1 } }],
    [429, {}],
  ]) assert.equal(confirmedRetryableRejection(status, body), null)
})

const contexts = [1, 2, 3].map(priority => ({
  route: { priority, provider: 'openai', connection_id: 'connection-' + priority,
    model_id: 'model-' + priority, model_configuration_id: 'configuration-' + priority },
  price: {}, credential: 'fake-' + priority,
}))
const refused = (status, code) => ({ ok: false, status,
  body: { error: { code } }, requestId: 'request-' + status })
const completed = { ok: true, status: 200, body: { status: 'completed' }, requestId: 'request-ok' }
function harness(responses, claimed = priority => ({
  status: 'claimed', must_not_submit: false,
  fallback_claim_id: 'claim-' + priority, route: contexts[priority - 1].route,
})) {
  const events = []
  const send = async (context, claimId) => {
    events.push(['send', context.route.priority, claimId])
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response
  }
  const record = async (priority, status, code) => {
    events.push(['reject', priority, status, code])
    return { idempotent_replay: false }
  }
  const claim = async priority => {
    events.push(['claim', priority])
    return claimed(priority)
  }
  const markUnknown = async reason => { events.push(['unknown', reason]) }
  return { events, run: () => runConfirmedPipelineFallback(
    contexts, 'claim-1', send, record, claim, markUnknown,
  ) }
}

test('confirmed rate and overload refusals claim each pinned backup once', async () => {
  const caseRun = harness([
    refused(429, 'rate_limit_exceeded'),
    refused(503, 'server_is_overloaded'),
    completed,
  ])
  const result = await caseRun.run()
  assert.equal(result.status, 'completed')
  assert.equal(result.context.route.priority, 3)
  assert.equal(result.routeClaimId, 'claim-3')
  assert.deepEqual(caseRun.events.map(event => event[0]),
    ['send', 'reject', 'claim', 'send', 'reject', 'claim', 'send'])
})

test('ambiguous result or transport failure never submits a backup', async () => {
  for (const response of [refused(500, 'server_error'), new Error('timeout')]) {
    const caseRun = harness([response])
    assert.equal((await caseRun.run()).status, 'outcome_unknown')
    assert.deepEqual(caseRun.events.map(event => event[0]), ['send', 'unknown'])
  }
})

test('all confirmed refusals await independent budget release', async () => {
  const caseRun = harness([
    refused(429, 'slow_down'), refused(503, 'server_is_overloaded'),
    refused(429, 'rate_limit_exceeded'),
  ])
  assert.equal((await caseRun.run()).status, 'all_routes_refused')
  assert.equal(caseRun.events.filter(event => event[0] === 'send').length, 3)
  assert.equal(caseRun.events.some(event => event[0] === 'unknown'), false)
})

test('replayed or mismatched backup claim never submits provider work', async () => {
  for (const claimed of [
    () => ({ must_not_submit: true }),
    () => ({ status: 'claimed', must_not_submit: false,
      fallback_claim_id: 'claim-2', route: contexts[2].route }),
  ]) {
    const caseRun = harness([refused(429, 'rate_limit_exceeded')], claimed)
    const result = await caseRun.run()
    assert.ok(['already_claimed', 'outcome_unknown'].includes(result.status))
    assert.equal(caseRun.events.filter(event => event[0] === 'send').length, 1)
  }
})

test('N7 provider refusals distinguish temporary limits from spending and ambiguous outcomes', () => {
  assert.equal(confirmedRetryableRejection(429,
    { error: { type: 'rate_limit_error' } }, 'anthropic', '2'), 'rate_limit_error')
  assert.equal(confirmedRetryableRejection(429,
    { error: { type: 'rate_limit_error' } }, 'anthropic'), null)
  assert.equal(confirmedRetryableRejection(429, { error: {
    type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' },
  } }, 'anthropic', '2'), null)
  assert.equal(confirmedRetryableRejection(529,
    { error: { type: 'overloaded_error' } }, 'anthropic'), 'overloaded_error')
  assert.equal(confirmedRetryableRejection(503,
    { error: { status: 'UNAVAILABLE' } }, 'google_gemini'), 'service_unavailable')
  assert.equal(confirmedRetryableRejection(429,
    { error: { status: 'RESOURCE_EXHAUSTED', code: 429 } }, 'google_gemini'), null)
  assert.equal(confirmedRetryableRejection(429,
    { error: { code: 'rate_limit_exceeded' } }, 'google_gemini'), 'rate_limit_exceeded')
  assert.equal(confirmedRetryableRejection(503,
    { error: { code: 'server_is_overloaded' } }, 'unknown'), null)
})
