import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260902065946_mk6b_meta_connector.sql')
const verifier = read('../../supabase/verify_20260902065946_mk6b_meta_connector.sql')
const edge = read('../../supabase/functions/meta-oauth/index.ts')
const sharedTokens = read('../../supabase/functions/_shared/googleOAuthTokens.ts')
const repository = read('./integrationRepository.js')
const settings = read('../apps/Settings.jsx')
const catalog = read('../config/connectorCatalog.js')

test('MK6b schema matches the required tenant-safe connection and snapshot model', () => {
  assert.match(migration, /create table public\.meta_connections/)
  assert.match(migration, /create table public\.meta_performance_snapshots/)
  assert.match(migration, /create table public\.meta_oauth_sessions/)
  assert.match(migration, /foreign key \(brand_id, organization_id\)[\s\S]*references public\.brands\(id, organization_id\) on delete cascade/)
  assert.match(migration, /foreign key \(meta_connection_id, organization_id\)[\s\S]*references public\.meta_connections\(id, organization_id\) on delete cascade/)
  assert.match(migration, /unique \(meta_connection_id, snapshot_date, platform\)/)
  assert.match(migration, /check \(platform in \('facebook', 'instagram'\)\)/)
  for (const column of ['reach integer', 'impressions integer', 'engagement integer', 'spend numeric']) {
    assert.match(migration, new RegExp(column))
  }
})

test('Meta reuses the canonical connector registry and department mappings', () => {
  assert.match(migration, /integration_connections_provider_check[\s\S]*'meta'/)
  assert.match(migration, /integration_events_provider_check[\s\S]*'meta'/)
  assert.match(migration, /meta_connections_registry_fk[\s\S]*integration_connections\(id, organization_id\)/)
  assert.match(edge, /from\('integration_connections'\)\.insert/)
  assert.match(edge, /from\('integration_connection_departments'\)\.insert/)
  assert.match(edge, /provider: 'meta'/)
})

test('RLS exposes tenant metadata and snapshots without exposing Meta credentials or sessions', () => {
  for (const table of ['meta_connections', 'meta_performance_snapshots', 'meta_oauth_sessions']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.equal((migration.match(/is_team_organization_member\(organization_id\)/g) || []).length, 2)
  assert.match(migration, /grant select \([\s\S]*facebook_page_id[\s\S]*instagram_account_id[\s\S]*\) on public\.meta_connections to authenticated/)
  assert.doesNotMatch(migration, /grant select \([\s\S]*access_token_(ciphertext|iv)[\s\S]*\) on public\.meta_connections to authenticated/)
  assert.match(migration, /revoke all on public\.meta_oauth_sessions from anon, authenticated/)
  assert.match(verifier, /has_column_privilege\('authenticated', 'public\.meta_connections', 'access_token_ciphertext', 'select'\)/)
  assert.match(verifier, /mk6b_oauth_sessions_server_only/)
})

test('Meta permissions and external endpoints remain organic read-only', () => {
  assert.match(edge, /'pages_show_list',[\s\S]*'pages_read_engagement',[\s\S]*'read_insights',[\s\S]*'instagram_basic',[\s\S]*'instagram_manage_insights'/)
  assert.doesNotMatch(edge, /['"]ads_read['"]|['"]ads_management['"]|['"]instagram_content_publish['"]|['"]pages_manage_posts['"]/)
  assert.equal((edge.match(/method:\s*'POST'/g) || []).length, 1)
  assert.match(edge, /oauth\/access_token`[\s\S]*method: 'POST'/)
  assert.match(edge, /method: 'GET'/)
  assert.doesNotMatch(edge, /\/(feed|media|media_publish|campaigns|adsets|ads)[?`'"/]/i)
  assert.match(edge, /spend: null/)
  assert.doesNotMatch(edge, /ad_account_id/)
})

test('Meta verifies and stores the selected Page token using shared AES-GCM', () => {
  assert.match(edge, /fields: 'id,name,access_token,instagram_business_account'/)
  assert.match(edge, /page\.id !== session\.facebook_page_id \|\| !page\.access_token/)
  assert.match(edge, /encryptSecret\(page\.access_token, config\.encryptionMaterial\)/)
  assert.match(edge, /from '\.\.\/_shared\/googleOAuthTokens\.ts'/)
  assert.match(sharedTokens, /crypto\.subtle\.importKey\('raw', digest, 'AES-GCM'/)
  assert.match(sharedTokens, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/)
  assert.match(sharedTokens, /name: 'AES-GCM', iv/)
})

test('Meta connector is reachable through the existing Connector Centre UI', () => {
  assert.match(catalog, /meta: Object\.freeze\([\s\S]*availability: 'available'/)
  assert.match(repository, /listBrands/)
  assert.match(repository, /startMetaOAuth/)
  assert.match(repository, /syncMetaOrganicMetrics/)
  assert.match(repository, /disconnectMetaOAuth/)
  assert.match(settings, /authorizeMeta/)
  assert.match(settings, /MetaReportingFields/)
  assert.match(settings, /Sync yesterday/)
  assert.match(settings, /Disconnect Meta/)
})

test('the verifier is rollback-safe and fails closed', () => {
  assert.match(verifier, /^begin;/)
  assert.match(verifier, /raise exception 'One or more MK6b verification checks failed'/)
  assert.match(verifier, /rollback;\s*$/)
  assert.doesNotMatch(verifier, /commit;/)
})
