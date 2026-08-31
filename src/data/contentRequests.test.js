import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONTENT_REQUEST_FORMATS,
  newContentRequest,
  serializeContentRequest,
} from './contentRequests.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const coreMigration = read('supabase/migrations/20260831165601_cp1_content_request_core.sql')
const mediaMigration = read('supabase/migrations/20260831165617_cp1_design_media_content_request_target.sql')
const contentEdge = read('supabase/functions/content-studio/index.ts')
const designEdge = read('supabase/functions/design-workshop/index.ts')
const repository = read('src/data/contentRequestsRepository.js')
const ui = read('src/components/ContentRequestPanel.jsx')

test('CP1 format vocabulary matches the evidence-backed production shapes', () => {
  assert.deepEqual(CONTENT_REQUEST_FORMATS.map(([value]) => value), [
    'reel', 'carousel', 'single_image', 'stories',
    'carousel_stories', 'reel_carousel', 'web_design_element',
  ])
  for (const [format] of CONTENT_REQUEST_FORMATS) assert.match(coreMigration, new RegExp(`'${format}'`))
})

test('project request serialization keeps event linking genuinely optional', () => {
  const engagement = { id: 'engagement-1', brand_id: 'brand-1' }
  const unlinked = serializeContentRequest({ ...newContentRequest(engagement), brief: 'Routine Tuesday post' })
  assert.equal(unlinked.linked_event_id, null)
  assert.equal(unlinked.create_event_link, false)
  const linked = serializeContentRequest({
    ...newContentRequest(engagement), brief: 'Conference post',
    linked_event_id: 'event-1', create_event_link: true, lead_time_days: '14',
  })
  assert.equal(linked.linked_event_id, 'event-1')
  assert.equal(linked.create_event_link, true)
  assert.equal(linked.lead_time_days, 14)
})

test('core migration enforces tenant-safe project, brand, event, and attachment relationships', () => {
  assert.match(coreMigration, /create table public\.content_requests/)
  assert.match(coreMigration, /create table public\.content_request_assets/)
  assert.match(coreMigration, /foreign key \(engagement_id, organization_id\)/)
  assert.match(coreMigration, /foreign key \(brand_id, organization_id\)/)
  assert.match(coreMigration, /foreign key \(linked_event_id, organization_id\)[\s\S]*on delete set null \(linked_event_id\)/)
  assert.match(coreMigration, /foreign key \(design_media_asset_id, organization_id\)/)
  assert.match(coreMigration, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(coreMigration, /revoke all on public\.content_requests from anon, authenticated/)
  assert.match(coreMigration, /grant select on public\.content_requests to authenticated/)
  assert.match(coreMigration, /Content request core fields are immutable/)
  assert.doesNotMatch(coreMigration, /grant (insert|update|delete|all) on public\.content_requests to authenticated/i)
})

test('the Design Media boundary migration is isolated and enforces exactly one composite target', () => {
  assert.doesNotMatch(mediaMigration, /create table public\.content_requests|create table public\.content_request_assets/)
  assert.match(mediaMigration, /alter table public\.design_media_assets/)
  assert.match(mediaMigration, /design_media_assets_exactly_one_target check/)
  assert.match(mediaMigration, /design_direction_version_id is not null and content_request_id is null/)
  assert.match(mediaMigration, /design_direction_version_id is null and content_request_id is not null/)
  assert.match(mediaMigration, /foreign key \(content_request_id, organization_id\)/)
  assert.match(mediaMigration, /references public\.content_requests\(id, organization_id\)/)
  assert.match(mediaMigration, /Design media must target the same internal-engine content request/)
  assert.match(mediaMigration, /Figma handoff URLs require a Figma-handoff content request/)
  assert.doesNotMatch(mediaMigration, /alter table public\.(engagements|brands|external_events|content_event_links)/)
})

test('existing Design Workshop generation remains direction-scoped and unchanged at its public action', () => {
  assert.match(designEdge, /generate_image: \(\) => generateImage\(admin, userClient, body, user\.id\)/)
  assert.match(designEdge, /directionVersionId: version\.id,[\s\S]*contentRequestId: null/)
  assert.match(designEdge, /mediaStoragePath\(input\.directionVersionId, asset\.id\)/)
  assert.match(designEdge, /createVideoPlaceholder[\s\S]*design_direction_version_id: version\.id/)
  assert.match(designEdge, /generateOpenAiImage\(credential, model\.model_id, input\.prompt\)/)
})

test('CP1 reuses the same model registry, provider adapter, storage bucket, and media table', () => {
  assert.match(repository, /generate_content_request_image/)
  assert.match(designEdge, /generateContentRequestImage[\s\S]*generateImageForTarget/)
  assert.match(designEdge, /from\('design_model_registry'\)/)
  assert.match(designEdge, /from\('design_media_assets'\)\.insert/)
  assert.match(designEdge, /from\(MEDIA_BUCKET\)\.upload/)
  assert.doesNotMatch(coreMigration + mediaMigration, /create table public\.(content_generated_media|content_media_assets)/)
})

test('project-mode UI treats no event as the normal path and contains no client-type branching', () => {
  assert.match(ui, /No event — routine or recurring content/)
  assert.match(ui, /Event context is always optional/)
  assert.match(ui, /CP3 will generate and attach/)
  assert.doesNotMatch(ui + repository + contentEdge, /client_type|event_driven|industry\s*===|industry\s*!==/i)
})

test('CP1 leaves queue, general-mode UI, and Figma page generation out of scope', () => {
  assert.doesNotMatch(ui, /mode[^\n]*general|General mode/i)
  assert.doesNotMatch(coreMigration, /create table public\.content_(queue|calendar)/)
  assert.doesNotMatch(repository + contentEdge, /figma\.com\/api|create_figma|figma_file/i)
  assert.match(coreMigration, /Reserved nullable reference for CP4/)
})
