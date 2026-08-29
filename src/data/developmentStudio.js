export const DEVELOPMENT_ARTIFACTS = Object.freeze({
  technical_brief: Object.freeze({
    label: 'Technical brief',
    description: 'Implementation constraints, requirements, access notes, and agreed technical decisions.',
  }),
  launch_checklist: Object.freeze({
    label: 'Launch checklist',
    description: 'A concise release-readiness record for QA, backup, launch, and verification checks.',
  }),
})

export const DEVELOPMENT_ARTIFACT_TYPES = Object.freeze(Object.keys(DEVELOPMENT_ARTIFACTS))

export const DEVELOPMENT_STAGE_STATUSES = Object.freeze([
  Object.freeze({ id: 'not_started', label: 'Not started' }),
  Object.freeze({ id: 'in_progress', label: 'In progress' }),
  Object.freeze({ id: 'blocked', label: 'Blocked' }),
  Object.freeze({ id: 'complete', label: 'Complete' }),
])

export function developmentStatus(value) {
  if (value === 'completed') return 'complete'
  if (['in_progress', 'blocked', 'complete', 'not_started'].includes(value)) return value
  return 'not_started'
}

export function latestArtifactVersion(versions, artifactId) {
  return (versions || [])
    .filter(version => version.artifact_id === artifactId)
    .sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function artifactContent(notes, checklist) {
  return {
    notes: String(notes || '').trim(),
    checklist: String(checklist || '').split('\n').map(item => item.trim()).filter(Boolean),
  }
}
