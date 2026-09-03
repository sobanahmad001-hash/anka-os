import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260902070100_mk6b_meta_connector.sql')
const verifier = read('../../supabase/verify_20260902070100_mk6b_meta_connector.sql')
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
  assert.match(verifier, /exact_column_acls_via_pg_attribute/)
  assert.match(verifier, /browser_credentials_sessions_writes_denied_runtime/)
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

test('the verifier proves the exact catalog, policy, ACL, FK, and index contract', () => {
  for (const anchor of [
    'exact_tables_and_relkind',
    'exact_columns_types_nullability_defaults',
    'exact_table_constraints',
    'exact_foreign_keys',
    'exact_provider_and_event_constraints',
    'exact_rls_policy_contract',
    'exact_table_acls_pg17',
    'exact_column_acls_via_pg_attribute',
    'no_sequence_or_table_function_acl_surface',
    'exact_nonconstraint_indexes',
    'all_constraint_and_supporting_indexes_live',
  ]) assert.match(verifier, new RegExp(anchor))
  assert.match(verifier, /aclexplode\(coalesce\(c\.relacl/)
  assert.match(verifier, /aclexplode\(a\.attacl\)/)
  assert.doesNotMatch(verifier, /aclexplode\(coalesce\(a\.attacl, '\{\}'::aclitem\[\]\)\)/)
  assert.match(verifier, /'MAINTAIN'/)
  assert.match(verifier, /confupdtype/)
  assert.match(verifier, /confdeltype/)
  assert.match(verifier, /confmatchtype/)
  assert.match(verifier, /confdelsetcols/)
  assert.doesNotMatch(verifier, /mk6b_expected_meta_(connections|snapshots|sessions)[\s\S]*references (auth|public)\./)
  assert.match(verifier, /polpermissive[\s\S]*polcmd = 'r'[\s\S]*polwithcheck is null/)
  assert.match(verifier, /polrelid = 'public\.meta_connections'::regclass[\s\S]*polname = 'Team can read own Meta connection metadata'/)
  assert.match(verifier, /polrelid = 'public\.meta_performance_snapshots'::regclass[\s\S]*polname = 'Team can read own Meta performance snapshots'/)
  assert.doesNotMatch(verifier, /like\s+'%meta%'/i)
  assert.doesNotMatch(verifier, /join roles r on r\.role_oid = x\.grantee/)
  assert.match(verifier, /case when x\.grantee = 0 then 'PUBLIC' else pg_get_userbyid\(x\.grantee\) end/)
  assert.match(verifier, /select c\.relname::text, pg_get_userbyid\(c\.relowner\), privilege_type, false/)
  assert.doesNotMatch(verifier, /select c\.relname::text, pg_get_userbyid\(c\.relowner\), privilege_type, true/)
})

test('the verifier executes every required rollback security outcome', () => {
  for (const anchor of [
    'cross_tenant_foreign_keys_reject',
    'oauth_actor_foreign_key_rejects_unknown_user',
    'snapshot_idempotency_runtime',
    'negative_metrics_reject_runtime',
    'spend_is_always_null_runtime',
    'rls_tenant_visibility_runtime',
    'browser_credentials_sessions_writes_denied_runtime',
    'registry_cascade_runtime',
    'brand_cascade_runtime',
  ]) assert.match(verifier, new RegExp(anchor))
  assert.match(verifier, /set local role authenticated/)
  assert.match(verifier, /exception when insufficient_privilege/)
  assert.match(verifier, /exception when foreign_key_violation/)
  assert.match(verifier, /exception when check_violation/)
})

test('the approved constraint and index audit keeps only current consumers', () => {
  assert.match(migration, /meta_performance_snapshots_spend_check check \(spend is null\)/)
  assert.equal((migration.match(/create index idx_meta_/g) || []).length, 4)
  assert.match(migration, /idx_meta_oauth_sessions_connection[\s\S]*meta_oauth_sessions\(integration_connection_id\)/)
  assert.match(migration, /idx_meta_oauth_sessions_brand_org[\s\S]*meta_oauth_sessions\(brand_id, organization_id\)/)
  assert.match(migration, /idx_meta_oauth_sessions_actor[\s\S]*meta_oauth_sessions\(actor_id\)/)
  assert.match(migration, /idx_meta_oauth_sessions_expiry[\s\S]*meta_oauth_sessions\(expires_at\)/)
  assert.doesNotMatch(migration, /idx_meta_performance_snapshots_org_date/)
  assert.doesNotMatch(migration, /idx_meta_connections_organization_brand/)
  assert.doesNotMatch(migration, /meta_connections\(connected_by\)/)
  assert.doesNotMatch(migration, /idx_meta_oauth_sessions_expiry[\s\S]{0,100}where consumed_at is null/)
  assert.doesNotMatch(migration, /create (or replace )?function|create sequence|create trigger/i)
})
