import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Campaign plan query failed')
  return data || []
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
      return { versions, requirements, artifacts, sourceVersions, approvals }
    },
    async saveDraft(input) {
      const { data, error } = await client.functions.invoke('marketing-studio', {
        body: { ...input, action: 'save_campaign_plan', organization_id: organizationId }, signal,
      })
      if (error) throw new Error(error.message || 'Campaign plan save failed')
      if (data?.error) throw new Error(data.error)
      return data?.data
    },
  })
}
