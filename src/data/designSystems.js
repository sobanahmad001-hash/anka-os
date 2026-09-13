export const EMPTY_DESIGN_SYSTEM = Object.freeze({
  color_tokens: [{ name: '', value: '#000000' }],
  typography_scale: [{ name: '', font: '', size: '', weight: '' }],
  components: [{ name: '', description: '', usage_notes: '' }],
  usage_rules: '',
})

export function cloneDesignSystemContent(content = EMPTY_DESIGN_SYSTEM) {
  return {
    color_tokens: (content.color_tokens || []).map(item => ({ name: item.name || '', value: item.value || '' })),
    typography_scale: (content.typography_scale || []).map(item => ({
      name: item.name || '', font: item.font || '', size: item.size || '', weight: item.weight || '',
    })),
    components: (content.components || []).map(item => ({
      name: item.name || '', description: item.description || '', usage_notes: item.usage_notes || '',
    })),
    usage_rules: content.usage_rules || '',
  }
}

export function approvedVersionIds(approvals) {
  return new Set((approvals || []).map(approval => approval.artifact_version_id))
}

export function releasedVersionsFor(artifactId, versions, approvals) {
  const approved = approvedVersionIds(approvals)
  return (versions || []).filter(version => version.artifact_id === artifactId && approved.has(version.id))
    .sort((left, right) => right.version_number - left.version_number)
}

export function latestVersionFor(artifactId, versions) {
  return (versions || []).filter(version => version.artifact_id === artifactId)
    .sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function resolveDesignSystemLibrarySelection({
  artifacts = [], versions = [], approvals = [], requestedArtifactId = '', requestedVersionId = '',
  preferredArtifactId = '', currentArtifactId = '',
} = {}) {
  const exactArtifactId = typeof requestedArtifactId === 'string' ? requestedArtifactId.trim() : ''
  const exactVersionId = typeof requestedVersionId === 'string' ? requestedVersionId.trim() : ''
  const preferredId = typeof preferredArtifactId === 'string' ? preferredArtifactId.trim() : ''
  const currentId = typeof currentArtifactId === 'string' ? currentArtifactId.trim() : ''

  if (exactVersionId && !exactArtifactId) return { status: 'invalid', reason: 'exact_target_unavailable', artifactId: '', versionId: '' }
  if (exactArtifactId && !artifacts.some(item => item.id === exactArtifactId)) {
    return { status: 'invalid', reason: 'exact_target_unavailable', artifactId: '', versionId: '' }
  }

  const artifactId = exactArtifactId
    || (artifacts.some(item => item.id === preferredId) ? preferredId : '')
    || (artifacts.some(item => item.id === currentId) ? currentId : '')
    || artifacts[0]?.id || ''
  if (!artifactId) return { status: 'empty', reason: '', artifactId: '', versionId: '' }

  if (exactVersionId) {
    const exactVersion = versions.find(item => item.id === exactVersionId && item.artifact_id === artifactId)
    if (!exactVersion) return { status: 'invalid', reason: 'exact_target_unavailable', artifactId: '', versionId: '' }
    return { status: 'ready', reason: '', artifactId, versionId: exactVersion.id }
  }

  const defaultVersion = releasedVersionsFor(artifactId, versions, approvals)[0]
    || latestVersionFor(artifactId, versions)
  return { status: 'ready', reason: '', artifactId, versionId: defaultVersion?.id || '' }
}
