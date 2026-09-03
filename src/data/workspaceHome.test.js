import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildWorkspaceHome } from './workspaceHomeModel.js'

const snapshot = {
  projects: [
    { id: 'project-a', organization_id: 'org-a', name: 'Launch', status: 'active' },
    { id: 'project-b', organization_id: 'org-b', name: 'Other tenant', status: 'active' },
  ],
  engagements: [{ id: 'engagement-a', organization_id: 'org-a', project_id: 'project-a' }],
  tasks: [
    { id: 'task-a', organization_id: 'org-a', project_id: 'project-a', title: 'Approve scope', department_id: 'design', status: 'blocked', priority: 'urgent', due_date: '2026-09-03' },
    { id: 'task-b', organization_id: 'org-b', project_id: 'project-b', title: 'Hidden task', department_id: 'design', status: 'ready', priority: 'high', due_date: '2026-09-04' },
  ],
  workItems: [
    { id: 'item-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'engagement-a', title: 'Prepare concepts', department_id: 'design', status: 'in_progress', priority: 'high', due_date: '2026-09-08' },
    { id: 'orphan', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'wrong-engagement', title: 'Orphan item', department_id: 'design', status: 'blocked', priority: 'urgent', due_date: '2026-09-02' },
  ],
  versions: [{ id: 'version-a', organization_id: 'org-a', project_id: 'project-a', title: 'Homepage', version_number: 2, review_status: 'ready_for_internal_review', created_at: '2026-09-01T12:00:00Z' }],
  activities: [{ id: 'event-a', organization_id: 'org-a', project_id: 'project-a', action: 'task_blocked', target_type: 'task', metadata: { title: 'Approve scope' }, occurred_at: '2026-09-03T12:00:00Z' }],
}

test('Workspace Home scopes records and keeps Project Tasks separate from Engagement Work Items', () => {
  const home = buildWorkspaceHome(snapshot, { organizationId: 'org-a', today: '2026-09-04' })
  assert.equal(home.summary.activeProjects, 1)
  assert.equal(home.summary.projectTasks, 1)
  assert.equal(home.summary.engagementWorkItems, 1)
  assert.equal(home.summary.blocked, 1)
  assert.equal(home.summary.overdue, 1)
  assert.equal(home.summary.reviews, 1)
  assert.deepEqual(home.priorities.map((row) => row.source), ['Project Task', 'Engagement Work Item'])
  assert.equal(home.departments.find((row) => row.id === 'design').projectTasks, 1)
  assert.equal(home.departments.find((row) => row.id === 'design').engagementWorkItems, 1)
})

test('Workspace Home is read-only, active-organization scoped, and exposes every required section', () => {
  const repository = readFileSync(new URL('./workspaceHomeRepository.js', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../apps/WorkspaceHome.jsx', import.meta.url), 'utf8')
  const project = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(repository, /\.eq\('organization_id', organizationId\)/)
  assert.doesNotMatch(repository, /\.(insert|update|upsert|delete|rpc|functions)\s*\(/)
  for (const title of ['Priorities', 'Due work', 'Blockers', 'Reviews', 'Department summary', 'Recent activity']) assert.match(screen, new RegExp(title))
  assert.match(screen, /Project Tasks/)
  assert.match(screen, /Engagement Work Items/)
  assert.match(project, /useSearchParams/)
})

test('shared shell provides one scroll region and uninterrupted mobile navigation', () => {
  const layout = readFileSync(new URL('../components/Layout.jsx', import.meta.url), 'utf8')
  const header = readFileSync(new URL('../components/Header.jsx', import.meta.url), 'utf8')
  assert.match(layout, /overflow-y-auto/)
  assert.match(layout, /id="main-workspace"/)
  assert.match(header, /md:hidden/)
  assert.match(header, /md:flex/)
  assert.match(header, /Anka Sphere/)
})
