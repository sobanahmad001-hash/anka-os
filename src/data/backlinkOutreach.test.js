import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  BACKLINK_COST_TYPES,
  BACKLINK_LINK_TYPES,
  BACKLINK_STATUSES,
  blankBacklinkTarget,
  filterBacklinkTargets,
} from './backlinkOutreach.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260831124451_mk4_backlink_outreach_tracking.sql', import.meta.url), 'utf8')
const verification = readFileSync(new URL('../../supabase/verify_20260831124451_mk4_backlink_outreach_tracking.sql', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/marketing-studio/index.ts', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./marketingStudioRepository.js', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')

test('MK4 adds one tenant-safe canonical backlink target table', () => {
  assert.match(migration, /create table public\.backlink_targets/)
  assert.doesNotMatch(migration, /create table public\.(?:backlink_outreach_events|outreach_emails|backlink_contacts)/)
  assert.match(migration, /foreign key \(brand_id, organization_id\)[\s\S]*references public\.brands\(id, organization_id\)/)
  assert.match(migration, /unique \(id, organization_id\)/)
  assert.match(migration, /alter table public\.backlink_targets enable row level security/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on public\.backlink_targets from anon, authenticated/)
  assert.match(migration, /grant select on public\.backlink_targets to authenticated/)
  assert.match(migration, /revoke all on public\.backlink_targets from service_role/)
  assert.match(migration, /grant select, insert, update on public\.backlink_targets to service_role/)
  assert.doesNotMatch(migration, /grant all on public\.backlink_targets/)
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[\s\S]{0,120}to authenticated/)
})

test('MK4 database validation and indexes cover the specified research model', () => {
  for (const column of [
    'site_name', 'site_url', 'industry_category', 'domain_authority', 'estimated_traffic',
    'relevance_score', 'link_type', 'cost_type', 'outreach_status', 'notes', 'created_by',
  ]) assert.match(migration, new RegExp(`\\b${column}\\b`))
  for (const value of [...BACKLINK_STATUSES, ...BACKLINK_LINK_TYPES, ...BACKLINK_COST_TYPES]) {
    assert.match(migration, new RegExp(`'${value}'`))
  }
  assert.match(migration, /domain_authority between 0 and 100/)
  assert.match(migration, /relevance_score between 0 and 100/)
  assert.match(migration, /estimated_traffic is null or estimated_traffic >= 0/)
  assert.match(migration, /\[\[:alnum:\]\][\s\S]*\[\.\][\s\S]*\[\[:alpha:\]\]/)
  assert.match(migration, /lower\(rtrim\(site_url, '\/'\)\)/)
  assert.match(migration, /idx_backlink_targets_brand_status/)
  assert.match(migration, /idx_backlink_targets_created_by/)
})

test('unknown scores remain null and default sorting keeps actionable high relevance first', () => {
  const blank = blankBacklinkTarget()
  assert.equal(blank.domain_authority, '')
  assert.equal(blank.relevance_score, '')
  const rows = filterBacklinkTargets([
    { site_name: 'Secured high', outreach_status: 'secured', relevance_score: 99, domain_authority: 90 },
    { site_name: 'Unknown', outreach_status: 'not_started', relevance_score: null, domain_authority: null },
    { site_name: 'Actionable high', outreach_status: 'contacted', relevance_score: 80, domain_authority: 70 },
    { site_name: 'Actionable zero', outreach_status: 'not_started', relevance_score: 0, domain_authority: 0 },
  ])
  assert.deepEqual(rows.map(row => row.site_name), ['Actionable high', 'Actionable zero', 'Unknown', 'Secured high'])
  assert.deepEqual(filterBacklinkTargets(rows, { minimum_relevance: 1 }).map(row => row.site_name), ['Actionable high', 'Secured high'])
})

test('writes use the caller-validated Marketing Studio boundary', () => {
  assert.match(edge, /validateBacklinkTarget/)
  assert.match(edge, /create_backlink_target/)
  assert.match(edge, /update_backlink_target/)
  assert.match(edge, /admin\.from\('backlink_targets'\)\.insert/)
  assert.match(edge, /admin\.from\('backlink_targets'\)\.update/)
  assert.match(edge, /userClient\.auth\.getUser\(\)/)
  assert.match(repository, /supabase\.from\('backlink_targets'\)[\s\S]{0,40}\.select\('\*'\)/)
  assert.doesNotMatch(repository, /supabase\.from\('backlink_targets'\)\.(?:insert|update|delete)/)
})

test('Marketing Studio provides brand filtering, qualification fields, and historical statuses', () => {
  assert.match(studio, /Backlink outreach/)
  assert.match(studio, /Minimum relevance/)
  assert.match(studio, /Minimum authority/)
  assert.match(studio, /Secured and declined targets stay in the log/)
  assert.match(studio, /does not scrape sites, send messages, or verify backlinks/)
  assert.doesNotMatch(studio, /Send outreach|Scrape now|Verify backlink|Email contact/)
})

test('rollback verifier returns named lifecycle, validation, tenant, and privilege checks', () => {
  for (const check of [
    'unknown_metrics_remain_null', 'all_statuses_and_history_remain_queryable',
    'malformed_url_rejected', 'malformed_host_url_rejected', 'negative_traffic_rejected', 'out_of_range_score_rejected',
    'unsupported_enum_rejected', 'duplicate_normalized_url_rejected',
    'authenticated_direct_write_rejected', 'cross_organization_rows_hidden',
    'browser_is_read_only', 'server_write_boundary_is_minimum_privilege',
  ]) assert.match(verification, new RegExp(`'${check}'`))
  assert.match(verification, /jsonb_object_agg\(check_name, passed\)/)
  assert.match(verification, /'https:\/\/\.\.\.'/)
  assert.match(verification, /rollback;/)
})
