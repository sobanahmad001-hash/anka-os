import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildMarketingConnectionReadiness,
  canManageMarketingConnections,
  shouldApplyConnectionReadinessResponse,
} from './marketingConnectionReadiness.js'
import { collectConnectionReadinessPages } from './marketingConnectionReadinessRepository.js'

const organizationId = 'org-a'
const brand = { id: 'brand-a', organization_id: organizationId, name: 'Anka' }
const now = new Date('2026-09-04T12:00:00Z')

function fixture() {
  return {
    organizationId,
    brand,
    now,
    engagements: [
      { id: 'engagement-1', organization_id: organizationId, brand_id: brand.id, name: 'Launch' },
      { id: 'engagement-2', organization_id: organizationId, brand_id: brand.id, name: 'Retainer' },
      { id: 'engagement-foreign', organization_id: 'org-b', brand_id: 'brand-b', name: 'Private' },
    ],
    mappings: [
      { connection_id: 'ga', organization_id: organizationId, engagement_id: 'engagement-1', department_id: 'marketing' },
      { connection_id: 'ga', organization_id: organizationId, engagement_id: 'engagement-2', department_id: 'marketing' },
      { connection_id: 'gsc', organization_id: organizationId, engagement_id: 'engagement-1', department_id: 'marketing' },
      { connection_id: 'foreign', organization_id: 'org-b', engagement_id: 'engagement-foreign', department_id: 'marketing' },
    ],
    connections: [
      { id: 'ga', organization_id: organizationId, provider: 'google_analytics', display_name: 'GA primary', public_config: { property_id: '1234' }, status: 'verified', last_checked_at: '2026-09-04T11:59:00Z' },
      { id: 'gsc', organization_id: organizationId, provider: 'google_search_console', display_name: 'Search property', public_config: { site_url: 'sc-domain:anka.test' }, status: 'error' },
      { id: 'ads', organization_id: organizationId, provider: 'google_ads', display_name: 'Ads reporting', public_config: { customer_id: '1112223333' }, status: 'verified' },
      { id: 'meta', organization_id: organizationId, provider: 'meta', display_name: 'Meta organic', public_config: { facebook_page_name: 'Anka Page' }, status: 'verified' },
      { id: 'foreign', organization_id: 'org-b', provider: 'google_analytics', display_name: 'Private GA', public_config: { property_id: 'private' }, status: 'verified' },
    ],
    metaConnections: [
      { id: 'meta-map', organization_id: organizationId, integration_connection_id: 'meta', brand_id: brand.id, facebook_page_id: '9988', token_expires_at: '2026-10-01T00:00:00Z' },
      { id: 'meta-foreign', organization_id: 'org-b', integration_connection_id: 'foreign', brand_id: 'brand-b', facebook_page_id: 'private' },
    ],
    adCampaigns: [
      { id: 'ad-1', organization_id: organizationId, brand_id: brand.id, provider_connection_id: 'ads', external_account_id: '1112223333' },
      { id: 'ad-2', organization_id: organizationId, brand_id: brand.id, provider_connection_id: 'ads', external_account_id: '9998887777' },
      { id: 'ad-foreign', organization_id: 'org-b', brand_id: 'brand-b', provider_connection_id: 'foreign', external_account_id: 'private' },
    ],
    adSnapshots: [
      { id: 'ad-snapshot-current', organization_id: organizationId, ad_campaign_id: 'ad-1', provider_connection_id: 'ads', created_at: '2026-09-04T06:00:00Z' },
      { id: 'ad-snapshot-old', organization_id: organizationId, ad_campaign_id: 'ad-2', provider_connection_id: 'ads', created_at: '2026-09-02T06:00:00Z' },
      { id: 'ad-snapshot-foreign', organization_id: 'org-b', ad_campaign_id: 'ad-foreign', provider_connection_id: 'foreign', created_at: '2026-09-04T11:00:00Z' },
    ],
    metaSnapshots: [
      { id: 'meta-snapshot', organization_id: organizationId, meta_connection_id: 'meta-map', created_at: '2026-09-03T10:00:00Z' },
      { id: 'meta-snapshot-foreign', organization_id: 'org-b', meta_connection_id: 'meta-foreign', created_at: '2026-09-04T11:00:00Z' },
    ],
  }
}

test('rows preserve connection, account/resource, and each visible brand mapping identity', () => {
  const rows = buildMarketingConnectionReadiness(fixture())
  const analytics = rows.filter(item => item.provider === 'google_analytics')
  const ads = rows.filter(item => item.provider === 'google_ads')
  assert.deepEqual(analytics.map(item => item.mappingLabel), ['Launch', 'Retainer'])
  assert.equal(new Set(analytics.map(item => item.id)).size, 2)
  assert.deepEqual(ads.map(item => item.accountId), ['1112223333', '9998887777'])
  assert.equal(rows.some(item => item.accountId === 'private'), false)
})

test('only persisted provider snapshots can establish healthy or stale readiness', () => {
  const rows = buildMarketingConnectionReadiness(fixture())
  const analytics = rows.find(item => item.provider === 'google_analytics')
  const currentAds = rows.find(item => item.provider === 'google_ads' && item.accountId === '1112223333')
  const oldAds = rows.find(item => item.provider === 'google_ads' && item.accountId === '9998887777')
  const meta = rows.find(item => item.provider === 'meta')
  assert.equal(analytics.state, 'connected_no_data')
  assert.equal(analytics.lastSuccessfulRead, null)
  assert.equal(currentAds.state, 'healthy')
  assert.equal(oldAds.state, 'stale')
  assert.equal(meta.state, 'stale')
  assert.equal(meta.staleAfterHours, 24)
})

test('unsupported error evidence stays unavailable and capabilities use the closed contract', () => {
  const rows = buildMarketingConnectionReadiness(fixture())
  const search = rows.find(item => item.provider === 'google_search_console')
  assert.equal(search.state, 'status_unavailable')
  assert.equal(search.lastErrorCategory, null)
  assert.equal(search.capability, 'setup_only')
  assert.equal(rows.find(item => item.provider === 'google_analytics').capability, 'live_reporting_read')
  assert.equal(rows.find(item => item.provider === 'google_ads').capability, 'stored_snapshot_read')
  assert.equal(rows.find(item => item.provider === 'meta').capability, 'organic_insights')
})

test('missing sources are explicit not-configured setup-only rows', () => {
  const rows = buildMarketingConnectionReadiness({ organizationId, brand, now })
  assert.equal(rows.length, 4)
  assert.deepEqual(new Set(rows.map(item => item.state)), new Set(['not_configured']))
  assert.deepEqual(new Set(rows.map(item => item.capability)), new Set(['setup_only']))
  assert.equal(rows.every(item => item.lastSuccessfulRead === null && item.lastErrorCategory === null), true)
})

test('existing integration administration authority is not broadened', () => {
  assert.equal(canManageMarketingConnections({ role: 'system_owner' }), true)
  assert.equal(canManageMarketingConnections({ role: 'operations_admin' }), true)
  assert.equal(canManageMarketingConnections({ role: 'executive' }), true)
  assert.equal(canManageMarketingConnections({ role: 'department_manager' }), false)
  assert.equal(canManageMarketingConnections({ role: 'contributor' }), false)
})

test('foreign roots and mismatched brand envelopes fail closed', () => {
  const rows = buildMarketingConnectionReadiness(fixture())
  assert.equal(rows.some(item => item.connectionLabel.includes('Private')), false)
  assert.throws(() => buildMarketingConnectionReadiness({
    ...fixture(), brand: { ...brand, organization_id: 'org-b' },
  }), error => error.membershipMismatch)
})

test('stale organization, brand, revision, generation, and aborted responses are rejected', () => {
  const request = { organizationId, brandId: brand.id, revision: 3, signal: { aborted: false } }
  const current = { organizationId, brandId: brand.id, revision: 3 }
  assert.equal(shouldApplyConnectionReadinessResponse(request, current, 2, 2), true)
  assert.equal(shouldApplyConnectionReadinessResponse(request, { ...current, organizationId: 'org-b' }, 2, 2), false)
  assert.equal(shouldApplyConnectionReadinessResponse(request, { ...current, brandId: 'brand-b' }, 2, 2), false)
  assert.equal(shouldApplyConnectionReadinessResponse(request, { ...current, revision: 4 }, 2, 2), false)
  assert.equal(shouldApplyConnectionReadinessResponse(request, current, 1, 2), false)
  assert.equal(shouldApplyConnectionReadinessResponse({ ...request, signal: { aborted: true } }, current, 2, 2), false)
})

test('pagination walks deterministic inclusive 500-row ranges', async () => {
  const ranges = []
  const rows = await collectConnectionReadinessPages(async (from, to) => {
    ranges.push([from, to])
    return from < 1000 ? Array.from({ length: 500 }, (_, index) => from + index) : [1000]
  })
  assert.equal(rows.length, 1001)
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]])
})

test('production path is scoped, cancellable, paginated, presentation-only, and secret-free', async () => {
  const repository = await readFile(new URL('./marketingConnectionReadinessRepository.js', import.meta.url), 'utf8')
  const panel = await readFile(new URL('../components/MarketingConnectionReadinessPanel.jsx', import.meta.url), 'utf8')
  const studio = await readFile(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
  assert.match(repository, /abortSignal\(signal\)/)
  assert.match(repository, /\.range\(from, to\)/)
  assert.match(repository, /\.eq\('organization_id', organizationId\)/)
  assert.match(repository, /\.eq\('brand_id', brand\.id\)/)
  assert.doesNotMatch(repository, /integration_events|last_checked_at|last_check_status|secret_name/)
  assert.doesNotMatch(repository, /\.(?:insert|update|upsert|delete|rpc)\s*\(|functions\.invoke/)
  assert.doesNotMatch(panel, /onClick=\{[^}]*?(?:retry|authori[sz]e|mapping)|functions\.invoke|integrations?\.(?:test|start|configure|sync|disconnect)/i)
  assert.match(panel, /does not retry reads, contact providers, start authorization, or change mappings/)
  assert.match(panel, /Manage connections in Settings/)
  assert.match(studio, /SEO keyword history/)
  assert.match(studio, /Performance dashboard/)
  assert.match(studio, /Connections/)
})
