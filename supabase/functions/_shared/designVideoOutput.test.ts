import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { fetchDesignVideoOutput } from './designVideoOutput.ts'

const source = 'https://media.vendor.example/file.mp4?token=private'
const bytes = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])
const response = (body: Uint8Array, headers: Record<string,string> = {}) =>
  new Response(new Uint8Array(body).buffer as ArrayBuffer,
    { headers: { 'content-type': 'video/mp4', ...headers } })

Deno.test('private ingestion requires exact configured host and checks bytes before storage', async () => {
  const calls: unknown[] = []
  const fetched = await fetchDesignVideoOutput(source, ['media.vendor.example'], 'mp4',
    (async (url, options) => { calls.push([url, options?.redirect]); return response(bytes) }) as typeof fetch)
  assertEquals(calls, [[source, 'error']])
  assertEquals(fetched.byteLength, 12)
  assertEquals(fetched.contentType, 'video/mp4')
  assertEquals(fetched.checksum.length, 64)
})

Deno.test('unapproved hosts and redirects never enter storage', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; return Response.redirect('https://other.example/video.mp4') }) as typeof fetch
  for (const url of [
    'http://media.vendor.example/file.mp4', 'https://127.0.0.1/file.mp4',
    'https://media.vendor.example.attacker.example/file.mp4',
    'https://user:secret@media.vendor.example/file.mp4',
  ]) await assertRejects(() => fetchDesignVideoOutput(url, ['media.vendor.example'], 'mp4', fetcher))
  assertEquals(calls, 0)
  await assertRejects(() => fetchDesignVideoOutput(source, ['media.vendor.example'], 'mp4', fetcher))
  assertEquals(calls, 1)
})

Deno.test('oversize, wrong type and invalid container signature fail closed', async () => {
  await assertRejects(() => fetchDesignVideoOutput(source, ['media.vendor.example'], 'mp4',
    (async () => response(bytes, { 'content-length': '100' })) as typeof fetch, 16))
  await assertRejects(() => fetchDesignVideoOutput(source, ['media.vendor.example'], 'mp4',
    (async () => response(new Uint8Array(20))) as typeof fetch, 16))
  await assertRejects(() => fetchDesignVideoOutput(source, ['media.vendor.example'], 'mp4',
    (async () => response(bytes, { 'content-type': 'text/html' })) as typeof fetch))
  await assertRejects(() => fetchDesignVideoOutput(source, ['media.vendor.example'], 'mp4',
    (async () => response(new Uint8Array(12))) as typeof fetch))
})
