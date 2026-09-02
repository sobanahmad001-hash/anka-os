import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildPerformanceDashboard } from './performanceDashboard.js'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const repository = read('./performanceDashboardRepository.js')
const ui = read('../apps/MarketingStudio.jsx')
const edge = read('../../supabase/functions/marketing-studio/index.ts')

const organizationId = 'organization-a'
const brand = { id: 'brand-a', name: 'Anka', organization_id: organizationId }
const period = { start: '2026-08-01', end: '2026-08-31' }

test('MK6c rolls up every fixed section and keeps unlike sources separate', () => {
  const dashboard = buildPerformanceDashboard({
    brand,
    period,
    googleDashboard: {
      brand_id: brand.id,
      reports: [
        { provider: 'google_search_console', totals: { clicks: 30, impressions: 300 }, rows: [
          { date: '2026-08-01', clicks: 10, impressions: 100 },
          { date: '2026-08-02', clicks: 20, impressions: 200 },
        ] },
        { provider: 'google_analytics', totals: { active_users: 80, sessions: 100, events: 250 }, rows: [] },
      ],
    },
    pageHealth: [
      { tracked_page_id: 'page-1', organization_id: organizationId, brand_id: brand.id, page_url: 'https://anka.test/', open_issue_count: 2, needs_attention: true, index_status: 'indexed', schema_valid: false },
      { tracked_page_id: 'foreign-page', organization_id: 'organization-b', brand_id: brand.id, page_url: 'https://foreign.test/', open_issue_count: 50, needs_attention: true },
    ],
    trackedKeywords: [
      { id: 'keyword-1', organization_id: organizationId, brand_id: brand.id, active: true },
      { id: 'keyword-2', organization_id: organizationId, brand_id: brand.id, active: true },
      { id: 'foreign-keyword', organization_id: 'organization-b', brand_id: brand.id, active: true },
    ],
    rankSnapshots: [
      { organization_id: organizationId, tracked_keyword_id: 'keyword-1', snapshot_date: '2026-08-01', position: 12 },
      { organization_id: organizationId, tracked_keyword_id: 'keyword-1', snapshot_date: '2026-08-31', position: 7 },
      { organization_id: organizationId, tracked_keyword_id: 'keyword-2', snapshot_date: '2026-08-31', position: null },
      { organization_id: 'organization-b', tracked_keyword_id: 'foreign-keyword', snapshot_date: '2026-08-31', position: 1 },
    ],
    adCampaigns: [
      { id: 'campaign-1', organization_id: organizationId, brand_id: brand.id, status: 'active' },
      { id: 'foreign-campaign', organization_id: 'organization-b', brand_id: brand.id, status: 'active' },
    ],
    adSnapshots: [
      { organization_id: organizationId, ad_campaign_id: 'campaign-1', snapshot_date: '2026-08-02', impressions: 1000, clicks: 50, cost: 125, conversions: 5 },
      { organization_id: 'organization-b', ad_campaign_id: 'foreign-campaign', snapshot_date: '2026-08-02', impressions: 9000, clicks: 900, cost: 900, conversions: 90 },
    ],
    metaConnections: [
      { id: 'meta-1', organization_id: organizationId, brand_id: brand.id },
      { id: 'foreign-meta', organization_id: 'organization-b', brand_id: brand.id },
    ],
    metaSnapshots: [
      { organization_id: organizationId, meta_connection_id: 'meta-1', snapshot_date: '2026-08-02', platform: 'facebook', reach: 500, impressions: 700, engagement: 70 },
      { organization_id: 'organization-b', meta_connection_id: 'foreign-meta', snapshot_date: '2026-08-02', platform: 'instagram', reach: 5000, impressions: 7000, engagement: 700 },
    ],
  })

  assert.deepEqual(dashboard.organic.gsc.trend, [
    { date: '2026-08-01', clicks: 10, impressions: 100 },
    { date: '2026-08-02', clicks: 20, impressions: 200 },
  ])
  assert.deepEqual(dashboard.organic.ga4, { connected: true, active_users: 80, sessions: 100, events: 250 })
  assert.deepEqual(dashboard.organic.keywords, {
    tracked: 2, ranked: 1, no_rank_data: 1, top_3: 0, top_10: 1, top_20: 1, average_position: 7, improved: 1,
  })
  assert.equal(dashboard.technical.tracked_pages, 1)
  assert.equal(dashboard.technical.pages_with_open_issues, 1)
  assert.equal(dashboard.technical.open_issues, 2)
  assert.equal(dashboard.paid.spend, 125)
  assert.equal(dashboard.paid.ctr, 0.05)
  assert.equal(dashboard.social.reach, 500)
  assert.equal(dashboard.social.engagement_rate, 0.1)
})

test('MK6c returns honest empty states when connectors or source rows are missing', () => {
  const dashboard = buildPerformanceDashboard({ brand, period, googleDashboard: { brand_id: brand.id, reports: [] } })
  assert.equal(dashboard.organic.available, false)
  assert.equal(dashboard.technical.available, false)
  assert.equal(dashboard.paid.available, false)
  assert.equal(dashboard.social.available, false)
  assert.deepEqual(dashboard.source_errors, [])
})

test('MK6c stays live-computed, RLS-backed, fixed, and read-only', () => {
  for (const source of ['tracked_page_current_health', 'tracked_keywords', 'ad_campaigns', 'meta_connections']) {
    assert.match(repository, new RegExp(`from\\('${source}'\\)`))
  }
  for (const source of ['keyword_rank_snapshots', 'ad_campaign_performance_snapshots', 'meta_performance_snapshots']) {
    assert.match(repository, new RegExp(`'${source}'`))
  }
  assert.match(repository, /analytics_dashboard/)
  assert.match(repository, /\.eq\('brand_id', brand\.id\)/)
  assert.match(repository, /\.gte\('snapshot_date', period\.start\)/)
  assert.match(repository, /\.lte\('snapshot_date', period\.end\)/)
  assert.doesNotMatch(repository, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
  assert.doesNotMatch(repository, /localStorage|sessionStorage|indexedDB|cache/i)
  assert.match(ui, /Organic visibility/)
  assert.match(ui, /Technical health/)
  assert.match(ui, /Paid performance/)
  assert.match(ui, /Social performance/)
  assert.doesNotMatch(ui, /add widget|configure widget|widget builder/i)
  assert.match(edge, /dimensions: \['date'\]/)
  assert.doesNotMatch(edge, /mutateCampaigns|sitemaps\/(submit|delete)|instagram_content_publish/)
})
