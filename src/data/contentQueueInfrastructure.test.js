import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260831211215_cp4_content_queue.sql')
const verifier = read('supabase/verify_20260831211215_cp4_content_queue.sql')
const edge = read('supabase/functions/content-studio/index.ts')
const panel = read('src/components/ContentQueuePanel.jsx')

test('CP4 queue schema is brand-scoped, tenant-safe, and browser read-only', () => {
  assert.match(migration, /create table public\.content_queue_entries/)
  assert.match(migration, /brand_id uuid not null/)
  assert.match(migration, /foreign key \(brand_id, organization_id\)/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on public\.content_queue_entries from anon, authenticated, service_role/)
  assert.match(migration, /grant select on public\.content_queue_entries to authenticated/)
  assert.doesNotMatch(migration, /alter table public\.(work_items|work_item_dependencies|content_requests)/)
})

test('CP4 actioning reuses CP1 atomically and skipping has no request insert path', () => {
  assert.match(migration, /v_result := public\.create_content_request\(/)
  assert.match(migration, /for update/)
  assert.match(migration, /set status = 'actioned', fulfilled_by_request_id/)
  const skipBody = migration.match(/create or replace function public\.skip_content_queue_entry[\s\S]*?\n\$\$;/)?.[0] || ''
  assert.doesNotMatch(skipBody, /content_requests|content_event_links/)
  assert.match(edge, /action === 'action_queue_entry'[\s\S]*actionQueueEntry\(admin, body, user\.id\)/)
  assert.doesNotMatch(edge, /from\('content_requests'\)\.insert/)
})

test('CP4 remains human-triggered and its verifier proves rollback isolation', () => {
  assert.match(panel, />Action</)
  assert.match(panel, />Skip</)
  assert.match(panel, /Dates never trigger work automatically/)
  assert.doesNotMatch(migration + edge, /pg_cron|cron\.schedule|recurrence_rule|setInterval/)
  assert.match(verifier, /planning_creates_no_request/)
  assert.match(verifier, /mid_transaction_failure_rolls_back_everything/)
  assert.match(verifier, /CP4 forced verifier failure/)
  assert.match(verifier, /rollback;\s*$/)
})
