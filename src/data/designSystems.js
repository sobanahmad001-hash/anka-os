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
