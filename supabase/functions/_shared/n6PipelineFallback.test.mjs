import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { confirmedRetryableRejection } from './n6PipelineFallback.ts'

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
    [429, {}],
  ]) assert.equal(confirmedRetryableRejection(status, body), null)
})
