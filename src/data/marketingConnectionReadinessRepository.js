import { buildMarketingConnectionReadiness } from './marketingConnectionReadiness.js'

const PAGE_SIZE = 500

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Marketing connection readiness query failed'), {
    status: error.status || error.statusCode,
  })
  return data || []
}

export async function collectConnectionReadinessPages(fetchPage, pageSize = PAGE_SIZE) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function paged(fetchQuery, options) {
  return collectConnectionReadinessPages((from, to) => dataOrThrow(fetchQuery(from, to), options))
}

export async function loadMarketingConnectionReadiness({
  organizationId,
  brand,
  signal,
  client,
  now = new Date(),
  staleAfterHours = 24,
}) {
  if (!organizationId || !brand?.id || brand.organization_id !== organizationId) {
    throw Object.assign(new Error('Marketing connection organization mismatch'), {
      status: 403,
      membershipMismatch: true,
    })
  }
  const dataClient = client || (await import('../lib/supabase.js')).supabase
  const options = { signal }
  const scoped = query => query.eq('organization_id', organizationId)
  const brandScoped = query => scoped(query).eq('brand_id', brand.id)

  const [engagements, metaConnections, adCampaigns] = await Promise.all([
    paged((from, to) => brandScoped(dataClient.from('engagements')
      .select('id, organization_id, brand_id, name'))
      .order('name').order('id').range(from, to), options),
    paged((from, to) => brandScoped(dataClient.from('meta_connections')
      .select('id, organization_id, integration_connection_id, brand_id, facebook_page_id, instagram_account_id, token_expires_at'))
      .order('facebook_page_id').order('id').range(from, to), options),
    paged((from, to) => brandScoped(dataClient.from('ad_campaigns')
      .select('id, organization_id, brand_id, provider_connection_id, external_account_id'))
      .order('provider_connection_id').order('external_account_id').order('id').range(from, to), options),
  ])

  const engagementIds = engagements.map(item => item.id)
  const mappings = engagementIds.length ? await paged((from, to) => scoped(dataClient.from('integration_connection_engagements')
    .select('connection_id, organization_id, engagement_id, department_id'))
    .eq('department_id', 'marketing')
    .in('engagement_id', engagementIds)
    .order('connection_id').order('engagement_id').range(from, to), options) : []

  const connectionIds = [...new Set([
    ...mappings.map(item => item.connection_id),
    ...metaConnections.map(item => item.integration_connection_id),
    ...adCampaigns.map(item => item.provider_connection_id),
  ].filter(Boolean))]
  const connections = connectionIds.length ? await paged((from, to) => scoped(dataClient.from('integration_connections')
    .select('id, organization_id, provider, display_name, public_config, status, archived_at'))
    .in('id', connectionIds)
    .in('provider', ['google_analytics', 'google_search_console', 'google_ads', 'meta'])
    .is('archived_at', null)
    .order('provider').order('display_name').order('id').range(from, to), options) : []

  const adCampaignIds = adCampaigns.map(item => item.id)
  const metaConnectionIds = metaConnections.map(item => item.id)
  const [adSnapshots, metaSnapshots] = await Promise.all([
    adCampaignIds.length ? paged((from, to) => scoped(dataClient.from('ad_campaign_performance_snapshots')
      .select('id, organization_id, ad_campaign_id, provider_connection_id, created_at'))
      .in('ad_campaign_id', adCampaignIds)
      .order('created_at').order('id').range(from, to), options) : [],
    metaConnectionIds.length ? paged((from, to) => scoped(dataClient.from('meta_performance_snapshots')
      .select('id, organization_id, meta_connection_id, created_at'))
      .in('meta_connection_id', metaConnectionIds)
      .order('created_at').order('id').range(from, to), options) : [],
  ])

  return buildMarketingConnectionReadiness({
    organizationId,
    brand,
    engagements,
    mappings,
    connections,
    metaConnections,
    adCampaigns,
    adSnapshots,
    metaSnapshots,
    now,
    staleAfterHours,
  })
}
