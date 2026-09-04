import { supabase } from '../lib/supabase.js'
import { buildPerformanceDashboard, collectPaginatedRows } from './performanceDashboard.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Performance dashboard query failed'), {
    status: error.status || error.statusCode,
  })
  return data || []
}

async function paginatedRows(queryForPage, options) {
  return collectPaginatedRows((from, to) => dataOrThrow(queryForPage().range(from, to), options))
}

async function invokeAnalytics(organizationId, engagementId, period, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke('marketing-studio', {
    body: {
      action: 'analytics_dashboard', organization_id: organizationId, engagement_id: engagementId,
      start_date: period.start, end_date: period.end,
      providers: ['google_analytics', 'google_search_console'],
    }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Live Google reporting failed'), {
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data || { reports: [] }
}

async function rowsForParents(table, columns, parentColumn, parentIds, period, organizationId, options) {
  if (!parentIds.length) return []
  return paginatedRows(() => supabase.from(table).select(columns)
    .eq('organization_id', organizationId)
    .in(parentColumn, parentIds)
    .gte('snapshot_date', period.start)
    .lte('snapshot_date', period.end)
    .order('snapshot_date')
    .order('id'), options)
}

export async function loadPerformanceDashboard({ organizationId, engagementId, brand, period, signal }) {
  if (!organizationId) throw new TypeError('Active organization is required')
  if (brand.organization_id !== organizationId) {
    throw Object.assign(new Error('Dashboard brand does not belong to the active organization'), { status: 403, membershipMismatch: true })
  }
  const options = { signal }
  const [googleDashboard, pageHealth, trackedKeywords, adCampaigns, metaConnections] = await Promise.all([
    invokeAnalytics(organizationId, engagementId, period, options),
    paginatedRows(() => supabase.from('tracked_page_current_health')
      .select('tracked_page_id, organization_id, brand_id, page_url, audit_date, index_status, schema_valid, open_issue_count, needs_attention')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .order('page_url')
      .order('tracked_page_id'), options),
    paginatedRows(() => supabase.from('tracked_keywords')
      .select('id, organization_id, brand_id, tracked_page_id, keyword, target_rank_tier, active')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .eq('active', true)
      .order('keyword')
      .order('id'), options),
    paginatedRows(() => supabase.from('ad_campaigns')
      .select('id, organization_id, brand_id, campaign_name, status')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .order('campaign_name')
      .order('id'), options),
    paginatedRows(() => supabase.from('meta_connections')
      .select('id, organization_id, brand_id, facebook_page_id, instagram_account_id')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .order('id'), options),
  ])

  const [rankSnapshots, adSnapshots, metaSnapshots] = await Promise.all([
    rowsForParents(
      'keyword_rank_snapshots',
      'id, organization_id, tracked_keyword_id, snapshot_date, position, search_console_clicks, search_console_impressions',
      'tracked_keyword_id', trackedKeywords.map(row => row.id), period, organizationId, options,
    ),
    rowsForParents(
      'ad_campaign_performance_snapshots',
      'id, organization_id, ad_campaign_id, snapshot_date, impressions, clicks, cost, conversions',
      'ad_campaign_id', adCampaigns.map(row => row.id), period, organizationId, options,
    ),
    rowsForParents(
      'meta_performance_snapshots',
      'id, organization_id, meta_connection_id, snapshot_date, platform, reach, impressions, engagement',
      'meta_connection_id', metaConnections.map(row => row.id), period, organizationId, options,
    ),
  ])

  return buildPerformanceDashboard({
    brand, period, googleDashboard, pageHealth, trackedKeywords, rankSnapshots,
    adCampaigns, adSnapshots, metaConnections, metaSnapshots,
  })
}
