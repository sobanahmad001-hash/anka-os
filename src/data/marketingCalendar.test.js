import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createServer } from 'vite'
import { buildMarketingCalendar, entriesForDay, filterMarketingCalendar, marketingMonthDays, moveMarketingMonth } from './marketingCalendar.js'

const repository = readFileSync(new URL('./marketingCalendarRepository.js', import.meta.url), 'utf8')
const component = readFileSync(new URL('../components/MarketingCalendar.jsx', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
const planning = readFileSync(new URL('../../supabase/migrations/20260904120000_p5_unified_planning.sql', import.meta.url), 'utf8')
const dependencyMigration = readFileSync(new URL('../../supabase/migrations/20260829081243_work_item_dependencies_subtasks.sql', import.meta.url), 'utf8')

function repositoryClient(rowsByTable) {
  const calls = []
  return { calls, from(table) {
    const call = { table, select: '', filters: [] }; calls.push(call); let single = false
    const query = {
      select(columns) { call.select = columns; return query },
      eq(column, value) { call.filters.push(['eq', column, value]); return query },
      in(column, values) { call.filters.push(['in', column, values]); return query },
      is(column, value) { call.filters.push(['is', column, value]); return query },
      order() { return query }, abortSignal() { return query }, maybeSingle() { single = true; return query },
      then(resolve, reject) {
        const invalidWorkDependencyId = table === 'work_item_dependencies' && call.select.split(',').map(value => value.trim()).includes('id')
        if (invalidWorkDependencyId) return Promise.resolve({ data: null, error: { message: 'column work_item_dependencies.id does not exist' }, status: 400 }).then(resolve, reject)
        let rows = [...(rowsByTable[table] || [])]
        for (const [operator, column, value] of call.filters) {
          if (column.includes('.')) continue
          if (operator === 'eq') rows = rows.filter(row => row[column] === value)
          if (operator === 'in') rows = rows.filter(row => value.includes(row[column]))
          if (operator === 'is') rows = rows.filter(row => row[column] === value || (row[column] === null || row[column] === undefined) && value === null)
        }
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null, status: 200 }).then(resolve, reject)
      },
    }
    return query
  } }
}

const fixture = () => ({
  organizationId: 'org-a',
  engagement: { id: 'eng-a', organization_id: 'org-a', project_id: 'project-a', name: 'Launch' },
  project: { id: 'project-a', organization_id: 'org-a', client_id: 'client-a', engagement_type: 'client', planning_timezone: '' },
  client: { id: 'client-a', organization_id: 'org-a', default_timezone: 'Asia/Karachi' },
  memberships: [{ organization_id: 'org-a', user_id: 'owner-a', member_kind: 'team', status: 'active' }],
  profiles: [{ id: 'owner-a', full_name: 'Amina Owner' }],
  campaigns: [{ id: 'campaign-a', organization_id: 'org-a', engagement_id: 'eng-a', name: 'Autumn', planned_channels: ['Email'] }],
  planVersions: [
    { id: 'plan-v1', organization_id: 'org-a', engagement_id: 'eng-a', campaign_id: 'campaign-a', version_number: 1, title: 'Old draft', channels: ['Email'], starts_on: '2026-09-01', ends_on: '2026-09-03', created_by: 'owner-a' },
    { id: 'plan-v2', organization_id: 'org-a', engagement_id: 'eng-a', campaign_id: 'campaign-a', version_number: 2, title: 'Current draft', channels: ['Email', 'Search'], starts_on: '2026-09-10', ends_on: '2026-09-12', created_by: 'owner-a' },
  ],
  campaignLinks: [{ id: 'link-a', organization_id: 'org-a', campaign_id: 'campaign-a', artifact_id: 'artifact-a' }],
  tasks: [
    { id: 'task-a', organization_id: 'org-a', project_id: 'project-a', department_id: 'marketing', title: 'Project launch', status: 'done', assigned_to: 'owner-a', due_date: '2026-09-11' },
    { id: 'task-blocker', organization_id: 'org-a', project_id: 'project-a', department_id: 'marketing', title: 'Approval', status: 'ready', assigned_to: null, due_date: null },
  ],
  taskDependencies: [{ id: 'td-a', organization_id: 'org-a', project_id: 'project-a', task_id: 'task-a', depends_on_task_id: 'task-blocker' }],
  workItems: [{ id: 'work-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'eng-a', department_id: 'marketing', title: 'Email delivery', status: 'in_progress', assignee_id: 'owner-a', start_date: '2026-09-09', due_date: '2026-09-13', linked_artifact_id: 'artifact-a', recurring_occurrence_id: 'occurrence-a' }],
  workItemDependencies: [],
})

test('MB05 projects distinct canonical records plus only the latest draft in organization timezone', () => {
  const calendar = buildMarketingCalendar(fixture())
  assert.equal(calendar.timezone, 'Asia/Karachi')
  assert.deepEqual(calendar.entries.map(item => item.recordKind).sort(), ['campaign_plan_draft', 'engagement_work_item', 'project_task', 'project_task'])
  assert.equal(calendar.entries.some(item => item.title === 'Old draft'), false)
  const work = calendar.entries.find(item => item.recordId === 'work-a')
  assert.deepEqual(work.channels, ['Email', 'Search'])
  assert.match(work.href, /engagement_work_item\/work-a$/)
  assert.match(work.plannerHref, /retainer-planning/)
  const completed = calendar.entries.find(item => item.recordId === 'task-a')
  assert.equal(completed.calendarState, 'completed')
  assert.equal(completed.externallyPublished, false)
  assert.equal(completed.unresolvedDependencies, 1)
})

test('month, channel, owner, status and date-range helpers are deterministic', () => {
  const calendar = buildMarketingCalendar(fixture())
  assert.equal(marketingMonthDays('2026-09').length, 30)
  assert.equal(moveMarketingMonth('2026-12', 1), '2027-01')
  assert.deepEqual(filterMarketingCalendar(calendar.entries, { engagement: 'eng-a', channel: 'Search', owner: 'owner-a', status: 'draft' }, '2026-09').map(item => item.title), ['Current draft'])
  assert.equal(entriesForDay(calendar.entries, '2026-09-11').some(item => item.title === 'Email delivery'), true)
  assert.equal(filterMarketingCalendar(calendar.entries, {}, '2026-10').length, 0)
})

test('cancelled Project Tasks remain cancelled while still satisfying dependency-terminal semantics', () => {
  const input = fixture()
  input.tasks[0].status = 'cancelled'
  input.tasks[1].status = 'cancelled'
  const calendar = buildMarketingCalendar(input)
  assert.equal(calendar.entries.find(item => item.recordId === 'task-a').calendarState, 'cancelled')
  assert.equal(calendar.statuses.includes('cancelled'), true)
  assert.equal(calendar.entries.find(item => item.recordId === 'task-a').unresolvedDependencies, 0)
})

test('cross-department completed, incomplete and unavailable prerequisites stay honest for both record kinds', () => {
  const input = fixture()
  input.taskDependencies = [
    { id: 'td-done', organization_id: 'org-a', project_id: 'project-a', task_id: 'task-a', depends_on_task_id: 'design-task-done' },
    { id: 'td-open', organization_id: 'org-a', project_id: 'project-a', task_id: 'task-a', depends_on_task_id: 'design-task-open' },
    { id: 'td-unknown', organization_id: 'org-a', project_id: 'project-a', task_id: 'task-a', depends_on_task_id: 'design-task-unavailable' },
  ]
  input.dependencyTasks = [
    { id: 'design-task-done', organization_id: 'org-a', project_id: 'project-a', status: 'done' },
    { id: 'design-task-open', organization_id: 'org-a', project_id: 'project-a', status: 'in_progress' },
  ]
  input.workItemDependencies = [
    { organization_id: 'org-a', work_item_id: 'work-a', depends_on_work_item_id: 'design-work-done' },
    { organization_id: 'org-a', work_item_id: 'work-a', depends_on_work_item_id: 'design-work-open' },
    { organization_id: 'org-a', work_item_id: 'work-a', depends_on_work_item_id: 'design-work-unavailable' },
  ]
  input.dependencyWorkItems = [
    { id: 'design-work-done', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'eng-a', status: 'done' },
    { id: 'design-work-open', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'eng-a', status: 'blocked' },
  ]
  const calendar = buildMarketingCalendar(input)
  for (const id of ['task-a', 'work-a']) {
    const entry = calendar.entries.find(item => item.recordId === id)
    assert.equal(entry.unresolvedDependencies, 1)
    assert.equal(entry.unknownDependencies, 1)
  }
})

test('repository loads dependency status through schema-valid scoped SELECT contracts', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key') } })
  t.after(() => server.close())
  const { createMarketingCalendarRepository } = await server.ssrLoadModule('/src/data/marketingCalendarRepository.js')
  const client = repositoryClient({
    projects: [{ id: 'project-a', organization_id: 'org-a', client_id: null, engagement_type: 'internal', planning_timezone: 'UTC' }],
    tasks: [
      { id: 'task-a', organization_id: 'org-a', project_id: 'project-a', department_id: 'marketing', title: 'Launch', status: 'ready', assigned_to: null, due_date: '2026-09-11', archived_at: null },
      { id: 'design-task', organization_id: 'org-a', project_id: 'project-a', department_id: 'design', status: 'done', archived_at: null },
    ],
    work_items: [
      { id: 'work-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'eng-a', department_id: 'marketing', title: 'Email', status: 'in_progress', assignee_id: null, start_date: '2026-09-11', due_date: '2026-09-12', deleted_at: null },
      { id: 'design-work', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'eng-a', department_id: 'design', status: 'done', deleted_at: null },
    ],
    task_dependencies: [{ id: 'td-a', organization_id: 'org-a', project_id: 'project-a', task_id: 'task-a', depends_on_task_id: 'design-task' }],
    work_item_dependencies: [{ organization_id: 'org-a', work_item_id: 'work-a', depends_on_work_item_id: 'design-work', created_by: 'owner-a', created_at: '2026-09-01T00:00:00Z' }],
    marketing_campaigns: [], marketing_campaign_plan_versions: [], marketing_campaign_artifacts: [], organization_memberships: [],
  })
  const snapshot = await createMarketingCalendarRepository('org-a', { client }).load({ id: 'eng-a', organization_id: 'org-a', project_id: 'project-a' })
  assert.equal(snapshot.entries.find(item => item.recordId === 'task-a').unresolvedDependencies, 0)
  assert.equal(snapshot.entries.find(item => item.recordId === 'work-a').unresolvedDependencies, 0)
  const workDependencyCall = client.calls.find(call => call.table === 'work_item_dependencies')
  assert.equal(workDependencyCall.select, 'organization_id, work_item_id, depends_on_work_item_id')
  assert.match(dependencyMigration, /primary key \(work_item_id, depends_on_work_item_id\)/)
  assert.doesNotMatch(dependencyMigration.match(/create table public\.work_item_dependencies \([\s\S]*?\n\);/)[0], /\bid uuid\b/)
  assert.equal(client.calls.some(call => call.table === 'tasks' && call.select === 'id, organization_id, project_id, status'), true)
  assert.equal(client.calls.some(call => call.table === 'work_items' && call.select === 'id, organization_id, project_id, engagement_id, status'), true)
})

test('foreign organization rows fail closed before projection', () => {
  const input = fixture(); input.workItems[0].organization_id = 'org-b'
  assert.throws(() => buildMarketingCalendar(input), error => error.status === 403 && error.membershipMismatch)
})

test('MB05 is a SELECT-only projection and surfaces the verified scheduling gap', () => {
  for (const table of ['projects', 'clients', 'tasks', 'work_items', 'task_dependencies', 'work_item_dependencies', 'marketing_campaigns', 'marketing_campaign_plan_versions']) assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  assert.doesNotMatch(repository, /functions\.invoke|\.insert\(|\.update\(|\.upsert\(|\.delete\(|rpc\(/)
  assert.match(component, /project-owner\/project-manager authority and dependency revalidation/)
  assert.match(component, /Completed work; no external publication evidence is linked/)
  assert.match(component, /Recurring planner/)
  assert.doesNotMatch(component, /draggable|onDrop|>Schedule work<|>Confirm date<|>Publish</)
  assert.match(studio, /\['calendar', 'Calendar'\]/)
  assert.match(studio, /createMarketingCalendarRepository/)
  assert.match(edge, /update_project_task[\s\S]*p_due_date/)
  assert.match(planning, /v_task\.user_id = p_actor_id[\s\S]*v_task\.assigned_to = p_actor_id/)
  assert.doesNotMatch(planning.match(/create function public\.update_p5_project_task[\s\S]*?end; \$\$;/)[0], /project_manager|project_owner/)
})
