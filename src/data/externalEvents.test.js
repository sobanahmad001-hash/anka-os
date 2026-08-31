import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { EVENT_CONTENT_TYPES, calendarMonth, displayWorkItem, dueLabel } from './externalEvents.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260831112719_mk1_external_events.sql')
const verifier = read('../../supabase/verify_20260831112719_mk1_external_events.sql')
const edge = read('../../supabase/functions/external-events/index.ts')
const repository = read('./externalEventsRepository.js')
const screen = read('../apps/ExternalEvents.jsx')
const app = read('../App.jsx')
const nav = read('../config/environmentNav.js')

test('MK1 schema is organization-safe, indexed, and browser read-only', () => {
  assert.match(migration, /create table public\.external_events/)
  assert.match(migration, /create table public\.content_event_links/)
  assert.match(migration, /unique \(id, organization_id\)/)
  assert.match(migration, /on delete set null \(linked_work_item_id\)/)
  assert.match(migration, /with \(security_invoker = true\)/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /grant select on public\.external_events to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.external_events to authenticated/i)
  for (const index of ['idx_external_events_brand_dates', 'idx_content_event_links_event', 'idx_content_event_links_work_item_fk', 'idx_content_event_links_due']) assert.match(migration, new RegExp(index))
})

test('external event server writes require an allowed department or leadership', () => {
  for (const department of ['content', 'marketing', 'design']) assert.match(edge, new RegExp(`'${department}'`))
  for (const role of ['system_owner', 'operations_admin', 'executive']) assert.match(edge, new RegExp(`'${role}'`))
  assert.match(edge, /requireWriter/)
  assert.match(edge, /userClient\.from\('brands'\)/)
  assert.match(edge, /item\.organization_id !== event\.organization_id \|\| item\.brand_id !== event\.brand_id/)
  assert.match(repository, /functions\.invoke\('external-events'/)
})

test('Sphere Events is shared and supports every required planning flow', () => {
  assert.deepEqual(EVENT_CONTENT_TYPES, ['blog', 'social', 'email', 'design_asset'])
  assert.match(app, /path="sphere\/events" element={<ExternalEvents \/>}/)
  assert.match(nav, /Sphere Events.*\/sphere\/events.*dept: null/)
  assert.match(screen, /externalEvents\.listDue/)
  assert.match(screen, /workItems\.save/)
  assert.match(screen, /updateLinkStatus/)
  assert.match(screen, /Select engagement/)
  assert.match(screen, /Multiple items of the same type are supported/)
})

test('calendar and work-item display helpers preserve historical context', () => {
  assert.equal(calendarMonth([{ start_date: '2026-09-01' }, { start_date: '2026-10-01' }], '2026-09').length, 1)
  assert.equal(displayWorkItem({ work_items: { title: 'Launch page', deleted_at: null } }), 'Launch page')
  assert.equal(displayWorkItem({ work_items: { title: 'Old task', deleted_at: '2026-08-31' } }), 'Old task (historical)')
  assert.equal(dueLabel('2026-08-31', new Date(2026, 7, 31)), 'Due today')
})

test('rollback-safe verifier covers the live view, all types, isolation, and unlink behavior', () => {
  for (const check of ['all_four_content_types_together', 'link_without_work_item_created', 'due_view_is_live', 'hard_deleted_work_item_unlinks_only_id', 'cross_organization_rows_hidden', 'due_view_is_security_invoker']) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /rollback;/)
})
