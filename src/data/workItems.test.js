import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  artifactRoute,
  buildWorkItemCalendar,
  buildWorkItemRelations,
  buildWorkItemTimeline,
  filterAndSortWorkItems,
  groupWorkItemsForBoard,
  planWorkItemBoardMove,
  workItemSaveInput,
  WORK_ITEM_BOARD_COLUMNS,
} from './workItems.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260829071335_work_item_core.sql', import.meta.url), 'utf8')
const w3Migration = readFileSync(new URL('../../supabase/migrations/20260829081243_work_item_dependencies_subtasks.sql', import.meta.url), 'utf8')
const w3Verification = readFileSync(new URL('../../supabase/verify_20260829081243_work_item_dependencies_subtasks.sql', import.meta.url), 'utf8')
const functionSource = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')
const calendarTimeline = readFileSync(new URL('../components/WorkCalendarTimeline.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./workItemsRepository.js', import.meta.url), 'utf8')
const operatingSpine = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
const migrationNames = readdirSync(new URL('../../supabase/migrations/', import.meta.url))

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

test('board groups the same filtered items into the four fixed W1 statuses', () => {
  const items = [
    { id: 'a', status: 'not_started', assignee_id: 'u1', department_id: 'design', position: 2 },
    { id: 'b', status: 'in_progress', assignee_id: 'u1', department_id: 'design', position: 1 },
    { id: 'c', status: 'blocked', assignee_id: 'u2', department_id: 'development', position: 3 },
    { id: 'd', status: 'done', assignee_id: 'u1', department_id: 'design', position: 4 },
  ]
  const filtered = filterAndSortWorkItems(items, { assignee: 'u1', department: 'design' }, { key: 'position', direction: 'asc' })
  const columns = groupWorkItemsForBoard(filtered)
  assert.deepEqual(WORK_ITEM_BOARD_COLUMNS.map(column => column.value), ['not_started', 'in_progress', 'blocked', 'done'])
  assert.deepEqual(Object.values(columns).flat().map(item => item.id).sort(), filtered.map(item => item.id).sort())
  assert.deepEqual(columns.blocked, [])
})

test('board moves and reorders produce updates compatible with the existing save path', () => {
  const items = [
    { id: 'a', status: 'not_started', position: 0 },
    { id: 'b', status: 'in_progress', position: 1000 },
    { id: 'c', status: 'in_progress', position: 2000 },
  ]
  const crossColumn = planWorkItemBoardMove(items, 'a', 'in_progress', 'c')
  assert.deepEqual(crossColumn.map(item => ({ id: item.id, status: item.status, position: item.position })), [{ id: 'a', status: 'in_progress', position: 1500 }])
  const reordered = planWorkItemBoardMove(items, 'c', 'in_progress', 'b')
  assert.equal(reordered.find(item => item.id === 'c').status, 'in_progress')
  assert.ok(reordered.find(item => item.id === 'c').position < items.find(item => item.id === 'b').position)
})

test('board changes retain the full work item shape when calling save_work_item', () => {
  const input = workItemSaveInput({
    id: 'item-1', title: 'Approve homepage', description: 'Client pass', work_item_type: 'request', priority: 'high', status: 'blocked',
    assignee_id: 'member-1', department_id: 'design', linked_artifact_id: 'artifact-1', linked_artifact_version_id: 'version-1',
    linked_engagement_stage_instance_id: 'stage-1', parent_work_item_id: null, start_date: '2026-08-29', due_date: '2026-09-01', position: 2000,
  }, 'engagement-1')
  assert.deepEqual(input, {
    workItemId: 'item-1', engagementId: 'engagement-1', title: 'Approve homepage', description: 'Client pass', workItemType: 'request',
    priority: 'high', status: 'blocked', assigneeId: 'member-1', departmentId: 'design', linkedArtifactId: 'artifact-1',
    linkedArtifactVersionId: 'version-1', linkedEngagementStageInstanceId: 'stage-1', parentWorkItemId: null, startDate: '2026-08-29', dueDate: '2026-09-01', position: 2000,
  })
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

test('the engagement-level UI retains all W1 filters and excludes unrelated later-phase surfaces', () => {
  assert.match(operatingSpine, />Work<\/button>/)
  for (const label of ['Status', 'Assignee', 'Department', 'Priority', 'Due date']) assert.match(panel, new RegExp(`label="${label}"`))
  assert.match(panel, /Work item detail/)
  assert.match(panel, /References are storage-only in W1/)
  assert.doesNotMatch(panel, /Automation|Custom field/i)
  assert.doesNotMatch(functionSource, /openai|anthropic|notification|webhook|auto.?status/i)
  assert.doesNotMatch(migration, /parent_work_item_id|custom_fields|automation_rules/)
})

test('W3 relations expose one-level subtasks and unresolved blockers without status automation', () => {
  const items = [
    { id: 'parent', status: 'in_progress', parent_work_item_id: null },
    { id: 'child-open', status: 'not_started', parent_work_item_id: 'parent' },
    { id: 'child-done', status: 'done', parent_work_item_id: 'parent' },
    { id: 'blocker', status: 'blocked', parent_work_item_id: null },
  ]
  const relations = buildWorkItemRelations(items, [{ work_item_id: 'parent', depends_on_work_item_id: 'blocker' }])
  assert.deepEqual(relations.subtasksByParent.get('parent').map(item => item.id), ['child-open', 'child-done'])
  assert.equal(relations.openSubtaskCount('parent'), 1)
  assert.equal(relations.unresolvedDependencyCount('parent'), 1)
  assert.deepEqual(relations.blocksByItem.get('blocker').map(item => item.id), ['parent'])
})

test('W3 schema uses the tenant-safe parent FK, one-level validation, RLS, and recursive cycle detection', () => {
  assert.match(w3Migration, /foreign key \(parent_work_item_id, organization_id\)[\s\S]*on delete set null \(parent_work_item_id\)/i)
  assert.match(w3Migration, /check \(parent_work_item_id is distinct from id\)/i)
  assert.match(w3Migration, /v_parent\.parent_work_item_id is not null[\s\S]*one level deep/i)
  assert.match(w3Migration, /A work item with subtasks cannot become a subtask/i)
  assert.match(w3Migration, /create table public\.work_item_dependencies/)
  assert.match(w3Migration, /enable row level security[\s\S]*is_team_organization_member\(organization_id\)/i)
  assert.match(w3Migration, /with recursive reachable\(id\)[\s\S]*Dependency would create a cycle/i)
  assert.match(w3Migration, /pg_advisory_xact_lock[\s\S]*with recursive reachable/i)
  assert.match(w3Migration, /Active team membership required/i)
  assert.doesNotMatch(w3Migration, /security definer/i)
})

test('W3 verification proves a three-hop cycle rejection and soft-delete child detachment', () => {
  assert.match(w3Verification, /save_work_item_dependency\(v_a\.id, v_b\.id/)
  assert.match(w3Verification, /save_work_item_dependency\(v_b\.id, v_c\.id/)
  assert.match(w3Verification, /save_work_item_dependency\(v_c\.id, v_a\.id/)
  assert.match(w3Verification, /three_hop_dependency_cycle_rejected/)
  assert.match(w3Verification, /soft_delete_work_item\(v_parent\.id/)
  assert.match(w3Verification, /v_child\.id and item\.parent_work_item_id is null/)
  assert.match(w3Migration, /update public\.work_items child[\s\S]*set parent_work_item_id = null[\s\S]*set deleted_at = now\(\)/i)
})

test('W3 UI adds text relations and card indicators while preserving the W2 move path', () => {
  for (const label of ['Subtasks', 'Blocked by', 'Blocks', 'Parent work item']) assert.match(panel, new RegExp(label))
  assert.match(panel, /openSubtasks/)
  assert.match(panel, /unresolvedDependencies/)
  assert.match(panel, /workItems\.addDependency/)
  assert.match(panel, /workItems\.removeDependency/)
  assert.match(panel, /onMoveWithinColumn/)
  assert.doesNotMatch(panel, /dependency graph|auto.?block/i)
})

test('W2 adds an accessible board without a new backend write path', () => {
  assert.match(panel, /aria-label="Work view"/)
  assert.match(panel, /WORK_ITEM_BOARD_COLUMNS\.map/)
  assert.match(panel, /draggable=/)
  assert.match(panel, /Move .* to status/)
  assert.match(panel, /onMoveWithinColumn/)
  assert.match(panel, /workItems\.save\(workItemSaveInput/)
  assert.match(repository, /\.is\(['"]deleted_at['"], null\)/)
  assert.doesNotMatch(panel, /supabase\.from\(['"]work_items['"]\).*\.(insert|update|upsert|delete)/s)
})

test('W4 calendar uses the filtered items for full date ranges and a visible no-due list', () => {
  const items = [
    { id: 'range', title: 'Range', start_date: '2026-08-03', due_date: '2026-08-05', status: 'in_progress' },
    { id: 'due', title: 'Due only', start_date: null, due_date: '2026-08-04', status: 'not_started' },
    { id: 'none', title: 'No due date', start_date: '2026-08-02', due_date: null, status: 'not_started' },
  ]
  const month = buildWorkItemCalendar(items, new Date('2026-08-15T00:00:00Z'), 'month')
  const augustFourth = month.days.find(day => day.date === '2026-08-04')
  assert.deepEqual(augustFourth.items.map(entry => entry.item.id), ['range', 'due'])
  assert.equal(augustFourth.items.find(entry => entry.item.id === 'range').isStart, false)
  assert.equal(month.days.find(day => day.date === '2026-08-05').items[0].isDue, true)
  assert.deepEqual(month.noDueDate.map(item => item.id), ['none'])
  assert.equal(buildWorkItemCalendar(items, new Date('2026-08-04T00:00:00Z'), 'week').days.length, 7)
})

test('W4 timeline renders ranges, real single-date points, unscheduled items, nesting, and dependency links', () => {
  const items = [
    { id: 'parent', title: 'Parent', parent_work_item_id: null, start_date: '2026-08-01', due_date: '2026-08-05' },
    { id: 'child', title: 'Child', parent_work_item_id: 'parent', start_date: null, due_date: '2026-08-03' },
    { id: 'unscheduled', title: 'Unscheduled', parent_work_item_id: null, start_date: null, due_date: null },
  ]
  const timeline = buildWorkItemTimeline(items, [{ work_item_id: 'parent', depends_on_work_item_id: 'child' }])
  assert.deepEqual(timeline.rows.map(row => [row.item.id, row.depth]), [['parent', 0], ['child', 1]])
  assert.equal(timeline.rows[0].point, false)
  assert.ok(timeline.rows[0].width > 0)
  assert.equal(timeline.rows[1].point, true)
  assert.deepEqual(timeline.unscheduled.map(entry => entry.item.id), ['unscheduled'])
  assert.deepEqual(timeline.links.map(link => [link.workItemId, link.dependsOnWorkItemId]), [['parent', 'child']])
})

test('W4 reuses the existing read path and detail panel without adding a migration or mutation surface', () => {
  assert.match(panel, /items=\{visibleItems\}/)
  assert.match(panel, /WorkCalendarView/)
  assert.match(panel, /WorkTimelineView/)
  assert.match(calendarTimeline, /onOpen\(item\)/)
  assert.match(calendarTimeline, /Read-only dependency connectors/)
  assert.match(calendarTimeline, /edit dates in work-item detail/i)
  assert.match(repository, /\.eq\(['"]engagement_id['"], engagementId\)[\s\S]*\.is\(['"]deleted_at['"], null\)/)
  assert.doesNotMatch(calendarTimeline, /supabase|workItems\.(save|remove|addDependency|removeDependency)|insert\(|update\(|upsert\(|delete\(/i)
  assert.equal(migrationNames.some(name => /calendar|timeline/i.test(name)), false)
})
