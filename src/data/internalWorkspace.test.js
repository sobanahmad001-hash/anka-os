import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildInternalWorkspace } from './internalWorkspaceModel.js'

function fixture(overrides = {}) {
  return {
    projects: [
      { id: 'internal-a', organization_id: 'org-a', client_id: null, name: 'Operating System', engagement_type: 'internal', status: 'active', health: 'at_risk', owner_id: 'owner-a', due_date: '2026-09-02' },
      { id: 'clientless-external', organization_id: 'org-a', client_id: null, name: 'Not internal', engagement_type: 'project', status: 'active' },
      { id: 'other-org', organization_id: 'org-b', client_id: null, name: 'Other org', engagement_type: 'internal', status: 'active', owner_id: 'owner-b' },
    ],
    engagements: [{ id: 'extension-a', organization_id: 'org-a', project_id: 'internal-a', status: 'active' }],
    workstreams: [{ id: 'stream-a', organization_id: 'org-a', project_id: 'internal-a', department_id: 'development', name: 'Platform', status: 'active', owner_id: 'owner-a' }],
    tasks: [{ id: 'task-a', organization_id: 'org-a', project_id: 'internal-a', workstream_id: 'stream-a', title: 'Document model', status: 'blocked', assigned_to: 'owner-a', due_date: '2026-09-01' }, { id: 'forged-task', organization_id: 'org-b', project_id: 'internal-a', title: 'Forged', status: 'ready' }],
    workItems: [{ id: 'item-a', organization_id: 'org-a', project_id: 'internal-a', engagement_id: 'extension-a', title: 'Prepare record', status: 'in_progress', assignee_id: 'owner-a', due_date: '2026-09-05' }, { id: 'orphan', organization_id: 'org-a', project_id: 'internal-a', engagement_id: 'missing', title: 'Orphan', status: 'in_progress' }],
    milestones: [{ id: 'milestone-a', organization_id: 'org-a', project_id: 'internal-a', name: 'Review', status: 'planned', owner_id: 'owner-a', target_date: '2026-09-10' }],
    requests: [{ id: 'request-a', organization_id: 'org-a', project_id: 'internal-a', title: 'Input needed', request_type: 'internal_handoff', status: 'submitted', owner_id: 'owner-a', required_by: '2026-09-08' }],
    deliverables: [{ id: 'deliverable-a', organization_id: 'org-a', project_id: 'internal-a', title: 'Operating guide', deliverable_type: 'document', status: 'in_production', owner_id: 'owner-a', due_date: '2026-09-12' }],
    activity: [{ id: 'activity-a', organization_id: 'org-a', project_id: 'internal-a', actor_id: 'owner-a', action: 'project_updated', occurred_at: '2026-09-03T10:00:00Z' }],
    livingRecords: [{ id: 'record-a', organization_id: 'org-a', project_id: 'internal-a', source_version: 4, generated_at: '2026-09-03T09:00:00Z', updated_at: '2026-09-03T09:00:00Z' }],
    memberships: [{ organization_id: 'org-a', user_id: 'owner-a' }],
    profiles: [{ id: 'owner-a', full_name: 'Ava Owner' }, { id: 'owner-b', full_name: 'Hidden Owner' }],
    ...overrides,
  }
}

test("WKS4 membership is exactly projects.engagement_type = 'internal'", () => {
  const workspace = buildInternalWorkspace(fixture(), { today: '2026-09-03' })
  assert.deepEqual(workspace.projects.map((row) => row.id), ['internal-a', 'other-org'])
  assert.equal(workspace.projects.some((row) => row.id === 'clientless-external'), false)
  assert.equal(workspace.projects[0].owner.name, 'Ava Owner')
  assert.equal(workspace.projects[1].owner.name, 'Unassigned')
})

test('WKS4 keeps Project Tasks and validated Engagement Work Items separate', () => {
  const workspace = buildInternalWorkspace(fixture(), { today: '2026-09-03' })
  const project = workspace.projects.find((row) => row.id === 'internal-a')
  assert.equal(project.projectTasks.length, 1)
  assert.equal(project.engagementWorkItems.length, 1)
  assert.equal(workspace.summary.openProjectTasks, 1)
  assert.equal(workspace.summary.openEngagementWorkItems, 1)
  assert.deepEqual(workspace.dueWork.slice(0, 2).map((row) => row.source), ['Project Task', 'Engagement Work Item'])
})

test('WKS4 rejects orphan and cross-organization children while retaining Living Records', () => {
  const workspace = buildInternalWorkspace(fixture(), { today: '2026-09-03' })
  const project = workspace.projects.find((row) => row.id === 'internal-a')
  assert.equal(project.projectTasks.some((row) => row.id === 'forged-task'), false)
  assert.equal(project.engagementWorkItems.some((row) => row.id === 'orphan'), false)
  assert.equal(project.livingRecord.source_version, 4)
  assert.equal(workspace.summary.livingRecords, 1)
})

test('WKS4 does not fabricate a client, agency-client, or engagement extension', () => {
  const workspace = buildInternalWorkspace(fixture({ engagements: [], workItems: [] }), { today: '2026-09-03' })
  const project = workspace.projects.find((row) => row.id === 'internal-a')
  assert.equal(project.engagement, null)
  assert.equal(project.engagementWorkItems.length, 0)
  assert.equal('client' in project, false)
  assert.equal('agencyClient' in project, false)
})

test('WKS4 repository is read-only and independent of client, RET, and QTS models', () => {
  const repository = readFileSync(new URL('./internalWorkspaceRepository.js', import.meta.url), 'utf8')
  for (const table of ['projects', 'workstreams', 'tasks', 'milestones', 'requests', 'deliverables', 'activity_events', 'living_project_documents']) assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  assert.match(repository, /\.eq\('engagement_type', 'internal'\)/)
  assert.doesNotMatch(repository, /from\('(clients|agency_clients|brands|recurring_plans|quick_tasks)'\)/)
  assert.doesNotMatch(repository, /\.(insert|update|upsert|delete|rpc|functions)\s*\(/)
})

test('WKS4 route and UI preserve exact membership and separate work labels', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../apps/InternalWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="sphere\/internal" element={<InternalWorkspace \/>}/)
  assert.match(screen, /projects\.engagement_type = 'internal'/)
  assert.match(screen, /Project Tasks/)
  assert.match(screen, /Engagement Work Items/)
  assert.match(screen, /No extension is synthesized/)
})
