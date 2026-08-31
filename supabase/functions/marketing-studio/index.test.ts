import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import {
  fetchReadOnlyGoogleReport,
  hasMarketingAuthority,
  safeDateRange,
  validateBacklinkTarget,
  validateCampaign,
  validateMarketingArtifact,
} from './index.ts'

Deno.test('Marketing authority keeps approval manager-controlled', () => {
  assertEquals(hasMarketingAuthority({ role: 'contributor', department_id: 'marketing' }, 'save_artifact'), true)
  assertEquals(hasMarketingAuthority({ role: 'contributor', department_id: 'marketing' }, 'approve_artifact'), false)
  assertEquals(hasMarketingAuthority({ role: 'department_manager', department_id: 'marketing' }, 'approve_artifact'), true)
  assertEquals(hasMarketingAuthority({ role: 'executive', department_id: null }, 'analytics_dashboard'), true)
})

Deno.test('campaign planning validates dates, channels, and informational budget', () => {
  const campaign = validateCampaign({ name: 'Launch', planned_channels: ['search', 'email'], planned_budget: '2500', currency_code: 'usd', status: 'planned' })
  assertEquals(campaign.planned_budget, 2500)
  assertEquals(campaign.currency_code, 'USD')
  assertThrows(() => validateCampaign({ name: 'Risk', planned_channels: ['paid'], planned_budget: -1 }), Error, 'non-negative')
})

Deno.test('backlink targets preserve unknown metrics and validate URLs, scores, and enums', () => {
  const target = validateBacklinkTarget({
    site_name: 'Local property guild', site_url: 'HTTPS://Example.COM/directory/',
    domain_authority: '', estimated_traffic: null, relevance_score: 91,
    link_type: 'membership', cost_type: 'paid', outreach_status: 'contacted',
  })
  assertEquals(target.site_url, 'https://example.com/directory')
  assertEquals(target.domain_authority, null)
  assertEquals(target.estimated_traffic, null)
  assertEquals(target.relevance_score, 91)
  assertThrows(() => validateBacklinkTarget({ site_name: 'Bad URL', site_url: 'ftp://example.com' }), Error, 'HTTP or HTTPS')
  assertThrows(() => validateBacklinkTarget({ site_name: 'Bad score', relevance_score: 101 }), Error, 'between 0 and 100')
  assertThrows(() => validateBacklinkTarget({ site_name: 'Bad status', outreach_status: 'emailed' }), Error, 'Unsupported')
})

Deno.test('backlink writes allow Marketing and leadership but deny unrelated departments', () => {
  assertEquals(hasMarketingAuthority({ role: 'contributor', department_id: 'marketing' }, 'create_backlink_target'), true)
  assertEquals(hasMarketingAuthority({ role: 'operations_admin', department_id: null }, 'update_backlink_target'), true)
  assertEquals(hasMarketingAuthority({ role: 'contributor', department_id: 'design' }, 'create_backlink_target'), false)
})

Deno.test('marketing report preserves source, period, insight, and recommended action', () => {
  const report = validateMarketingArtifact('marketing_report', {
    sources: ['GA4 · Primary'], period_start: '2026-08-01', period_end: '2026-08-27',
    executive_summary: 'Demand improved.', insights: ['Organic sessions increased.'],
    recommended_actions: ['Expand the winning landing page.'],
  })
  assertEquals(report.sources, ['GA4 · Primary'])
  assertThrows(() => safeDateRange('2026-09-01', '2026-08-01'), Error, 'ordered')
})

Deno.test('Google reporting adapter calls only the approved read-report endpoints', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  await fetchReadOnlyGoogleReport('google_analytics', 'token', { property_id: '123456' }, { start: '2026-08-01', end: '2026-08-27' }, fetcher)
  await fetchReadOnlyGoogleReport('google_search_console', 'token', { site_url: 'sc-domain:example.com' }, { start: '2026-08-01', end: '2026-08-27' }, fetcher)
  assertEquals(calls.map(call => call.url), [
    'https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport',
    'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query',
  ])
  assertEquals(calls.every(call => call.init?.method === 'POST'), true)
  assertEquals(calls.every(call => !/mutate|upload|delete|create/i.test(call.url)), true)
})

Deno.test('Google Ads reporting never falls back to a mutating endpoint', async () => {
  let called = ''
  const fetcher = (async (url: string | URL | Request) => {
    called = String(url)
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  await fetchReadOnlyGoogleReport(
    'google_ads', 'token', { customer_id: '1234567890' },
    { start: '2026-08-01', end: '2026-08-27' }, fetcher,
    { googleAdsDeveloperToken: 'test-developer-token' },
  )
  assertEquals(called, 'https://googleads.googleapis.com/v24/customers/1234567890/googleAds:searchStream')
  await assertRejects(() => fetchReadOnlyGoogleReport('unknown', 'token', {}, { start: '2026-08-01', end: '2026-08-27' }))
})
