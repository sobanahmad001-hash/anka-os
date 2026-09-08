import { buildMarketingKeywordResearch } from './marketingKeywordResearch.js'

const PAGE_SIZE = 500

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'SEO keyword research query failed'), {
    status: error.status || error.statusCode,
  })
  return data || []
}

export async function collectKeywordResearchPages(fetchPage, pageSize = PAGE_SIZE) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function paged(fetchQuery, options) {
  return collectKeywordResearchPages((from, to) => dataOrThrow(fetchQuery(from, to), options))
}

export async function loadMarketingKeywordResearch({ organizationId, brand, signal, client }) {
  if (!organizationId || !brand?.id || brand.organization_id !== organizationId) {
    throw Object.assign(new Error('SEO keyword research organization mismatch'), {
      status: 403,
      membershipMismatch: true,
    })
  }
  const dataClient = client || (await import('../lib/supabase.js')).supabase
  const options = { signal }
  const scoped = query => query.eq('organization_id', organizationId).eq('brand_id', brand.id)

  const [pages, keywords, sourceArtifacts, backlinkTargets] = await Promise.all([
    paged((from, to) => scoped(dataClient.from('tracked_pages')
      .select('id, organization_id, brand_id, page_url, page_type'))
      .order('page_url').order('id').range(from, to), options),
    paged((from, to) => scoped(dataClient.from('tracked_keywords')
      .select('id, organization_id, brand_id, tracked_page_id, keyword, source_artifact_id, target_rank_tier, active, created_at'))
      .order('keyword').order('id').range(from, to), options),
    paged((from, to) => scoped(dataClient.from('artifacts')
      .select('id, organization_id, brand_id, artifact_type, title'))
      .eq('artifact_type', 'keyword_strategy').order('created_at').order('id').range(from, to), options),
    paged((from, to) => scoped(dataClient.from('backlink_targets')
      .select('id, organization_id, brand_id, site_name, site_url, industry_category, domain_authority, estimated_traffic, relevance_score, link_type, cost_type, outreach_status, updated_at'))
      .order('site_name').order('id').range(from, to), options),
  ])

  const keywordIds = keywords.map(row => row.id)
  const snapshots = keywordIds.length ? await paged((from, to) => dataClient.from('keyword_rank_snapshots')
    .select('id, organization_id, tracked_keyword_id, snapshot_date, position, search_console_clicks, search_console_impressions, fetched_at')
    .eq('organization_id', organizationId)
    .in('tracked_keyword_id', keywordIds)
    .order('snapshot_date').order('fetched_at').order('id').range(from, to), options) : []

  return buildMarketingKeywordResearch({
    organizationId, brand, pages, keywords, snapshots, sourceArtifacts, backlinkTargets,
  })
}
