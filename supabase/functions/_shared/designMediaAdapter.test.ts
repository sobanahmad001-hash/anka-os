import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { createDesignMediaAdapter, type SdkFactory } from './designMediaAdapter.ts'

const input = { prompt: 'A cinematic scene at sunset', duration: 5, resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false }
const savedUrl = (id: string) => `https://api.higgsfield.ai/requests/${id}/status`
function fixture(raw: unknown = { status: 'queued', request_id: 'request-1', status_url: savedUrl('request-1') }) {
  const calls: unknown[] = []
  const factory: SdkFactory = config => {
    calls.push(config)
    return { subscribe: async (endpoint, options) => { calls.push({ endpoint, options }); return raw } }
  }
  return { calls, adapter: createDesignMediaAdapter(factory, 'mock-key:mock-secret') }
}
Deno.test('SDK adapter disables submission retries and polling and strips extra fields', async () => {
  const { calls, adapter } = fixture()
  assertEquals(await adapter.submit({ ...input, extra: 'discard' } as typeof input), { state: 'pending', requestId: 'request-1', statusUrl: savedUrl('request-1') })
  assertEquals(calls, [{ credentials: 'mock-key:mock-secret', maxRetries: 0, timeout: 30000, baseURL: 'https://api.higgsfield.ai' },
    { endpoint: 'bytedance/seedance-2.5/text-to-video', options: { input, withPolling: false } }])
})
Deno.test('unsupported server payload makes zero SDK submissions', async () => {
  const { adapter, calls } = fixture()
  for (const patch of [{ resolution: '1080p' }, { duration: 31 }, { duration: 4.1 }, { prompt: ' ' }, { generate_audio: 'false' }, { output_format: 'gif' }]) {
    await assertRejects(() => adapter.submit({ ...input, ...patch } as typeof input), Error, 'Unsupported')
  }
  assertEquals(calls.length, 1)
})
Deno.test('submission ambiguity is sanitized and never retried', async () => {
  let calls = 0
  const adapter = createDesignMediaAdapter(() => ({ subscribe: () => { calls++; throw new Error('mock-secret private prompt') } }), 'mock-key:mock-secret')
  const error = await assertRejects(() => adapter.submit(input), Error, 'outcome unknown')
  assertEquals(error.message.includes('mock-secret'), false)
  assertEquals(calls, 1)
})
Deno.test('provider completion is not stored/approved success and safety refusals are distinct', async () => {
  assertEquals(await fixture({ status: 'completed', request_id: 'r1', video: { url: 'https://media.example/video.mp4' } }).adapter.submit(input),
    { state: 'provider_completed', requestId: 'r1', outputUrl: 'https://media.example/video.mp4' })
  assertEquals((await fixture({ status: 'nsfw', request_id: 'r1' }).adapter.submit(input)).state, 'safety_refused')
  assertEquals((await fixture({ status: 'failed', request_id: 'r1' }).adapter.submit(input)).state, 'provider_failed')
  for (const video of [{}, { url: 'http://example.com/v' }, { url: 'https://user:pass@example.com/v' }]) {
    await assertRejects(() => fixture({ status: 'completed', request_id: 'r1', video }).adapter.submit(input))
  }
})
Deno.test('status recovery reads only the persisted identity at fixed origin', async () => {
  const calls: unknown[] = []
  const adapter = createDesignMediaAdapter(() => ({ subscribe: () => { throw new Error('must not submit') } }), 'mock-key:mock-secret',
    ((url: unknown, options: RequestInit) => { calls.push([url, options.method, options.redirect]); return Promise.resolve(Response.json({ status: 'in_progress', request_id: 'r1', status_url: 'https://attacker.example' })) }) as typeof fetch)
  assertEquals(await adapter.status('r1', savedUrl('r1')), { state: 'pending', requestId: 'r1', statusUrl: savedUrl('r1') })
  await assertRejects(() => adapter.status('../secrets', savedUrl('r1')))
  assertEquals(calls, [['https://api.higgsfield.ai/requests/r1/status', 'GET', 'error']])
})
Deno.test('status errors and mismatched receipt identity cannot become completed', async () => {
  for (const response of [Response.json({ status: 'completed', request_id: 'wrong', video: { url: 'https://example.com/v' } }), new Response('secret', { status: 500 })]) {
    const adapter = createDesignMediaAdapter(() => ({ subscribe: async () => null }), 'mock-key:mock-secret', (() => Promise.resolve(response)) as typeof fetch)
    await assertRejects(() => adapter.status('r1', savedUrl('r1')), Error, 'retain the original')
  }
  assertThrows(() => createDesignMediaAdapter(() => ({ subscribe: async () => null }), ''), Error, 'unavailable')
})

Deno.test('unrecognized cancellation never implies a refund, safe retry or successful cancellation', async () => {
  const { adapter, calls } = fixture({ status: 'cancelled', request_id: 'r1', cancel_url: 'https://attacker.example' })
  await assertRejects(() => adapter.submit(input), Error, 'outcome unknown')
  assertEquals(calls.length, 2)
  assertEquals('cancel' in adapter, false)
})

Deno.test('moderation refusal drops output and untrusted provider metadata', async () => {
  const { adapter } = fixture({ status: 'nsfw', request_id: 'r1', video: { url: 'https://example.com/refused.mp4' }, detail: 'private prompt' })
  assertEquals(await adapter.submit(input), { state: 'safety_refused', requestId: 'r1' })
})

Deno.test('temporary recovery failure retains identity and next recovery never submits', async () => {
  let reads = 0
  let submissions = 0
  const adapter = createDesignMediaAdapter(() => ({ subscribe: async () => { submissions++; return null } }), 'mock-key:mock-secret',
    (() => {
      reads++
      if (reads === 1) throw new Error('timeout containing mock-secret')
      return Promise.resolve(Response.json({ status: 'completed', request_id: 'same-request', video: { url: 'https://example.com/video.mp4' } }))
    }) as typeof fetch)
  const error = await assertRejects(() => adapter.status('same-request', savedUrl('same-request')), Error, 'retain the original')
  assertEquals(error.message.includes('mock-secret'), false)
  assertEquals((await adapter.status('same-request', savedUrl('same-request'))).requestId, 'same-request')
  assertEquals(submissions, 0)
  assertEquals(reads, 2)
})

Deno.test('untyped invalid identities are rejected before HTTP and initialization errors are sanitized', async () => {
  let reads = 0
  const adapter = createDesignMediaAdapter(() => ({ subscribe: async () => null }), 'mock-key:mock-secret',
    (() => { reads++; throw new Error('must not read') }) as typeof fetch)
  for (const id of [null, undefined, 123, {}, '', '../r', 'r?x=1']) {
    await assertRejects(() => adapter.status(id as string, savedUrl('r1')), Error, 'Invalid provider request identity')
  }
  assertEquals(reads, 0)
  const error = assertThrows(() => createDesignMediaAdapter(() => { throw new Error('mock-secret') }, 'mock-key:mock-secret'), Error, 'client unavailable')
  assertEquals(error.message.includes('mock-secret'), false)
})

Deno.test('malformed receipt cannot be accepted as a known outcome', async () => {
  for (const raw of [null, {}, { status: 'queued' }, { status: 'queued', request_id: '../r' }, { status: 'completed', request_id: 'r1' }]) {
    const { adapter, calls } = fixture(raw)
    await assertRejects(() => adapter.submit(input), Error, 'outcome unknown')
    assertEquals(calls.length, 2)
  }
})

Deno.test('queued receipt requires a returned exact trusted status URL', async () => {
  for (const status_url of [undefined, 'http://api.higgsfield.ai/requests/r1/status', 'https://attacker.example/requests/r1/status', 'https://u:p@api.higgsfield.ai/requests/r1/status', savedUrl('r2'), `${savedUrl('r1')}?x=1`, `${savedUrl('r1')}#x`, 'https://api.higgsfield.ai/requests/x/../r1/status']) {
    await assertRejects(() => fixture({ status: 'queued', request_id: 'r1', status_url }).adapter.submit(input), Error, 'outcome unknown')
  }
})

Deno.test('recovery refuses untrusted saved URLs before sending credentials', async () => {
  let reads = 0
  const adapter = createDesignMediaAdapter(() => ({ subscribe: async () => null }), 'mock-key:mock-secret',
    (() => { reads++; throw new Error('must not read') }) as typeof fetch)
  for (const url of [savedUrl('other'), 'https://attacker.example', `${savedUrl('r1')}?token=x`, `${savedUrl('r1')}#x`, 'https://u:p@api.higgsfield.ai/requests/r1/status']) {
    await assertRejects(() => adapter.status('r1', url))
  }
  assertEquals(reads, 0)
})

Deno.test('terminal submissions preserve valid returned URLs and accept omitted URLs', async () => {
  for (const [status, state] of [['completed', 'provider_completed'], ['failed', 'provider_failed'], ['nsfw', 'safety_refused']] as const) {
    const raw = { status, request_id: 'r1', video: { url: 'https://example.com/video.mp4' } }
    const expected = { state, requestId: 'r1', ...(status === 'completed' ? { outputUrl: raw.video.url } : {}) }
    assertEquals(await fixture(raw).adapter.submit(input), expected)
    assertEquals(await fixture({ ...raw, status_url: savedUrl('r1') }).adapter.submit(input), { ...expected, statusUrl: savedUrl('r1') })
    await assertRejects(() => fixture({ ...raw, status_url: savedUrl('other') }).adapter.submit(input), Error, 'outcome unknown')
  }
})

Deno.test('terminal recovery keeps the saved URL and missing saved URL cannot trigger HTTP', async () => {
  let reads = 0
  const adapter = createDesignMediaAdapter(() => ({ subscribe: async () => null }), 'mock-key:mock-secret',
    (() => { reads++; return Promise.resolve(Response.json({ status: 'failed', request_id: 'r1', status_url: 'https://attacker.example' })) }) as typeof fetch)
  assertEquals(await adapter.status('r1', savedUrl('r1')), { state: 'provider_failed', requestId: 'r1', statusUrl: savedUrl('r1') })
  await assertRejects(() => adapter.status('r1', undefined as unknown as string))
  assertEquals(reads, 1)
})
