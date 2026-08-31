import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { fetchUrlInspection, mapInspectionResult, normalizePageUrl } from './index.ts'

Deno.test('tracked page URLs are normalized without fragments or trailing slashes', () => {
  assertEquals(normalizePageUrl('https://Example.com/service/#section'), 'https://example.com/service')
  assertThrows(() => normalizePageUrl('javascript:alert(1)'), Error, 'HTTP or HTTPS')
})

Deno.test('URL Inspection maps only documented indexation signals', () => {
  assertEquals(mapInspectionResult({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } } }).index_status, 'indexed')
  assertEquals(mapInspectionResult({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' } } }).index_status, 'discovered_not_indexed')
  assertEquals(mapInspectionResult({ inspectionResult: { indexStatusResult: { verdict: 'FAIL', coverageState: 'Blocked by robots.txt' } } }).index_status, 'excluded')
})

Deno.test('URL Inspection uses the read-only Search Console endpoint', async () => {
  let url = ''; let body = ''
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input); body = String(init?.body || '')
    return new Response(JSON.stringify({ inspectionResult: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  await fetchUrlInspection('token', 'https://example.com/page', 'sc-domain:example.com', fetcher)
  assertEquals(url, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect')
  assertEquals(JSON.parse(body), { inspectionUrl: 'https://example.com/page', siteUrl: 'sc-domain:example.com', languageCode: 'en-US' })
  await assertRejects(() => fetchUrlInspection('token', 'https://example.com/page', 'sc-domain:example.com', async () => new Response('{}', { status: 403 })))
})
