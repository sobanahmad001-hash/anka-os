import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260912182552_design_b04_safe_asset_archive.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260912182552_design_b04_safe_asset_archive.sql', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./designWorkshopRepository.js', import.meta.url), 'utf8')
const server = readFileSync(new URL('../../supabase/functions/design-workshop/index.ts', import.meta.url), 'utf8')
const race = readFileSync(new URL('../../scripts/design-b04-archive-concurrency.ts', import.meta.url), 'utf8')

test('B04 is a soft-only archive that retains exact immutable versions and stored objects', () => {
  assert.match(migration, /storage_objects_deleted', 0/)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.design_asset_versions/i)
  assert.doesNotMatch(migration, /storage\.objects|storage\.from/i)
  assert.match(migration, /Only standalone uploaded draft assets can be archived/)
  assert.match(migration, /\) is not true then raise exception 'Design department access required'/)
  assert.match(migration, /different confirmed intent/)
  assert.match(migration, /source_kind <> 'upload'/)
  assert.match(migration, /source_media_asset_id is not null/)
  assert.match(migration, /source_direction_version_id is not null/)
})

test('B04 serializes archive and version creation on the same root and rejects restore', () => {
  assert.match(migration, /from public\.design_assets[\s\S]*for update/)
  assert.match(migration, /for key share/)
  assert.match(migration, /Archived Design assets cannot receive new versions/)
  assert.match(migration, /Archived Design asset state is immutable/)
  assert.match(race, /writer did not wait on the asset root lock/)
  assert.match(race, /concurrent_version_rejected=true/)
  assert.match(race, /archive did not wait on the version writer root lock/)
  assert.match(race, /stale_archive_sqlstate_40001=true/)
})

test('B04 hides archived roots only from normal browsing while exact signing stays resolvable', () => {
  assert.match(repository, /scopedFrom\('design_assets'\)\.select\('\*'\)[\s\S]*\.is\('archived_at', null\)/)
  assert.match(server, /action === 'sign_asset_versions'/)
  assert.doesNotMatch(server, /sign_asset_versions[\s\S]{0,500}archived_at/)
  assert.match(verifier, /version_history_still_readable/)
  assert.match(verifier, /new_version_rejected/)
  assert.match(verifier, /restore_rejected/)
  for (const check of ['null_department_rejected', 'inactive_member_rejected', 'missing_member_rejected',
    'client_member_rejected', 'wrong_organization_rejected', 'stale_latest_rejected',
    'ineligible_history_rejected', 'changed_replay_intent_rejected']) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /set local role service_role/)
})
