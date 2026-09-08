import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONTENT_ARTIFACT_TYPES,
  DEFAULT_DISCOVERY_TEMPLATE,
  bestContentStage,
  resolveContentLanguage,
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

test('B02 uses one canonical discovery template and limits Unknown explicitly', () => {
  assert.equal(DEFAULT_DISCOVERY_TEMPLATE.id, 'content-discovery-default-v1')
  assert.deepEqual(DEFAULT_DISCOVERY_TEMPLATE.fields.filter(field => field.unknownAllowed).map(field => field.key), ['evidence', 'constraints'])
  assert.equal(DEFAULT_DISCOVERY_TEMPLATE.fields.every(field => field.required), true)
})

test('B02 language precedence never invents English', () => {
  assert.deepEqual(resolveContentLanguage({ explicitLanguage: 'Urdu', approvedBrandLanguage: 'Arabic', organizationDefaultLanguage: 'French' }), {
    status: 'ready', source: 'explicit_request', language: 'Urdu',
  })
  assert.equal(resolveContentLanguage({ approvedBrandLanguage: 'Arabic', organizationDefaultLanguage: 'French' }).language, 'Arabic')
  assert.equal(resolveContentLanguage({ organizationDefaultLanguage: 'French' }).language, 'French')
  assert.deepEqual(resolveContentLanguage(), { status: 'selection_required', source: null, language: '' })
})

test('B02 persists optional source metadata and explicit Vision fields in artifact content', () => {
  const content = serializeContentArtifact('vision', {
    vision_statement: 'Future', positioning: 'Position', value_proposition: 'Value',
    differentiators: 'Evidence-led', values: 'Care', voice_principles: 'Direct', messaging_pillars: 'Clarity',
    language: 'Urdu', source_metadata: { differentiators: {
      source_label: 'Workshop', source_date: '2026-09-04', needs_confirmation: false, human_confirmed: true,
    } },
  })
  assert.deepEqual(content.differentiators, ['Evidence-led'])
  assert.deepEqual(content.messaging_pillars, ['Clarity'])
  assert.equal(content.language, 'Urdu')
  assert.equal(content.source_metadata.differentiators.human_confirmed, true)
})

test('B02 exposes deliberate private exploration and separate confirmed official effects', () => {
  const app = read('src/App.jsx')
  const ui = read('src/apps/ContentStudio.jsx')
  const quickTasks = read('src/apps/QuickTasks.jsx')
  const chatUi = read('src/components/DepartmentChat.jsx')
  const chatServer = read('supabase/functions/department-chat/index.ts')
  assert.match(app, /sphere\/quick-tasks/)
  assert.match(ui, /Start private Content exploration/)
  assert.match(ui, /This does not create an artifact version/)
  assert.match(ui, /create immutable .* version/)
  assert.match(ui, /Use single-manager route/)
  assert.match(ui, /expected_updated_at/)
  assert.match(quickTasks, /This source is terminal after promotion/)
  assert.match(chatUi, /approved Vision or organization default/)
  assert.match(chatServer, /Produce one structured/)
  assert.match(chatServer, /proposalKind: 'artifact_version'/)
})

test('Content vocabulary migration is an isolated additive CHECK change', () => {
  for (const type of CONTENT_ARTIFACT_TYPES) assert.match(migration, new RegExp(`'${type}'`))
  assert.match(migration, /artifact_draft_proposed_via_chat/)
  assert.doesNotMatch(migration, /create table|create policy|enable row level security|add column|actor_id\s/)
  assert.equal((migration.match(/alter table public\./g) || []).length, 4)
})

test('RP2 sitemap and keyword-to-page content serialize as structured records', () => {
  const architecture = serializeContentArtifact('website_architecture', {
    pages: [{ slug: 'home', title: 'Homepage', parent_slug: '', page_type: 'hub', purpose: 'Orient' }],
  })
  assert.deepEqual(architecture.pages[0], {
    slug: 'home', title: 'Homepage', parent_slug: null, page_type: 'hub', purpose: 'Orient',
  })
  const keywords = serializeContentArtifact('keyword_strategy', {
    keywords: [{ term: 'strategy agency', category: 'industry', search_volume: '1200', target_page_slug: 'home', notes: '' }],
  })
  assert.deepEqual(keywords.keywords[0], {
    term: 'strategy agency', category: 'industry', search_volume: 1200, target_page_slug: 'home', notes: '',
  })
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
  const compiler = read('supabase/functions/_shared/approvedArtifactContext.ts')
  assert.doesNotMatch(ui, /ArtifactModal|Complete form|Create revision|Approve exact version/)
  assert.doesNotMatch(repository, /saveArtifact|approveArtifact/)
  assert.doesNotMatch(edge, /save_artifact|approve_artifact/)
  assert.match(edge, /compileApprovedArtifactContext/)
  assert.match(compiler, /Approved \$\{artifactType\} context is required/)
})

test('Shared Department Chat has no business connector or external mutation path', () => {
  const source = read('supabase/functions/department-chat/index.ts')
  const proposalMigration = read('supabase/migrations/20260903235243_department_chat_proposals.sql')
  const externalUrls = [...source.matchAll(/https:\/\/[^'`"\s]+/g)].map(match => match[0])
  assert.deepEqual(externalUrls, ['https://api.openai.com/v1/responses'])
  assert.doesNotMatch(source, /integration-gateway|googleapis|googleads|facebook|instagram|tiktok|wordpress|send_email|\/mutate/)
  assert.match(proposalMigration, /'source', 'department_chat'/)
  assert.match(proposalMigration, /false, 'internal', p_actor_id/)
  assert.match(source, /Organization AI budget has been reached/)
  assert.match(source, /estimated_cost_microusd/)
})

test('chat drafts use canonical versions and cannot insert an approval', () => {
  const chat = read('supabase/functions/department-chat/index.ts')
  const proposalMigration = read('supabase/migrations/20260903235243_department_chat_proposals.sql')
  assert.match(chat, /save_department_chat_proposal/)
  assert.match(chat, /confirm_department_chat_proposal/)
  assert.match(proposalMigration, /insert into public\.artifact_versions/)
  assert.match(proposalMigration, /artifact_draft_proposed_via_chat/)
  assert.doesNotMatch(chat, /from\('artifact_approvals'\)\.insert/)
  assert.doesNotMatch(proposalMigration, /insert into public\.artifact_approvals/)
  assert.doesNotMatch(chat, /approve_artifact|release_direction|select_direction/)
})
