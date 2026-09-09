import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { fetchSearchConsoleKeywordRank, fetchUrlInspection, mapInspectionResult, normalizePageUrl, setKeywordActive } from './index.ts'

function query(result: unknown, calls: Array<unknown[]>) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'eq', 'update']) builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  builder.maybeSingle = async () => result
  builder.single = async () => result
  return builder
}

function keywordClients({ active = true, allowed = true } = {}) {
  const calls: Array<unknown[]> = []
  const tables: string[] = []
  const keyword = { id: 'keyword-1', organization_id: 'org-a', brand_id: 'brand-a', tracked_page_id: 'page-a', active }
  const userClient = { from(table: string) { tables.push(`user:${table}`); return query({ data: keyword, error: null }, calls) } }
  const admin = { from(table: string) {
    tables.push(`admin:${table}`)
    if (table === 'organization_memberships') return query({ data: allowed ? { status: 'active', member_kind: 'team', department_id: 'marketing', role: 'member' } : { status: 'active', member_kind: 'team', department_id: 'content', role: 'member' }, error: null }, calls)
    return query({ data: { ...keyword, active: !active }, error: null }, calls)
  } }
  return { userClient: userClient as never, admin: admin as never, calls, tables }
}

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

Deno.test('keyword ranks use the existing read-only Search Analytics endpoint and preserve no-rank results', async () => {
  let url = ''; let body = ''
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input); body = String(init?.body || '')
    return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const empty = await fetchSearchConsoleKeywordRank('token', 'sc-domain:example.com', 'https://example.com/service', 'design agency', fetcher)
  assertEquals(empty, { position: null, clicks: null, impressions: null })
  assertEquals(url, 'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query')
  const payload = JSON.parse(body)
  assertEquals(payload.dataState, 'final')
  assertEquals(payload.startDate, new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10))
  assertEquals(payload.endDate, new Date(Date.now() - 1 * 86_400_000).toISOString().slice(0, 10))
  assertEquals(payload.dimensions, ['query'])
  assertEquals(payload.dimensionFilterGroups[0].filters, [
    { dimension: 'page', operator: 'equals', expression: 'https://example.com/service' },
    { dimension: 'query', operator: 'equals', expression: 'design agency' },
  ])
})

Deno.test('keyword pause uses canonical tenant scope and never touches rank history', async () => {
  const { userClient, admin, calls, tables } = keywordClients()
  const result = await setKeywordActive(userClient, admin, 'user-a', {
    keywordId: 'keyword-1', active: false, organizationId: 'stale-org', brandId: 'stale-brand',
  })
  assertEquals(result.active, false)
  assertEquals(calls.filter(call => call[0] === 'eq').slice(-4), [
    ['eq', 'id', 'keyword-1'], ['eq', 'organization_id', 'org-a'], ['eq', 'brand_id', 'brand-a'], ['eq', 'tracked_page_id', 'page-a'],
  ])
  assertEquals(tables.includes('admin:keyword_rank_snapshots'), false)
})

Deno.test('keyword status rejects denied writers and repeat requests are idempotent', async () => {
  const denied = keywordClients({ allowed: false })
  await assertRejects(() => setKeywordActive(denied.userClient, denied.admin, 'user-a', { keywordId: 'keyword-1', active: false }), Error, 'Marketing department')
  assertEquals(denied.calls.some(call => call[0] === 'update'), false)

  const repeat = keywordClients({ active: false })
  const result = await setKeywordActive(repeat.userClient, repeat.admin, 'user-a', { keywordId: 'keyword-1', active: false })
  assertEquals(result.active, false)
  assertEquals(repeat.calls.some(call => call[0] === 'update'), false)
})
