import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONTENT_ARTIFACT_TYPES,
  bestContentStage,
  serializeContentArtifact,
} from './contentStudio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260828105516_content_studio_artifact_types.sql')

test('Content Studio covers all eight agreed artifact types', () => {
  assert.deepEqual(CONTENT_ARTIFACT_TYPES, [
    'discovery', 'vision', 'audience', 'website_architecture',
    'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
  ])
})

test('Content vocabulary migration is an isolated additive CHECK change', () => {
  for (const type of CONTENT_ARTIFACT_TYPES) assert.match(migration, new RegExp(`'${type}'`))
  assert.match(migration, /artifact_draft_proposed_via_chat/)
  assert.doesNotMatch(migration, /create table|create policy|enable row level security|add column|actor_id\s/)
  assert.equal((migration.match(/alter table public\./g) || []).length, 4)
})

test('website architecture and three-lens keyword strategy serialize as structured records', () => {
  const architecture = serializeContentArtifact('website_architecture', {
    site_goal: 'Convert', navigation_principles: 'Clear\nPredictable',
    pages: [{ page_name: 'Home', path: '/', page_goal: 'Orient', primary_audience: 'Buyer', primary_cta: 'Book' }],
  })
  assert.equal(architecture.pages[0].path, '/')
  const keywords = serializeContentArtifact('keyword_strategy', {
    strategy_summary: 'Intent map', measurement_notes: 'Review quarterly',
    page_keywords: [{ page_path: '/', service_keywords: 'strategy, consulting', search_demand_keywords: 'agency', brand_identity_keywords: 'Anka' }],
  })
  assert.deepEqual(keywords.page_keywords[0].service_keywords, ['strategy', 'consulting'])
})

test('stage selection remains within the Content department', () => {
  const stage = bestContentStage([
    { id: 'design', name: 'Website architecture', accountable_department_id: 'design' },
    { id: 'content', name: 'Website architecture', accountable_department_id: 'content' },
  ], 'website_architecture')
  assert.equal(stage.id, 'content')
})

test('Design Workshop has no Content artifact authoring or approval entry point', () => {
  const ui = read('src/apps/DesignWorkshop.jsx')
  const repository = read('src/data/designWorkshopRepository.js')
  const edge = read('supabase/functions/design-workshop/index.ts')
  assert.doesNotMatch(ui, /ArtifactModal|Complete form|Create revision|Approve exact version/)
  assert.doesNotMatch(repository, /saveArtifact|approveArtifact/)
  assert.doesNotMatch(edge, /save_artifact|approve_artifact/)
  assert.match(edge, /Approved \$\{type\} context is required/)
})

test('Shared Department Chat has no business connector or external mutation path', () => {
  const source = read('supabase/functions/department-chat/index.ts')
  const externalUrls = [...source.matchAll(/https:\/\/[^'`"\s]+/g)].map(match => match[0])
  assert.deepEqual(externalUrls, ['https://api.openai.com/v1/responses'])
  assert.doesNotMatch(source, /integration-gateway|googleapis|googleads|facebook|instagram|tiktok|wordpress|send_email|\/mutate/)
  assert.match(source, /source: 'department_chat'/)
  assert.match(source, /aiUseAllowed: false/)
  assert.match(source, /Organization AI budget has been reached/)
  assert.match(source, /estimated_cost_microusd/)
})

test('chat drafts use canonical versions and cannot insert an approval', () => {
  const chat = read('supabase/functions/department-chat/index.ts')
  const shared = read('supabase/functions/_shared/contentArtifacts.ts')
  assert.match(chat, /createContentArtifactVersion/)
  assert.match(shared, /from\('artifact_versions'\)\.insert/)
  assert.match(shared, /artifact_draft_proposed_via_chat/)
  assert.doesNotMatch(chat, /from\('artifact_approvals'\)\.insert/)
  assert.doesNotMatch(chat, /approve_artifact|release_direction|select_direction/)
})
