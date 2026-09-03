function text(value) {
  return typeof value === 'string' ? value : ''
}

function compareText(left, right) {
  return text(left).localeCompare(text(right))
}

function belongsTo(row, organizationId, brandId) {
  return row?.organization_id === organizationId && row?.brand_id === brandId
}

export function shouldApplyKeywordResearchResponse(request, current, generation, currentGeneration) {
  return !request.signal?.aborted &&
    request.organizationId === current.organizationId &&
    request.brandId === current.brandId &&
    request.revision === current.revision &&
    generation === currentGeneration
}

export function buildMarketingKeywordResearch({
  organizationId,
  brand,
  pages = [],
  keywords = [],
  snapshots = [],
  sourceArtifacts = [],
  backlinkTargets = [],
}) {
  if (!organizationId || !brand?.id || brand.organization_id !== organizationId) {
    throw Object.assign(new Error('SEO keyword research organization mismatch'), {
      status: 403,
      membershipMismatch: true,
    })
  }

  const pageById = new Map(pages
    .filter(row => belongsTo(row, organizationId, brand.id))
    .map(row => [row.id, row]))
  const artifactById = new Map(sourceArtifacts
    .filter(row => belongsTo(row, organizationId, brand.id) && row.artifact_type === 'keyword_strategy')
    .map(row => [row.id, row]))
  const visibleKeywords = keywords.filter(row => belongsTo(row, organizationId, brand.id))
  const keywordIds = new Set(visibleKeywords.map(row => row.id))
  const histories = new Map()

  snapshots
    .filter(row => row?.organization_id === organizationId && keywordIds.has(row.tracked_keyword_id))
    .sort((left, right) => compareText(left.snapshot_date, right.snapshot_date) ||
      compareText(left.fetched_at, right.fetched_at) || compareText(left.id, right.id))
    .forEach(row => {
      const history = histories.get(row.tracked_keyword_id) || []
      history.push(Object.freeze({
        id: row.id,
        date: row.snapshot_date,
        position: row.position == null ? null : Number(row.position),
        clicks: row.search_console_clicks == null ? null : Number(row.search_console_clicks),
        impressions: row.search_console_impressions == null ? null : Number(row.search_console_impressions),
        fetchedAt: row.fetched_at,
        rankState: row.position == null ? 'unknown' : 'ranked',
      }))
      histories.set(row.tracked_keyword_id, history)
    })

  const trackedKeywords = visibleKeywords.map(row => {
    const page = pageById.get(row.tracked_page_id)
    const artifact = artifactById.get(row.source_artifact_id)
    const history = histories.get(row.id) || []
    return Object.freeze({
      id: row.id,
      kind: 'seo_tracked_keyword',
      keyword: row.keyword,
      active: row.active !== false,
      targetRankTier: row.target_rank_tier || null,
      createdAt: row.created_at,
      pageTarget: page ? Object.freeze({ id: page.id, url: page.page_url, pageType: page.page_type }) : null,
      sourceArtifact: artifact ? Object.freeze({
        id: artifact.id,
        title: artifact.title,
        artifactType: artifact.artifact_type,
      }) : null,
      history: Object.freeze(history),
      latestSnapshot: history.at(-1) || null,
    })
  }).sort((left, right) => Number(right.active) - Number(left.active) ||
    compareText(left.keyword, right.keyword) || compareText(left.pageTarget?.url, right.pageTarget?.url) || compareText(left.id, right.id))

  const backlinkEvidence = backlinkTargets
    .filter(row => belongsTo(row, organizationId, brand.id))
    .map(row => Object.freeze({
      id: row.id,
      siteName: row.site_name,
      siteUrl: row.site_url || null,
      industryCategory: row.industry_category || null,
      domainAuthority: row.domain_authority == null ? null : Number(row.domain_authority),
      estimatedTraffic: row.estimated_traffic == null ? null : Number(row.estimated_traffic),
      relevanceScore: row.relevance_score == null ? null : Number(row.relevance_score),
      linkType: row.link_type || null,
      costType: row.cost_type || null,
      outreachStatus: row.outreach_status,
      updatedAt: row.updated_at,
    }))
    .sort((left, right) => compareText(left.siteName, right.siteName) || compareText(left.id, right.id))

  return Object.freeze({
    organizationId,
    brand: Object.freeze({ id: brand.id, name: brand.name || 'Brand' }),
    trackedKeywords: Object.freeze(trackedKeywords),
    backlinkEvidence: Object.freeze(backlinkEvidence),
  })
}
