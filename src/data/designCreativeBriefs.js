export const CREATIVE_BRIEF_OUTPUTS = Object.freeze([
  ['image', 'Image'], ['brand_identity', 'Brand identity'],
  ['website', 'Website'], ['social', 'Social'],
])

const REQUIRED = Object.freeze({
  image: ['title', 'purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs'],
  brand_identity: ['title', 'purpose', 'audience', 'objective', 'requested_outputs', 'exclusions_constraints'],
  website: ['title', 'purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs'],
  social: ['title', 'purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs', 'rights_notes'],
})

const clean = value => typeof value === 'string' ? value.trim() : ''

export function emptyCreativeBrief() {
  return {
    title: '', purpose: '', output_type: 'image', audience: '', objective: '',
    placement_destination: '', instructions: '', exclusions_constraints: '',
    rights_notes: '', requested_outputs: [],
  }
}

export function validateCreativeBrief(content = {}) {
  const outputType = clean(content.output_type)
  if (!REQUIRED[outputType]) return { valid: false, output_type: outputType, missing: ['supported output type'], unsupported: true }
  const missing = REQUIRED[outputType].filter(field => Array.isArray(content[field])
    ? !content[field].map(clean).filter(Boolean).length : !clean(content[field]))
  return { valid: missing.length === 0, output_type: outputType, missing, unsupported: false }
}

export function latestBriefVersion(brief, versions = []) {
  return versions.filter(version => version.creative_brief_id === brief?.id)
    .sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function creativeBriefForContext(briefs = [], organizationId = '', engagementId = '', engagementServiceId = '', workRecord = null) {
  if (!organizationId || !engagementId || !engagementServiceId) return null
  if (workRecord && (!workRecord.id || !['project_task', 'engagement_work_item'].includes(workRecord.kind))) return null
  const projectTaskId = workRecord?.kind === 'project_task' ? workRecord.id : null
  const engagementWorkItemId = workRecord?.kind === 'engagement_work_item' ? workRecord.id : null
  const matches = briefs.filter(brief => brief.visibility === 'official'
    && brief.organization_id === organizationId
    && brief.engagement_id === engagementId
    && brief.engagement_service_id === engagementServiceId
    && (brief.project_task_id || null) === projectTaskId
    && (brief.engagement_work_item_id || null) === engagementWorkItemId)
  return matches.length === 1 ? matches[0] : null
}

export function creativeBriefVersionsForDirectionContext(direction, sessions = [], briefs = [], versions = []) {
  const session = sessions.find(item => item.id === direction?.session_id)
  if (!direction?.organization_id || !session?.organization_id || direction.organization_id !== session.organization_id
    || !session.engagement_id || !session.engagement_service_id) return []
  if (session.project_task_id && session.engagement_work_item_id) return []
  const workRecord = session.project_task_id
    ? { kind: 'project_task', id: session.project_task_id }
    : session.engagement_work_item_id
      ? { kind: 'engagement_work_item', id: session.engagement_work_item_id }
      : null
  const brief = creativeBriefForContext(
    briefs, session.organization_id, session.engagement_id, session.engagement_service_id, workRecord,
  )
  if (!brief) return []
  return versions.filter(item => item.organization_id === session.organization_id && item.creative_brief_id === brief.id)
    .sort((left, right) => left.version_number - right.version_number)
}

export function validateCreativeBriefVersionSelection(versionId = '', compatibleVersions = []) {
  return compatibleVersions.some(item => item.id === versionId)
    ? { valid: true, error: '' }
    : { valid: false, error: 'Choose a creative brief version from this direction’s exact work context.' }
}

export function nextOperationKey() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure operation IDs are unavailable')
  return globalThis.crypto.randomUUID()
}

export function workingPreferenceForSession(preferences = [], sessionId = '') {
  return preferences.find(preference => preference.session_id === sessionId) || null
}
