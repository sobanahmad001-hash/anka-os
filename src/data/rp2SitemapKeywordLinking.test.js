import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831100811_rp2_sitemap_keyword_linking.sql')
const sharedContent = read('supabase/functions/_shared/contentArtifacts.ts')
const sharedRelations = read('supabase/functions/_shared/artifactRelations.ts')
const contentStudio = read('supabase/functions/content-studio/index.ts')
const departmentChat = read('supabase/functions/department-chat/index.ts')
const verification = read('supabase/verify_20260831100811_rp2_sitemap_keyword_linking.sql')

test('RP2 extends D3 vocabulary without adding a table or parallel relation store', () => {
  assert.match(migration, /alter table public\.artifact_relations/)
  assert.match(migration, /targets_page/)
  assert.doesNotMatch(migration, /create table|artifact_versions|work_items|work_item_dependencies/i)
  assert.match(sharedRelations, /createArtifactRelation/)
  assert.match(sharedContent, /createArtifactRelation\(input\.visibilityClient/)
  assert.doesNotMatch(sharedContent, /\.from\('artifact_relations'\)\.insert/)
})

test('RP2 validates both required JSON shapes in the canonical server save path', () => {
  for (const field of ['slug', 'title', 'parent_slug', 'page_type', 'purpose']) assert.match(sharedContent, new RegExp(field))
  for (const field of ['term', 'category', 'search_volume', 'target_page_slug', 'notes']) assert.match(sharedContent, new RegExp(field))
  assert.match(sharedContent, /parent slug .*does not reference/)
  assert.match(sharedContent, /industry.*brand.*volume/)
  assert.match(contentStudio, /visibilityClient: userClient/)
  assert.match(departmentChat, /visibilityClient: userClient/)
})

test('RP2 checks target slugs and creates one queryable targets_page relation', () => {
  assert.match(sharedContent, /latest website architecture/)
  assert.match(sharedContent, /relation_type: 'targets_page'/)
  assert.match(sharedContent, /allowExisting: true/)
  assert.match(verification, /keyword_to_page_relation_created/)
  assert.match(verification, /d3_visibility_policy_preserved/)
})

test('RP2 stays out of adjacent roadmap phases', () => {
  const rp2 = `${migration}\n${sharedContent}`
  assert.doesNotMatch(rp2, /brief statement|actual content writing|design direction|keyword volume api/i)
  assert.doesNotMatch(rp2, /create table|work_items|work_item_dependencies/i)
})
