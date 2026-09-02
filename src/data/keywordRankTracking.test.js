import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260902064943_keyword_rank_tracking.sql')
const verifier = read('../../supabase/verify_20260902064943_keyword_rank_tracking.sql')
const edge = read('../../supabase/functions/technical-seo/index.ts')
const edgeTest = read('../../supabase/functions/technical-seo/index.test.ts')
const repository = read('./technicalSeoRepository.js')
const ui = read('../apps/TechnicalSeoTracking.jsx')

test('MK6a tables are tenant-safe, append-only, and read-only to the browser', () => {
  for (const table of ['tracked_keywords', 'keyword_rank_snapshots']) assert.match(migration, new RegExp(`create table public\\.${table}`))
  assert.match(migration, /check \(length\(trim\(keyword\)\) between 1 and 200\)/)
  assert.match(migration, /check \(target_rank_tier in \('top_3', 'top_10', 'top_20'\)\)/)
  assert.match(migration, /foreign key \(tracked_page_id, organization_id\)/)
  assert.match(migration, /foreign key \(tracked_keyword_id, organization_id\)/)
  assert.match(migration, /foreign key \(source_artifact_id, organization_id\)/)
  assert.match(migration, /unique \(tracked_keyword_id, snapshot_date\)/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all privileges on public\.tracked_keywords, public\.keyword_rank_snapshots from anon, authenticated, service_role/)
  assert.match(migration, /grant select, insert on public\.keyword_rank_snapshots to service_role/)
  assert.doesNotMatch(migration, /keyword_rank_snapshots[\s\S]{0,500}unique \(id, organization_id\)/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[\s\S]{0,160}to authenticated/i)
})

test('MK6a extends the established Search Console connector without a new auth or provider-write path', () => {
  assert.match(edge, /searchConsoleConnection\(admin, page\)/)
  assert.match(edge, /googleAccessToken\(admin, connection\.id, 'google_search_console'\)/)
  assert.match(edge, /searchAnalytics\/query/)
  assert.match(edge, /dimensions: \['query'\]/)
  assert.match(edge, /dimension: 'page'/)
  assert.match(edge, /dimension: 'query'/)
  assert.doesNotMatch(edge, /google-oauth|oauth.*callback|sitemaps\/(submit|delete)|indexing\/v3|batchUpdate/i)
  assert.match(edgeTest, /keyword ranks use the existing read-only Search Analytics endpoint/i)
})

test('MK6a UI supports manual page-scoped tracking and distinguishes no rank from no fetch', () => {
  assert.match(repository, /listKeywords/)
  assert.match(repository, /listRankSnapshots/)
  assert.match(repository, /listKeywordSources/)
  assert.match(repository, /save_keyword/)
  assert.match(repository, /fetch_keyword_ranks/)
  assert.match(ui, /Keyword rank tracking/)
  assert.match(ui, /No Keyword Strategy source/)
  assert.match(ui, /Not yet ranking — no Search Console impressions yet/)
  assert.match(ui, /Rank appears after the first fetch/)
})

test('MK6a keeps the daily record immutable by reading an existing snapshot before inserting', () => {
  assert.match(edge, /from\('keyword_rank_snapshots'\)\.select\('\*'\)[\s\S]{0,300}snapshot_date/)
  assert.match(edge, /if \(existing\) \{[\s\S]{0,100}continue/)
  assert.match(edge, /from\('keyword_rank_snapshots'\)\.insert/)
  assert.doesNotMatch(edge, /from\('keyword_rank_snapshots'\)\.upsert/)
  assert.match(verifier, /v_other_artifact_id/)
  assert.match(verifier, /aclexplode\(attribute\.attacl\)/)
  assert.doesNotMatch(verifier, /coalesce\(attribute\.attacl, '\{\}'::aclitem\[\]\)/)
  assert.match(verifier, /FOREIGN KEY \(tracked_keyword_id, organization_id\) REFERENCES tracked_keywords/)
  assert.match(verifier, /confrelid = 'public\.brands'::regclass/)
  assert.match(verifier, /confrelid = 'public\.tracked_pages'::regclass/)
  assert.match(verifier, /confrelid = 'auth\.users'::regclass/)
  assert.match(verifier, /array_agg\(pg_get_indexdef/)
  assert.match(verifier, /'mk6a_primary_keys_are_exact'/)
  assert.match(verifier, /'mk6a_unique_constraints_are_exact'/)
  assert.match(verifier, /'mk6a_check_constraints_are_exact'/)
  assert.match(verifier, /CHECK \(\(\("position" IS NULL\) OR \("position" >= \(1\)::numeric\)\)\)/)
  assert.match(verifier, /CHECK \(\(\(length\(TRIM\(BOTH FROM keyword\)\) >= 1\) AND \(length\(TRIM\(BOTH FROM keyword\)\) <= 200\)\)\)/)
  assert.doesNotMatch(verifier, /^  \)\r?\n  \),$/m)
})

test('MK6a includes a rollback-safe verifier for schema, daily snapshots, and isolation', () => {
  for (const check of [
    'mk6a_tables_exist_and_rls_enabled', 'mk6a_browser_is_read_only', 'mk6a_exact_team_read_policies_exist',
    'mk6a_composite_foreign_keys_exist', 'mk6a_snapshots_are_strictly_append_only_for_service_role',
    'mk6a_no_explicit_column_grants_or_grant_options', 'mk6a_columns_match_contract', 'mk6a_constraints_match_contract',
    'mk6a_exact_column_types_nullability_and_defaults', 'mk6a_foreign_keys_are_exact_and_validated', 'mk6a_indexes_are_all_valid',
    'mk6a_primary_keys_are_exact', 'mk6a_unique_constraints_are_exact', 'mk6a_check_constraints_are_exact',
    'mk6a_foreign_key_catalog_mapping_is_exact',
    'null_position_is_honest_not_yet_ranking_state', 'one_snapshot_per_keyword_per_day',
    'target_rank_tier_is_constrained', 'composite_page_foreign_key_rejects_cross_org_target',
    'negative_rank_metrics_are_rejected', 'composite_brand_source_and_snapshot_foreign_keys_reject_cross_org_targets',
    'source_artifact_deletion_nulls_only_source_column',
    'authenticated_reads_are_organization_isolated',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /rollback;/)
})
