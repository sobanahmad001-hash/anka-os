export const ARTIFACT_RELATION_TYPES = Object.freeze([
  ['feeds_into', 'Feeds into'],
  ['derived_from', 'Derived from'],
  ['referenced_by', 'Referenced by'],
])

const CONTENT_TYPES = new Set([
  'discovery', 'vision', 'audience', 'website_architecture',
  'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
])
const MARKETING_TYPES = new Set([
  'channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report',
])
const DEVELOPMENT_TYPES = new Set(['technical_brief', 'implementation_record', 'launch_record'])

export function artifactTypeLabel(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export function relationTypeLabel(value) {
  return ARTIFACT_RELATION_TYPES.find(([id]) => id === value)?.[1] || artifactTypeLabel(value)
}

export function artifactSurfacePath(artifact) {
  if (!artifact?.id) return '/sphere/engagements'
  return `/sphere/artifacts/${artifact.id}`
}

export function owningWorkspacePath(artifact) {
  if (CONTENT_TYPES.has(artifact?.artifact_type)) return '/sphere/content/studio'
  if (MARKETING_TYPES.has(artifact?.artifact_type)) return '/sphere/marketing/studio'
  if (DEVELOPMENT_TYPES.has(artifact?.artifact_type)) return '/sphere/engagements'
  return '/sphere/engagements'
}

export function splitArtifactRelations(artifactId, relations) {
  const outgoing = []
  const incoming = []
  for (const relation of relations || []) {
    if (relation.source_artifact_id === artifactId && relation.target) {
      outgoing.push({ ...relation, relatedArtifact: relation.target })
    }
    if (relation.target_artifact_id === artifactId && relation.source) {
      incoming.push({ ...relation, relatedArtifact: relation.source })
    }
  }
  return { outgoing, incoming }
}
