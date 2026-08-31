import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  newGeneralContentRequest,
  serializeGeneralContentRequest,
} from './contentRequests.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const repository = read('src/data/contentRequestsRepository.js')
const panel = read('src/components/GeneralContentRequestsPanel.jsx')
const studio = read('src/apps/ContentStudio.jsx')
const edge = read('supabase/functions/content-studio/index.ts')
const coreMigration = read('supabase/migrations/20260831165601_cp1_content_request_core.sql')

test('CP2 general request serialization requires no engagement and keeps brand optional', () => {
  const empty = serializeGeneralContentRequest({ ...newGeneralContentRequest(), brief: 'Quick reel' })
  assert.equal(empty.mode, 'general')
  assert.equal(empty.engagement_id, null)
  assert.equal(empty.brand_id, null)
  assert.equal(empty.linked_event_id, null)
  assert.equal(empty.create_event_link, false)

  const branded = serializeGeneralContentRequest({
    ...newGeneralContentRequest(), brief: 'Brand carousel', brand_id: ' brand-1 ',
  })
  assert.equal(branded.engagement_id, null)
  assert.equal(branded.brand_id, 'brand-1')
})

test('CP2 uses the one existing CP1 creation action without parallel insert logic', () => {
  assert.match(panel, /contentRequests\.create\(serializeGeneralContentRequest\(form\)\)/)
  assert.match(repository, /create: input => invoke\('content-studio', 'create_content_request', input\)/)
  assert.match(edge, /action === 'create_content_request'[\s\S]*createContentRequest\(admin, body, user\.id\)/)
  assert.doesNotMatch(panel + repository, /\.from\('content_requests'\)\.insert|\.insert\([^)]*content_requests/i)
})

test('general requests are a flat RLS-filtered organization list sorted newest first', () => {
  assert.match(repository, /from\('content_requests'\)[\s\S]*\.eq\('mode', 'general'\)\.order\('created_at', \{ ascending: false \}\)/)
  assert.match(repository, /CP1's RLS policy limits both reads/)
  assert.match(coreMigration, /Team can read organization content requests[\s\S]*is_team_organization_member\(organization_id\)/)
  assert.doesNotMatch(panel, /folder|category|groupBy|section_id/i)
})

test('general mode is directly usable before an engagement workspace exists', () => {
  assert.match(studio, /Make a post \/ reel/)
  assert.match(studio, /tab === 'general' \? <GeneralContentRequestsPanel \/> : loading/)
  assert.match(studio, /\['general', 'General requests'\]/)
  assert.match(panel, /No brand selected/)
  assert.match(panel, /What do you need\?/)
})

test('CP2 records output intent but does not extend either generation path', () => {
  assert.match(panel, /Internal generation remains project-only/)
  assert.match(panel, /CP3 owns Figma reference-page generation/)
  assert.doesNotMatch(panel, /generateImage|generate_content_request_image|createVideoPlaceholder|design-workshop/)
  assert.doesNotMatch(panel + repository, /figma\.com\/api|create_figma|figma_file/i)
})

test('CP2 adds no migration and leaves queue, calendar, schema, and RLS unchanged', () => {
  const migrationNames = fs.readdirSync(path.join(root, 'supabase/migrations'))
  assert.equal(migrationNames.some(name => /cp2|general_mode_ui/i.test(name)), false)
  assert.doesNotMatch(panel, /content_queue|recurring|lead_time_days|linked_event_id/i)
  assert.doesNotMatch(repository, /\.update\(|\.delete\(/)
})
