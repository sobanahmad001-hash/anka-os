import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { composePageDesignPreview, latestArchitecturePages } from './websitePageDesigns.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831110424_rp4_html_css_page_designs.sql')
const edge = read('supabase/functions/website-page-designs/index.ts')
const verification = read('supabase/verify_20260831110424_rp4_html_css_page_designs.sql')
const workshop = read('src/apps/DesignWorkshop.jsx')

test('RP4 uses the canonical architecture slug and actual content page_path', () => {
  assert.match(migration, /\n  slug text not null/)
  assert.doesNotMatch(migration, /\n\s+page_slug text/)
  assert.match(edge, /page\.slug/)
  assert.match(edge, /page\.page_path/)
  assert.doesNotMatch(edge, /body\.page_slug/)
})

test('RP4 stores standalone attempts and leaves export behavior to RP5', () => {
  assert.match(migration, /create table public\.website_page_designs/)
  assert.match(migration, /design_direction_version_id/)
  assert.doesNotMatch(edge, /wordpress|exported_at|wordpress_export_url/i)
  assert.match(edge, /status: 'draft'/)
  assert.match(edge, /submit_review/)
  assert.match(edge, /approve/)
})

test('RP4 preview is a sandboxed iframe with CSS injected into the exact HTML attempt', () => {
  const preview = composePageDesignPreview('<!doctype html><html><head></head><body><h1>Home</h1></body></html>', 'h1 { color: red; }')
  assert.match(preview, /<style data-anka-page-design>/)
  assert.match(preview, /h1 \{ color: red; \}/)
  assert.match(workshop, /<iframe[^>]*sandbox=""/)
  assert.match(workshop, /srcDoc=\{composePageDesignPreview/)
})

test('architecture extraction reads pages from the newest version using slug', () => {
  const artifacts = [{ id: 'architecture', artifact_type: 'website_architecture' }]
  const versions = [
    { artifact_id: 'architecture', version_number: 1, content: { pages: [{ slug: 'old' }] } },
    { artifact_id: 'architecture', version_number: 2, content: { pages: [{ slug: 'home' }] } },
  ]
  assert.deepEqual(latestArchitecturePages(artifacts, versions), [{ slug: 'home' }])
})

test('rollback-safe verification names the required schema and security checks', () => {
  assert.match(verification.trimEnd(), /rollback;$/)
  for (const name of ['multiple_attempts_are_append_created', 'd2_visibility_is_inherited', 'new_attempt_defaults_to_draft', 'slug_column_is_canonical', 'rls_enabled', 'browser_is_read_only', 'html_css_model_registered']) assert.match(verification, new RegExp(name))
})
