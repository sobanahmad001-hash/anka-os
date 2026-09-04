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

function latestValue(rows, field) {
  return rows.map(row => String(row[field] || '')).filter(Boolean).sort().at(-1) || null
}

export function collectionAgeState(retrievedAt, now = new Date(), thresholdHours = 24) {
  const retrieved = retrievedAt ? new Date(retrievedAt) : null
  const current = now instanceof Date ? now : new Date(now)
  if (!retrieved || !Number.isFinite(retrieved.getTime()) || !Number.isFinite(current.getTime())) {
    return { status: 'unknown', age_hours: null, threshold_hours: thresholdHours }
  }
  const ageHours = Math.max(0, (current.getTime() - retrieved.getTime()) / 3_600_000)
  return { status: ageHours > thresholdHours ? 'stale' : 'current', age_hours: ageHours, threshold_hours: thresholdHours }
}

function sourceAccount({
  id, provider, connectionId = null, accountId = null, accountLabel, brand, period,
  reportingTimezone = null, retrievedAt = null, dataThrough = null,
  currencyCode = null, metrics = [], trend: sourceTrend = null,
  notes = [], error = null, now, thresholdHours,
}) {
  return {
    id, provider, connectionId,
    accountId, accountLabel,
    brandId: brand.id, organizationId: brand.organization_id,
    periodStart: period.start, periodEnd: period.end,
    reportingTimezone, retrievedAt,
    dataThrough, currencyCode,
    freshness: collectionAgeState(retrievedAt, now, thresholdHours),
    metrics, trend: sourceTrend, notes, error, available: !error && metrics.length > 0,
  }
}

function googleSource(report, brand, period, now, thresholdHours) {
  const common = {
    id: `${report.provider}:${report.connection_id || report.connection_name || 'unmapped'}`,
    provider: report.provider, connectionId: report.connection_id || null,
    accountId: report.account_id || null,
    accountLabel: report.connection_name || report.account_id || 'Unnamed connection',
    brand, period, reportingTimezone: report.reporting_timezone || null,
    retrievedAt: report.retrieved_at || null,
    dataThrough: report.data_through || latestValue(report.rows || [], 'date'),
    currencyCode: report.currency_code || null,
    notes: report.notes || [], error: report.error || null, now, thresholdHours,
  }
  if (report.provider === 'google_analytics') return sourceAccount({ ...common, metrics: [
    { key: 'active_users', label: 'Active users', value: report.totals?.active_users ?? null, unit: 'number' },
    { key: 'sessions', label: 'Sessions', value: report.totals?.sessions ?? null, unit: 'number' },
    { key: 'events', label: 'Events', value: report.totals?.events ?? null, unit: 'number' },
  ], trend: { points: report.rows || [], series: [['active_users', 'Active users', '#34d399'], ['sessions', 'Sessions', '#38bdf8']] } })
  return sourceAccount({ ...common, metrics: [
    { key: 'clicks', label: 'Clicks', value: report.totals?.clicks ?? null, unit: 'number' },
    { key: 'impressions', label: 'Impressions', value: report.totals?.impressions ?? null, unit: 'number' },
  ], trend: { points: report.rows || [], series: [['clicks', 'Clicks', '#34d399'], ['impressions', 'Impressions', '#38bdf8']] } })
}

export function shouldApplyDashboardResponse(response, request, activeGeneration, activeScopeRevision = request.scopeRevision) {
  return request.generation === activeGeneration &&
    request.scopeRevision === activeScopeRevision &&
    response?.brand?.id === request.brandId &&
    response?.brand?.organization_id === request.organizationId
}

export async function collectPaginatedRows(fetchPage, pageSize = 500) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
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
  now = new Date(),
  staleThresholdHours = 24,
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

  const sources = reports
    .filter(report => ['google_analytics', 'google_search_console'].includes(report.provider))
    .map(report => googleSource(report, brand, period, now, staleThresholdHours))

  if (pages.length) sources.push(sourceAccount({
    id: `technical_seo:${brand.id}`, provider: 'technical_seo', accountId: brand.id,
    accountLabel: `${brand.name} tracked pages`, brand, period,
    dataThrough: latestValue(pages, 'audit_date'), now, thresholdHours: staleThresholdHours,
    metrics: [
      { key: 'tracked_pages', label: 'Tracked pages', value: pages.length, unit: 'number' },
      { key: 'pages_with_open_issues', label: 'Pages with open issues', value: pagesWithIssues.length, unit: 'number' },
      { key: 'open_issues', label: 'Open issues', value: sum(pages, 'open_issue_count'), unit: 'number' },
      { key: 'needs_attention', label: 'Need attention', value: needsAttention.length, unit: 'number' },
    ], notes: ['Retrieval time and reporting timezone are unavailable for this stored technical-health view.'],
  }))

  if (keywords.length) sources.push(sourceAccount({
    id: `keyword_tracking:${brand.id}`, provider: 'keyword_tracking', accountId: brand.id,
    accountLabel: `${brand.name} tracked keywords`, brand, period,
    retrievedAt: latestValue(ranks, 'fetched_at'), dataThrough: latestValue(ranks, 'snapshot_date'),
    now, thresholdHours: staleThresholdHours,
    metrics: [
      { key: 'tracked', label: 'Tracked keywords', value: keywords.length, unit: 'number' },
      { key: 'ranked', label: 'Ranked', value: knownPositions.length, unit: 'number' },
      { key: 'top_10', label: 'Top 10', value: knownPositions.filter(position => position <= 10).length, unit: 'number' },
      { key: 'average_position', label: 'Average position', value: average(knownPositions), unit: 'number' },
    ], notes: ['Search engine, device, and reporting timezone are unavailable in the current stored tracking scope.'],
  }))

  const paidAccounts = new Map()
  for (const campaign of campaigns.filter(item => item.provider_connection_id && item.external_account_id)) {
    const key = `${campaign.provider_connection_id}:${campaign.external_account_id}`
    const account = paidAccounts.get(key) || { campaigns: [], rows: [] }
    account.campaigns.push(campaign)
    account.rows.push(...paidRows.filter(row => row.ad_campaign_id === campaign.id))
    paidAccounts.set(key, account)
  }
  for (const [key, account] of paidAccounts) {
    const [connectionId, accountId] = key.split(':')
    const impressions = sum(account.rows, 'impressions')
    const clicks = sum(account.rows, 'clicks')
    sources.push(sourceAccount({
      id: `google_ads:${connectionId}:${accountId}`, provider: 'google_ads', connectionId, accountId,
      accountLabel: `Google Ads ${accountId}`, brand, period,
      retrievedAt: latestValue(account.rows, 'created_at'), dataThrough: latestValue(account.rows, 'snapshot_date'),
      now, thresholdHours: staleThresholdHours,
      metrics: account.rows.length ? [
        { key: 'spend', label: 'Spend', value: sum(account.rows, 'cost'), unit: 'currency' },
        { key: 'impressions', label: 'Impressions', value: impressions, unit: 'number' },
        { key: 'clicks', label: 'Clicks', value: clicks, unit: 'number' },
        { key: 'conversions', label: 'Conversions', value: sum(account.rows, 'conversions'), unit: 'number' },
        { key: 'ctr', label: 'CTR', value: impressions ? clicks / impressions : null, unit: 'percent' },
      ] : [],
      trend: account.rows.length ? { points: trend(account.rows, ['cost', 'conversions']), series: [['cost', 'Spend', '#fbbf24'], ['conversions', 'Conversions', '#a78bfa']] } : null,
      notes: [
        'Currency and reporting timezone are unavailable in the current stored Google Ads snapshot contract.',
        ...(account.rows.length ? [] : [`${account.campaigns.length} linked campaign${account.campaigns.length === 1 ? '' : 's'}; no dated measurements are available.`]),
      ],
    }))
  }

  for (const connection of meta) {
    const rows = socialRows.filter(row => row.meta_connection_id === connection.id)
    const impressions = sum(rows, 'impressions')
    const engagement = sum(rows, 'engagement')
    sources.push(sourceAccount({
      id: `meta:${connection.id}`, provider: 'meta',
      connectionId: connection.integration_connection_id || connection.id,
      accountId: connection.instagram_account_id || connection.facebook_page_id || null,
      accountLabel: connection.instagram_account_id
        ? `Instagram ${connection.instagram_account_id}`
        : connection.facebook_page_id ? `Facebook ${connection.facebook_page_id}` : `Meta connection ${connection.id}`,
      brand, period, retrievedAt: latestValue(rows, 'created_at'), dataThrough: latestValue(rows, 'snapshot_date'),
      now, thresholdHours: staleThresholdHours,
      metrics: rows.length ? [
        { key: 'reach', label: 'Reach', value: sum(rows, 'reach'), unit: 'number' },
        { key: 'impressions', label: 'Impressions', value: impressions, unit: 'number' },
        { key: 'engagement', label: 'Engagement', value: engagement, unit: 'number' },
        { key: 'engagement_rate', label: 'Engagement rate', value: impressions ? engagement / impressions : null, unit: 'percent' },
      ] : [],
      trend: rows.length ? { points: trend(rows, ['reach', 'engagement']), series: [['reach', 'Reach', '#fb7185'], ['engagement', 'Engagement', '#c084fc']] } : null,
      notes: ['Currency, reporting timezone, and provider finality are unavailable in the current stored Meta snapshot contract.'],
    }))
  }

  sources.push(sourceAccount({
    id: 'manual_evidence:reporting', provider: 'manual_evidence', accountLabel: 'Manual evidence',
    brand, period, error: 'Manual evidence is labeled for report authoring and is not a live performance source.',
    notes: ['No file, export, or official report is created in MB06A.'], now, thresholdHours: staleThresholdHours,
  }))

  return {
    brand: { id: brand.id, name: brand.name, organization_id: organizationId },
    period,
    comparison_enabled: false,
    sources,
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
        no_rank_data_in_period: keywords.length - knownPositions.length,
        top_3: knownPositions.filter(position => position <= 3).length,
        top_10: knownPositions.filter(position => position <= 10).length,
        top_20: knownPositions.filter(position => position <= 20).length,
        average_position: average(knownPositions),
        improved_in_period: improved,
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
      has_period_data: paidRows.length > 0,
      campaigns: campaigns.length,
      active_campaigns: campaigns.filter(row => row.status === 'active').length,
      spend: paidRows.length ? sum(paidRows, 'cost') : null,
      impressions: paidRows.length ? paidImpressions : null,
      clicks: paidRows.length ? paidClicks : null,
      conversions: paidRows.length ? sum(paidRows, 'conversions') : null,
      ctr: paidRows.length && paidImpressions ? paidClicks / paidImpressions : null,
      trend: trend(paidRows, ['cost', 'conversions']),
    },
    social: {
      available: meta.length > 0,
      has_period_data: socialRows.length > 0,
      connections: meta.length,
      platforms: [...new Set(socialRows.map(row => row.platform))].sort(),
      reach: socialRows.length ? sum(socialRows, 'reach') : null,
      impressions: socialRows.length ? socialImpressions : null,
      engagement: socialRows.length ? socialEngagement : null,
      engagement_rate: socialRows.length && socialImpressions ? socialEngagement / socialImpressions : null,
      trend: trend(socialRows, ['reach', 'engagement']),
    },
    source_errors: reports.filter(report => report.error && ['google_analytics', 'google_search_console'].includes(report.provider)).map(report => ({
      provider: report.provider,
      connection_name: report.connection_name,
      error: report.error,
    })),
  }
}
