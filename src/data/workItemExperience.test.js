import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMyWorkPlan, MY_WORK_HORIZON_DAYS, WORK_RECORD_TYPES, workRecordPath, workRecordState, workshopPathForRecord } from './workItemExperience.js'
import { readFileSync } from 'node:fs'

const repositorySource = readFileSync(new URL('./workItemExperienceRepository.js', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../apps/WorkItemDetail.jsx', import.meta.url), 'utf8')
const myWorkSource = readFileSync(new URL('../apps/MyWork.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('My Work uses a visible fourteen-day horizon without hiding later or undated work', () => {
  const plan = buildMyWorkPlan({
    tasks: [
      { id: 'overdue', title: 'Overdue task', status: 'ready', priority: 'high', due_date: '2026-09-03' },
      { id: 'next', title: 'Next task', status: 'ready', priority: 'medium', due_date: '2026-09-18' },
      { id: 'later', title: 'Later task', status: 'ready', priority: 'low', due_date: '2026-09-19' },
      { id: 'undated', title: 'Undated task', status: 'ready', priority: 'low' },
    ],
    workItems: [{ id: 'blocked', title: 'Blocked item', status: 'blocked', priority: 'urgent', due_date: '2026-09-10' }],
  }, new Date('2026-09-04T12:00:00Z'))

  assert.equal(MY_WORK_HORIZON_DAYS, 14)
  assert.deepEqual(plan.overdue.map(item => item.id), ['overdue'])
  assert.deepEqual(plan.next.map(item => item.id), ['blocked', 'next'])
  assert.deepEqual(plan.later.map(item => item.id), ['later'])
  assert.deepEqual(plan.undated.map(item => item.id), ['undated'])
  assert.deepEqual(plan.blocked.map(item => item.id), ['blocked'])
  assert.equal(plan.total, 5)
})

test('typed routes never translate Project Tasks into Engagement Work Items', () => {
  assert.equal(workRecordPath(WORK_RECORD_TYPES.PROJECT_TASK, 'task-1'), '/sphere/workspace/items/project_task/task-1')
  assert.equal(workRecordPath(WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM, 'item-1'), '/sphere/workspace/items/engagement_work_item/item-1')
  assert.equal(workRecordPath('task', 'task-1'), '')
})

test('archived and deleted records are explicit stale states', () => {
  assert.equal(workRecordState({ kind: WORK_RECORD_TYPES.PROJECT_TASK, record: { archived_at: '2026-09-04' } }), 'stale')
  assert.equal(workRecordState({ kind: WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM, record: { deleted_at: '2026-09-04' } }), 'stale')
  assert.equal(workRecordState(null), 'denied')
})

test('Workshop navigation carries exact typed record and returns to its detail route', () => {
  const path = workshopPathForRecord({
    kind: WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM,
    record: { id: 'item-1', organization_id: 'org-1', project_id: 'project-1', engagement_id: 'eng-1', brand_id: 'brand-1', department_id: 'design' },
    project: { client_id: 'client-1' },
  })
  const url = new URL(path, 'https://anka.invalid')
  assert.equal(url.pathname, '/sphere/design/workshop')
  assert.equal(url.searchParams.get('ctxRecordKind'), 'engagement_work_item')
  assert.equal(url.searchParams.get('ctxRecordId'), 'item-1')
  assert.equal(url.searchParams.get('ctxOrigin'), '/sphere/workspace/items/engagement_work_item/item-1')
})

test('detail repository selects exact typed records inside the active organization and stays read-only', () => {
  assert.match(repositorySource, /const table = kind === WORK_RECORD_TYPES\.PROJECT_TASK \? 'tasks' : 'work_items'/)
  assert.match(repositorySource, /from\(table\)\.select\('\*'\)\.eq\('organization_id', organizationId\)\.eq\('id', recordId\)/)
  assert.match(repositorySource, /from\('comments'\)[\s\S]*?\.eq\('entity_type', 'task'\)\.eq\('entity_id', record\.id\)/)
  assert.match(repositorySource, /from\('engagement_events'\)[\s\S]*?\.contains\('payload', \{ record_id: record\.id \}\)/)
  assert.doesNotMatch(repositorySource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|functions\.invoke|\.rpc\(/)
})

test('P4 exposes a responsive drill-down with explicit operational states and canonical navigation', () => {
  assert.match(appSource, /path="sphere\/workspace\/items\/:recordKind\/:recordId" element={<WorkItemDetail \/>}/)
  for (const copy of ['Loading work item', 'Choose an organization', 'Work item unavailable', 'Stale record', 'Work item could not be loaded']) assert.match(detailSource, new RegExp(copy))
  for (const section of ['Description', 'Work facts', 'Dependencies', 'Outputs', 'Discussion', 'History']) assert.match(detailSource, new RegExp(section))
  assert.match(detailSource, /Project workspace/)
  assert.match(detailSource, /Continue in Workshop/)
  assert.match(detailSource, /lg:grid-cols|xl:grid-cols/)
})

test('My Work states personal scope and date range while retaining distinct queues', () => {
  assert.match(myWorkSource, /What to do next/)
  assert.match(myWorkSource, /Next-up range:/)
  assert.match(myWorkSource, /Later and undated work remain visible/)
  assert.match(myWorkSource, /WORK_RECORD_TYPES\.PROJECT_TASK/)
  assert.match(myWorkSource, /WORK_RECORD_TYPES\.ENGAGEMENT_WORK_ITEM/)
  assert.match(myWorkSource, /last loaded organization-scoped results remain visible/)
})
