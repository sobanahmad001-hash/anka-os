import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readAssignmentCapabilities, recordAssignmentCapabilities } from './assignmentCapabilities.js'
const envelope = overrides => ({ schema_version: 1, assignment_enforced: true, organization_id: 'org', project_id: 'project',
  actor_id: 'actor', can_assign: false, can_create_unassigned: true,
  project_tasks: [{ id: 'task', row_version: 2, can_assign: false, can_execute: true }],
  engagement_work_items: [], ...overrides })

test('server capabilities are project/organization scoped and project task identity stays distinct', async () => {
  const calls = []
  const result = await readAssignmentCapabilities({ rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: envelope() }) } }, 'org', 'project')
  assert.deepEqual(calls, [{ name: 'get_assignment_capabilities', args: { p_organization_id: 'org', p_project_id: 'project' } }])
  assert.equal(recordAssignmentCapabilities(result, 'project_tasks', { id: 'task', row_version: 2 }).can_execute, true)
  assert.equal(recordAssignmentCapabilities(result, 'engagement_work_items', { id: 'task', row_version: 2 }).can_execute, false)
  assert.equal(result.can_assign, false)
  assert.equal('can_approve' in result, false)
})

test('missing, stale and wrong-scope capabilities never enable controls', async () => {
  assert.equal(recordAssignmentCapabilities(null, 'project_tasks', { id: 'task', row_version: 2 }).can_assign, false)
  assert.equal(recordAssignmentCapabilities(envelope(), 'project_tasks', { id: 'task', row_version: 3 }).can_execute, false)
  for (const overrides of [{ organization_id: 'foreign' }, { project_id: 'foreign' }, { assignment_enforced: false },
    { can_assign: 'true' }, { actor_id: null }, { project_tasks: [{ id: 'task', row_version: 2, can_assign: true }] }]) {
    await assert.rejects(readAssignmentCapabilities({ rpc() { return Promise.resolve({ data: envelope(overrides) }) } }, 'org', 'project'))
  }
})

test('missing migration and revoked permission errors propagate without fallback', async () => {
  for (const code of ['PGRST202', '42501']) await assert.rejects(readAssignmentCapabilities({
    rpc() { return Promise.resolve({ error: { code } }) },
  }, 'org', 'project'), { code })
})

test('aborted requests and delayed capability responses cannot populate the old scope', async () => {
  const controller = new AbortController()
  let resolve
  const pending = readAssignmentCapabilities({ rpc() { return new Promise(done => { resolve = done }) } }, 'org', 'project', { signal: controller.signal })
  controller.abort()
  resolve({ data: envelope() })
  await assert.rejects(pending, { name: 'AbortError' })
})

test('alternate AI/promotion callers retain shared checked save entry and existing idempotency structure', () => {
  const promotion = readFileSync(new URL('../../supabase/migrations/20260903152801_qts4_deliberate_promotion.sql', import.meta.url), 'utf8')
  const chat = readFileSync(new URL('../../supabase/migrations/20260911130000_p9_department_chat_model_selection.sql', import.meta.url), 'utf8')
  assert.match(promotion, /public\.save_work_item\(/)
  assert.match(promotion, /p_assignee_id => v_assignee_id/)
  assert.match(promotion, /p_idempotency_key/)
  assert.match(chat, /public\.save_work_item\(/)
  assert.match(chat, /p_status => 'not_started', p_assignee_id => null/)
  assert.match(chat, /replayed/)
})

test('both UI record types use server guards and no assignment claim is treated as approval', () => {
  const planning = readFileSync(new URL('../components/ProjectPlanningPanel.jsx', import.meta.url), 'utf8')
  const items = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')
  assert.match(planning, /disabled=\{disabled \|\| !capability.can_assign\}/)
  assert.match(planning, /recordAssignmentCapabilities\(authority, 'project_tasks'/)
  assert.match(planning, /recordAssignmentCapabilities\(authority, 'engagement_work_items'/)
  assert.match(items, /disabled=\{!editorAuthority.can_assign\}/)
  assert.match(items, /!item.assignmentCapabilities\?\.can_execute/)
  assert.match(items, /neither grants approval or release/)
})
