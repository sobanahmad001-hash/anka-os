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
    const engagement = await dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)').eq('id', engagementId).single())
    const [campaigns, artifacts, versions, approvals, adCampaigns, googleAdsConnections] = await Promise.all([
      dataOrThrow(supabase.from('marketing_campaigns').select('*').eq('engagement_id', engagementId).order('updated_at', { ascending: false })),
      dataOrThrow(supabase.from('artifacts').select('*').eq('engagement_id', engagementId).in('artifact_type', TYPES).order('created_at')),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', TYPES).order('version_number')),
      dataOrThrow(supabase.from('artifact_approvals').select('*, artifacts!inner(artifact_type)').eq('engagement_id', engagementId).in('artifacts.artifact_type', TYPES).order('approved_at')),
      dataOrThrow(supabase.from('ad_campaigns').select('*').eq('brand_id', engagement.brand_id).order('updated_at', { ascending: false })),
      invoke('list_google_ads_connections', { engagement_id: engagementId }),
    ])
    const campaignIds = campaigns.map(item => item.id)
    const campaignLinks = campaignIds.length
      ? await dataOrThrow(supabase.from('marketing_campaign_artifacts').select('*').in('campaign_id', campaignIds).order('linked_at'))
      : []
    const adCampaignIds = adCampaigns.map(item => item.id)
    const adGroups = adCampaignIds.length
      ? await dataOrThrow(supabase.from('ad_groups').select('*').in('ad_campaign_id', adCampaignIds).order('updated_at', { ascending: false }))
      : []
    const adGroupIds = adGroups.map(item => item.id)
    const [adKeywords, adSnapshots] = await Promise.all([
      adGroupIds.length
        ? dataOrThrow(supabase.from('ad_group_keywords').select('*').in('ad_group_id', adGroupIds).order('created_at'))
        : [],
      adCampaignIds.length
        ? dataOrThrow(supabase.from('ad_campaign_performance_metrics').select('*').in('ad_campaign_id', adCampaignIds).order('snapshot_date'))
        : [],
    ])
    return {
      engagement, campaigns, artifacts, versions, approvals, links: campaignLinks,
      adCampaigns, adGroups, adKeywords, adSnapshots, googleAdsConnections: googleAdsConnections || [],
    }
  },

  createCampaign: (engagementId, campaign) => invoke('create_campaign', { engagement_id: engagementId, campaign }),
  updateCampaign: (campaignId, campaign) => invoke('update_campaign', { campaign_id: campaignId, campaign }),
  createBacklinkTarget: (brandId, target) => invoke('create_backlink_target', { brand_id: brandId, target }),
  updateBacklinkTarget: (targetId, target) => invoke('update_backlink_target', { target_id: targetId, target }),
  createAdCampaign: (engagementId, campaign) => invoke('create_ad_campaign', { engagement_id: engagementId, campaign }),
  updateAdCampaign: (engagementId, adCampaignId, campaign) => invoke('update_ad_campaign', { engagement_id: engagementId, ad_campaign_id: adCampaignId, campaign }),
  deleteAdCampaign: (engagementId, adCampaignId) => invoke('delete_ad_campaign', { engagement_id: engagementId, ad_campaign_id: adCampaignId }),
  saveAdGroup: (engagementId, adCampaignId, adGroupId, adGroup) => invoke('save_ad_group', { engagement_id: engagementId, ad_campaign_id: adCampaignId, ad_group_id: adGroupId, ad_group: adGroup }),
  deleteAdGroup: (engagementId, adGroupId) => invoke('delete_ad_group', { engagement_id: engagementId, ad_group_id: adGroupId }),
  saveAdKeyword: (engagementId, adGroupId, keywordId, keyword) => invoke('save_ad_keyword', { engagement_id: engagementId, ad_group_id: adGroupId, keyword_id: keywordId, keyword }),
  deleteAdKeyword: (engagementId, keywordId) => invoke('delete_ad_keyword', { engagement_id: engagementId, keyword_id: keywordId }),
  importAdPerformance: (engagementId, adCampaignId, snapshotDate) => invoke('import_ad_campaign_performance', { engagement_id: engagementId, ad_campaign_id: adCampaignId, snapshot_date: snapshotDate }),
  saveArtifact: input => invoke('save_artifact', input),
  proposeArtifact: input => {
    const { engagement_stage_instance_id: _ignoredStage, ...body } = input
    return supabase.functions.invoke('department-chat', { body: { action: 'propose_artifact', department_id: 'marketing', ...body } })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message || 'Department Chat function failed')
        if (data?.error) throw new Error(data.error)
        return data?.data
      })
  },
  proposeWorkItem: input => {
    const { engagement_stage_instance_id: _ignoredStage, ...body } = input
    return supabase.functions.invoke('department-chat', { body: { action: 'propose_work_item', department_id: 'marketing', ...body } })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message || 'Department Chat function failed')
        if (data?.error) throw new Error(data.error)
        return data?.data
      })
  },
  approveArtifact: (artifactVersionId, notes = '') => invoke('approve_artifact', { artifact_version_id: artifactVersionId, notes }),
  analytics: (engagementId, startDate, endDate) => invoke('analytics_dashboard', {
    engagement_id: engagementId, start_date: startDate, end_date: endDate,
  }),
})
