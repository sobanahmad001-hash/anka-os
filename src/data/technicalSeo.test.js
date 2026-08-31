import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { auditTrend, filterHealth, healthSummary, pageDepth } from './technicalSeo.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260831124306_mk2_technical_seo_tracking.sql')
const verifier = read('../../supabase/verify_20260831124306_mk2_technical_seo_tracking.sql')
const edge = read('../../supabase/functions/technical-seo/index.ts')
const edgeTest = read('../../supabase/functions/technical-seo/index.test.ts')
const oauth = read('../../supabase/functions/google-oauth/index.ts')
const ci = read('../../.github/workflows/ci.yml')
const repository = read('./technicalSeoRepository.js')
const ui = read('../apps/TechnicalSeoTracking.jsx')
const app = read('../App.jsx')

test('MK2 schema is historical, tenant-safe, indexed, and browser read-only', () => {
  for (const table of ['tracked_pages', 'tracked_page_audits']) assert.match(migration, new RegExp(`create table public\\.${table}`))
  assert.match(migration, /unique \(tracked_page_id, audit_date\)/)
  assert.match(migration, /with \(security_invoker = true\)/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /on delete set null \(parent_page_id\)/)
  assert.match(migration, /hierarchy cannot contain a cycle/i)
  assert.match(migration, /grant select on public\.tracked_pages, public\.tracked_page_audits to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[\s\S]{0,160}to authenticated/i)
  for (const index of ['idx_tracked_pages_brand_normalized_url', 'idx_tracked_page_audits_page_history', 'idx_tracked_page_audits_attention']) assert.match(migration, new RegExp(index))
})

test('URL Inspection reuses the read-only Google connector without adding Google writes', () => {
  assert.match(oauth, /webmasters\.readonly/)
  assert.match(edge, /searchconsole\.googleapis\.com\/v1\/urlInspection\/index:inspect/)
  assert.match(edge, /googleAccessToken/)
  assert.match(edge, /source_type: 'search_console'/)
  assert.doesNotMatch(edge, /sitemaps\/(submit|delete)|indexing\/v3|mutate|batchUpdate/i)
})

test('MK2 uses a conflict-light nested Marketing route and dedicated server boundary', () => {
  assert.match(app, /path="sphere\/marketing\/seo" element={<TechnicalSeoTracking \/>}/)
  assert.match(repository, /functions\.invoke\('technical-seo'/)
  assert.match(ui, /Inspect with Search Console/)
  assert.match(ui, /One append-only snapshot per page and date/)
  assert.match(ui, /manual Core Web Vitals remain separate/i)
  assert.match(ui, /Any audit recency/)
  assert.match(ui, /Audit trend over time/)
  assert.match(edgeTest, /URL Inspection uses the read-only Search Console endpoint/)
  assert.match(ci, /deno test --frozen[^\n]*technical-seo\/index\.test\.ts/)
  assert.match(ci, /deno check --frozen[^\n]*technical-seo\/index\.ts[^\n]*technical-seo\/index\.test\.ts/)
})

test('health helpers filter current state and preserve hierarchy depth', () => {
  const rows = [
    { tracked_page_id: 'a', page_type: 'homepage', index_status: 'indexed', needs_attention: false, latest_audit_id: 'audit-a', days_since_audit: 10 },
    { tracked_page_id: 'b', parent_page_id: 'a', page_type: 'service', index_status: 'discovered_not_indexed', needs_attention: true, latest_audit_id: 'audit-b', days_since_audit: 95 },
    { tracked_page_id: 'c', page_type: 'blog', needs_attention: false, latest_audit_id: null, days_since_audit: null },
  ]
  assert.deepEqual(healthSummary(rows), { total: 3, attention: 1, notIndexed: 1, unaudited: 1 })
  assert.equal(filterHealth(rows, { pageType: 'service', indexStatus: '', attention: 'yes' }).length, 1)
  assert.equal(filterHealth(rows, { pageType: '', indexStatus: '', attention: '', recency: 'last_30' }).length, 1)
  assert.equal(filterHealth([{ days_since_audit: 60, latest_audit_id: 'audit-mid' }], { pageType: '', indexStatus: '', attention: '', recency: 'days_31_90' }).length, 1)
  assert.equal(filterHealth(rows, { pageType: '', indexStatus: '', attention: '', recency: 'over_90' }).length, 1)
  assert.equal(filterHealth(rows, { pageType: '', indexStatus: '', attention: '', recency: 'never' }).length, 1)
  assert.equal(pageDepth(rows[1], rows), 1)
})

test('audit trend is chronological and derives visible values from snapshots', () => {
  const trend = auditTrend([
    { id: 'new', audit_date: '2026-08-31', index_status: 'indexed', issues: [], core_web_vitals_mobile: 90, source_type: 'search_console' },
    { id: 'old', audit_date: '2026-08-01', index_status: 'excluded', issues: ['schema'], core_web_vitals_mobile: 50, source_type: 'manual' },
  ])
  assert.deepEqual(trend.map(point => point.id), ['old', 'new'])
  assert.deepEqual(trend.map(point => point.issueCount), [1, 0])
})

test('rollback verifier covers history, hierarchy, provenance, live view, and isolation', () => {
  for (const check of ['historical_snapshots_preserved', 'latest_health_is_live', 'mixed_provenance_preserved', 'hierarchy_cycle_rejected', 'cross_brand_parent_rejected', 'table_and_view_cross_org_isolation']) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /rollback;/)
})
