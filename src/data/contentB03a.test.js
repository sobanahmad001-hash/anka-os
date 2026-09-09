import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260909202126_content_b03a_page_identity.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260909202126_content_b03a_page_identity.sql', import.meta.url), 'utf8')
const server = readFileSync(new URL('../../supabase/functions/_shared/contentArtifacts.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../apps/ContentStudio.jsx', import.meta.url), 'utf8')

test('B03a migration adds stable page identity without rewriting legacy rows', () => {
  assert.match(migration, /add column linked_page_key text/)
  assert.match(migration, /work_items_content_page_key_unique/)
  assert.match(migration, /coalesce\([\s\S]*page_key[\s\S]*'legacy:' \|\| private\.normalize_content_page_path/)
  assert.match(migration, /latest approved Website architecture/i)
  assert.doesNotMatch(migration, /update public\.work_items/i)
  assert.match(migration, /old\.linked_page_key/)
  assert.match(verifier, /rollback;/)
  assert.match(verifier, /page path normalization is not deterministic/)
})

test('B03a UI keeps identity read-only and exposes deterministic order controls', () => {
  assert.match(ui, /Stable page identity/)
  assert.match(ui, /aria-readonly="true"/)
  assert.match(ui, /Move .* earlier/)
  assert.match(ui, /Move .* later/)
  assert.match(ui, /stable page key/)
})

test('B03a server owns normalized paths, stable keys and full ancestor validation', () => {
  assert.match(server, /Website page paths must be unique after normalization/)
  assert.match(server, /Website page positions must be unique/)
  assert.match(server, /ancestor cycle/)
  assert.match(server, /Stable page key .* cannot be changed/)
})
