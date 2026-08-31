import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260829113811_design_media_generation.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const repository = read('src/data/designWorkshopRepository.js')
const ui = read('src/apps/DesignWorkshop.jsx')

test('generated media is private, exact-version scoped, and explicitly exposed through RLS', () => {
  assert.match(migration, /'design-generated-media'[\s\S]*false,[\s\S]*10485760/)
  assert.match(migration, /create table public\.design_media_assets/)
  assert.match(migration, /foreign key \(design_direction_version_id, organization_id\)/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /exists \([\s\S]*from public\.design_direction_versions version/)
  assert.match(migration, /revoke all on public\.design_media_assets from anon, authenticated/)
  assert.match(migration, /grant select on public\.design_media_assets to authenticated/)
  assert.doesNotMatch(migration, /create policy[\s\S]*on storage\.objects/)
})

test('the registry seeds the current image model without making it a direction model', () => {
  assert.match(migration, /'gpt-image-2'/)
  assert.match(migration, /array\['image'\]::text\[\]/)
  assert.match(edge, /supportsOutput\(model, 'design_direction'\)/)
  assert.match(ui, /supported_output_types\?\.includes\('design_direction'\)/)
  assert.match(ui, /supported_output_types\?\.includes\('image'\)/)
})

test('image generation uses the selected registry model and server-only private storage', () => {
  assert.match(edge, /model: modelId, prompt/)
  assert.match(edge, /from\(MEDIA_BUCKET\)\.upload\(storagePath, bytes/)
  assert.match(edge, /upsert: false/)
  assert.match(edge, /createSignedUrls\([\s\S]*300\)/)
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY/)
  assert.doesNotMatch(repository, /storage\.from\([^)]*\)\.upload/)
})

test('video is an auditable unavailable placeholder and makes no video provider call', () => {
  assert.match(edge, /media_type: 'video', status: 'unavailable'/)
  assert.match(edge, /Video generation is not yet configured\. An API key and provider need to be added before this works\./)
  assert.doesNotMatch(edge, /api\.openai\.com\/v1\/videos|generativelanguage|sora-2/i)
  assert.match(ui, />Generate video</)
})

test('media stays attached to the exact immutable version and failures remain visible', () => {
  assert.match(repository, /design_direction_version_id/)
  assert.match(ui, /asset\.design_direction_version_id === version\.id/)
  assert.match(ui, /asset\.status === 'failed'/)
  assert.match(ui, /This failed record stays in the audit trail/)
  assert.match(ui, /versionAssets\.map/)
})
