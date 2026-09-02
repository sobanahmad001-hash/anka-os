function numeric(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function latestBy(rows, key) {
  const result = new Map()
  for (const row of [...rows].sort((left, right) => String(left.snapshot_date).localeCompare(String(right.snapshot_date)))) {
    result.set(row[key], row)
  }
  return result
}

function trend(rows, fields) {
  const dates = new Map()
  for (const row of rows) {
    const date = String(row.snapshot_date || row.date || '')
    if (!date) continue
    const point = dates.get(date) || { date }
    for (const field of fields) point[field] = numeric(point[field]) + numeric(row[field])
    dates.set(date, point)
  }
  return [...dates.values()].sort((left, right) => left.date.localeCompare(right.date))
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + numeric(row[field]), 0)
}

function scoped(rows, organizationId) {
  return (rows || []).filter(row => row.organization_id === organizationId)
}

export function buildPerformanceDashboard({
  brand,
  period,
  googleDashboard,
  pageHealth = [],
  trackedKeywords = [],
  rankSnapshots = [],
  adCampaigns = [],
  adSnapshots = [],
  metaConnections = [],
  metaSnapshots = [],
}) {
  const organizationId = brand.organization_id
  const pages = scoped(pageHealth, organizationId).filter(row => row.brand_id === brand.id)
  const keywords = scoped(trackedKeywords, organizationId).filter(row => row.brand_id === brand.id && row.active !== false)
  const keywordIds = new Set(keywords.map(row => row.id))
  const ranks = scoped(rankSnapshots, organizationId).filter(row => keywordIds.has(row.tracked_keyword_id))
  const campaigns = scoped(adCampaigns, organizationId).filter(row => row.brand_id === brand.id)
  const campaignIds = new Set(campaigns.map(row => row.id))
  const paidRows = scoped(adSnapshots, organizationId).filter(row => campaignIds.has(row.ad_campaign_id))
  const meta = scoped(metaConnections, organizationId).filter(row => row.brand_id === brand.id)
  const metaIds = new Set(meta.map(row => row.id))
  const socialRows = scoped(metaSnapshots, organizationId).filter(row => metaIds.has(row.meta_connection_id))

  const googleIsForBrand = googleDashboard?.brand_id === brand.id
  const reports = googleIsForBrand ? (googleDashboard.reports || []) : []
  const gscReports = reports.filter(report => report.provider === 'google_search_console' && !report.error)
  const ga4Reports = reports.filter(report => report.provider === 'google_analytics' && !report.error)
  const gscRows = gscReports.flatMap(report => report.rows || [])
  const latestRanks = [...latestBy(ranks, 'tracked_keyword_id').values()]
  const knownPositions = latestRanks
    .filter(row => row.position !== null && row.position !== undefined)
    .map(row => Number(row.position)).filter(Number.isFinite)
  const firstRanks = new Map()
  for (const row of [...ranks].sort((left, right) => String(left.snapshot_date).localeCompare(String(right.snapshot_date)))) {
    if (!firstRanks.has(row.tracked_keyword_id)) firstRanks.set(row.tracked_keyword_id, row)
  }
  const improved = latestRanks.filter(row => {
    const firstValue = firstRanks.get(row.tracked_keyword_id)?.position
    if (firstValue === null || firstValue === undefined || row.position === null || row.position === undefined) return false
    const first = Number(firstValue)
    const latest = Number(row.position)
    return Number.isFinite(first) && Number.isFinite(latest) && latest < first
  }).length

  const pagesWithIssues = pages.filter(row => numeric(row.open_issue_count) > 0)
  const needsAttention = pages.filter(row => row.needs_attention === true)
  const paidImpressions = sum(paidRows, 'impressions')
  const paidClicks = sum(paidRows, 'clicks')
  const socialImpressions = sum(socialRows, 'impressions')
  const socialEngagement = sum(socialRows, 'engagement')

  return {
    brand: { id: brand.id, name: brand.name, organization_id: organizationId },
    period,
    organic: {
      available: gscReports.length > 0 || ga4Reports.length > 0 || keywords.length > 0,
      gsc: {
        connected: gscReports.length > 0,
        clicks: gscReports.reduce((total, report) => total + numeric(report.totals?.clicks), 0),
        impressions: gscReports.reduce((total, report) => total + numeric(report.totals?.impressions), 0),
        trend: trend(gscRows, ['clicks', 'impressions']),
      },
      ga4: {
        connected: ga4Reports.length > 0,
        active_users: ga4Reports.reduce((total, report) => total + numeric(report.totals?.active_users), 0),
        sessions: ga4Reports.reduce((total, report) => total + numeric(report.totals?.sessions), 0),
        events: ga4Reports.reduce((total, report) => total + numeric(report.totals?.events), 0),
      },
      keywords: {
        tracked: keywords.length,
        ranked: knownPositions.length,
        no_rank_data: keywords.length - knownPositions.length,
        top_3: knownPositions.filter(position => position <= 3).length,
        top_10: knownPositions.filter(position => position <= 10).length,
        top_20: knownPositions.filter(position => position <= 20).length,
        average_position: average(knownPositions),
        improved,
      },
    },
    technical: {
      available: pages.length > 0,
      tracked_pages: pages.length,
      pages_with_open_issues: pagesWithIssues.length,
      open_issues: sum(pages, 'open_issue_count'),
      needs_attention: needsAttention.length,
      pages: needsAttention.map(row => ({
        id: row.tracked_page_id,
        page_url: row.page_url,
        open_issue_count: numeric(row.open_issue_count),
        index_status: row.index_status,
        schema_valid: row.schema_valid,
      })),
    },
    paid: {
      available: campaigns.length > 0,
      campaigns: campaigns.length,
      active_campaigns: campaigns.filter(row => row.status === 'active').length,
      spend: sum(paidRows, 'cost'),
      impressions: paidImpressions,
      clicks: paidClicks,
      conversions: sum(paidRows, 'conversions'),
      ctr: paidImpressions ? paidClicks / paidImpressions : null,
      trend: trend(paidRows, ['cost', 'conversions']),
    },
    social: {
      available: meta.length > 0,
      connections: meta.length,
      platforms: [...new Set(socialRows.map(row => row.platform))].sort(),
      reach: sum(socialRows, 'reach'),
      impressions: socialImpressions,
      engagement: socialEngagement,
      engagement_rate: socialImpressions ? socialEngagement / socialImpressions : null,
      trend: trend(socialRows, ['reach', 'engagement']),
    },
    source_errors: reports.filter(report => report.error).map(report => ({
      provider: report.provider,
      connection_name: report.connection_name,
      error: report.error,
    })),
  }
}
