export const MARKETING_CONNECTION_PROVIDERS = Object.freeze([
  Object.freeze({ provider: 'google_analytics', label: 'Google Analytics', capability: 'live_reporting_read' }),
  Object.freeze({ provider: 'google_search_console', label: 'Google Search Console', capability: 'live_reporting_read' }),
  Object.freeze({ provider: 'google_ads', label: 'Google Ads', capability: 'stored_snapshot_read' }),
  Object.freeze({ provider: 'meta', label: 'Meta', capability: 'organic_insights' }),
])

const PROVIDER_BY_ID = new Map(MARKETING_CONNECTION_PROVIDERS.map(item => [item.provider, item]))
const INTEGRATION_ADMIN_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])

export function canManageMarketingConnections(membership) {
  return Boolean(membership && INTEGRATION_ADMIN_ROLES.has(membership.role))
}

function value(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function belongsTo(row, organizationId) {
  return row?.organization_id === organizationId
}

function latestTimestamp(rows) {
  return rows.map(row => value(row.created_at)).filter(Boolean).sort().at(-1) || null
}

function accountIdentity(provider, config = {}) {
  if (provider === 'google_analytics') return value(config.property_id)
  if (provider === 'google_search_console') return value(config.site_url)
  if (provider === 'google_ads') return value(config.customer_id)
  return null
}

function readinessState({ connection, lastSuccessfulRead, tokenExpiresAt, now, staleAfterHours }) {
  if (!connection) return 'not_configured'
  if (tokenExpiresAt && Date.parse(tokenExpiresAt) <= now.getTime()) return 'authorization_required'
  if (['disconnected', 'configured', 'authorizing'].includes(connection.status)) return 'authorization_required'
  if (connection.status !== 'verified') return 'status_unavailable'
  if (!lastSuccessfulRead) return 'connected_no_data'
  const ageHours = (now.getTime() - Date.parse(lastSuccessfulRead)) / 3_600_000
  if (!Number.isFinite(ageHours)) return 'status_unavailable'
  return ageHours > staleAfterHours ? 'stale' : 'healthy'
}

function row({
  organizationId, brand, provider, connection = null, mappingId, mappingLabel,
  accountId = null, accountLabel = null, lastSuccessfulRead = null, tokenExpiresAt = null,
  now, staleAfterHours,
}) {
  const contract = PROVIDER_BY_ID.get(provider)
  const state = readinessState({ connection, lastSuccessfulRead, tokenExpiresAt, now, staleAfterHours })
  return Object.freeze({
    id: [organizationId, brand.id, provider, connection?.id || 'none', accountId || 'unavailable', mappingId].join(':'),
    organizationId,
    brand: Object.freeze({ id: brand.id, name: brand.name || 'Brand' }),
    provider,
    providerLabel: contract.label,
    connectionId: connection?.id || null,
    connectionLabel: value(connection?.display_name) || 'Not configured',
    accountId,
    accountLabel: accountLabel || accountId || 'Unavailable',
    mappingId,
    mappingLabel,
    capability: connection?.status === 'verified' ? contract.capability : 'setup_only',
    state,
    lastSuccessfulRead,
    lastErrorCategory: null,
    staleAfterHours: lastSuccessfulRead ? staleAfterHours : null,
  })
}

export function shouldApplyConnectionReadinessResponse(request, current, generation, currentGeneration) {
  return !request.signal?.aborted &&
    request.organizationId === current.organizationId &&
    request.brandId === current.brandId &&
    request.revision === current.revision &&
    generation === currentGeneration
}

export function buildMarketingConnectionReadiness({
  organizationId,
  brand,
  engagements = [],
  mappings = [],
  connections = [],
  metaConnections = [],
  adCampaigns = [],
  adSnapshots = [],
  metaSnapshots = [],
  now = new Date(),
  staleAfterHours = 24,
}) {
  if (!organizationId || !brand?.id || brand.organization_id !== organizationId) {
    throw Object.assign(new Error('Marketing connection organization mismatch'), {
      status: 403,
      membershipMismatch: true,
    })
  }
  const visibleEngagements = engagements.filter(item => belongsTo(item, organizationId) && item.brand_id === brand.id)
  const engagementById = new Map(visibleEngagements.map(item => [item.id, item]))
  const visibleMappings = mappings.filter(item => belongsTo(item, organizationId) &&
    item.department_id === 'marketing' && engagementById.has(item.engagement_id))
  const connectionById = new Map(connections
    .filter(item => belongsTo(item, organizationId) && PROVIDER_BY_ID.has(item.provider) && !item.archived_at)
    .map(item => [item.id, item]))
  const visibleMeta = metaConnections.filter(item => belongsTo(item, organizationId) && item.brand_id === brand.id &&
    connectionById.get(item.integration_connection_id)?.provider === 'meta')
  const visibleCampaigns = adCampaigns.filter(item => belongsTo(item, organizationId) && item.brand_id === brand.id &&
    connectionById.get(item.provider_connection_id)?.provider === 'google_ads')
  const campaignById = new Map(visibleCampaigns.map(item => [item.id, item]))
  const visibleAdSnapshots = adSnapshots.filter(item => belongsTo(item, organizationId) &&
    campaignById.has(item.ad_campaign_id) && campaignById.get(item.ad_campaign_id).provider_connection_id === item.provider_connection_id)
  const metaById = new Map(visibleMeta.map(item => [item.id, item]))
  const visibleMetaSnapshots = metaSnapshots.filter(item => belongsTo(item, organizationId) && metaById.has(item.meta_connection_id))
  const rows = []

  visibleMappings.forEach(mapping => {
    const connection = connectionById.get(mapping.connection_id)
    if (!connection || connection.provider === 'meta') return
    const engagement = engagementById.get(mapping.engagement_id)
    const configuredAccount = accountIdentity(connection.provider, connection.public_config)
    const campaignAccounts = connection.provider === 'google_ads'
      ? [...new Set(visibleCampaigns.filter(item => item.provider_connection_id === connection.id)
        .map(item => value(item.external_account_id)).filter(Boolean))]
      : []
    const accountIds = campaignAccounts.length ? campaignAccounts : [configuredAccount]
    accountIds.forEach(accountId => {
      const campaigns = visibleCampaigns.filter(item => item.provider_connection_id === connection.id &&
        (!accountId || value(item.external_account_id) === accountId))
      const campaignIds = new Set(campaigns.map(item => item.id))
      const lastSuccessfulRead = connection.provider === 'google_ads'
        ? latestTimestamp(visibleAdSnapshots.filter(item => campaignIds.has(item.ad_campaign_id)))
        : null
      rows.push(row({
        organizationId, brand, provider: connection.provider, connection,
        mappingId: mapping.engagement_id,
        mappingLabel: engagement?.name || 'Visible brand engagement',
        accountId,
        accountLabel: configuredAccount === accountId ? value(connection.display_name) : accountId,
        lastSuccessfulRead,
        now,
        staleAfterHours,
      }))
    })
  })

  visibleCampaigns.forEach(campaign => {
    const connection = connectionById.get(campaign.provider_connection_id)
    const accountId = value(campaign.external_account_id) || accountIdentity('google_ads', connection?.public_config)
    if (!connection || rows.some(item => item.provider === 'google_ads' &&
      item.connectionId === connection.id && item.accountId === accountId)) return
    const campaignIds = new Set(visibleCampaigns.filter(item => item.provider_connection_id === connection.id &&
      (value(item.external_account_id) || accountIdentity('google_ads', connection.public_config)) === accountId)
      .map(item => item.id))
    rows.push(row({
      organizationId, brand, provider: 'google_ads', connection,
      mappingId: 'brand-account-' + (accountId || connection.id),
      mappingLabel: brand.name || 'Visible brand',
      accountId,
      accountLabel: accountId,
      lastSuccessfulRead: latestTimestamp(visibleAdSnapshots.filter(item => campaignIds.has(item.ad_campaign_id))),
      now,
      staleAfterHours,
    }))
  })

  visibleMeta.forEach(meta => {
    const connection = connectionById.get(meta.integration_connection_id)
    const pageId = value(meta.facebook_page_id)
    rows.push(row({
      organizationId, brand, provider: 'meta', connection,
      mappingId: meta.id,
      mappingLabel: brand.name || 'Visible brand',
      accountId: pageId,
      accountLabel: value(connection?.public_config?.facebook_page_name) || pageId,
      lastSuccessfulRead: latestTimestamp(visibleMetaSnapshots.filter(item => item.meta_connection_id === meta.id)),
      tokenExpiresAt: meta.token_expires_at,
      now,
      staleAfterHours,
    }))
  })

  MARKETING_CONNECTION_PROVIDERS.forEach(contract => {
    if (!rows.some(item => item.provider === contract.provider)) {
      rows.push(row({
        organizationId, brand, provider: contract.provider,
        mappingId: 'not-configured',
        mappingLabel: brand.name || 'Visible brand',
        now,
        staleAfterHours,
      }))
    }
  })

  return Object.freeze(rows.sort((left, right) =>
    left.providerLabel.localeCompare(right.providerLabel) ||
    left.mappingLabel.localeCompare(right.mappingLabel) ||
    left.accountLabel.localeCompare(right.accountLabel) ||
    left.id.localeCompare(right.id)))
}
