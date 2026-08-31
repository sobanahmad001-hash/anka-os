import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { brandBriefEditor, brandStatementEditor, serializeBrandBrief, serializeBrandStatement } from './brandBrief.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831100748_rp1_brand_brief_statement.sql')
const contentEdge = read('supabase/functions/content-studio/index.ts')
const designEdge = read('supabase/functions/design-workshop/index.ts')
const compiler = read('supabase/functions/_shared/approvedArtifactContext.ts')
const sharedArtifacts = read('supabase/functions/_shared/contentArtifacts.ts')
const chat = read('supabase/functions/department-chat/index.ts')
const ui = read('src/apps/ContentStudio.jsx')

test('brand brief editor serializes mutable working context', () => {
  const editor = brandBriefEditor({ target_market: 'Operators', price_tier: 'premium', operating_principles: ['Care'], competitor_references: ['Reference A'], raw_brief: 'Raw context' })
  const serialized = serializeBrandBrief({ ...editor, operating_principles: 'Care\nClarity' })
  assert.deepEqual(serialized.operating_principles, ['Care', 'Clarity'])
  assert.equal(serialized.raw_brief, 'Raw context')
})

test('reviewing a statement preserves the exact compilation manifest', () => {
  const sourceManifest = { artifacts: { discovery: { artifact_version_id: 'v1' } } }
  const editor = brandStatementEditor({ statement: 'Positioning and promise', target_market: 'Operators', positioning: 'Position', value_proposition: 'Promise', audience_summary: 'Audience' })
  const serialized = serializeBrandStatement(editor, sourceManifest)
  assert.equal(serialized.source_manifest, sourceManifest)
})

test('migration adds one mutable brand brief per brand with organization RLS', () => {
  assert.match(migration, /create table public\.brand_briefs/)
  assert.match(migration, /unique \(brand_id\)/)
  assert.match(migration, /foreign key \(brand_id, organization_id\)/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /grant select on public\.brand_briefs to authenticated/)
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on public\.brand_briefs to authenticated/)
  assert.doesNotMatch(migration, /immutable[\s\S]*trigger|before update or delete on public\.brand_briefs/)
})

test('brand brief updates one row while statements use immutable artifact versions', () => {
  assert.match(contentEdge, /from\('brand_briefs'\)\.update/)
  assert.match(contentEdge, /\.eq\('id', existing\.id\)/)
  assert.match(contentEdge, /artifactType: 'brand_statement'/)
  assert.match(contentEdge, /createContentArtifactVersion/)
  assert.match(sharedArtifacts, /from\('artifact_versions'\)\.insert/)
  assert.match(migration, /'brand_statement'/)
  assert.doesNotMatch(migration, /create table public\.brand_statements/)
})

test('RP1 uses the same exact approved-context compiler as Design Workshop', () => {
  assert.match(contentEdge, /compileApprovedArtifactContext/)
  assert.match(designEdge, /compileApprovedArtifactContext/)
  for (const type of ['discovery', 'vision', 'audience']) assert.match(contentEdge, new RegExp(`'${type}'`))
  assert.match(compiler, /artifact_version_id: version\.id/)
  assert.match(compiler, /content_checksum: version\.content_checksum/)
  assert.doesNotMatch(contentEdge, /discovery_facilitation|vision_positioning|audience_research/)
})

test('statement generation is explicit, reviewable, approvable, and not a chat artifact', () => {
  assert.match(ui, /Brief & brand statement/)
  assert.match(ui, /Compile brand statement/)
  assert.match(ui, /Save reviewed version/)
  assert.match(ui, /ArtifactApprovalPanel/)
  assert.match(ui, /VersionProofingPanel/)
  assert.match(chat, /CHAT_CONTENT_ARTIFACT_TYPE_SET/)
  assert.match(sharedArtifacts, /filter\(type => type !== 'brand_statement'\)/)
  assert.doesNotMatch(contentEdge, /api\.openai\.com|generateText|integration-gateway/)
})

test('RP1 does not add later-phase surfaces or automatic regeneration', () => {
  assert.doesNotMatch(migration, /sitemap|page_keywords|content_draft|design_direction/)
  assert.doesNotMatch(contentEdge, /database_webhook|pg_cron|automatic_regeneration/)
  assert.doesNotMatch(ui, /Sitemap builder|Keyword builder|Design generation/)
})
