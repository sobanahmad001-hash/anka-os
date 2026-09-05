import { createSchedulerHandler, schedulerInput } from './index.ts'
const id = '11111111-1111-4111-8111-111111111111'
const assert = (value: unknown) => { if (!value) throw new Error('Assertion failed') }
Deno.test('RET4 scheduler accepts one explicit target and never accepts caller audit identity', async () => {
  let seen: Record<string, unknown> = {}
  const handler = createSchedulerHandler(async () => ({ actorId: id, rpc: async (_name, input) => { seen = input; return { data: {}, error: null } } }))
  const result = await handler(new Request('https://local.test', { method: 'POST', body: JSON.stringify({ action: 'admit', planId: id, periodStart: '2026-09-04', actorId: 'owner', admittedAt: '1900-01-01' }) }))
  assert(result.status === 200 && seen.p_actor_id === id && !('admittedAt' in seen))
})
Deno.test('RET4 scheduler denies unverified identity and malformed or batch requests', async () => {
  const handler = createSchedulerHandler(async () => { throw new Error('denied') })
  assert((await handler(new Request('https://local.test', { method: 'POST' }))).status === 401)
  for (const input of [{ action: 'bulk' }, { action: 'admit', planId: id, periodStart: '2026-02-30' }, { action: 'execute', admissionId: 'bad' }]) {
    let rejected = false
    try { schedulerInput(input) } catch { rejected = true }
    assert(rejected)
  }
})
Deno.test('RET4 scheduler propagates database authority rejection without internal detail', async () => {
  const handler = createSchedulerHandler(async () => ({ actorId: id, rpc: async () => ({ data: null, error: { message: 'private details' } }) }))
  const response = await handler(new Request('https://local.test', { method: 'POST', body: JSON.stringify({ action: 'execute', admissionId: id }) }))
  assert(response.status === 403 && !(await response.text()).includes('private details'))
})
