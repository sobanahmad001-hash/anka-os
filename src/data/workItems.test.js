import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { artifactRoute, filterAndSortWorkItems } from './workItems.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260829071335_work_item_core.sql', import.meta.url), 'utf8')
const functionSource = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')
const operatingSpine = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')

test('filters and sorts the flat W1 list without board semantics', () => {
  const items = [
    { id: 'a', title: 'Later', status: 'not_started', priority: 'low', assignee_id: 'u1', department_id: 'design', due_date: '2026-09-10', position: 2 },
    { id: 'b', title: 'Blocked', status: 'blocked', priority: 'urgent', assignee_id: 'u2', department_id: 'development', due_date: '2026-08-28', position: 1 },
    { id: 'c', title: 'Done', status: 'done', priority: 'high', assignee_id: 'u2', department_id: 'design', due_date: '2026-08-27', position: 3 },
  ]
  const result = filterAndSortWorkItems(items, { department: 'development', due: 'overdue' }, { key: 'priority', direction: 'asc' }, new Date('2026-08-29T00:00:00Z'))
  assert.deepEqual(result.map(item => item.id), ['b'])
})

test('artifact references route to the owning department workspace', () => {
  assert.equal(artifactRoute('content'), '/sphere/content/studio')
  assert.equal(artifactRoute('campaign_brief'), '/sphere/marketing/studio')
  assert.equal(artifactRoute('technical_brief'), '/sphere/engagements')
})

test('the migration enforces membership, soft deletion, RLS, and atomic audit writes', () => {
  assert.match(migration, /create table public\.work_items/)
  assert.match(migration, /deleted_at timestamptz/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /Assignee must be an active team member of this organization/)
  assert.match(migration, /'work_item_created'[\s\S]*'work_item_status_changed'[\s\S]*'work_item_assigned'/)
  assert.match(migration, /grant select on public\.work_items to authenticated/)
  assert.match(migration, /grant execute on function public\.save_work_item[\s\S]*to service_role/)
  assert.match(migration, /set deleted_at = now\(\)/)
  assert.doesNotMatch(migration, /delete from public\.work_items/)
  assert.doesNotMatch(migration, /update public\.artifacts|update public\.artifact_versions|update public\.engagement_stage_instances/)
})

test('the engagement-level UI contains all W1 filters and no later-phase surface', () => {
  assert.match(operatingSpine, />Work<\/button>/)
  for (const label of ['Status', 'Assignee', 'Department', 'Priority', 'Due date']) assert.match(panel, new RegExp(`label="${label}"`))
  assert.match(panel, /Work item detail/)
  assert.match(panel, /References are storage-only in W1/)
  assert.doesNotMatch(panel, /Kanban|Calendar|Timeline|Dependency|Automation|Subtask|Custom field/i)
  assert.doesNotMatch(functionSource, /openai|anthropic|notification|webhook|auto.?status/i)
  assert.doesNotMatch(migration, /parent_work_item_id|custom_fields|automation_rules/)
})
