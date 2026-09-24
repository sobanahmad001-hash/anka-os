import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { createDesignMediaAdapter, type SdkFactory } from './designMediaAdapter.ts'

const input = { prompt: 'A cinematic scene at sunset', duration: 5, resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false }
function fixture(raw: unknown = { status: 'queued', request_id: 'request-1' }) {
  const calls: unknown[] = []
  const factory: SdkFactory = config => {
    calls.push(config)
    return { subscribe: async (endpoint, options) => { calls.push({ endpoint, options }); return raw } }
  }
  return { calls, adapter: createDesignMediaAdapter(factory, 'mock-key:mock-secret') }
}
Deno.test('SDK adapter disables submission retries and polling and strips extra fields', async () => {
  const { calls, adapter } = fixture()
  assertEquals(await adapter.submit({ ...input, extra: 'discard' } as typeof input), { state: 'pending', requestId: 'request-1' })
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
  assertEquals(await adapter.status('r1'), { state: 'pending', requestId: 'r1' })
  await assertRejects(() => adapter.status('../secrets'))
  assertEquals(calls, [['https://api.higgsfield.ai/requests/r1/status', 'GET', 'error']])
})
Deno.test('status errors and mismatched receipt identity cannot become completed', async () => {
  for (const response of [Response.json({ status: 'completed', request_id: 'wrong', video: { url: 'https://example.com/v' } }), new Response('secret', { status: 500 })]) {
    const adapter = createDesignMediaAdapter(() => ({ subscribe: async () => null }), 'mock-key:mock-secret', (() => Promise.resolve(response)) as typeof fetch)
    await assertRejects(() => adapter.status('r1'), Error, 'retain the original')
  }
  assertThrows(() => createDesignMediaAdapter(() => ({ subscribe: async () => null }), ''), Error, 'unavailable')
})
