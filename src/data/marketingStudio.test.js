import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { MARKETING_ARTIFACT_FORMS, blankMarketingArtifact, defaultReportingPeriod } from './marketingStudio.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const typeMigration = read('supabase/migrations/20260827190000_marketing_shared_type_extensions.sql')
const schemaMigration = read('supabase/migrations/20260827200000_marketing_campaigns.sql')
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
