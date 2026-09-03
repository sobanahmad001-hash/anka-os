import { supabase } from '../lib/supabase.js'

const TYPES = ['channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report']

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Marketing Studio query failed'), {
    status: error.status || error.statusCode,
  })
  return data
}

async function invoke(organizationId, action, input = {}, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke('marketing-studio', {
    body: { ...input, action, organization_id: organizationId }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Marketing Studio function failed'), {
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export function createMarketingStudioScope(organizationId, { signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({
  organizationId,
  async listBrands() {
    return dataOrThrow(supabase.from('brands')
      .select('id, organization_id, name, status')
      .eq('organization_id', organizationId)
      .order('name'), options)
  },

  async listBacklinkTargets(brandId) {
    return dataOrThrow(supabase.from('backlink_targets')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }), options)
  },

  async listEngagements() {
    const rows = await dataOrThrow(supabase.from('engagements')
      .select('id, organization_id, name, brand_id, status, agency_clients(name), brands(name), engagement_services!inner(id, service_catalog!inner(name, department_id))')
      .eq('organization_id', organizationId)
      .eq('engagement_services.service_catalog.department_id', 'marketing')
      .order('updated_at', { ascending: false }), options)
    return rows
  },

  async load(engagementId) {
    const engagement = await dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)')
      .eq('organization_id', organizationId).eq('id', engagementId).single(), options)
    const [campaigns, artifacts, versions, approvals, adCampaigns, googleAdsConnections] = await Promise.all([
      dataOrThrow(supabase.from('marketing_campaigns').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('updated_at', { ascending: false }), options),
      dataOrThrow(supabase.from('artifacts').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).in('artifact_type', TYPES).order('created_at'), options),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('organization_id', organizationId).eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', TYPES).order('version_number'), options),
      dataOrThrow(supabase.from('artifact_approvals').select('*, artifacts!inner(artifact_type)').eq('organization_id', organizationId).eq('engagement_id', engagementId).in('artifacts.artifact_type', TYPES).order('approved_at'), options),
      dataOrThrow(supabase.from('ad_campaigns').select('*').eq('organization_id', organizationId).eq('brand_id', engagement.brand_id).order('updated_at', { ascending: false }), options),
      invoke(organizationId, 'list_google_ads_connections', { engagement_id: engagementId }, options),
    ])
    const campaignIds = campaigns.map(item => item.id)
    const campaignLinks = campaignIds.length
      ? await dataOrThrow(supabase.from('marketing_campaign_artifacts').select('*').eq('organization_id', organizationId).in('campaign_id', campaignIds).order('linked_at'), options)
      : []
    const adCampaignIds = adCampaigns.map(item => item.id)
    const adGroups = adCampaignIds.length
      ? await dataOrThrow(supabase.from('ad_groups').select('*').eq('organization_id', organizationId).in('ad_campaign_id', adCampaignIds).order('updated_at', { ascending: false }), options)
      : []
    const adGroupIds = adGroups.map(item => item.id)
    const [adKeywords, adSnapshots] = await Promise.all([
      adGroupIds.length
        ? dataOrThrow(supabase.from('ad_group_keywords').select('*').eq('organization_id', organizationId).in('ad_group_id', adGroupIds).order('created_at'), options)
        : [],
      adCampaignIds.length
        ? dataOrThrow(supabase.from('ad_campaign_performance_metrics').select('*').eq('organization_id', organizationId).in('ad_campaign_id', adCampaignIds).order('snapshot_date'), options)
        : [],
    ])
    return {
      engagement, campaigns, artifacts, versions, approvals, links: campaignLinks,
      adCampaigns, adGroups, adKeywords, adSnapshots, googleAdsConnections: googleAdsConnections || [],
    }
  },

  createCampaign: (engagementId, campaign) => invoke(organizationId, 'create_campaign', { engagement_id: engagementId, campaign }, options),
  updateCampaign: (campaignId, campaign) => invoke(organizationId, 'update_campaign', { campaign_id: campaignId, campaign }, options),
  createBacklinkTarget: (brandId, target) => invoke(organizationId, 'create_backlink_target', { brand_id: brandId, target }, options),
  updateBacklinkTarget: (targetId, target) => invoke(organizationId, 'update_backlink_target', { target_id: targetId, target }, options),
  createAdCampaign: (engagementId, campaign) => invoke(organizationId, 'create_ad_campaign', { engagement_id: engagementId, campaign }, options),
  updateAdCampaign: (engagementId, adCampaignId, campaign) => invoke(organizationId, 'update_ad_campaign', { engagement_id: engagementId, ad_campaign_id: adCampaignId, campaign }, options),
  deleteAdCampaign: (engagementId, adCampaignId) => invoke(organizationId, 'delete_ad_campaign', { engagement_id: engagementId, ad_campaign_id: adCampaignId }, options),
  saveAdGroup: (engagementId, adCampaignId, adGroupId, adGroup) => invoke(organizationId, 'save_ad_group', { engagement_id: engagementId, ad_campaign_id: adCampaignId, ad_group_id: adGroupId, ad_group: adGroup }, options),
  deleteAdGroup: (engagementId, adGroupId) => invoke(organizationId, 'delete_ad_group', { engagement_id: engagementId, ad_group_id: adGroupId }, options),
  saveAdKeyword: (engagementId, adGroupId, keywordId, keyword) => invoke(organizationId, 'save_ad_keyword', { engagement_id: engagementId, ad_group_id: adGroupId, keyword_id: keywordId, keyword }, options),
  deleteAdKeyword: (engagementId, keywordId) => invoke(organizationId, 'delete_ad_keyword', { engagement_id: engagementId, keyword_id: keywordId }, options),
  importAdPerformance: (engagementId, adCampaignId, snapshotDate) => invoke(organizationId, 'import_ad_campaign_performance', { engagement_id: engagementId, ad_campaign_id: adCampaignId, snapshot_date: snapshotDate }, options),
  saveArtifact: input => invoke(organizationId, 'save_artifact', input, options),
  proposeArtifact: input => {
    const { engagement_stage_instance_id: _ignoredStage, ...body } = input
    return supabase.functions.invoke('department-chat', { body: { ...body, action: 'propose_artifact', organization_id: organizationId, department_id: 'marketing' }, signal })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message || 'Department Chat function failed')
        if (data?.error) throw new Error(data.error)
        return data?.data
      })
  },
  proposeWorkItem: input => {
    const { engagement_stage_instance_id: _ignoredStage, ...body } = input
    return supabase.functions.invoke('department-chat', { body: { ...body, action: 'propose_work_item', organization_id: organizationId, department_id: 'marketing' }, signal })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message || 'Department Chat function failed')
        if (data?.error) throw new Error(data.error)
        return data?.data
      })
  },
  approveArtifact: (artifactVersionId, notes = '') => invoke(organizationId, 'approve_artifact', { artifact_version_id: artifactVersionId, notes }, options),
  analytics: (engagementId, startDate, endDate) => invoke(organizationId, 'analytics_dashboard', {
    engagement_id: engagementId, start_date: startDate, end_date: endDate,
  }, options),
  })
}

export const marketingStudio = Object.freeze({
  forOrganization: createMarketingStudioScope,
})
