import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationUrl = new URL(
  '../../supabase/migrations/20260825040000_canonical_delivery_core.sql',
  import.meta.url
)

const canonicalTables = [
  'workflow_templates',
  'workflow_stages',
  'project_workflow_templates',
  'task_dependencies',
  'milestones',
  'deliverables',
  'files',
  'deliverable_versions',
  'approvals',
  'requests',
  'research_records',
  'activity_events',
  'living_project_documents',
  'living_project_document_snapshots',
  'client_project_projections',
  'client_portal_items',
]

test('canonical migration enables RLS on every new public table', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const table of canonicalTables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`))
  }
})

test('canonical migration has no deprecated auth role check or legacy foreign key', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.doesNotMatch(sql, /auth\.role\s*\(/)
  assert.doesNotMatch(sql, /references\s+public\.as_/i)
  assert.match(sql, /revoke all on all tables in schema public from anon;/)
})

test('client visibility uses sanitized projection tables and exact released versions', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /create policy "Clients can read project projections"/)
  assert.match(sql, /create policy "Clients can read released portal items"/)
  assert.match(sql, /portal_item\.source_type = 'deliverable_version'/)
  assert.match(sql, /portal_item\.source_id = requests\.target_deliverable_version_id/)
  assert.doesNotMatch(sql, /create policy "Clients can read (tasks|deliverables|deliverable versions|files|research)"/i)
})

test('client approval and historical deletion remain closed', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /client_approvals_enabled/)
  assert.match(sql, /approval_type <> 'client_approval'/)
  assert.match(sql, /revoke delete on[\s\S]*from authenticated;/)
  assert.match(sql, /grant select, insert on[\s\S]*public\.approvals/)
})
