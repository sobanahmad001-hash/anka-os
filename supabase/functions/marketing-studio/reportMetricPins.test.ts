import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { pinMarketingReportMetrics, validateMarketingReportMetricRefs } from './reportMetricPins.ts'

const org = 'org-a'
const brand = 'brand-a'
const id = '11111111-1111-4111-8111-111111111111'
const foreignId = '22222222-2222-4222-8222-222222222222'
const fixtures: Record<string, Record<string, unknown>[]> = {
  ad_campaign_performance_snapshots: [
    { id, organization_id: org, ad_campaign_id: 'campaign-a', snapshot_date: '2026-08-15',
      impressions: 120, clicks: 12, cost: 8.5, conversions: 2, provider_connection_id: 'connection-a',
      external_campaign_id: '123', created_at: '2026-08-16T10:00:00Z' },
    { id: foreignId, organization_id: org, ad_campaign_id: 'campaign-b', snapshot_date: '2026-08-15',
      impressions: 900, clicks: 90, cost: 99, conversions: 9, provider_connection_id: 'connection-b',
      external_campaign_id: '456', created_at: '2026-08-16T10:00:00Z' },
  ],
  keyword_rank_snapshots: [{ id: '33333333-3333-4333-8333-333333333333', organization_id: org,
    tracked_keyword_id: 'keyword-a', snapshot_date: '2026-08-12', position: 7,
    search_console_clicks: 4, search_console_impressions: 80, fetched_at: '2026-08-13T09:00:00Z' }],
  tracked_keywords: [{ id: 'keyword-a', organization_id: org, brand_id: brand, keyword: 'anka sphere' }],
  meta_performance_snapshots: [{ id: '44444444-4444-4444-8444-444444444444', organization_id: org,
    meta_connection_id: 'meta-a', snapshot_date: '2026-08-14', platform: 'instagram',
    reach: 30, impressions: 40, engagement: 5, created_at: '2026-08-15T09:00:00Z' }],
  meta_connections: [{ id: 'meta-a', organization_id: org, brand_id: brand,
    instagram_account_id: 'ig-1', integration_connection_id: 'integration-a' }],
  ad_campaigns: [
    { id: 'campaign-a', organization_id: org, brand_id: brand, campaign_name: 'Brand campaign', external_account_id: 'account-123' },
    { id: 'campaign-b', organization_id: org, brand_id: 'brand-b', campaign_name: 'Foreign brand campaign' },
  ],
}
function adminFor(data = fixtures) {
  return { from(table: string) {
    return { select(_columns: string) {
      return { eq(column: string, value: string) {
        return { async in(key: string, values: string[]) {
          return { data: (data[table] || []).filter(row => row[column] === value && values.includes(String(row[key]))), error: null }
        } }
      } }
    } }
  } }
}

Deno.test('M05 exact metric references reject duplicates and invalid IDs', () => {
  assertEquals(validateMarketingReportMetricRefs(undefined), [])
  assertEquals(validateMarketingReportMetricRefs([{ source: 'google_ads', snapshot_id: id }]),
    [{ source: 'google_ads', snapshot_id: id }])
  assertThrows(() => validateMarketingReportMetricRefs([{ source: 'google_ads', snapshot_id: id },
    { source: 'google_ads', snapshot_id: id }]))
  assertThrows(() => validateMarketingReportMetricRefs([{ source: 'google_ads', snapshot_id: 'not-uuid' }]))
  assertThrows(() => validateMarketingReportMetricRefs([{ source: '__proto__', snapshot_id: id }]))
})

Deno.test('M05 pins exact stored values and collection time without claiming unknown definitions', async () => {
  const pins = await pinMarketingReportMetrics(adminFor(), org, brand, { start: '2026-08-01', end: '2026-08-31' },
    [{ source: 'google_ads', snapshot_id: id }], '2026-09-21T12:00:00Z')
  assertEquals(pins.length, 1)
  assertEquals(pins[0].metrics, { impressions: 120, clicks: 12, cost: 8.5, conversions: 2 })
  assertEquals(pins[0].source_record_id, id)
  assertEquals(pins[0].retrieved_at, '2026-08-16T10:00:00Z')
  assertEquals(pins[0].definitions, {
    metric_units: { impressions: 'count', clicks: 'count', cost: 'currency amount', conversions: 'count' },
    reporting_timezone: null, currency: null, provider_finality: null,
  })
  assertEquals(pins[0].source_filter, {
    brand_id: brand, parent_id: 'campaign-a', period_start: '2026-08-01', period_end: '2026-08-31',
  })
})

Deno.test('M05 pins keyword and Meta observations with unavailable definitions', async () => {
  const refs = validateMarketingReportMetricRefs([
    { source: 'keyword_tracking', snapshot_id: '33333333-3333-4333-8333-333333333333' },
    { source: 'meta', snapshot_id: '44444444-4444-4444-8444-444444444444' },
  ])
  const pins = await pinMarketingReportMetrics(adminFor(), org, brand,
    { start: '2026-08-01', end: '2026-08-31' }, refs, '2026-09-21T12:00:00Z')
  assertEquals(pins.length, 2)
  assertEquals(pins.find(pin => pin.source === 'keyword_tracking')?.metrics,
    { position: 7, search_console_clicks: 4, search_console_impressions: 80 })
  assertEquals(pins.find(pin => pin.source === 'meta')?.metrics,
    { reach: 30, impressions: 40, engagement: 5 })
  assertEquals(pins.find(pin => pin.source === 'meta')?.definitions,
    { metric_units: { reach: 'count', impressions: 'count', engagement: 'count' },
      reporting_timezone: null, provider_finality: null })
})

Deno.test('M05 refuses another brand, missing row, and out-of-period metric evidence', async () => {
  const period = { start: '2026-08-01', end: '2026-08-31' }
  await assertRejects(() => pinMarketingReportMetrics(adminFor(), org, brand, period,
    [{ source: 'google_ads', snapshot_id: foreignId }], '2026-09-21T12:00:00Z'))
  await assertRejects(() => pinMarketingReportMetrics(adminFor(), org, brand,
    { start: '2026-09-01', end: '2026-09-30' }, [{ source: 'google_ads', snapshot_id: id }], '2026-09-21T12:00:00Z'))
  await assertRejects(() => pinMarketingReportMetrics(adminFor({}), org, brand, period,
    [{ source: 'google_ads', snapshot_id: id }], '2026-09-21T12:00:00Z'))
})
