import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildMarketingCalendar, entriesForDay, filterMarketingCalendar, marketingMonthDays, moveMarketingMonth } from './marketingCalendar.js'

const repository = readFileSync(new URL('./marketingCalendarRepository.js', import.meta.url), 'utf8')
const component = readFileSync(new URL('../components/MarketingCalendar.jsx', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
const planning = readFileSync(new URL('../../supabase/migrations/20260904120000_p5_unified_planning.sql', import.meta.url), 'utf8')

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
