import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { handleRequest, hasEventWriteAuthority, validateEventInput } from './index.ts'

Deno.test('MK1 writer authority covers the three departments and leadership only', () => {
  for (const department_id of ['content', 'marketing', 'design']) {
    assertEquals(hasEventWriteAuthority({ role: 'member', department_id }), true)
  }
  for (const role of ['system_owner', 'operations_admin', 'executive']) {
    assertEquals(hasEventWriteAuthority({ role, department_id: 'operations' }), true)
  }
  assertEquals(hasEventWriteAuthority({ role: 'member', department_id: 'operations' }), false)
})

Deno.test('MK1 event validation emits event_category and rejects the legacy category contract', () => {
  const valid = validateEventInput({
    eventName: 'Design Week', eventCategory: 'fashion', startDate: '2026-09-10',
    endDate: '2026-09-12', sourceUrl: 'https://example.com/design-week',
  })
  assertEquals(valid.event_category, 'fashion')
  assertEquals(valid.event_name, 'Design Week')
  assertThrows(
    () => validateEventInput({ eventName: 'Legacy', category: 'fashion', startDate: '2026-09-10' }),
    Error,
    'Unsupported event category',
  )
  assertThrows(
    () => validateEventInput({ eventName: 'Backwards', eventCategory: 'concert', startDate: '2026-09-12', endDate: '2026-09-10' }),
    Error,
    'End date cannot be before start date',
  )
})

Deno.test('MK1 endpoint handles preflight and rejects unsupported methods without database access', async () => {
  const preflight = await handleRequest(new Request('https://example.test', { method: 'OPTIONS' }))
  assertEquals(preflight.status, 200)
  assertEquals(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
  const method = await handleRequest(new Request('https://example.test', { method: 'GET' }))
  assertEquals(method.status, 405)
})
