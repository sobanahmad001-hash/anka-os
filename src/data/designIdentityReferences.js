function related(value) {
  return Array.isArray(value) ? value[0] : value
}

function timestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function approvedDesignSystemReferences(workspace = {}) {
  const artifacts = workspace.identitySystems || []
  const approvals = workspace.identitySystemApprovals || []
  const approvedIds = new Set(approvals.map(approval => approval.artifact_version_id))
  return (workspace.identitySystemVersions || [])
    .filter(version => approvedIds.has(version.id))
    .map(version => {
      const artifact = artifacts.find(item => item.id === version.artifact_id)
      return artifact ? { artifact, version } : null
    })
    .filter(Boolean)
    .sort((left, right) => left.artifact.title.localeCompare(right.artifact.title)
      || right.version.version_number - left.version.version_number)
}

export function pinnedIdentityReferences(workspace = {}, creativeBriefVersionId = '') {
  const pinnedIds = new Set((workspace.creativeBriefSources || [])
    .filter(source => source.creative_brief_version_id === creativeBriefVersionId)
    .map(source => source.artifact_version_id))
  return approvedDesignSystemReferences(workspace).filter(item => pinnedIds.has(item.version.id))
}

export function identityProvenanceForDirection(workspace = {}, directionVersion = null) {
  if (!directionVersion?.creative_brief_version_id) return { briefVersion: null, references: [] }
  const briefVersion = (workspace.creativeBriefVersions || [])
    .find(item => item.id === directionVersion.creative_brief_version_id) || null
  return { briefVersion, references: pinnedIdentityReferences(workspace, directionVersion.creative_brief_version_id) }
}

const FAILURE_STATES = Object.freeze({
  HTTP_401: 'permission_denied', HTTP_403: 'permission_denied', HTTP_404: 'resource_deleted',
  HTTP_415: 'unsupported_format', HTTP_422: 'unsupported_format', HTTP_429: 'quota_limited',
  HTTP_500: 'provider_unavailable', HTTP_502: 'provider_unavailable', HTTP_503: 'provider_unavailable',
  HTTP_504: 'provider_unavailable', CONNECTION_FAILED: 'provider_unavailable', TIMEOUT: 'provider_unavailable',
})

export function designConnectionState(connection) {
  if (!connection) return 'disconnected'
  if (connection.status === 'verified') return 'verified'
  if (connection.status === 'configured') return 'configured'
  if (connection.status === 'disabled' || connection.status === 'disconnected') return 'disconnected'
  if (connection.status !== 'error') return 'unknown'
  const observation = connection.health_observation
  if (!observation || observation.outcome !== 'failed'
    || timestamp(observation.observed_at) < timestamp(connection.updated_at)) return 'unknown'
  return FAILURE_STATES[observation.error_code] || 'unknown'
}

export function figmaFileUrl(connection) {
  const key = related(connection?.public_config)?.file_key
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{6,160}$/.test(key)) return ''
  return `https://www.figma.com/file/${encodeURIComponent(key)}`
}

export function isDesignConnectionScopeCurrent(current, request) {
  return !request.signal?.aborted && current.organizationId === request.organizationId
    && current.revision === request.revision && current.generation === request.generation
}

export const DESIGN_CONNECTION_STATE_COPY = Object.freeze({
  verified: 'Read-only access was verified. External edits never replace pinned local versions.',
  configured: 'Credential metadata exists, but access has not been verified.',
  disconnected: 'No usable Design connection is available.',
  permission_denied: 'The provider denied access to this file or account.',
  resource_deleted: 'The configured external resource was not found or was deleted.',
  quota_limited: 'The provider reported a quota or rate limit.',
  unsupported_format: 'The provider rejected this resource format.',
  provider_unavailable: 'The provider could not be reached or returned a service failure.',
  unknown: 'Current access health cannot be classified from verified evidence.',
})
