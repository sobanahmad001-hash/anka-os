import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import {
  fetchReadOnlyGoogleReport,
  fetchGoogleAdsCampaignSnapshot,
  handleRequest,
  hasMarketingAuthority,
  safeDateRange,
  validateBacklinkTarget,
  validateAdCampaign,
  validateAdGroup,
  validateAdKeyword,
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
  assertThrows(() => validateBacklinkTarget({ site_name: 'Bad host', site_url: 'https://...' }), Error, 'HTTP or HTTPS')
  assertThrows(() => validateBacklinkTarget({ site_name: 'Bad score', relevance_score: 101 }), Error, 'between 0 and 100')
  assertThrows(() => validateBacklinkTarget({ site_name: 'Bad status', outreach_status: 'emailed' }), Error, 'Unsupported')
})

function backlinkServerPath(membership: Record<string, unknown>) {
  const writes: Array<Record<string, unknown>> = []
  let clientCount = 0
  const userClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor-id' } }, error: null }) },
  }
  const admin = {
    from(table: string) {
      let inserted: Record<string, unknown> | null = null
      const builder = {
        select() { return builder },
        eq() { return builder },
        insert(value: Record<string, unknown>) { inserted = value; writes.push(value); return builder },
        async maybeSingle() {
          if (table === 'organization_memberships') return { data: membership, error: null }
          if (table === 'brands') return { data: { id: 'brand-id', organization_id: membership.organization_id, name: 'Brand' }, error: null }
          return { data: null, error: null }
        },
        async single() {
          return { data: { id: 'target-id', ...inserted }, error: null }
        },
      }
      return builder
    },
  }
  const factory = () => clientCount++ === 0 ? userClient : admin
  return { factory: factory as never, writes }
}

async function createBacklinkThroughServer(membership: Record<string, unknown>) {
  const path = backlinkServerPath(membership)
  const request = new Request('https://functions.example/marketing-studio', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create_backlink_target', brand_id: 'brand-id',
      target: { site_name: 'Industry journal', site_url: 'https://journal.example.com' },
    }),
  })
  const response = await handleRequest(request, {
    createClient: path.factory,
    environment: { supabaseUrl: 'https://project.supabase.co', publishableKey: 'publishable', secretKey: 'secret' },
  })
  return { response, writes: path.writes }
}

Deno.test('handleRequest permits Marketing and leadership backlink writes and denies unrelated departments', async () => {
  const base = { organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', status: 'active', member_kind: 'team' }
  const marketing = await createBacklinkThroughServer({ ...base, role: 'contributor', department_id: 'marketing' })
  const leadership = await createBacklinkThroughServer({ ...base, role: 'operations_admin', department_id: null })
  const unrelated = await createBacklinkThroughServer({ ...base, role: 'contributor', department_id: 'design' })
  assertEquals(marketing.response.status, 200)
  assertEquals(marketing.writes.length, 1)
  assertEquals(leadership.response.status, 200)
  assertEquals(leadership.writes.length, 1)
  assertEquals(unrelated.response.status, 403)
  assertEquals(unrelated.writes.length, 0)
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

Deno.test('MK3 planning validators enforce hierarchy vocabulary and complete provider identity', () => {
  const campaign = validateAdCampaign({
    campaign_name: 'Brand search', campaign_type: 'search', status: 'draft',
    daily_budget: '25', location_targeting: ['Karachi'],
  })
  assertEquals(campaign.daily_budget, 25)
  assertEquals(validateAdGroup({ name: 'Services', status: 'active' }), { name: 'Services', status: 'active' })
  assertEquals(validateAdKeyword({ keyword: 'digital agency', match_type: 'phrase', is_negative: false }), {
    keyword: 'digital agency', match_type: 'phrase', is_negative: false,
  })
  assertThrows(() => validateAdCampaign({ campaign_name: 'Broken', campaign_type: 'search', provider_connection_id: 'x' }), Error, 'supplied together')
  assertThrows(() => validateAdKeyword({ keyword: 'x', match_type: 'unsupported' }), Error, 'Unsupported')
})

Deno.test('MK3 snapshot reader issues one reporting-only query and maps provider metrics', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify([{ results: [{
      campaign: { id: '987654321' }, segments: { date: '2026-08-30' },
      metrics: { impressions: '100', clicks: '10', costMicros: '25000000', conversions: '2' },
    }] }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const snapshot = await fetchGoogleAdsCampaignSnapshot(
    'token', { customer_id: '1234567890' }, '987654321', '2026-08-30', fetcher,
    { googleAdsDeveloperToken: 'developer-token' },
  )
  assertEquals(snapshot, { snapshot_date: '2026-08-30', impressions: 100, clicks: 10, cost: 25, conversions: 2 })
  assertEquals(calls[0].url, 'https://googleads.googleapis.com/v24/customers/1234567890/googleAds:searchStream')
  assertEquals(calls[0].init?.method, 'POST')
  const body = String(calls[0].init?.body)
  assertEquals(/campaign\.id = 987654321/.test(body), true)
  assertEquals(/segments\.date = '2026-08-30'/.test(body), true)
  assertEquals(/mutate|create|update|remove|pause|enable/i.test(calls[0].url + body), false)
})
