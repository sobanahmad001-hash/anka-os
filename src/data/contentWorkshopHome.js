import { CONTENT_ARTIFACT_FORMS, latestVersion } from './contentStudio.js'

export const CONTENT_HOME_GROUPS = Object.freeze([
  Object.freeze({ id: 'brief', label: 'Brief', artifactTypes: Object.freeze(['discovery']) }),
  Object.freeze({ id: 'brand_foundations', label: 'Brand foundations', artifactTypes: Object.freeze(['vision', 'audience', 'brand_statement']) }),
  Object.freeze({ id: 'website_structure', label: 'Website structure', artifactTypes: Object.freeze(['website_architecture']) }),
  Object.freeze({ id: 'keywords', label: 'Keywords', artifactTypes: Object.freeze(['keyword_strategy']) }),
  Object.freeze({ id: 'content', label: 'Content', artifactTypes: Object.freeze(['content', 'campaign_messaging', 'scripts']) }),
  Object.freeze({ id: 'review', label: 'Review', artifactTypes: Object.freeze([]) }),
])

const REVIEW_LABELS = Object.freeze({
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  released: 'Released',
})

const CONTENT_TYPE_LABELS = Object.freeze({
  brand_statement: 'Brand statement',
})

function groupForType(type) {
  return CONTENT_HOME_GROUPS.find(group => group.artifactTypes.includes(type))?.id || 'content'
}

function versionReviewState(version, approvals) {
  if (!version) return 'draft'
  const state = String(version.review_state || version.status || '').trim().toLowerCase()
  if (state === 'released') return 'released'
  if (approvals.some(approval => approval.artifact_version_id === version.id)) return 'approved'
  return Object.hasOwn(REVIEW_LABELS, state) ? state : 'draft'
}

function itemTitle(artifact) {
  return String(artifact.title
    || CONTENT_ARTIFACT_FORMS[artifact.artifact_type]?.label
    || CONTENT_TYPE_LABELS[artifact.artifact_type]
    || artifact.artifact_type
    || 'Content item').trim()
}

export function buildContentHomeIndex(workspace = {}) {
  const versions = workspace.versions || []
  const approvals = workspace.approvals || []
  const items = (workspace.artifacts || []).map(artifact => {
    const currentVersion = latestVersion(versions.filter(version => version.artifact_id === artifact.id))
    const reviewState = versionReviewState(currentVersion, approvals)
    return Object.freeze({
      id: artifact.id,
      groupId: groupForType(artifact.artifact_type),
      title: itemTitle(artifact),
      contentType: artifact.artifact_type,
      currentVersionId: currentVersion?.id || null,
      currentVersionNumber: currentVersion?.version_number || null,
      reviewState,
      reviewLabel: REVIEW_LABELS[reviewState],
      ownerId: currentVersion?.created_by || artifact.owner_id || artifact.created_by || null,
      updatedAt: currentVersion?.created_at || artifact.updated_at || artifact.created_at || null,
    })
  })

  return CONTENT_HOME_GROUPS.map(group => Object.freeze({
    ...group,
    items: Object.freeze((group.id === 'review'
      ? items.filter(item => item.reviewState !== 'draft')
      : items.filter(item => item.groupId === group.id))
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))),
  }))
}

export function contentSourceReadiness(workspace = {}, artifactType, selection = {}) {
  const normalizedSelection = typeof selection === 'string'
    ? { usedVersionId: selection }
    : (selection || {})
  const { artifactId = null, usedVersionId = null } = normalizedSelection
  const artifacts = workspace.artifacts || []
  const candidates = artifacts.filter(item => item.artifact_type === artifactType)

  if (!artifactId && candidates.length > 1) return Object.freeze({
    status: 'selection_required', label: 'Selection required', artifactId: null, versionId: null,
    candidateArtifactIds: Object.freeze(candidates.map(item => item.id).sort()), usedVersionId,
  })

  const artifact = artifactId
    ? candidates.find(item => item.id === artifactId)
    : candidates[0]
  if (artifactId && !artifact) return Object.freeze({
    status: 'invalid_selection', label: 'Invalid selection', artifactId, versionId: null,
    usedVersionId, reason: 'The selected artifact does not match the required source type.',
  })

  const versions = (workspace.versions || []).filter(version => version.artifact_id === artifact?.id)
  const currentVersion = latestVersion(versions)

  if (!artifact || !currentVersion) return Object.freeze({
    status: 'missing', label: 'Missing', artifactId: artifact?.id || null, versionId: null,
  })

  if (usedVersionId && !versions.some(version => version.id === usedVersionId)) return Object.freeze({
    status: 'invalid_selection', label: 'Invalid selection', artifactId: artifact.id,
    versionId: currentVersion.id, usedVersionId,
    reason: 'The used version does not belong to the selected artifact.',
  })

  if (usedVersionId && currentVersion.id !== usedVersionId) return Object.freeze({
    status: 'changed_since_use', label: 'Changed since use', artifactId: artifact.id,
    versionId: currentVersion.id, usedVersionId,
  })

  const approved = (workspace.approvals || []).some(approval => approval.artifact_version_id === currentVersion.id)
  return Object.freeze({
    status: approved ? 'approved' : 'available',
    label: approved ? 'Approved' : 'Available',
    artifactId: artifact.id,
    versionId: currentVersion.id,
    usedVersionId,
  })
}

function activeContentService(context) {
  return (context.activeServices || []).some(service => {
    const department = service.departmentId || service.department_id || service.service_catalog?.department_id
    return department === 'content' && service.status === 'active'
  })
}

export function contentHomeAccessState(context = {}, { mode = 'project' } = {}) {
  if (mode === 'private') return Object.freeze({
    canBrowse: true,
    canCreateOfficial: false,
    canCreatePrivate: true,
    reason: 'Private work must be promoted through an authorized target preview and confirmation.',
  })

  const required = [
    ['organizationId', 'Choose an organization.'],
    ['projectId', 'Choose a project.'],
    ['engagementId', 'Choose an engagement.'],
    ['brandId', 'Choose a brand.'],
  ]
  const missing = required.find(([key]) => !String(context[key] || '').trim())
  if (missing) return Object.freeze({ canBrowse: true, canCreateOfficial: false, canCreatePrivate: false, reason: missing[1] })
  if (!activeContentService(context)) return Object.freeze({
    canBrowse: true,
    canCreateOfficial: false,
    canCreatePrivate: false,
    reason: 'Content is not an active service for this engagement.',
  })
  return Object.freeze({ canBrowse: true, canCreateOfficial: true, canCreatePrivate: false, reason: null })
}

export function contentActionReadiness(workspace = {}, request = {}) {
  const access = contentHomeAccessState(workspace.context, { mode: request.mode })
  const missingFields = (request.requiredFields || []).filter(field => !String(request.values?.[field] || '').trim())
  const sourceReadiness = Object.fromEntries((request.requiredSourceTypes || []).map(type => [
    type,
    contentSourceReadiness(workspace, type, request.sourceSelections?.[type]),
  ]))
  const missingSources = Object.entries(sourceReadiness)
    .filter(([, readiness]) => readiness.status === 'missing')
    .map(([type]) => type)
  const unresolvedSources = Object.entries(sourceReadiness)
    .filter(([, readiness]) => ['selection_required', 'invalid_selection'].includes(readiness.status))
    .map(([type]) => type)
  return Object.freeze({
    ...access,
    canRun: (request.mode === 'private' ? access.canCreatePrivate : access.canCreateOfficial)
      && missingFields.length === 0 && missingSources.length === 0 && unresolvedSources.length === 0,
    missingFields: Object.freeze(missingFields),
    missingSources: Object.freeze(missingSources),
    unresolvedSources: Object.freeze(unresolvedSources),
    sourceReadiness: Object.freeze(sourceReadiness),
  })
}
