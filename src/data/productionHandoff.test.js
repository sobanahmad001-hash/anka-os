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
    'handoff_bucket_remains_private',
    'handoff_bucket_accepts_zip',
    'non_release_package_rejected',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /rollback;\s*$/)
  assert.doesNotMatch(verifier, /\bcommit\s*;/i)
})
