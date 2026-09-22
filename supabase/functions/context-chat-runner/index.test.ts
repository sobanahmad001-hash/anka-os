import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { handleRequest, requirePrivateChatPaidExecution } from './index.ts'

Deno.test('paid switch denies new submissions while the handler never calls a provider without auth', async () => {
  let calls = 0
  const result = await handleRequest(new Request('https://example.test/run', { method: 'POST' }),
    () => { calls += 1; throw new Error('provider must not run') },
    { get: () => undefined })
  assertEquals(result.status, 401)
  assertEquals(calls, 0)
  assertEquals((await result.json()).error, 'Authentication required')
  assertThrows(() => requirePrivateChatPaidExecution({ get: () => undefined }))
})
