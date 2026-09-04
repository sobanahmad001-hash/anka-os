import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildProjectEngagementWorkspace } from './projectEngagementWorkspaceModel.js'

function fixture(overrides = {}) {
  return {
    project: { id: 'project-a', organization_id: 'org-a', client_id: 'client-a', name: 'Launch', description: 'Launch project', engagement_type: 'project', status: 'active', health: 'at_risk', owner_id: 'owner-a', start_date: '2026-09-01', due_date: '2026-09-02', scope_statement: 'Launch scope', exclusions: '', progress: 25 },
    client: { id: 'client-a', organization_id: 'org-a', name: 'Acme' },
    engagement: { id: 'engagement-a', organization_id: 'org-a', project_id: 'project-a', brand_id: 'brand-a', name: 'Launch', status: 'active', objective: 'Ship launch' },
    brand: { id: 'brand-a', organization_id: 'org-a', name: 'Acme Brand' },
    workstreams: [{ id: 'stream-a', organization_id: 'org-a', project_id: 'project-a', department_id: 'design', name: 'Design', status: 'active', owner_id: 'owner-a' }],
    tasks: [
      { id: 'task-a', organization_id: 'org-a', project_id: 'project-a', workstream_id: 'stream-a', title: 'Approve design', status: 'blocked', priority: 'high', assigned_to: 'owner-a', due_date: '2026-09-01' },
      { id: 'forged-task', organization_id: 'org-b', project_id: 'project-a', title: 'Forged', status: 'ready' },
    ],
    milestones: [{ id: 'milestone-a', organization_id: 'org-a', project_id: 'project-a', name: 'Launch', status: 'at_risk', target_date: '2026-09-02' }],
    deliverables: [{ id: 'deliverable-a', organization_id: 'org-a', project_id: 'project-a', workstream_id: 'stream-a', title: 'Campaign', status: 'in_review' }],
    deliverableVersions: [{ id: 'delivery-version-a', organization_id: 'org-a', project_id: 'project-a', deliverable_id: 'deliverable-a', version_number: 2, review_status: 'ready_for_internal_review' }],
    projectActivity: [{ id: 'activity-a', organization_id: 'org-a', project_id: 'project-a', actor_id: 'owner-a', action: 'project_updated', occurred_at: '2026-09-03T10:00:00Z' }],
    memberships: [{ organization_id: 'org-a', user_id: 'owner-a' }],
    profiles: [{ id: 'owner-a', full_name: 'Ava Owner', email: 'ava@example.com' }],
    services: [{ id: 'service-a', organization_id: 'org-a', engagement_id: 'engagement-a', owner_id: 'owner-a', status: 'active', service_catalog: { id: 'catalog-a', name: 'Design', department_id: 'design' } }],
    stages: [{ id: 'stage-a', organization_id: 'org-a', engagement_id: 'engagement-a', name: 'Design review', accountable_department_id: 'design', stage_kind: 'delivery', position: 0, status: 'blocked' }],
    stageDependencies: [],
    prerequisites: [{ id: 'prereq-a', organization_id: 'org-a', engagement_id: 'engagement-a', prerequisite_key: 'brand', status: 'satisfied', satisfaction_method: 'existing_asset', target_stage_instance_id: 'stage-a' }],
    workItems: [{ id: 'item-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'engagement-a', title: 'Prepare frames', status: 'in_progress', priority: 'medium', assignee_id: 'owner-a', due_date: '2026-09-05' }],
    artifacts: [{ id: 'artifact-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'engagement-a', title: 'Direction', artifact_type: 'vision' }],
    artifactVersions: [{ id: 'artifact-version-a', organization_id: 'org-a', artifact_id: 'artifact-a', version_number: 1 }],
    artifactApprovals: [{ id: 'approval-a', organization_id: 'org-a', engagement_id: 'engagement-a', artifact_id: 'artifact-a', artifact_version_id: 'artifact-version-a' }],
    engagementActivity: [{ id: 'event-a', organization_id: 'org-a', engagement_id: 'engagement-a', actor_id: 'owner-a', event_type: 'stage_status_changed', occurred_at: '2026-09-03T11:00:00Z' }],
    ...overrides,
  }
}

test('WKS2 composes one canonical project with its validated engagement extension', () => {
  const workspace = buildProjectEngagementWorkspace(fixture(), { today: '2026-09-03' })
  assert.equal(workspace.projectTasks.length, 1)
  assert.equal(workspace.engagementWorkItems.length, 1)
  assert.equal(workspace.summary.openProjectTasks, 1)
  assert.equal(workspace.summary.openEngagementWorkItems, 1)
  assert.equal(workspace.summary.reviewQueue, 1)
  assert.equal(workspace.workshopArtifacts[0].approvedVersions, 1)
  assert.deepEqual(workspace.activity.map((item) => item.source), ['Engagement', 'Project'])
  assert.deepEqual(workspace.workshopLinks, [{ department: 'design', path: '/sphere/design?engagement=engagement-a' }])
  assert.ok(workspace.attentionSignals.includes('Project Tasks include blocked work'))
})

test("Internal Work depends only on projects.engagement_type='internal' and needs no fake client", () => {
  const internal = buildProjectEngagementWorkspace(fixture({ project: { ...fixture().project, engagement_type: 'internal', client_id: null }, client: null, engagement: null, brand: null, services: [], stages: [], prerequisites: [], workItems: [], artifacts: [], artifactVersions: [], artifactApprovals: [], engagementActivity: [] }), { today: '2026-09-03' })
  assert.equal(internal.identity.workType, 'Internal Work')
  assert.equal(internal.identity.clientName, null)
  assert.equal(internal.identity.hasEngagement, false)
  assert.equal(internal.engagementWorkItems.length, 0)
  const unclassified = buildProjectEngagementWorkspace(fixture({ project: { ...fixture().project, engagement_type: null } }), { today: '2026-09-03' })
  assert.equal(unclassified.identity.workType, 'Client Work')
})

test('WKS2 rejects cross-organization extension data in the read model', () => {
  const workspace = buildProjectEngagementWorkspace(fixture({ engagement: { ...fixture().engagement, organization_id: 'org-b' } }), { today: '2026-09-03' })
  assert.equal(workspace.engagement, null)
  assert.equal(workspace.services.length, 0)
  assert.equal(workspace.engagementWorkItems.length, 0)
  assert.equal(workspace.workshopArtifacts.length, 0)
})

test('WKS2 repository is read-only and independent of RET1 and QTS1', () => {
  const repository = readFileSync(new URL('./projectEngagementWorkspaceRepository.js', import.meta.url), 'utf8')
  for (const table of ['projects', 'engagements', 'tasks', 'work_items', 'engagement_stage_instances', 'deliverables', 'activity_events']) assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  assert.doesNotMatch(repository, /\.(insert|update|upsert|delete|rpc|functions)\s*\(/)
  assert.doesNotMatch(repository, /recurring_plan|quick_task|sandbox/i)
})

test('WKS2 route and UI preserve distinct Project Task and Engagement Work Item labels', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const portfolio = readFileSync(new URL('../apps/PortfolioWorkspace.jsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="sphere\/workspace\/projects\/:projectId" element={<ProjectEngagementWorkspace \/>}/)
  assert.match(portfolio, /\/sphere\/workspace\/projects\/\$\{row\.id\}/)
  assert.match(workspace, /Project Tasks/)
  assert.match(workspace, /Engagement Work Items/)
  assert.match(workspace, /No engagement data has been fabricated/)
  assert.match(workspace, /Retainer Planning/)
  assert.match(workspace, /showRetainerPlanning/)
})
