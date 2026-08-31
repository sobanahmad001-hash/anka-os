import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { filterHealth, healthSummary, pageDepth } from './technicalSeo.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260831124306_mk2_technical_seo_tracking.sql')
const verifier = read('../../supabase/verify_20260831124306_mk2_technical_seo_tracking.sql')
const edge = read('../../supabase/functions/technical-seo/index.ts')
const oauth = read('../../supabase/functions/google-oauth/index.ts')
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
})

test('health helpers filter current state and preserve hierarchy depth', () => {
  const rows = [
    { tracked_page_id: 'a', page_type: 'homepage', index_status: 'indexed', needs_attention: false },
    { tracked_page_id: 'b', parent_page_id: 'a', page_type: 'service', index_status: 'discovered_not_indexed', needs_attention: true },
  ]
  assert.deepEqual(healthSummary(rows), { total: 2, attention: 1, notIndexed: 1, unaudited: 2 })
  assert.equal(filterHealth(rows, { pageType: 'service', indexStatus: '', attention: 'yes' }).length, 1)
  assert.equal(pageDepth(rows[1], rows), 1)
})

test('rollback verifier covers history, hierarchy, provenance, live view, and isolation', () => {
  for (const check of ['historical_snapshots_preserved', 'latest_health_is_live', 'mixed_provenance_preserved', 'hierarchy_cycle_rejected', 'cross_brand_parent_rejected', 'table_and_view_cross_org_isolation']) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /rollback;/)
})
