import test from 'node:test'
import assert from 'node:assert/strict'
import { composeLivingProjectReference, selectLivingProjectSnapshot } from './livingProjectReference.js'

function fixture() {
  const project = { id: 'project', organization_id: 'org', name: 'Recorded project' }
  const records = { project, livingRecord: { id: 'document', organization_id: 'org', project_id: 'project', source_version: 4 },
    snapshots: [], workstreams: [], tasks: [], milestones: [], dependencies: [], research: [], deliverables: [], versions: [], requests: [], activities: [] }
  return { organizationId: 'org', projectId: 'project', records,
    workspace: { project, engagement: { id: 'engagement' }, context: { brief: 'Approved brief', projectOwner: { name: 'Owner' } },
      milestones: [], projectTasks: [], engagementWorkItems: [], workstreams: [] },
    services: { organization_id: 'org', project_id: 'project', catalog: [{ id: 'service', name: 'Design' }], scopes: [
      { id: 'agreed', service_id: 'service', status: 'active' },
      { id: 'pending', service_id: 'service', status: 'proposed' },
    ] },
    proposals: [{ id: 'decision', organization_id: 'org', project_id: 'project', status: 'applied' },
      { id: 'proposal', organization_id: 'org', project_id: 'project', status: 'approved_failed' }],
    memory: { organization_id: 'org', project_id: 'project', confirmed: [{ id: 'confirmed', statement: 'Reviewed preference' }],
      candidates: [{ id: 'private-candidate', statement: 'Do not claim this is agreed' }] },
    pipeline: { configurations: [{ id: 'activated', organization_id: 'org', engagement_id: 'engagement', revision: 1 },
      { id: 'draft', organization_id: 'org', engagement_id: 'engagement', revision: 2 }],
      activations: [{ id: 'activation', organization_id: 'org', engagement_id: 'engagement', configuration_id: 'activated' }] } }
}

test('document separates applied agreement, proposals and unconfirmed preferences', () => {
  const document = composeLivingProjectReference(fixture(), '2026-09-26T00:00:00Z')
  assert.deepEqual(document.agreedServices.map(row => row.id), ['agreed'])
  assert.deepEqual(document.proposedServices.map(row => row.id), ['pending'])
  assert.deepEqual(document.decisions.map(row => row.id), ['decision'])
  assert.deepEqual(document.proposedChanges.map(row => row.id), ['proposal'])
  assert.deepEqual(document.confirmedPreferences.map(row => row.id), ['confirmed'])
  assert.equal(document.activeConfiguration.id, 'activated')
  assert.equal(document.coreProjection.source_version, 4)
  assert.equal(JSON.stringify(document.coreProjection).includes('Reviewed preference'), false)
  assert.match(document.coverage, /v1 core record or v2 recorded reference sections/)
})

test('foreign project sources and unmatched pipeline activations fail closed', () => {
  for (const source of ['services', 'memory']) {
    const input = fixture(); input[source].project_id = 'foreign'
    assert.throws(() => composeLivingProjectReference(input), { status: 403 })
  }
  for (const source of ['configurations', 'activations']) {
    const input = fixture(); input.pipeline[source][0].engagement_id = 'foreign'
    assert.throws(() => composeLivingProjectReference(input), { status: 403 })
  }
  const input = fixture(); input.pipeline.activations[0].configuration_id = 'missing'
  assert.throws(() => composeLivingProjectReference(input), { status: 403 })
})

test('history returns only the exact saved projection and never current-source fallback', () => {
  const snapshot = { id: 'version', organization_id: 'org', project_id: 'project', living_project_document_id: 'document',
    snapshot: { project: { name: 'Historic name' } } }
  assert.equal(selectLivingProjectSnapshot([snapshot], 'version', 'org', 'project', 'document'), snapshot)
  for (const args of [['missing', 'org', 'project', 'document'], ['version', 'foreign', 'project', 'document'],
    ['version', 'org', 'foreign', 'document'], ['version', 'org', 'project', 'foreign']]) {
    assert.throws(() => selectLivingProjectSnapshot([snapshot], ...args), { status: 403 })
  }
})
test('recurring plans preserve approved versus draft versions and reject foreign linked templates', () => {
  const input = fixture()
  input.recurring = { project: input.records.project,
    engagement: { id: 'engagement', organization_id: 'org', project_id: 'project' },
    plans: [{ id: 'plan', organization_id: 'org', project_id: 'project', engagement_id: 'engagement' }],
    versions: [{ id: 'approved-version', plan_id: 'plan', organization_id: 'org', frequency: 'monthly' },
      { id: 'draft-version', plan_id: 'plan', organization_id: 'org', frequency: 'weekly' }],
    approvals: [{ id: 'approval', organization_id: 'org', plan_id: 'plan', plan_version_id: 'approved-version' }],
    templateItems: [{ id: 'template', organization_id: 'org', plan_id: 'plan', plan_version_id: 'approved-version' }] }
  const document = composeLivingProjectReference(input)
  assert.deepEqual(document.recurringPlans[0].versions.map(row => [row.id, row.approved, row.items.length]),
    [['approved-version', true, 1], ['draft-version', false, 0]])
  assert.equal(JSON.stringify(document.coreProjection).includes('approved-version'), false)
  input.recurring.templateItems[0].plan_version_id = 'foreign-version'
  assert.throws(() => composeLivingProjectReference(input), { status: 403 })
  input.recurring.templateItems[0].plan_version_id = 'approved-version'
  input.recurring.approvals[0].organization_id = 'foreign-org'
  assert.throws(() => composeLivingProjectReference(input), { status: 403 })
})
