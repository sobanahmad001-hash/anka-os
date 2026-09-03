import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildPortfolioWorkspace, filterPortfolioRows } from './portfolioWorkspaceModel.js'

const snapshot = {
  projects: [
    { id: 'client-project', organization_id: 'org-a', client_id: 'client-a', name: 'Launch', engagement_type: 'project', status: 'active', health: 'at_risk', owner_id: 'owner-a', due_date: '2026-09-01' },
    { id: 'internal-project', organization_id: 'org-a', client_id: null, name: 'Playbook', engagement_type: 'internal', status: 'active', health: 'on_track', owner_id: null, due_date: null },
    { id: 'unclassified-project', organization_id: 'org-a', client_id: null, name: 'Unclassified', engagement_type: null, status: 'planning', health: 'on_track', owner_id: null, due_date: '2026-09-10' },
  ],
  clients: [{ id: 'client-a', organization_id: 'org-a', name: 'Acme' }],
  brands: [{ id: 'brand-a', organization_id: 'org-a', name: 'Acme Brand' }],
  engagements: [{ id: 'engagement-a', organization_id: 'org-a', project_id: 'client-project', brand_id: 'brand-a', status: 'active' }],
  tasks: [
    { id: 'task-a', organization_id: 'org-a', project_id: 'client-project', department_id: 'design', status: 'blocked', due_date: '2026-09-01' },
    { id: 'forged-task', organization_id: 'org-b', project_id: 'client-project', status: 'ready', due_date: null },
  ],
  workItems: [
    { id: 'item-a', organization_id: 'org-a', project_id: 'client-project', engagement_id: 'engagement-a', department_id: 'design', status: 'in_progress', due_date: '2026-09-08', automation_flagged_at: '2026-09-02T00:00:00Z' },
    { id: 'wrong-engagement', organization_id: 'org-a', project_id: 'client-project', engagement_id: 'engagement-b', status: 'blocked' },
  ],
  stages: [{ id: 'stage-a', organization_id: 'org-a', engagement_id: 'engagement-a', accountable_department_id: 'design', status: 'in_progress' }],
  milestones: [{ id: 'milestone-a', organization_id: 'org-a', project_id: 'client-project', status: 'in_progress', target_date: '2026-09-02' }],
  versions: [{ id: 'version-a', organization_id: 'org-a', project_id: 'client-project', review_status: 'ready_for_internal_review' }],
  memberships: [{ organization_id: 'org-a', user_id: 'owner-a' }],
  profiles: [{ id: 'owner-a', full_name: 'Ava Owner', email: 'ava@example.com' }],
}

test('portfolio is project-root, tenant-safe, and keeps both task systems separate', () => {
  const portfolio = buildPortfolioWorkspace(snapshot, { today: '2026-09-03' })
  const project = portfolio.rows.find((row) => row.id === 'client-project')
  assert.equal(project.clientName, 'Acme')
  assert.deepEqual(project.projectTasks, { open: 1, blocked: 1, overdue: 1 })
  assert.deepEqual(project.engagementWorkItems, { open: 1, blocked: 0, overdue: 0, automationFlags: 1 })
  assert.deepEqual(project.departmentLoad, [{ department: 'design', projectTasks: 1, engagementWorkItems: 1 }])
  assert.equal(portfolio.summary.openProjectTasks, 1)
  assert.equal(portfolio.summary.openEngagementWorkItems, 1)
  assert.deepEqual(portfolio.departmentLoad[0], { department: 'design', projects: 1, projectTasks: 1, engagementWorkItems: 1 })
})

test("Internal Work is classified only by engagement_type='internal'", () => {
  const { rows } = buildPortfolioWorkspace(snapshot, { today: '2026-09-03' })
  assert.equal(rows.find((row) => row.id === 'internal-project').ownerKind, 'internal')
  assert.equal(rows.find((row) => row.id === 'unclassified-project').ownerKind, 'client')
  assert.equal(filterPortfolioRows(rows, { ownerKind: 'internal', today: '2026-09-03' }).length, 1)
})

test('portfolio repository is read-only and queries project-owned records', () => {
  const repository = readFileSync(new URL('./portfolioWorkspaceRepository.js', import.meta.url), 'utf8')
  assert.match(repository, /from\('projects'\)/)
  assert.match(repository, /from\('tasks'\)/)
  assert.match(repository, /from\('work_items'\)/)
  assert.match(repository, /project_id/)
  assert.doesNotMatch(repository, /\.(insert|update|upsert|delete|rpc|functions)\s*\(/)
})

test('workspace routes and terminology expose portfolio without replacing engagement compatibility', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const nav = readFileSync(new URL('../config/environmentNav.js', import.meta.url), 'utf8')
  const view = readFileSync(new URL('../apps/PortfolioWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="sphere\/workspace" element={<PortfolioWorkspace \/>}/)
  assert.match(app, /path="sphere\/internal" element={<PortfolioWorkspace initialOwnerKind="internal" \/>}/)
  assert.match(app, /path="sphere\/engagements" element={<OperatingSpine initialView="engagements" \/>}/)
  for (const term of ['Coordination', 'Portfolio', 'Client Work', 'Internal Work']) assert.match(nav, new RegExp(term))
  assert.match(view, /Project Tasks/)
  assert.match(view, /Engagement Work Items/)
})
