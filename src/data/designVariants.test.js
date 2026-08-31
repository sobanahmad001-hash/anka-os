import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831205738_ds2_variant_generation.sql')
const verifier = read('supabase/verify_20260831185355_ds2_variant_generation.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const edgeTest = read('supabase/functions/design-workshop/index.test.ts')
const repository = read('src/data/designWorkshopRepository.js')
const ui = read('src/apps/DesignWorkshop.jsx')

test('DS2 adds one organization-scoped released-variant table with indexed foreign keys and RLS', () => {
  assert.match(migration, /create table public\.design_direction_variants/)
  assert.match(migration, /foreign key \(source_direction_version_id, organization_id\)[\s\S]*references public\.design_direction_versions\(id, organization_id\) on delete cascade/)
  assert.match(migration, /foreign key \(design_media_asset_id, organization_id\)[\s\S]*references public\.design_media_assets\(id, organization_id\)/)
  assert.match(migration, /idx_design_direction_variants_source/)
  assert.match(migration, /idx_design_direction_variants_source[\s\S]*source_direction_version_id, organization_id, created_at desc/)
  assert.match(migration, /idx_design_direction_variants_media_asset/)
  assert.match(migration, /idx_design_direction_variants_created_by/)
  assert.match(migration, /alter table public\.design_direction_variants enable row level security/)
  assert.match(migration, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on public\.design_direction_variants from anon, authenticated/)
  assert.match(migration, /grant select on public\.design_direction_variants to authenticated/)
})

test('the verified format set uses current social and display targets rather than the draft 16:9 image guess', () => {
  for (const format of ['square_1x1', 'story_9x16', 'landscape_1_91x1', 'banner_728x90', 'banner_300x250', 'portrait_4x5']) {
    assert.match(migration, new RegExp(`'${format}'`))
    assert.match(edge, new RegExp(`\\['${format}',`))
    assert.match(ui, new RegExp(`\\['${format}',`))
  }
  assert.doesNotMatch(migration, /landscape_16x9/)
  assert.doesNotMatch(edge, /\['landscape_16x9',/)
})

test('database and Edge Function both reject draft or wrong-service variant sources', () => {
  assert.match(migration, /from public\.design_direction_releases release/)
  assert.match(migration, /service\.slug in \('social_assets', 'advertising_assets'\)/)
  assert.match(migration, /Variant media must be an image generated from the same direction version/)
  assert.match(migration, /A ready variant requires its ready image asset from the same direction version/)
  assert.match(edge, /requireReleasedVariantSource\(admin, userClient, directionVersionId\)/)
  assert.match(edge, /Variants can only be generated from a released direction version/)
  assert.match(edge, /VARIANT_SERVICE_SLUGS = new Set\(\['social_assets', 'advertising_assets'\]\)/)
  assert.match(edgeTest, /variant source validation rejects drafts and non-variant services/)
})

test('variant generation reuses the installed image adapter, storage path, asset table, and signer', () => {
  assert.equal((edge.match(/const OPENAI_IMAGES_URL/g) || []).length, 1)
  assert.equal((edge.match(/async function generateImageForTarget/g) || []).length, 1)
  assert.doesNotMatch(edge, /generateImageAsset/)
  assert.match(edge, /providerSize: spec\.providerSize,[\s\S]*targetWidth: spec\.width,[\s\S]*targetHeight: spec\.height/)
  assert.match(edge, /contentRequestId: request\.id,[\s\S]*engagementId: request\.engagement_id/)
  assert.match(edge, /from\('design_media_assets'\)\.insert/)
  assert.match(edge, /mediaStoragePath\(input\.directionVersionId, asset\.id\)/)
  assert.match(edge, /createSignedUrls/)
  assert.doesNotMatch(edge, /VARIANT_[A-Z_]*BUCKET|variant-generated-media/)
})

test('variants are exact-size PNG exports and status transitions check database errors', () => {
  assert.match(edge, /cropResizePng\(bytes, input\.targetWidth, input\.targetHeight\)/)
  assert.match(edge, /pngDimensions\(output\)/)
  assert.match(edge, /actual\.width !== width \|\| actual\.height !== height/)
  assert.match(edgeTest, /exports and verifies the exact declared PNG dimensions/)
  assert.match(edge, /const \{ error: generatingError \} = await admin/)
  assert.match(edge, /if \(generatingError\) throw generatingError/)
  assert.match(edge, /const \{ error: failedStatusError \} = await admin/)
  assert.match(edge, /if \(failedStatusError\)/)
})

test('batch formats are independent and the UI keeps variants outside direction comparison', () => {
  assert.match(edge, /runIndependentVariantJobs\(requestedFormats/)
  assert.match(edgeTest, /one failed variant does not block sibling formats in the same request/)
  assert.match(repository, /from\('design_direction_variants'\)/)
  assert.match(repository, /generateVariants:/)
  assert.match(ui, /Released-format variants/)
  assert.match(ui, /remains separate from direction comparison/)
  assert.match(ui, /workspace\.variants/)
  assert.match(ui, /variant\.design_media_asset_id/)
})

test('DS2 does not add future multi-page, storyboard, design-system, or handoff behavior', () => {
  assert.doesNotMatch(migration, /storyboard|handoff|design_system_library|multi_page/i)
  assert.doesNotMatch(edge, /generate_storyboard|generate_handoff|generate_design_system|generate_multi_page/i)
})

test('the live verifier is rollback-safe and exercises released, draft, and media-source behavior', () => {
  assert.match(verifier, /^begin;/m)
  assert.match(verifier, /released_source_variant_allowed/)
  assert.match(verifier, /draft_source_variant_rejected/)
  assert.match(verifier, /wrong_service_source_rejected/)
  assert.match(verifier, /ready_without_media_rejected/)
  assert.match(verifier, /matching_source_media_allowed/)
  assert.match(verifier, /mismatched_source_media_rejected/)
  assert.match(verifier, /rollback;\s*$/)
  assert.doesNotMatch(verifier, /\bcommit\s*;/i)
})
