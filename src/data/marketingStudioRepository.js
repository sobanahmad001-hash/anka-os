import { supabase } from '../lib/supabase.js'

const TYPES = ['channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report']

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Marketing Studio query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('marketing-studio', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Marketing Studio function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const marketingStudio = Object.freeze({
  async listBrands() {
    return dataOrThrow(supabase.from('brands')
      .select('id, name, status')
      .order('name'))
  },

  async listBacklinkTargets(brandId) {
    return dataOrThrow(supabase.from('backlink_targets')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }))
  },

  async listEngagements() {
    const rows = await dataOrThrow(supabase.from('engagements')
      .select('id, name, brand_id, status, agency_clients(name), brands(name), engagement_services!inner(id, service_catalog!inner(name, department_id))')
      .eq('engagement_services.service_catalog.department_id', 'marketing')
      .order('updated_at', { ascending: false }))
    return rows
  },

  async load(engagementId) {
    const [engagement, campaigns, artifacts, versions, approvals] = await Promise.all([
      dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)').eq('id', engagementId).single()),
      dataOrThrow(supabase.from('marketing_campaigns').select('*').eq('engagement_id', engagementId).order('updated_at', { ascending: false })),
      dataOrThrow(supabase.from('artifacts').select('*').eq('engagement_id', engagementId).in('artifact_type', TYPES).order('created_at')),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', TYPES).order('version_number')),
      dataOrThrow(supabase.from('artifact_approvals').select('*, artifacts!inner(artifact_type)').eq('engagement_id', engagementId).in('artifacts.artifact_type', TYPES).order('approved_at')),
    ])
    const campaignIds = campaigns.map(item => item.id)
    const campaignLinks = campaignIds.length
      ? await dataOrThrow(supabase.from('marketing_campaign_artifacts').select('*').in('campaign_id', campaignIds).order('linked_at'))
      : []
    return { engagement, campaigns, artifacts, versions, approvals, links: campaignLinks }
  },

  createCampaign: (engagementId, campaign) => invoke('create_campaign', { engagement_id: engagementId, campaign }),
  updateCampaign: (campaignId, campaign) => invoke('update_campaign', { campaign_id: campaignId, campaign }),
  createBacklinkTarget: (brandId, target) => invoke('create_backlink_target', { brand_id: brandId, target }),
  updateBacklinkTarget: (targetId, target) => invoke('update_backlink_target', { target_id: targetId, target }),
  saveArtifact: input => invoke('save_artifact', input),
  approveArtifact: (artifactVersionId, notes = '') => invoke('approve_artifact', { artifact_version_id: artifactVersionId, notes }),
  analytics: (engagementId, startDate, endDate) => invoke('analytics_dashboard', {
    engagement_id: engagementId, start_date: startDate, end_date: endDate,
  }),
})
