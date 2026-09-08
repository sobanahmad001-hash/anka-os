import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildClientWorkDirectory } from './clientWorkDirectoryModel.js'

function fixture(overrides = {}) {
  return {
    organizationId: 'org-a',
    clients: [
      { id: 'client-a', organization_id: 'org-a', name: 'Acme', company: 'Acme Ltd', status: 'active', owner_id: 'owner-a' },
      { id: 'client-b', organization_id: 'org-b', name: 'Hidden', company: 'Hidden Co', status: 'active', owner_id: 'owner-b' },
    ],
    agencyClients: [
      { id: 'agency-a', organization_id: 'org-a', canonical_client_id: 'client-a', name: 'Acme', status: 'active' },
      { id: 'agency-forged', organization_id: 'org-b', canonical_client_id: 'client-a', name: 'Forged', status: 'active' },
    ],
    brands: [
      { id: 'brand-a', organization_id: 'org-a', client_id: 'agency-a', name: 'Acme Brand', status: 'active', is_default: true },
      { id: 'brand-forged', organization_id: 'org-b', client_id: 'agency-a', name: 'Forged Brand', status: 'active' },
    ],
    projects: [
      { id: 'project-a', organization_id: 'org-a', client_id: 'client-a', name: 'Launch', engagement_type: 'project', status: 'active', owner_id: 'owner-a', due_date: '2026-09-02' },
      { id: 'retainer-a', organization_id: 'org-a', client_id: 'client-a', name: 'Growth', engagement_type: 'retainer', status: 'active', owner_id: 'missing' },
      { id: 'internal-a', organization_id: 'org-a', client_id: 'client-a', name: 'Internal', engagement_type: 'internal', status: 'active' },
      { id: 'project-forged', organization_id: 'org-b', client_id: 'client-a', name: 'Forged', engagement_type: 'project', status: 'active' },
    ],
    engagements: [{ id: 'engagement-a', organization_id: 'org-a', client_id: 'agency-a', brand_id: 'brand-a', project_id: 'project-a', status: 'active' }],
    tasks: [
      { id: 'task-a', organization_id: 'org-a', project_id: 'project-a', status: 'in_progress' },
      { id: 'task-done', organization_id: 'org-a', project_id: 'project-a', status: 'done' },
      { id: 'task-forged', organization_id: 'org-b', project_id: 'project-a', status: 'in_progress' },
    ],
    workItems: [
      { id: 'item-a', organization_id: 'org-a', project_id: 'project-a', engagement_id: 'engagement-a', status: 'blocked' },
      { id: 'orphan', organization_id: 'org-a', project_id: 'retainer-a', engagement_id: 'missing', status: 'in_progress' },
      { id: 'item-forged', organization_id: 'org-b', project_id: 'project-a', engagement_id: 'engagement-a', status: 'in_progress' },
    ],
    memberships: [{ organization_id: 'org-a', user_id: 'owner-a' }],
    profiles: [{ id: 'owner-a', full_name: 'Ava Owner' }, { id: 'owner-b', full_name: 'Hidden Owner' }],
    ...overrides,
  }
}

test('P2 Client Work keeps canonical clients and validated optional context inside the active organization', () => {
  const directory = buildClientWorkDirectory(fixture(), { today: '2026-09-03' })
  assert.deepEqual(directory.clients.map((row) => row.id), ['client-a'])
  assert.deepEqual(directory.clients[0].brands.map((row) => row.id), ['brand-a'])
  assert.deepEqual(directory.clients[0].projects.map((row) => row.id), ['project-a', 'retainer-a'])
  assert.equal(directory.clients[0].projects[0].brandName, 'Acme Brand')
  assert.equal(directory.clients[0].projects[0].hasEngagement, true)
  assert.equal(directory.clients[0].projects[1].hasEngagement, false)
  assert.equal(directory.clients[0].projects[0].overdue, true)
  assert.equal(directory.clients[0].owner.name, 'Ava Owner')
  assert.equal(directory.clients[0].projects[1].owner.name, 'Unassigned')
})

test('P2 Client Work counts Project Tasks and valid Engagement Work Items separately', () => {
  const directory = buildClientWorkDirectory(fixture(), { today: '2026-09-03' })
  assert.equal(directory.summary.clients, 1)
  assert.equal(directory.summary.activeProjects, 2)
  assert.equal(directory.summary.openProjectTasks, 1)
  assert.equal(directory.summary.openEngagementWorkItems, 1)
  assert.equal(directory.clients[0].counts.oneTimeProjects, 1)
  assert.equal(directory.clients[0].counts.retainers, 1)
})

test('P2 Client Work requires an explicit active organization', () => {
  assert.throws(() => buildClientWorkDirectory(fixture({ organizationId: '' })), /active organization/i)
})

test('P2 directory UI preserves routes, local filters, honest states, and company-client-internal navigation', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const operatingSpine = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
  const clientDirectory = readFileSync(new URL('../apps/ClientWorkDirectory.jsx', import.meta.url), 'utf8')
  const internalDirectory = readFileSync(new URL('../apps/InternalWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="sphere\/clients" element={<OperatingSpine initialView="clients" \/>}/)
  assert.match(app, /path="sphere\/clients\/:clientId" element={<ClientWorkspace \/>}/)
  assert.match(app, /path="sphere\/internal" element={<InternalWorkspace \/>}/)
  assert.match(operatingSpine, /initialView === 'clients'/)
  for (const source of [clientDirectory, internalDirectory]) {
    assert.match(source, /Company work/)
    assert.match(source, /Client Work/)
    assert.match(source, /Internal Work/)
    assert.match(source, /type="search"/)
    assert.match(source, /Showing \{filtered/)
    assert.doesNotMatch(source, /organization(Id)?=/)
  }
  assert.match(clientDirectory, /Access denied/)
  assert.match(clientDirectory, /Client Work is stale/)
  assert.match(clientDirectory, /No Client Work yet/)
  assert.match(clientDirectory, /No matching Client Work/)
  assert.match(internalDirectory, /Internal Work is stale/)
  assert.match(internalDirectory, /No matching Internal Work/)
  assert.match(clientDirectory, /Project Tasks/)
  assert.match(clientDirectory, /Engagement Work Items/)
  assert.match(internalDirectory, /Project Tasks/)
  assert.match(internalDirectory, /Engagement Work Items/)
})
