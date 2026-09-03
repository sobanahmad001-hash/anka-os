import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildClientWorkspace } from './clientWorkspaceModel.js'

function fixture(overrides = {}) {
  return {
    client: { id: 'client-a', organization_id: 'org-a', name: 'Acme', company: 'Acme Ltd', status: 'active', owner_id: 'owner-a' },
    agencyClient: { id: 'agency-a', organization_id: 'org-a', canonical_client_id: 'client-a', name: 'Acme', legal_name: 'Acme Ltd' },
    brands: [{ id: 'brand-a', organization_id: 'org-a', client_id: 'agency-a', name: 'Acme Brand', is_default: true }],
    projects: [
      { id: 'project-a', organization_id: 'org-a', client_id: 'client-a', name: 'Launch', engagement_type: 'project', status: 'active', owner_id: 'owner-a' },
      { id: 'retainer-a', organization_id: 'org-a', client_id: 'client-a', name: 'Growth', engagement_type: 'retainer', status: 'active', owner_id: 'owner-a' },
      { id: 'forged', organization_id: 'org-b', client_id: 'client-a', name: 'Forged', engagement_type: 'project', status: 'active' },
    ],
    engagements: [{ id: 'engagement-a', organization_id: 'org-a', client_id: 'agency-a', project_id: 'project-a', brand_id: 'brand-a', status: 'active' }],
    contacts: [{ id: 'contact-a', organization_id: 'org-a', client_id: 'client-a', full_name: 'Casey Client', portal_role: 'approver', status: 'active' }],
    access: [{ id: 'access-a', organization_id: 'org-a', project_id: 'project-a', client_contact_id: 'contact-a', access_role: 'approver', status: 'active' }],
    tasks: [{ id: 'task-a', organization_id: 'org-a', project_id: 'project-a', title: 'Plan launch', status: 'in_progress', assigned_to: 'owner-a', due_date: '2026-09-02' }],
    workItems: [{ id: 'item-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'engagement-a', title: 'Produce launch', status: 'in_progress', assignee_id: 'owner-a', due_date: '2026-09-05' }, { id: 'orphan', organization_id: 'org-a', project_id: 'retainer-a', engagement_id: 'unknown', title: 'Orphan', status: 'in_progress' }],
    milestones: [{ id: 'milestone-a', organization_id: 'org-a', project_id: 'project-a', name: 'Launch', status: 'planned', target_date: '2026-09-10' }],
    requests: [{ id: 'request-a', organization_id: 'org-a', project_id: 'project-a', title: 'Client input', request_origin: 'client', status: 'submitted', required_by: '2026-09-08' }],
    deliverables: [{ id: 'deliverable-a', organization_id: 'org-a', project_id: 'project-a', title: 'Campaign', status: 'in_review', due_date: '2026-09-12' }],
    versions: [{ id: 'version-a', organization_id: 'org-a', project_id: 'project-a', deliverable_id: 'deliverable-a', version_number: 1, review_status: 'ready_for_client_review' }],
    releases: [{ id: 'release-a', organization_id: 'org-a', project_id: 'project-a', title: 'Campaign v1', item_type: 'deliverable', status: 'released', released_at: '2026-09-03T10:00:00Z' }],
    memberships: [{ organization_id: 'org-a', user_id: 'owner-a' }],
    profiles: [{ id: 'owner-a', full_name: 'Ava Owner' }],
    ...overrides,
  }
}

test('WKS3 composes a canonical client with optional validated extensions', () => {
  const workspace = buildClientWorkspace(fixture(), { today: '2026-09-03' })
  assert.equal(workspace.projects.length, 2)
  assert.equal(workspace.summary.oneTimeProjects, 1)
  assert.equal(workspace.summary.retainers, 1)
  assert.equal(workspace.summary.openProjectTasks, 1)
  assert.equal(workspace.summary.openEngagementWorkItems, 1)
  assert.equal(workspace.projects.find((row) => row.id === 'retainer-a').engagementWorkItems.length, 0)
  assert.equal(workspace.people[0].access[0].projectName, 'Launch')
  assert.equal(workspace.deliverables[0].versions.length, 1)
  assert.equal(workspace.summary.releases, 1)
  assert.equal(workspace.dueWork[0].source, 'Project Task')
  assert.equal(workspace.dueWork[0].overdue, true)
})

test('WKS3 renders a canonical client without fabricating agency or recurring context', () => {
  const workspace = buildClientWorkspace(fixture({ agencyClient: null, brands: [], engagements: [], workItems: [] }), { today: '2026-09-03' })
  assert.equal(workspace.agencyClient, null)
  assert.deepEqual(workspace.brands, [])
  assert.equal(workspace.summary.retainers, 1)
  assert.equal(workspace.summary.openEngagementWorkItems, 0)
  assert.equal('recurringPlans' in workspace, false)
})

test('WKS3 rejects cross-organization client children and invalid engagement work', () => {
  const data = fixture()
  data.contacts.push({ id: 'forged-contact', organization_id: 'org-b', client_id: 'client-a', full_name: 'Forged' })
  data.workItems.push({ id: 'forged-item', organization_id: 'org-b', project_id: 'project-a', engagement_id: 'engagement-a', title: 'Forged', status: 'in_progress' })
  data.access.push({ id: 'forged-access', organization_id: 'org-a', project_id: 'retainer-a', client_contact_id: 'missing-contact', access_role: 'viewer', status: 'active' })
  const workspace = buildClientWorkspace(data, { today: '2026-09-03' })
  assert.equal(workspace.people.length, 1)
  assert.equal(workspace.people[0].access.length, 1)
  assert.equal(workspace.summary.openEngagementWorkItems, 1)
  assert.equal(workspace.projects.some((row) => row.id === 'forged'), false)
})

test('WKS3 rejects a cross-organization agency-client extension and its children', () => {
  const workspace = buildClientWorkspace(fixture({ agencyClient: { ...fixture().agencyClient, organization_id: 'org-b' } }), { today: '2026-09-03' })
  assert.equal(workspace.agencyClient, null)
  assert.deepEqual(workspace.brands, [])
  assert.equal(workspace.projects[0].extension, null)
  assert.equal(workspace.summary.openEngagementWorkItems, 0)
})

test('WKS3 repository is batch-oriented, read-only, and RET/QTS independent', () => {
  const repository = readFileSync(new URL('./clientWorkspaceRepository.js', import.meta.url), 'utf8')
  for (const table of ['clients', 'agency_clients', 'brands', 'projects', 'engagements', 'client_contacts', 'project_client_access', 'tasks', 'work_items', 'requests', 'deliverables', 'client_portal_items']) assert.match(repository, new RegExp(`from\\('${table}'\\)`))
  assert.doesNotMatch(repository, /\.(insert|update|upsert|delete|rpc|functions)\s*\(/)
  assert.doesNotMatch(repository, /recurring_plan|quick_task|sandbox/i)
})

test('WKS3 route and UI expose client-root navigation and distinct work systems', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const registry = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../apps/ClientWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="sphere\/clients\/:clientId" element={<ClientWorkspace \/>}/)
  assert.match(registry, /\/sphere\/clients\/\$\{client\.canonical_client_id\}/)
  assert.match(screen, /Project Tasks/)
  assert.match(screen, /Engagement Work Items/)
  assert.match(screen, /No recurring commitment schedule is inferred/)
})
