import { appendWorkshopNavigation } from './workshopNavigation.js'

const CONTENT_TYPES = new Set([
  'discovery', 'vision', 'audience', 'brand_statement', 'website_architecture',
  'keyword_strategy', 'content', 'campaign_messaging', 'scripts',
])
const MARKETING_TYPES = new Set(['channel_strategy', 'campaign_brief', 'measurement_plan'])

function exactVersion(linkedVersion) {
  if (!linkedVersion?.artifact_id || !linkedVersion?.artifact_version_id || !linkedVersion?.artifact_type) return null
  return linkedVersion
}

export function departmentChatVersionHistoryPath(engagement, linkedVersion) {
  const version = exactVersion(linkedVersion)
  if (!version || !engagement?.organization_id) return ''
  if (version.artifact_type === 'design_system') {
    const params = new URLSearchParams({ artifact: version.artifact_id, version: version.artifact_version_id })
    return `/sphere/design/systems?${params}`
  }
  const context = {
    organizationId: engagement.organization_id,
    clientId: engagement.agency_client_id || engagement.client_id || '',
    projectId: engagement.project_id || '',
    engagementId: engagement.id || '',
    brandId: engagement.brand_id || '',
    output: { kind: 'artifact', id: version.artifact_id, versionId: version.artifact_version_id },
  }
  if (MARKETING_TYPES.has(version.artifact_type)) {
    return appendWorkshopNavigation('/sphere/marketing/studio', { ...context, workshopTab: 'artifacts' })
  }
  if (CONTENT_TYPES.has(version.artifact_type)) {
    const path = appendWorkshopNavigation('/sphere/content/studio', { ...context, workshopTab: 'library' })
    const target = new URL(path, 'https://anka.invalid')
    target.searchParams.set('artifact', version.artifact_id)
    target.searchParams.set('version', version.artifact_version_id)
    return target.pathname + target.search
  }
  return ''
}

export function linkedDepartmentChatVersions(messages = []) {
  const versions = new Map()
  for (const message of messages) {
    for (const version of message.run?.source_versions || []) {
      if (exactVersion(version)) versions.set(version.artifact_version_id, version)
    }
    const accepted = message.proposal?.accepted_version
    if (exactVersion(accepted)) versions.set(accepted.artifact_version_id, accepted)
  }
  return [...versions.values()]
}
