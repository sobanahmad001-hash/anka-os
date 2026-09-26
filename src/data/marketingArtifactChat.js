import { MARKETING_ARTIFACT_FORMS } from './marketingStudio.js'

export const MARKETING_CHAT_ARTIFACT_TYPES = Object.freeze(['channel_strategy', 'campaign_brief', 'measurement_plan'])
const definitions = Object.freeze(Object.fromEntries(MARKETING_CHAT_ARTIFACT_TYPES.map(type => [type, MARKETING_ARTIFACT_FORMS[type]])))
const relation = value => Array.isArray(value) ? value[0] : value

export function marketingArtifactChatTargets(workspace, { organizationId, projectId, engagementId, brandId, activeServiceId } = {}) {
  const engagement = workspace?.engagement
  if (!organizationId || !projectId || !engagementId || !brandId || engagement?.id !== engagementId
    || engagement.organization_id !== organizationId || engagement.project_id !== projectId || engagement.brand_id !== brandId) return null
  const scoped = row => row.organization_id === organizationId && row.engagement_id === engagementId
    && (!row.project_id || row.project_id === projectId)
  if (![workspace.marketingServices, workspace.artifacts, workspace.stages, workspace.versions].every(Array.isArray)) return null
  if (!workspace.marketingServices.some(row => scoped(row) && (!activeServiceId || row.id === activeServiceId)
    && row.status === 'active' && relation(row.service_catalog)?.department_id === 'marketing'
    && relation(row.service_catalog)?.is_active === true)) return null
  if (workspace.artifacts.some(row => !scoped(row) || !MARKETING_CHAT_ARTIFACT_TYPES.includes(row.artifact_type))
    || workspace.stages.some(row => !scoped(row))) return null
  const artifacts = new Map(workspace.artifacts.map(row => [row.id, row]))
  if (workspace.versions.some(row => row.organization_id !== organizationId || !artifacts.has(row.artifact_id))) return null
  // Do not arbitrarily update one of several campaign briefs or attach a draft to an unrelated stage.
  const targets = new Map(MARKETING_CHAT_ARTIFACT_TYPES.map(type => {
    const rows = workspace.artifacts.filter(row => row.artifact_type === type)
    return [type, rows.length === 1 ? Object.freeze({ ...rows[0] }) : null]
  }))
  return Object.freeze({
    definitions,
    artifactForType: type => targets.get(type) || null,
    stageForType: () => null,
  })
}

export async function loadMarketingArtifactChatWorkspace(client, organizationId, engagementId, { signal } = {}) {
  if (!organizationId || !engagementId) throw new TypeError('Marketing scope is required')
  const read = async query => {
    signal?.throwIfAborted()
    if (signal) query = query.abortSignal(signal)
    const { data, error, status } = await query
    if (error || status >= 400) throw Object.assign(new Error(error?.message || 'Marketing draft context is unavailable'), {
      status: error?.status ?? error?.statusCode ?? status,
    })
    signal?.throwIfAborted()
    return data
  }
  const rows = async query => {
    const result = []
    for (let offset = 0; ; offset += 500) {
      const page = await read(query.order('id').range(offset, offset + 499))
      if (!Array.isArray(page)) throw new Error('Marketing draft context is unavailable')
      result.push(...page)
      if (page.length < 500) return result
    }
  }
  const [engagement, marketingServices, artifacts, stages, versions] = await Promise.all([
    read(client.from('engagements').select('id, organization_id, project_id, brand_id').eq('organization_id', organizationId).eq('id', engagementId).single()),
    rows(client.from('engagement_services').select('id, organization_id, engagement_id, status, service_catalog!inner(department_id, is_active)').eq('organization_id', organizationId).eq('engagement_id', engagementId).eq('status', 'active').eq('service_catalog.department_id', 'marketing').eq('service_catalog.is_active', true)),
    rows(client.from('artifacts').select('id, organization_id, engagement_id, artifact_type, title').eq('organization_id', organizationId).eq('engagement_id', engagementId).in('artifact_type', MARKETING_CHAT_ARTIFACT_TYPES)),
    rows(client.from('engagement_stage_instances').select('id, organization_id, engagement_id, accountable_department_id, stage_kind, status').eq('organization_id', organizationId).eq('engagement_id', engagementId)),
    rows(client.from('artifact_versions').select('id, organization_id, artifact_id, version_number, artifacts!inner(engagement_id, artifact_type)').eq('organization_id', organizationId).eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', MARKETING_CHAT_ARTIFACT_TYPES)),
  ])
  return { engagement, marketingServices, artifacts, stages, versions }
}
