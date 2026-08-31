import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { MARKETING_ARTIFACT_FORMS, adPerformanceMetrics, blankMarketingArtifact, campaignAfterDeletion, defaultReportingPeriod } from './marketingStudio.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const typeMigration = read('supabase/migrations/20260827190000_marketing_shared_type_extensions.sql')
const schemaMigration = read('supabase/migrations/20260827200000_marketing_campaigns.sql')
const mk3Migration = read('supabase/migrations/20260831124544_mk3_ad_campaign_tracking.sql')
const mk3Verifier = read('supabase/verify_20260831124544_mk3_ad_campaign_tracking.sql')
const edge = read('supabase/functions/marketing-studio/index.ts')
const googleOauth = read('supabase/functions/google-oauth/index.ts')
const googleTokens = read('supabase/functions/_shared/googleOAuthTokens.ts')
const ui = read('src/apps/MarketingStudio.jsx')
const app = read('src/App.jsx')
const navigation = read('src/config/environmentNav.js')

test('shared Marketing vocabulary is an isolated additive CHECK change', () => {
  assert.match(typeMigration, /alter table public\.artifacts[\s\S]*drop constraint artifacts_artifact_type_check/)
  for (const type of ['discovery', 'vision', 'audience', 'channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report']) {
    assert.match(typeMigration, new RegExp(type))
  }
  for (const event of ['campaign_created', 'campaign_updated']) assert.match(typeMigration, new RegExp(event))
  assert.doesNotMatch(typeMigration, /create table|create policy|enable row level security|add column|actor_id\s/)
})

test('campaign tables are tenant-scoped and browser read-only', () => {
  for (const table of ['marketing_campaigns', 'marketing_campaign_artifacts']) {
    assert.match(schemaMigration, new RegExp(`create table public\\.${table}`))
    assert.match(schemaMigration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(schemaMigration, /is_team_organization_member\(organization_id\)/)
  assert.match(schemaMigration, /revoke all on public\.marketing_campaigns, public\.marketing_campaign_artifacts[\s\S]*from anon, authenticated/)
  assert.doesNotMatch(schemaMigration, /grant (?:insert|update|delete|all)[\s\S]{0,250}to authenticated/)
  assert.match(schemaMigration, /planned_budget numeric\(14, 2\)[\s\S]*planned_budget >= 0/)
})

test('marketing artifacts reuse canonical immutable versions and approvals', () => {
  assert.equal(Object.keys(MARKETING_ARTIFACT_FORMS).length, 4)
  for (const type of Object.keys(MARKETING_ARTIFACT_FORMS)) {
    assert(Object.keys(blankMarketingArtifact(type)).length >= 5)
  }
  assert.match(edge, /admin\.from\('artifacts'\)\.insert/)
  assert.match(edge, /admin\.from\('artifact_versions'\)\.insert/)
  assert.match(edge, /admin\.from\('artifact_approvals'\)\.insert/)
  assert.doesNotMatch(schemaMigration, /create table public\.marketing_artifact/)
  assert.match(ui, /Create new version/)
  assert.match(ui, /Approve version/)
})

test('Google reporting reuses the encrypted OAuth store and remains externally read-only', () => {
  assert.match(edge, /googleAccessToken/)
  assert.match(googleTokens, /integration_oauth_credentials/)
  assert.match(googleTokens, /decryptSecret/)
  assert.match(googleOauth, /safeReportingConfig/)
  assert.match(edge, /analyticsdata\.googleapis\.com[\s\S]*:runReport/)
  assert.match(edge, /searchAnalytics\/query/)
  assert.match(edge, /googleAds:searchStream/)
  assert.doesNotMatch(edge, /mutateCampaigns|batchUpdate|sitemaps\/(submit|delete)|audienceExports\/create/)
  assert.doesNotMatch(ui, /mock|placeholder data[^\n]*\[/i)
})

test('Marketing Studio is a distinct lazy route while the department queue remains intact', () => {
  assert.match(app, /const MarketingStudio = lazy/)
  assert.match(app, /path="sphere\/marketing" element={<DepartmentWorkshop departmentId="marketing" \/>}/)
  assert.match(app, /path="sphere\/marketing\/studio" element={<MarketingStudio \/>}/)
  assert.match(navigation, /Marketing Workshop/)
  assert.match(navigation, /Marketing Studio/)
  assert.match(ui, /campaigns[\s\S]*artifacts[\s\S]*analytics/)
})

test('reporting period defaults to 28 completed days', () => {
  assert.deepEqual(defaultReportingPeriod(new Date('2026-08-27T12:00:00Z')), {
    start: '2026-07-30', end: '2026-08-26',
  })
})

test('out-of-scope publishing, client portal, and Development Studio work are absent', () => {
  assert.doesNotMatch(edge, /facebook|instagram|tiktok|client_portal|wordpress|ad_spend_transaction/i)
  assert.doesNotMatch(ui, /publish to|launch ads|change budget|Client Portal exposure/i)
})

test('MK3 hierarchy is tenant-consistent, indexed, constrained, and browser read-only', () => {
  for (const table of ['ad_campaigns', 'ad_groups', 'ad_group_keywords', 'ad_campaign_performance_snapshots']) {
    assert.match(mk3Migration, new RegExp(`create table public\\.${table}`))
    assert.match(mk3Migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(mk3Migration, /foreign key \(brand_id, organization_id\)/)
  assert.match(mk3Migration, /foreign key \(ad_campaign_id, organization_id\)/)
  assert.match(mk3Migration, /foreign key \(ad_group_id, organization_id\)/)
  assert.match(mk3Migration, /is_team_organization_member\(organization_id\)/)
  assert.match(mk3Migration, /revoke all[\s\S]*from anon, authenticated/)
  assert.doesNotMatch(mk3Migration, /grant (?:insert|update|delete|all)[\s\S]{0,250}to authenticated/)
  assert.match(mk3Migration, /unique \(ad_campaign_id, snapshot_date\)/)
  assert.match(mk3Verifier, /rollback;/)
  for (const isolationCheck of [
    'mk3_campaign_rls_isolation', 'mk3_ad_group_rls_isolation',
    'mk3_keyword_rls_isolation', 'mk3_snapshot_rls_isolation',
    'mk3_metrics_view_rls_isolation',
  ]) assert.match(mk3Verifier, new RegExp(isolationCheck))
  assert.doesNotMatch(mk3Verifier, /insert into mk3_runtime_checks values \(\s*\('/)
  assert.match(
    mk3Verifier,
    /'mk3_metrics_view_rls_isolation',[\s\S]*?where id = \(select snapshot_id from mk3_fixture_ids\)\s*\)\);/,
  )
})

test('MK3 derives performance ratios safely without storing duplicate metric columns', () => {
  assert.deepEqual(adPerformanceMetrics({ impressions: 100, clicks: 10, cost: 25, conversions: 2 }), {
    ctr: 0.1, cpc: 2.5, cost_per_conversion: 12.5,
  })
  assert.deepEqual(adPerformanceMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0 }), {
    ctr: null, cpc: null, cost_per_conversion: null,
  })
  const tableBody = mk3Migration.match(/create table public\.ad_campaign_performance_snapshots \(([\s\S]*?)\n\);/)?.[1] || ''
  assert.doesNotMatch(tableBody, /\bctr\b|\bcpc\b|cost_per_conversion/)
  assert.match(mk3Migration, /create view public\.ad_campaign_performance_metrics[\s\S]*security_invoker = true/)
})

test('MK3 provider import is idempotent and contains no Google Ads mutation path', () => {
  assert.match(edge, /fetchGoogleAdsCampaignSnapshot/)
  assert.match(edge, /googleAds:searchStream/)
  assert.match(edge, /onConflict: 'ad_campaign_id,snapshot_date', ignoreDuplicates: true/)
  const googleAdsUrls = [...edge.matchAll(/https:\/\/googleads\.googleapis\.com\/[^`'"\s]+/g)].map(match => match[0])
  assert.equal(googleAdsUrls.length, 2)
  assert(googleAdsUrls.every(url => url.endsWith('/googleAds:searchStream')))
  assert.doesNotMatch(edge, /\bmutat(?:e|es|ed|ing|ion|ions)\w*|\boperations\s*:/i)
  assert.doesNotMatch(googleOauth, /\/auth\/adwords[\s\S]*\/auth\/adwords/)
})

test('MK3 UI exposes local structure, targeting, positive and negative keywords, and dated trends', () => {
  assert.match(ui, /Ad campaign tracking/)
  assert.match(ui, /Planning mirror only/)
  assert.match(ui, /Location targeting/)
  assert.match(ui, /Negative keyword/)
  assert.match(ui, /Dated performance snapshots/)
  assert.match(ui, /must still be executed in Google Ads/)
  for (const summaryField of ['Daily', 'Total', 'No start', 'No end', 'No campaign goal recorded', 'impressions', 'conversions']) {
    assert.match(ui, new RegExp(summaryField))
  }
})

test('MK3 deletion selection preserves the next surviving campaign', () => {
  const campaigns = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
  assert.equal(campaignAfterDeletion(campaigns, 'first')?.id, 'second')
  assert.equal(campaignAfterDeletion(campaigns, 'second')?.id, 'first')
  assert.equal(campaignAfterDeletion([{ id: 'only' }], 'only'), null)
  assert.match(ui, /campaignAfterDeletion\(workspace\.adCampaigns, selected\.id\)/)
  assert.match(ui, /setSelectedId\(nextCampaign\?\.id \|\| ''\)/)
})
