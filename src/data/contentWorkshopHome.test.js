import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTENT_HOME_GROUPS,
  buildContentHomeIndex,
  contentActionReadiness,
  contentHomeAccessState,
  contentSourceReadiness,
} from './contentWorkshopHome.js'

const context = Object.freeze({
  organizationId: 'organization-1',
  projectId: 'project-1',
  engagementId: 'engagement-1',
  brandId: 'brand-1',
  activeServices: [{ id: 'service-1', departmentId: 'content', status: 'active' }],
})

const workspace = Object.freeze({
  context,
  artifacts: [
    { id: 'discovery', artifact_type: 'discovery', title: 'Launch discovery', created_by: 'owner-1' },
    { id: 'statement', artifact_type: 'brand_statement' },
    { id: 'keywords', artifact_type: 'keyword_strategy' },
    { id: 'copy', artifact_type: 'content' },
  ],
  versions: [
    { id: 'discovery-v1', artifact_id: 'discovery', version_number: 1, created_by: 'owner-1', created_at: '2026-09-01T09:00:00Z' },
    { id: 'discovery-v2', artifact_id: 'discovery', version_number: 2, created_by: 'owner-2', created_at: '2026-09-02T09:00:00Z' },
    { id: 'keywords-v1', artifact_id: 'keywords', version_number: 1, status: 'in_review', created_at: '2026-09-03T09:00:00Z' },
  ],
  approvals: [{ artifact_id: 'discovery', artifact_version_id: 'discovery-v2', approved_at: '2026-09-02T10:00:00Z' }],
})

test('CONTENT B01 exposes the six approved Content Home index groups', () => {
  assert.deepEqual(CONTENT_HOME_GROUPS.map(group => group.label), [
    'Brief', 'Brand foundations', 'Website structure', 'Keywords', 'Content', 'Review',
  ])
})

test('CONTENT B01 indexes real artifacts with current exact version and review state', () => {
  const groups = buildContentHomeIndex(workspace)
  const brief = groups.find(group => group.id === 'brief').items[0]
  assert.deepEqual(brief, {
    id: 'discovery', groupId: 'brief', title: 'Launch discovery', contentType: 'discovery',
    currentVersionId: 'discovery-v2', currentVersionNumber: 2, reviewState: 'approved',
    reviewLabel: 'Approved', ownerId: 'owner-2', updatedAt: '2026-09-02T09:00:00Z',
  })
  assert.deepEqual(groups.find(group => group.id === 'review').items.map(item => item.id), ['keywords', 'discovery'])
  assert.equal(groups.find(group => group.id === 'brand_foundations').items[0].title, 'Brand statement')
  assert.equal(groups.find(group => group.id === 'content').items[0].currentVersionId, null)
})

test('CONTENT B01 reports Missing Available Approved and Changed since use honestly', () => {
  assert.equal(contentSourceReadiness(workspace, 'vision').status, 'missing')
  assert.equal(contentSourceReadiness(workspace, 'keyword_strategy').status, 'available')
  assert.equal(contentSourceReadiness(workspace, 'discovery').status, 'approved')
  assert.deepEqual(contentSourceReadiness(workspace, 'discovery', 'discovery-v1'), {
    status: 'changed_since_use', label: 'Changed since use', artifactId: 'discovery',
    versionId: 'discovery-v2', usedVersionId: 'discovery-v1',
  })
})

test('CONTENT B01 permits browsing but blocks official creation without validated context', () => {
  assert.deepEqual(contentHomeAccessState({}), {
    canBrowse: true, canCreateOfficial: false, canCreatePrivate: false, reason: 'Choose an organization.',
  })
  assert.equal(contentHomeAccessState({ ...context, activeServices: [] }).canCreateOfficial, false)
  assert.equal(contentHomeAccessState({ ...context, activeServices: [{ departmentId: 'content', status: 'paused' }] }).canCreateOfficial, false)
  assert.deepEqual(contentHomeAccessState(context), {
    canBrowse: true, canCreateOfficial: true, canCreatePrivate: false, reason: null,
  })
})

test('CONTENT B01 keeps private work non-official and does not impose unrelated source gates', () => {
  const privateState = contentActionReadiness({ context }, {
    mode: 'private', requiredFields: ['objective'], values: { objective: 'Explore a social post' },
  })
  assert.equal(privateState.canCreateOfficial, false)
  assert.equal(privateState.canCreatePrivate, true)
  assert.equal(privateState.canRun, true)

  const isolatedSocial = contentActionReadiness({ context, artifacts: [], versions: [], approvals: [] }, {
    requiredFields: ['objective', 'language'],
    values: { objective: 'Draft one social post', language: 'en' },
    requiredSourceTypes: [],
  })
  assert.equal(isolatedSocial.canRun, true)
  assert.deepEqual(isolatedSocial.missingSources, [])
  assert.deepEqual(isolatedSocial.unresolvedSources, [])
})

test('CONTENT B01 blocks only sources and fields required by the selected action', () => {
  const websiteCopy = contentActionReadiness(workspace, {
    requiredFields: ['objective', 'language'], values: { objective: 'Write the home page', language: '' },
    requiredSourceTypes: ['website_architecture'],
  })
  assert.equal(websiteCopy.canRun, false)
  assert.deepEqual(websiteCopy.missingFields, ['language'])
  assert.deepEqual(websiteCopy.missingSources, ['website_architecture'])
})

test('CONTENT B01 requires an exact selection when a source type has multiple artifacts', () => {
  const duplicateWorkspace = {
    ...workspace,
    artifacts: [
      ...workspace.artifacts,
      { id: 'discovery-new', artifact_type: 'discovery', title: 'New discovery' },
    ],
    versions: [
      ...workspace.versions,
      { id: 'discovery-new-v1', artifact_id: 'discovery-new', version_number: 1 },
    ],
    approvals: [
      ...workspace.approvals,
      { artifact_id: 'discovery-new', artifact_version_id: 'discovery-new-v1' },
    ],
  }

  assert.deepEqual(contentSourceReadiness(duplicateWorkspace, 'discovery'), {
    status: 'selection_required', label: 'Selection required', artifactId: null, versionId: null,
    candidateArtifactIds: ['discovery', 'discovery-new'], usedVersionId: null,
  })
  assert.equal(contentSourceReadiness(duplicateWorkspace, 'discovery', {
    artifactId: 'discovery-new',
  }).status, 'approved')

  const action = contentActionReadiness(duplicateWorkspace, {
    requiredSourceTypes: ['discovery'],
  })
  assert.equal(action.canRun, false)
  assert.deepEqual(action.unresolvedSources, ['discovery'])
  assert.equal(action.sourceReadiness.discovery.status, 'selection_required')

  const selectedAction = contentActionReadiness(duplicateWorkspace, {
    requiredSourceTypes: ['discovery'],
    sourceSelections: { discovery: { artifactId: 'discovery-new' } },
  })
  assert.equal(selectedAction.canRun, true)
  assert.deepEqual(selectedAction.unresolvedSources, [])
  assert.equal(selectedAction.sourceReadiness.discovery.artifactId, 'discovery-new')
})

test('CONTENT B01 rejects cross-type artifacts and versions from another same-type artifact', () => {
  const duplicateWorkspace = {
    ...workspace,
    artifacts: [...workspace.artifacts, { id: 'discovery-new', artifact_type: 'discovery' }],
    versions: [
      ...workspace.versions,
      { id: 'discovery-new-v1', artifact_id: 'discovery-new', version_number: 1 },
    ],
  }

  assert.equal(contentSourceReadiness(duplicateWorkspace, 'discovery', {
    artifactId: 'keywords',
  }).status, 'invalid_selection')
  assert.deepEqual(contentSourceReadiness(duplicateWorkspace, 'discovery', {
    artifactId: 'discovery', usedVersionId: 'discovery-new-v1',
  }), {
    status: 'invalid_selection', label: 'Invalid selection', artifactId: 'discovery',
    versionId: 'discovery-v2', usedVersionId: 'discovery-new-v1',
    reason: 'The used version does not belong to the selected artifact.',
  })
})

test('CONTENT B01 source selection is independent of artifact ordering', () => {
  const artifacts = [
    { id: 'discovery-old', artifact_type: 'discovery' },
    { id: 'discovery-new', artifact_type: 'discovery' },
  ]
  const duplicateWorkspace = {
    ...workspace,
    artifacts,
    versions: [
      { id: 'discovery-old-v1', artifact_id: 'discovery-old', version_number: 1 },
      { id: 'discovery-new-v1', artifact_id: 'discovery-new', version_number: 1 },
    ],
    approvals: [{ artifact_id: 'discovery-new', artifact_version_id: 'discovery-new-v1' }],
  }

  for (const orderedArtifacts of [artifacts, [...artifacts].reverse()]) {
    const orderedWorkspace = { ...duplicateWorkspace, artifacts: orderedArtifacts }
    assert.equal(contentSourceReadiness(orderedWorkspace, 'discovery').status, 'selection_required')
    assert.equal(contentSourceReadiness(orderedWorkspace, 'discovery', {
      artifactId: 'discovery-new',
    }).status, 'approved')
    assert.equal(contentSourceReadiness(orderedWorkspace, 'discovery', {
      artifactId: 'discovery-old',
    }).status, 'available')
  }
})
