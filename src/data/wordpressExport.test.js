import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { latestWordPressExportJob, wordpressSeoRows } from './wordpressExport.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831123316_rp5_native_wordpress_export.sql')
const edge = read('supabase/functions/wordpress-export/index.ts')
const theme = read('supabase/functions/wordpress-export/theme.ts')
const verification = read('supabase/verify_20260831123316_rp5_native_wordpress_export.sql')
const workshop = read('src/apps/DesignWorkshop.jsx')
const browserContract = read('src/data/wordpressExport.js')

test('RP5 uses the canonical website page design slug and has no page_slug contract', () => {
  assert.match(theme, /wordpressSlug\(slugValue\)/)
  assert.match(edge, /design\.slug/)
  assert.doesNotMatch(edge, /page_slug/)
})

test('native export is provider-neutral and requires no paid API key in browser or server code', () => {
  assert.match(migration, /provider text not null default 'native'/)
  assert.match(migration, /provider in \('native', 'wpconvert'\)/)
  assert.doesNotMatch(edge, /WPCONVERT|X-API-Key|api\.wpconvert/i)
  assert.match(theme, /style\.css/)
  assert.match(theme, /index\.php/)
})

test('only approved pages can export and completion is an atomic service-only database boundary', () => {
  assert.match(edge, /data\.status !== 'approved'/)
  assert.match(migration, /and status = 'approved'/)
  assert.match(migration, /complete_native_wordpress_export/)
  assert.match(migration, /revoke all on function public\.complete_native_wordpress_export[\s\S]*from public, anon, authenticated/)
})

test('private artifacts use short-lived signed URLs that are never persisted', () => {
  assert.match(migration, /'wordpress-theme-exports'[\s\S]*false/)
  assert.match(edge, /createSignedUrl\(storagePath, 600/)
  assert.match(edge, /createSignedUrl\(job\.storage_path, 600/)
  assert.doesNotMatch(migration, /\n\s+download_url text/)
  assert.match(migration, /storage:\/\/wordpress-theme-exports/)
})

test('signed RP4 images are bundled and every SEO preservation result is shown', () => {
  assert.match(theme, /design-generated-media/)
  assert.match(theme, /get_template_directory_uri/)
  for (const field of ['title_matches', 'meta_description_matches', 'heading_hierarchy_preserved', 'image_alt_text_preserved']) {
    assert.match(theme, new RegExp(field))
    assert.match(browserContract, new RegExp(field))
  }
  assert.match(workshop, /wordpressSeoRows\(job\.seo_verification\)/)
  assert.match(theme, /if \(!verification\.all_checks_passed\)/)
})

test('latest export job and SEO rows are deterministic', () => {
  const latest = latestWordPressExportJob([
    { id: 'old', website_page_design_id: 'page', requested_at: '2026-01-01T00:00:00Z' },
    { id: 'new', website_page_design_id: 'page', requested_at: '2026-02-01T00:00:00Z' },
  ], 'page')
  assert.equal(latest.id, 'new')
  assert.equal(wordpressSeoRows({ title_matches: true }).filter(row => row.passed).length, 1)
})

test('rollback-safe verification names every security and completion check', () => {
  assert.match(verification.trimEnd(), /rollback;$/)
  for (const name of ['wordpress_export_jobs_exists', 'native_provider_is_default', 'canonical_slug_is_used', 'theme_bucket_is_private', 'rls_enabled', 'browser_is_read_only', 'completion_function_is_service_only', 'only_approved_designs_complete', 'successful_completion_is_atomic', 'seo_verification_is_persisted', 'seo_gate_blocks_partial_completion']) {
    assert.match(verification, new RegExp(name))
  }
})
