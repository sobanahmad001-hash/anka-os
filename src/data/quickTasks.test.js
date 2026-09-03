import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { daysUntilExpiry, quickTaskContent, QUICK_TASK_STATES } from './quickTasks.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260903071848_qts1_private_core.sql')
const repository = read('src/data/quickTasksRepository.js')
const screen = read('src/apps/QuickTasks.jsx')
const edge = read('supabase/functions/quick-tasks/index.ts')
const config = read('supabase/config.toml')
const verifier = read('supabase/verify_20260903071848_qts1_private_core.sql')

test('QTS1 content normalization is bounded and predictable', () => {
  const content = quickTaskContent({ notes: ' idea ', checklist: [{ text: ' ship ', done: 1 }, { text: '' }] })
  assert.equal(content.notes, ' idea ')
  assert.deepEqual(content.checklist, [{ text: 'ship', done: true }])
  assert.deepEqual(QUICK_TASK_STATES, ['active', 'preserved', 'expired', 'discarded', 'promoted'])
  assert.equal(daysUntilExpiry('2026-09-06T00:00:00Z', new Date('2026-09-03T00:00:00Z')), 3)
})

test('QTS1 schema separates private content from metadata-only lifecycle audit', () => {
  assert.match(migration, /create table public\.quick_tasks/)
  assert.match(migration, /create table public\.quick_task_revisions/)
  assert.match(migration, /create table public\.quick_task_lifecycle_events/)
  const events = migration.slice(migration.indexOf('create table public.quick_task_lifecycle_events'), migration.indexOf('create index idx_quick_tasks_owner_activity'))
  assert.doesNotMatch(events, /\b(content|title)\b/)
  assert.match(migration, /Quick Task history is append-only/)
  assert.match(migration, /interval '30 days'/)
  for (const index of [
    'idx_quick_tasks_current_revision', 'idx_quick_tasks_fork_source',
    'idx_quick_tasks_fork_revision', 'idx_quick_task_revisions_owner',
    'idx_quick_task_revisions_created_by', 'idx_quick_task_lifecycle_events_related',
  ]) assert.match(migration, new RegExp(index))
})

test('QTS1 owner RLS protects task and revision content while leadership sees only events', () => {
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /Owners and leaders can read Quick Task lifecycle metadata/)
  assert.match(migration, /system_owner.*operations_admin.*executive/s)
  assert.doesNotMatch(migration, /create policy[^;]*(insert|update|delete)/i)
  assert.match(migration, /revoke all on table public\.quick_tasks, public\.quick_task_revisions/)
})

test('QTS1 mutations are atomic service-role operations with exact revision checks', () => {
  for (const name of ['create_quick_task', 'append_quick_task_revision', 'fork_quick_task']) assert.match(migration, new RegExp(`function public\\.${name}`))
  assert.match(migration, /current_revision_id <> p_expected_revision_id/)
  assert.match(migration, /to service_role/)
  assert.match(edge, /admin\.rpc\(functionName/)
  assert.match(edge, /user\.id/)
  assert.match(config, /\[functions\.quick-tasks\][\s\S]*verify_jwt = true/)
})

test('QTS1 ships standalone UI and does not register or mutate canonical records', () => {
  assert.match(screen, /export default function QuickTasks/)
  assert.match(screen, /promotion is intentionally unavailable/i)
  assert.match(repository, /\.from\('quick_tasks'\)/)
  assert.match(repository, /functions\.invoke\('quick-tasks'/)
  for (const source of [migration, repository, edge, screen]) {
    assert.doesNotMatch(source, /from\(['"](artifacts|work_items|tasks|engagements)['"]\).*\.(insert|update|upsert|delete)/is)
  }
  for (const owned of ['src/App.jsx', 'src/config/environmentNav.js', 'src/components/Sidebar.jsx', 'src/components/Header.jsx']) {
    assert.ok(fs.existsSync(path.join(root, owned)))
  }
})

test('QTS1 verifier is rollback-safe and covers privacy, append-only history, and privileges', () => {
  for (const check of ['owner_can_read_content', 'non_owner_cannot_read_content', 'history_is_append_only', 'write_functions_are_service_role_only', 'events_are_metadata_only']) assert.match(verifier, new RegExp(check))
  assert.match(verifier.trim(), /rollback;$/)
  assert.doesNotMatch(verifier, /(^|\n)\s*commit\s*;/i)
})
