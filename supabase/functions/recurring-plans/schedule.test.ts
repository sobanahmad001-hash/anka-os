import { SUGGESTED_LOCAL_TIME, validateScheduleDefinition } from './schedule.ts'

function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed')
}

Deno.test('RET4 empty and legacy schedule metadata never receive automatic consent', () => {
  for (const value of [{}, { local_time: '09:00' }, { note: 'legacy' }]) {
    assert(validateScheduleDefinition(value) === value)
    assert(!('scheduler' in value))
  }
  assert(SUGGESTED_LOCAL_TIME === '09:00')
})

Deno.test('RET4 accepts explicit midnight and final-minute saved execution times', () => {
  for (const local_time of ['00:00', '09:00', '23:59']) {
    const value = { scheduler: { enabled: true, local_time, policy: 'ret4_v1' } }
    assert(validateScheduleDefinition(value) === value)
  }
})

Deno.test('RET4 rejects incomplete, implicit, malformed and unknown schedule policies', () => {
  for (const value of [null, [], false, { scheduler: null }, { scheduler: {} },
    ...['9:00', '24:00', '09:60', '', '09:00:00'].map(local_time => ({ scheduler: { enabled: true, local_time, policy: 'ret4_v1' } })),
    { scheduler: { enabled: false, local_time: '09:00', policy: 'ret4_v1' } },
    { scheduler: { enabled: true, local_time: '09:00', policy: 'future' } },
    { scheduler: { enabled: true, local_time: '09:00', policy: 'ret4_v1', catch_up: true } },
  ]) {
    let rejected = false
    try { validateScheduleDefinition(value) } catch { rejected = true }
    assert(rejected)
  }
})
