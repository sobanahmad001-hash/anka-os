import { supabase } from '../lib/supabase.js'
import { buildPerformanceDashboard } from './performanceDashboard.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Performance dashboard query failed')
  return data || []
}

async function invokeAnalytics(engagementId, period) {
  const { data, error } = await supabase.functions.invoke('marketing-studio', {
    body: {
      action: 'analytics_dashboard', engagement_id: engagementId,
      start_date: period.start, end_date: period.end,
      providers: ['google_analytics', 'google_search_console'],
    },
  })
  if (error) throw new Error(error.message || 'Live Google reporting failed')
  if (data?.error) throw new Error(data.error)
  return data?.data || { reports: [] }
}

async function rowsForParents(table, columns, parentColumn, parentIds, period) {
  if (!parentIds.length) return []
  return dataOrThrow(supabase.from(table).select(columns)
    .in(parentColumn, parentIds)
    .gte('snapshot_date', period.start)
    .lte('snapshot_date', period.end)
    .order('snapshot_date'))
}

export async function loadPerformanceDashboard({ engagementId, brand, period }) {
  const [googleDashboard, pageHealth, trackedKeywords, adCampaigns, metaConnections] = await Promise.all([
    invokeAnalytics(engagementId, period),
    dataOrThrow(supabase.from('tracked_page_current_health')
      .select('tracked_page_id, organization_id, brand_id, page_url, audit_date, index_status, schema_valid, open_issue_count, needs_attention')
      .eq('brand_id', brand.id)
      .order('page_url')),
    dataOrThrow(supabase.from('tracked_keywords')
      .select('id, organization_id, brand_id, tracked_page_id, keyword, target_rank_tier, active')
      .eq('brand_id', brand.id)
      .eq('active', true)
      .order('keyword')),
    dataOrThrow(supabase.from('ad_campaigns')
      .select('id, organization_id, brand_id, campaign_name, status')
      .eq('brand_id', brand.id)
      .order('campaign_name')),
    dataOrThrow(supabase.from('meta_connections')
      .select('id, organization_id, brand_id, facebook_page_id, instagram_account_id')
      .eq('brand_id', brand.id)),
  ])

  const [rankSnapshots, adSnapshots, metaSnapshots] = await Promise.all([
    rowsForParents(
      'keyword_rank_snapshots',
      'id, organization_id, tracked_keyword_id, snapshot_date, position, search_console_clicks, search_console_impressions',
      'tracked_keyword_id', trackedKeywords.map(row => row.id), period,
    ),
    rowsForParents(
      'ad_campaign_performance_snapshots',
      'id, organization_id, ad_campaign_id, snapshot_date, impressions, clicks, cost, conversions',
      'ad_campaign_id', adCampaigns.map(row => row.id), period,
    ),
    rowsForParents(
      'meta_performance_snapshots',
      'id, organization_id, meta_connection_id, snapshot_date, platform, reach, impressions, engagement',
      'meta_connection_id', metaConnections.map(row => row.id), period,
    ),
  ])

  return buildPerformanceDashboard({
    brand, period, googleDashboard, pageHealth, trackedKeywords, rankSnapshots,
    adCampaigns, adSnapshots, metaConnections, metaSnapshots,
  })
}
