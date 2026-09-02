import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831200414_ds6_production_handoff.sql')
const verifier = read('supabase/verify_20260831200414_ds6_production_handoff.sql')
const edge = read('supabase/functions/production-handoff/index.ts')
const edgeTest = read('supabase/functions/production-handoff/index.test.ts')
const designEdge = read('supabase/functions/design-workshop/index.ts')
const repository = read('src/data/productionHandoffsRepository.js')
const workshopRepository = read('src/data/designWorkshopRepository.js')
const ui = read('src/components/ProductionHandoffPanel.jsx')
const workshop = read('src/apps/DesignWorkshop.jsx')

test('DS6 adds one organization-scoped package table with composite release ownership and RLS', () => {
  assert.match(migration, /create table public\.production_handoff_packages/)
  assert.match(migration, /foreign key \(design_direction_release_id, organization_id\)[\s\S]*references public\.design_direction_releases\(id, organization_id\) on delete cascade/)
  assert.doesNotMatch(migration, /unique \(id, organization_id\)/)
  assert.match(migration, /alter table public\.production_handoff_packages enable row level security/)
  assert.match(migration, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on public\.production_handoff_packages from anon, authenticated/)
  assert.match(migration, /grant select on public\.production_handoff_packages to authenticated/)
  assert.match(migration, /grant select, insert, update on public\.production_handoff_packages to service_role/)
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*production_handoff_packages/i)
})

test('only a real release with the same organization, engagement, version, direction, and session can package', () => {
  assert.match(edge, /Production handoff requires an already-released direction/)
  assert.match(edge, /release\.engagement_id !== requestedEngagementId/)
  assert.match(edge, /direction\.session_id !== release\.session_id/)
  assert.match(edge, /session\.engagement_id !== release\.engagement_id/)
  assert.match(edgeTest, /rejects a non-release and cross-engagement source directly/)
  assert.match(verifier, /non_release_package_rejected/)
})

test('the package contains exact content, direction media, and ready DS2 variants', () => {
  assert.match(edge, /direction\/direction-version\.json/)
  assert.match(edge, /direction\/release\.json/)
  assert.match(edge, /eq\('design_direction_version_id', source\.version\.id\)/)
  assert.match(edge, /from\('design_direction_variants'\)/)
  assert.match(edge, /variants\/\$\{variant\.variant_format\}/)
  assert.match(edgeTest, /contains exact release content, images, and DS2 variants/)
  assert.doesNotMatch(edge, /content_request_id/)
})

test('missing or incomplete sources record a terminal failed package rather than a partial ready package', () => {
  assert.match(edge, /Required source object is unavailable/)
  assert.match(edge, /is not a valid PNG object/)
  assert.match(edge, /status: 'failed',[\s\S]*failure_reason: reason/)
  assert.match(edge, /if \(uploaded\) await admin\.storage\.from\(MEDIA_BUCKET\)\.remove/)
  assert.match(migration, /status = 'failed'[\s\S]*length\(trim\(failure_reason\)\) > 0/)
  assert.match(edgeTest, /fails honestly when a required source object is missing/)
  assert.match(edgeTest, /rejects a non-empty corrupt image before upload/)
})

test('the private package is available only through a short-lived signed URL', () => {
  assert.match(edge, /createSignedUrl\(packageRow\.package_storage_path, SIGNED_URL_TTL_SECONDS\)/)
  assert.match(edge, /const SIGNED_URL_TTL_SECONDS = 300/)
  assert.match(edge, /const MAX_PACKAGE_BYTES = 32 \* 1024 \* 1024/)
  assert.match(migration, /file_size_limit = greatest\(coalesce\(file_size_limit, 0\), 33554432\)/)
  assert.match(verifier, /file_size_limit >= 33554432/)
  assert.match(migration, /where id = 'design-generated-media'/)
  assert.match(migration, /public = false/)
  assert.doesNotMatch(migration, /storage\.objects[\s\S]*create policy/i)
  assert.match(repository, /invoke\('sign_package'/)
  assert.match(ui, /Download signed ZIP/)
})

test('handoff controls appear only after release and reuse the Workshop read model', () => {
  assert.match(workshopRepository, /from\('production_handoff_packages'\)/)
  assert.match(workshop, /release && <ProductionHandoffPanel/)
  assert.match(repository, /invoke\('create_package'/)
  assert.match(ui, /nothing is edited, regenerated, or published/)
})

test('only a failed production handoff refreshes the Workshop after an action error', () => {
  const ordinaryAction = "async function act(key, action) { setBusy(key); setError(''); try { await action(); setModal(null); await refresh() } catch (reason) { capture(reason) } finally { setBusy('') } }"
  assert.ok(workshop.includes(ordinaryAction))
  assert.equal(workshop.match(/setWorkspace\(await designWorkshop\.load\(engagementId\)\)/g)?.length, 2)
  assert.match(workshop, /async function prepareHandoff\(release\)[\s\S]*setWorkspace\(await designWorkshop\.load\(engagementId\)\)[\s\S]*Keep the packaging failure primary/)
  assert.match(workshop, /onPrepareHandoff=\{prepareHandoff\}/)
})

test('DS6 makes no change inside the shared Design Workshop generation function', () => {
  assert.doesNotMatch(designEdge, /production[_-]handoff|create_package|sign_package/i)
  for (const functionName of ['createSession', 'generateDirections', 'generateOne', 'directionSchema']) {
    assert.match(designEdge, new RegExp(`function ${functionName}\\b`))
  }
})

test('the DS6 verifier is named, rollback-safe, and never commits', () => {
  assert.match(verifier, /^begin;/m)
  for (const check of [
    'handoff_table_exists',
    'handoff_rls_enabled',
    'handoff_browser_is_read_only',
    'handoff_release_fk_is_composite',
    'handoff_failure_reason_is_bounded',
    'handoff_bucket_remains_private',
    'handoff_bucket_accepts_zip',
    'handoff_preparing_partial_index_exists',
    'non_release_package_rejected',
  ]) assert.match(verifier, new RegExp(check))
  for (const privilege of ['select', 'insert', 'update']) {
    assert.match(verifier, new RegExp(`has_table_privilege\\(\\s*'service_role', 'public\\.production_handoff_packages', '${privilege}'\\s*\\)`))
  }
  assert.doesNotMatch(verifier, /'service_role', 'public\.production_handoff_packages', 'select, insert, update'/)
  assert.match(verifier, /permissive = 'PERMISSIVE'[\s\S]*cmd = 'SELECT'[\s\S]*roles = array\['authenticated'\]::name\[\][\s\S]*qual = 'is_team_organization_member\(organization_id\)'[\s\S]*with_check is null/)
  assert.match(verifier, /'authenticated', 'public\.production_handoff_packages',[\s\S]*'insert, update, delete, truncate, references, trigger, maintain'/)
  assert.match(verifier, /'anon', 'public\.production_handoff_packages',[\s\S]*'select, insert, update, delete, truncate, references, trigger, maintain'/)
  assert.match(verifier, /'service_role', 'public\.production_handoff_packages',[\s\S]*'delete, truncate, references, trigger, maintain'/)
  assert.match(verifier, /has_any_column_privilege\([\s\S]*'authenticated', 'public\.production_handoff_packages',[\s\S]*'insert, update, references'/)
  assert.match(verifier, /has_any_column_privilege\([\s\S]*'anon', 'public\.production_handoff_packages',[\s\S]*'select, insert, update, references'/)
  assert.match(verifier, /has_any_column_privilege\([\s\S]*'service_role', 'public\.production_handoff_packages', 'references'/)
  assert.match(verifier, /'select with grant option, insert with grant option, update with grant option'/)
  assert.equal(verifier.match(/pg_get_constraintdef\(constraint_record\.oid, false\) = \(/g)?.length, 3)
  assert.match(verifier, /ds6_expected_ready_storage/)
  assert.match(verifier, /ds6_expected_storage_scope/)
  assert.match(verifier, /ds6_expected_failure_reason_length/)
  assert.match(verifier, /production_handoff_packages_failure_reason_check[\s\S]*constraint_record\.convalidated/)
  assert.match(verifier, /constraint_record\.confdeltype = 'c'[\s\S]*ON DELETE CASCADE/)
  assert.ok(!verifier.includes('pg_get_constraintdef(constraint_record.oid) like'))
  assert.match(verifier, /tgfoid =[\s\S]*private\.enforce_production_handoff_package_transition\(\)'::regprocedure/)
  assert.match(verifier, /tgtype = 19[\s\S]*tgenabled = 'O'[\s\S]*tgattr = ''::int2vector[\s\S]*tgqual is null[\s\S]*tgnargs = 0/)
  assert.doesNotMatch(verifier, /tgenabled <> 'D'/)
  assert.doesNotMatch(verifier, /trigger_record\.tgtype &/)
  assert.match(verifier, /'service_role', 'private\.enforce_production_handoff_package_transition\(\)', 'execute'/)
  assert.match(verifier, /idx_production_handoff_packages_preparing[\s\S]*indisvalid[\s\S]*indisready[\s\S]*indislive[\s\S]*indnkeyatts = 2[\s\S]*indnatts = 2[\s\S]*indexprs is null[\s\S]*amname = 'btree'/)
  assert.match(verifier, /pg_get_indexdef\(index_record\.indexrelid, 1, false\) = 'organization_id'[\s\S]*pg_get_indexdef\(index_record\.indexrelid, 2, false\) = 'created_at'/)
  assert.match(verifier, /pg_get_expr\(index_record\.indpred, index_record\.indrelid, false\) = \([\s\S]*ds6_expected_handoff_preparing/)
  assert.match(verifier, /rollback;\s*$/)
  assert.doesNotMatch(verifier, /\bcommit\s*;/i)
})
