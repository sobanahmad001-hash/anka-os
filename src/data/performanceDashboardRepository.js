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

async function invokeAnalytics(client, organizationId, engagementId, period, { signal } = {}) {
  const { data, error } = await client.functions.invoke('marketing-studio', {
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

async function rowsForParents(client, table, columns, parentColumn, parentIds, period, organizationId, options) {
  if (!parentIds.length) return []
  return paginatedRows(() => client.from(table).select(columns)
    .eq('organization_id', organizationId)
    .in(parentColumn, parentIds)
    .gte('snapshot_date', period.start)
    .lte('snapshot_date', period.end)
    .order('snapshot_date')
    .order('id'), options)
}

function requireAnalyticsEnvelope(googleDashboard, engagementId, brandId) {
  if (!googleDashboard?.engagement_id || !googleDashboard?.brand_id) {
    throw Object.assign(new Error('Live Google reporting returned an incomplete context envelope'), { status: 502 })
  }
  if (googleDashboard.engagement_id !== engagementId || googleDashboard.brand_id !== brandId) {
    throw Object.assign(new Error('Live Google reporting context does not match the requested Marketing workspace'), {
      status: 403,
      membershipMismatch: true,
    })
  }
  return googleDashboard
}

async function loadStoredPerformanceSources(client, { organizationId, brand, period, signal }) {
  const options = { signal }
  const [pageHealth, trackedKeywords, adCampaigns, metaConnections] = await Promise.all([
    paginatedRows(() => client.from('tracked_page_current_health')
      .select('tracked_page_id, organization_id, brand_id, page_url, audit_date, index_status, schema_valid, open_issue_count, needs_attention')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .order('page_url')
      .order('tracked_page_id'), options),
    paginatedRows(() => client.from('tracked_keywords')
      .select('id, organization_id, brand_id, tracked_page_id, keyword, target_rank_tier, active')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .eq('active', true)
      .order('keyword')
      .order('id'), options),
    paginatedRows(() => client.from('ad_campaigns')
      .select('id, organization_id, brand_id, provider_connection_id, external_account_id, campaign_name, status')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .order('campaign_name')
      .order('id'), options),
    paginatedRows(() => client.from('meta_connections')
      .select('id, organization_id, integration_connection_id, brand_id, facebook_page_id, instagram_account_id')
      .eq('organization_id', organizationId)
      .eq('brand_id', brand.id)
      .order('id'), options),
  ])

  const [rankSnapshots, adSnapshots, metaSnapshots] = await Promise.all([
    rowsForParents(
      client,
      'keyword_rank_snapshots',
      'id, organization_id, tracked_keyword_id, snapshot_date, position, search_console_clicks, search_console_impressions, fetched_at',
      'tracked_keyword_id', trackedKeywords.map(row => row.id), period, organizationId, options,
    ),
    rowsForParents(
      client,
      'ad_campaign_performance_snapshots',
      'id, organization_id, ad_campaign_id, snapshot_date, impressions, clicks, cost, conversions, provider_connection_id, external_campaign_id, created_at',
      'ad_campaign_id', adCampaigns.map(row => row.id), period, organizationId, options,
    ),
    rowsForParents(
      client,
      'meta_performance_snapshots',
      'id, organization_id, meta_connection_id, snapshot_date, platform, reach, impressions, engagement, created_at',
      'meta_connection_id', metaConnections.map(row => row.id), period, organizationId, options,
    ),
  ])
  return { pageHealth, trackedKeywords, adCampaigns, metaConnections, rankSnapshots, adSnapshots, metaSnapshots }
}

export async function loadPerformanceDashboard(
  { organizationId, engagementId, brand, period, signal },
  dependencies = {},
) {
  if (!organizationId) throw new TypeError('Active organization is required')
  if (brand.organization_id !== organizationId) {
    throw Object.assign(new Error('Dashboard brand does not belong to the active organization'), { status: 403, membershipMismatch: true })
  }
  const options = { signal }
  let client = dependencies.client
  if ((!dependencies.analyticsInvoker || !dependencies.storedSourceLoader) && !client) {
    client = (await import('../lib/supabase.js')).supabase
  }
  const analyticsInvoker = dependencies.analyticsInvoker ||
    ((...args) => invokeAnalytics(client, ...args))
  const storedSourceLoader = dependencies.storedSourceLoader ||
    (input => loadStoredPerformanceSources(client, input))
  const [edgeDashboard, storedSources] = await Promise.all([
    analyticsInvoker(organizationId, engagementId, period, options),
    storedSourceLoader({ organizationId, brand, period, signal }),
  ])
  const googleDashboard = requireAnalyticsEnvelope(edgeDashboard, engagementId, brand.id)

  return buildPerformanceDashboard({
    brand, period, googleDashboard, ...storedSources,
  })
}
