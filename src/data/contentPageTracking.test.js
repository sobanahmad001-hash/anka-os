import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildContentPageTracking } from './contentStudio.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260831101608_rp3_content_page_tracking.sql', import.meta.url), 'utf8')
const verification = readFileSync(new URL('../../supabase/verify_20260831101608_rp3_content_page_tracking.sql', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./contentStudioRepository.js', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../apps/ContentStudio.jsx', import.meta.url), 'utf8')
const workPanel = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')

function workspace({ contentPages = [], tasks = [] } = {}) {
  return {
    artifacts: [
      { id: 'architecture', artifact_type: 'website_architecture' },
      { id: 'content', artifact_type: 'content' },
    ],
    versions: [
      { id: 'architecture-v1', artifact_id: 'architecture', version_number: 1, content: { pages: [
        { page_name: 'Home', path: '/' },
        { page_name: 'Properties', path: '/properties' },
        { page_name: 'Contact', path: '/contact' },
      ] } },
      ...(contentPages.length ? [{ id: 'content-v1', artifact_id: 'content', version_number: 1, content: { pages: contentPages } }] : []),
    ],
    approvals: [{ id: 'approval', artifact_id: 'architecture', artifact_version_id: 'architecture-v1', approved_at: '2026-08-31T10:00:00Z' }],
    contentTasks: tasks,
  }
}

test('RP3 migration adds only page addressing plus a service-role generation function', () => {
  assert.match(migration, /add column linked_page_path text/)
  assert.match(migration, /work_items_content_page_unique/)
  assert.match(migration, /create function public\.generate_content_page_work_items/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /Active team membership required/)
  assert.match(migration, /artifact_type = 'website_architecture'/)
  assert.match(migration, /artifact_type = 'content'/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /create function private\.guard_work_item_page_link/)
  assert.match(migration, /Generated content task page links cannot be changed automatically/)
  assert.match(migration, /linked_artifact_id, linked_page_path, position/)
  assert.match(migration, /revoke all on function public\.generate_content_page_work_items[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.generate_content_page_work_items[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /create table|alter table public\.artifacts|alter table public\.artifact_versions|enable row level security/i)
})

test('generation is explicit, uses exact paths, rejects reruns, and has a three-page rollback verification', () => {
  assert.match(edge, /action === 'generate_content_tasks'/)
  assert.match(edge, /admin\.rpc\('generate_content_page_work_items'/)
  assert.match(repository, /generateContentTasks/)
  assert.match(studio, /Generate content tasks from sitemap/)
  assert.match(migration, /Content page tasks have already been generated/)
  assert.match(migration, /Content page paths do not match the approved website architecture/)
  assert.match(verification, /cardinality\(v_generated\) <> 3/)
  assert.match(verification, /array\['\/', '\/properties', '\/contact'\]/)
  assert.match(verification, /rollback;/)
})

test('status tracking uses the approved sitemap before content exists', () => {
  const tracking = buildContentPageTracking(workspace())
  assert.equal(tracking.source, 'website_architecture')
  assert.equal(tracking.canGenerate, true)
  assert.deepEqual(tracking.rows.map(row => [row.pageName, row.pagePath, row.task]), [
    ['Home', '/', null],
    ['Properties', '/properties', null],
    ['Contact', '/contact', null],
  ])
})

test('status tracking prefers content page records and flags later sitemap mismatches without syncing', () => {
  const tracking = buildContentPageTracking(workspace({
    contentPages: [{ page_path: '/' }, { page_path: '/properties' }, { page_path: '/about' }],
    tasks: [
      { id: 'home', linked_page_path: '/', status: 'done' },
      { id: 'properties', linked_page_path: '/properties', status: 'in_progress' },
      { id: 'contact', linked_page_path: '/contact', status: 'not_started' },
    ],
  }))
  assert.equal(tracking.source, 'content')
  assert.equal(tracking.canGenerate, false)
  assert.equal(tracking.hasMismatch, true)
  assert.deepEqual(tracking.rows.map(row => [row.pagePath, row.task?.status || null]), [
    ['/', 'done'], ['/properties', 'in_progress'], ['/about', null],
  ])
  assert.deepEqual(tracking.staleTasks.map(task => task.linked_page_path), ['/contact'])
  assert.match(studio, /reconcile the differences manually/i)
  assert.doesNotMatch(studio, /auto.?sync|auto.?delete/i)
})

test('existing Work list and Board infrastructure filters and labels tracked page paths', () => {
  assert.match(workPanel, /Filter label="Content page"/)
  assert.match(workPanel, /item\.linked_page_path/)
  assert.match(workPanel, /Tracked content page/)
  assert.match(studio, /Open Work board/)
})
