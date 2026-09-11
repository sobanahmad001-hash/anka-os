import { supabase } from '../lib/supabase.js'
import { validateCampaignPlanSnapshot } from './marketingCampaignPlan.js'

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const response = await query
  if (response.error || Number(response.status) >= 400) throw campaignPlanError(response, 'Campaign plan query failed')
  return response.data || []
}

function campaignPlanError(response, fallback) {
  const error = response?.error
  const status = response?.status ?? error?.status ?? error?.statusCode ?? error?.context?.status
  const detail = response?.data?.error
  return Object.assign(new Error(typeof detail === 'string' ? detail : error?.message || fallback), {
    status: status == null ? undefined : Number(status),
    cause: error,
    code: error?.code,
    response,
  })
}

export function createMarketingCampaignPlanRepository(organizationId, { client = supabase, signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  return Object.freeze({
    async load(engagementId, campaignId) {
      const versions = await dataOrThrow(client.from('marketing_campaign_plan_versions').select('*')
        .eq('organization_id', organizationId).eq('engagement_id', engagementId).eq('campaign_id', campaignId)
        .order('version_number', { ascending: false }), signal)
      const requirements = versions.length ? await dataOrThrow(client.from('marketing_campaign_plan_creative_requirements').select('*')
        .eq('organization_id', organizationId).in('plan_version_id', versions.map(item => item.id)).order('position'), signal) : []
      const artifacts = await dataOrThrow(client.from('artifacts').select('id, organization_id, engagement_id, artifact_type, title')
        .eq('organization_id', organizationId).eq('engagement_id', engagementId)
        .in('artifact_type', ['campaign_messaging', 'scripts', 'measurement_plan']), signal)
      const artifactIds = artifacts.map(item => item.id)
      const sourceVersions = artifactIds.length ? await dataOrThrow(client.from('artifact_versions').select('id, organization_id, artifact_id, version_number')
        .eq('organization_id', organizationId).in('artifact_id', artifactIds).order('version_number', { ascending: false }), signal) : []
      const approvals = sourceVersions.length ? await dataOrThrow(client.from('artifact_approvals').select('artifact_version_id')
        .eq('organization_id', organizationId).in('artifact_version_id', sourceVersions.map(item => item.id)), signal) : []
      return validateCampaignPlanSnapshot(
        { versions, requirements, artifacts, sourceVersions, approvals },
        { organizationId, engagementId, campaignId },
      )
    },
    async saveDraft(input) {
      const response = await client.functions.invoke('marketing-studio', {
        body: { ...input, action: 'save_campaign_plan', organization_id: organizationId }, signal,
      })
      if (response.error || response.data?.error || Number(response.status) >= 400) throw campaignPlanError(response, 'Campaign plan save failed')
      return response.data?.data
    },
  })
}
