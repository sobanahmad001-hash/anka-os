import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  cloneDesignSystemContent,
  latestVersionFor,
  releasedVersionsFor,
} from './designSystems.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const migration = read('supabase/migrations/20260831200435_ds5_design_systems_library.sql')
const verifier = read('supabase/verify_20260831200435_ds5_design_systems_library.sql')
const edge = read('supabase/functions/design-systems/index.ts')
const ui = read('src/apps/DesignSystems.jsx')
const relations = read('supabase/functions/_shared/artifactRelations.ts')
const config = read('supabase/config.toml')

test('DS5 migration adds only the design_system artifact vocabulary', () => {
  assert.match(migration, /drop constraint artifacts_artifact_type_check/)
  assert.match(migration, /add constraint artifacts_artifact_type_check[\s\S]*'design_system'/)
  assert.doesNotMatch(migration, /create table|create function|create policy|enable row level security/i)
  assert.equal((migration.match(/alter table public\.artifacts/g) || []).length, 2)
})

test('DS5 reuses the DS1 active-service validator without a Workshop generation path', () => {
  assert.match(edge, /import[\s\S]*requireActiveDesignService[\s\S]*from '\.\.\/design-workshop\/index\.ts'/)
  assert.match(edge, /await requireActiveDesignService\(admin, engagementId, engagementServiceId\)/)
  assert.match(edge, /result\.catalog\?\.slug !== DESIGN_SYSTEM_SERVICE/)
  assert.doesNotMatch(edge, /generateDirections|generateOne|directionSchema|createSession/)
})

test('DS5 content remains a manual structured specification', () => {
  for (const key of ['color_tokens', 'typography_scale', 'components', 'usage_rules']) {
    assert.match(edge, new RegExp(`'${key}'`))
    assert.match(ui, new RegExp(key === 'usage_rules' ? 'Usage rules' : key.replaceAll('_', ' '), 'i'))
  }
  assert.match(edge, /ai_use_allowed: false/)
  assert.doesNotMatch(edge, /openai|responses|image generation|storybook/i)
  assert.match(ui, /Structured specification, not a renderer/)
})

test('released versions remain browsable and D3 only targets released design systems', () => {
  const versions = [{ id: 'v1', artifact_id: 'a', version_number: 1 }, { id: 'v2', artifact_id: 'a', version_number: 2 }]
  const approvals = [{ artifact_id: 'a', artifact_version_id: 'v1' }]
  assert.equal(latestVersionFor('a', versions).id, 'v2')
  assert.deepEqual(releasedVersionsFor('a', versions, approvals).map(item => item.id), ['v1'])
  assert.match(ui, /Permanent released library/)
  assert.match(relations, /Only a released Design System can be linked/)
})

test('DS5 uses the generic artifact proofing, approval, and relation infrastructure', () => {
  assert.match(ui, /ArtifactApprovalPanel/)
  assert.match(ui, /VersionProofingPanel[\s\S]*targetKind="artifact"/)
  assert.match(ui, /ArtifactRelationsPanel/)
  assert.match(config, /\[functions\.design-systems\][\s\S]*verify_jwt = true/)
})

test('DS5 verifier is named and rollback-only', () => {
  for (const check of [
    'design_system_type_registered', 'artifact_rls_unchanged', 'artifact_browser_read_only',
    'released_version_persists', 'd3_relation_targets_design_system',
  ]) assert.match(verifier, new RegExp(`'${check}'`))
  assert.match(verifier.trim(), /rollback;$/)
  assert.doesNotMatch(verifier, /(^|\n)\s*commit\s*;/i)
})

test('design-system editor clones immutable content for safe local editing', () => {
  const source = { color_tokens: [{ name: 'A', value: '#fff' }], typography_scale: [], components: [], usage_rules: 'Rule' }
  const cloned = cloneDesignSystemContent(source)
  cloned.color_tokens[0].name = 'B'
  assert.equal(source.color_tokens[0].name, 'A')
})
