import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { googleAccessToken, namedKey, sha256 } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const MARKETING_ARTIFACT_TYPES = new Set([
  'channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report',
])
const GOOGLE_PROVIDERS = new Set(['google_analytics', 'google_search_console', 'google_ads'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const MANAGER_ROLES = new Set(['department_manager'])
const CAMPAIGN_STATUSES = new Set(['draft', 'planned', 'active', 'paused', 'completed', 'cancelled'])
const BACKLINK_STATUSES = new Set(['not_started', 'contacted', 'in_discussion', 'secured', 'declined'])
const BACKLINK_LINK_TYPES = new Set(['membership', 'partnership', 'editorial', 'guest_post'])
const BACKLINK_COST_TYPES = new Set(['free', 'paid', 'both'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value.map(item => text(item, 500)).filter(Boolean).slice(0, maxItems)
    : []
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function safeDate(value: unknown, required = false) {
  const result = text(value, 10)
  if (!result && !required) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error('Dates must use YYYY-MM-DD')
  }
  return result
}

export function safeDateRange(startValue: unknown, endValue: unknown) {
  const end = safeDate(endValue, true) as string
  const start = safeDate(startValue, true) as string
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  if (startMs > endMs || endMs - startMs > 366 * 86_400_000) {
    throw new Error('Reporting period must be ordered and no longer than 366 days')
  }
  return { start, end }
}

export function hasMarketingAuthority(membership: Json, action: string) {
  const role = text(membership.role, 60)
  if (LEADER_ROLES.has(role)) return true
  if (text(membership.department_id, 60) !== 'marketing') return false
  if (action === 'approve_artifact') return MANAGER_ROLES.has(role)
  return true
}

export function validateMarketingArtifact(type: string, value: unknown): Json {
  if (!MARKETING_ARTIFACT_TYPES.has(type) || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unsupported marketing artifact content')
  }
  const input = value as Json
  const definitions: Record<string, Array<[string, 'text' | 'list']>> = {
    channel_strategy: [
      ['objectives', 'list'], ['priority_audiences', 'list'], ['channel_roles', 'list'],
      ['sequencing', 'text'], ['success_measures', 'list'],
    ],
    campaign_brief: [
      ['campaign_goal', 'text'], ['audience', 'text'], ['offer', 'text'],
      ['key_message', 'text'], ['channels', 'list'], ['deliverables', 'list'],
    ],
    measurement_plan: [
      ['business_objectives', 'list'], ['kpis', 'list'], ['conversions', 'list'],
      ['tracking_requirements', 'list'], ['reporting_cadence', 'text'],
    ],
    marketing_report: [
      ['sources', 'list'], ['period_start', 'text'], ['period_end', 'text'],
      ['executive_summary', 'text'], ['insights', 'list'], ['recommended_actions', 'list'],
    ],
  }
  const output: Json = {}
  for (const [field, kind] of definitions[type]) {
    output[field] = kind === 'list' ? strings(input[field]) : text(input[field], 4000)
    if (kind === 'list' ? !(output[field] as string[]).length : !output[field]) {
      throw new Error(`${field.replaceAll('_', ' ')} is required`)
    }
  }
  if (type === 'marketing_report') safeDateRange(output.period_start, output.period_end)
  return output
}

export function validateCampaign(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Campaign details are required')
  const input = value as Json
  const name = text(input.name, 180)
  const plannedChannels = strings(input.planned_channels, 20)
  const status = text(input.status, 30) || 'draft'
  const startsOn = safeDate(input.starts_on)
  const endsOn = safeDate(input.ends_on)
  const plannedBudget = input.planned_budget === '' || input.planned_budget === null || input.planned_budget === undefined
    ? null : Number(input.planned_budget)
  const currencyCode = (text(input.currency_code, 3) || 'USD').toUpperCase()
  if (!name || !plannedChannels.length) throw new Error('Campaign name and at least one planned channel are required')
  if (!CAMPAIGN_STATUSES.has(status)) throw new Error('Unsupported campaign status')
  if (startsOn && endsOn && startsOn > endsOn) throw new Error('Campaign end date cannot precede its start date')
  if (plannedBudget !== null && (!Number.isFinite(plannedBudget) || plannedBudget < 0)) {
    throw new Error('Planned budget must be a non-negative number')
  }
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Currency must use a three-letter code')
  return {
    name, objective: text(input.objective, 2000), planned_channels: plannedChannels,
    starts_on: startsOn, ends_on: endsOn, planned_budget: plannedBudget,
    currency_code: currencyCode, status,
  }
}

function optionalText(value: unknown, max: number) {
  const result = text(value, max)
  return result || null
}

function optionalNumber(value: unknown, label: string, minimum = 0, maximum: number | null = null) {
  if (value === '' || value === null || value === undefined) return null
  const result = Number(value)
  if (!Number.isFinite(result) || result < minimum || (maximum !== null && result > maximum)) {
    throw new Error(maximum === null
      ? `${label} must be a non-negative number`
      : `${label} must be between ${minimum} and ${maximum}`)
  }
  return result
}

function optionalSiteUrl(value: unknown) {
  const raw = optionalText(value, 2048)
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Site URL must be a valid HTTP or HTTPS URL')
  }
  const validHostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
  if (!['http:', 'https:'].includes(parsed.protocol) || !validHostname.test(parsed.hostname)
    || parsed.username || parsed.password) {
    throw new Error('Site URL must be a valid HTTP or HTTPS URL')
  }
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString()
}

export function validateBacklinkTarget(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Backlink target details are required')
  }
  const input = value as Json
  const siteName = text(input.site_name, 240)
  const linkType = optionalText(input.link_type, 40)
  const costType = optionalText(input.cost_type, 20)
  const outreachStatus = text(input.outreach_status, 40) || 'not_started'
  if (!siteName) throw new Error('Site name is required')
  if (linkType && !BACKLINK_LINK_TYPES.has(linkType)) throw new Error('Unsupported backlink link type')
  if (costType && !BACKLINK_COST_TYPES.has(costType)) throw new Error('Unsupported backlink cost type')
  if (!BACKLINK_STATUSES.has(outreachStatus)) throw new Error('Unsupported backlink outreach status')
  return {
    site_name: siteName,
    site_url: optionalSiteUrl(input.site_url),
    industry_category: optionalText(input.industry_category, 160),
    domain_authority: optionalNumber(input.domain_authority, 'Domain authority', 0, 100),
    estimated_traffic: optionalNumber(input.estimated_traffic, 'Estimated traffic'),
    relevance_score: optionalNumber(input.relevance_score, 'Relevance score', 0, 100),
    link_type: linkType,
    cost_type: costType,
    outreach_status: outreachStatus,
    notes: optionalText(input.notes, 20000),
  }
}

type RequestDependencies = {
  createClient?: typeof createClient
  environment?: { supabaseUrl: string; publishableKey: string; secretKey: string }
}

async function requireContext(
  request: Request,
  clientFactory: typeof createClient = createClient,
  environment?: RequestDependencies['environment'],
) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const supabaseUrl = environment?.supabaseUrl ?? Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = environment?.publishableKey ?? namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = environment?.secretKey ?? namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = clientFactory(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
  const admin = clientFactory(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const { data: membership } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind')
    .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).maybeSingle()
  if (!membership || membership.status !== 'active' || membership.member_kind !== 'team') {
    throw Object.assign(new Error('Active team membership required'), { status: 403 })
  }
  return { admin, user, membership }
}

async function requireMarketingEngagement(admin: Client, engagementId: string) {
  const { data: engagement, error } = await admin.from('engagements').select('id, organization_id, brand_id, name, status')
    .eq('id', engagementId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !engagement) throw Object.assign(new Error('Engagement not found'), { status: 404 })
  const { data: services, error: serviceError } = await admin.from('engagement_services')
    .select('id, service_catalog!inner(department_id)').eq('engagement_id', engagementId)
    .eq('service_catalog.department_id', 'marketing').limit(1)
  if (serviceError || !services?.length) {
    throw Object.assign(new Error('This engagement has no active Marketing service'), { status: 409 })
  }
  return engagement
}

async function requireBrand(admin: Client, brandId: string) {
  const { data: brand, error } = await admin.from('brands').select('id, organization_id, name')
    .eq('id', brandId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error || !brand) throw Object.assign(new Error('Brand not found'), { status: 404 })
  return brand
}

async function recordEvent(admin: Client, engagementId: string, actorId: string, eventType: string, payload: Json) {
  const { error } = await admin.from('engagement_events').insert({
    organization_id: ORGANIZATION_ID, engagement_id: engagementId,
    event_type: eventType, actor_id: actorId, payload,
  })
  if (error) throw error
}

async function createCampaign(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const engagement = await requireMarketingEngagement(admin, engagementId)
  const campaign = validateCampaign(body.campaign)
  const { data, error } = await admin.from('marketing_campaigns').insert({
    organization_id: ORGANIZATION_ID, engagement_id: engagement.id, brand_id: engagement.brand_id,
    ...campaign, created_by: actorId, updated_by: actorId,
  }).select('*').single()
  if (error) throw error
  await recordEvent(admin, engagement.id, actorId, 'campaign_created', {
    record_type: 'marketing_campaign', record_id: data.id, action: 'created',
    name: data.name, status: data.status,
  })
  return data
}

async function updateCampaign(admin: Client, body: Json, actorId: string) {
  const campaignId = text(body.campaign_id, 80)
  const { data: existing } = await admin.from('marketing_campaigns').select('*')
    .eq('id', campaignId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!existing) throw Object.assign(new Error('Campaign not found'), { status: 404 })
  await requireMarketingEngagement(admin, existing.engagement_id)
  const campaign = validateCampaign(body.campaign)
  const { data, error } = await admin.from('marketing_campaigns').update({
    ...campaign, updated_by: actorId,
  }).eq('id', existing.id).select('*').single()
  if (error) throw error
  await recordEvent(admin, existing.engagement_id, actorId, 'campaign_updated', {
    record_type: 'marketing_campaign', record_id: data.id, action: 'updated',
    previous_status: existing.status, status: data.status,
  })
  return data
}

async function createBacklinkTarget(admin: Client, body: Json, actorId: string) {
  const brandId = text(body.brand_id, 80)
  const brand = await requireBrand(admin, brandId)
  const target = validateBacklinkTarget(body.target)
  const { data, error } = await admin.from('backlink_targets').insert({
    organization_id: ORGANIZATION_ID,
    brand_id: brand.id,
    ...target,
    created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function updateBacklinkTarget(admin: Client, body: Json) {
  const targetId = text(body.target_id, 80)
  const { data: existing, error: existingError } = await admin.from('backlink_targets')
    .select('id, brand_id').eq('id', targetId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (existingError) throw existingError
  if (!existing) throw Object.assign(new Error('Backlink target not found'), { status: 404 })
  await requireBrand(admin, existing.brand_id)
  const target = validateBacklinkTarget(body.target)
  const { data, error } = await admin.from('backlink_targets').update(target)
    .eq('id', existing.id).eq('organization_id', ORGANIZATION_ID).select('*').single()
  if (error) throw error
  return data
}

async function saveArtifact(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const campaignId = text(body.campaign_id, 80)
  const artifactType = text(body.artifact_type, 60)
  const engagement = await requireMarketingEngagement(admin, engagementId)
  const content = validateMarketingArtifact(artifactType, body.content)
  const checksum = await sha256(stableJson(content))
  let artifactId = text(body.artifact_id, 80)
  if (artifactId) {
    const { data: artifact } = await admin.from('artifacts').select('id, artifact_type, engagement_id, brand_id')
      .eq('id', artifactId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (!artifact || artifact.artifact_type !== artifactType || artifact.engagement_id !== engagement.id || artifact.brand_id !== engagement.brand_id) {
      throw new Error('Marketing artifact does not match this engagement and type')
    }
  } else {
    const { data: artifact, error } = await admin.from('artifacts').insert({
      organization_id: ORGANIZATION_ID, engagement_id: engagement.id, brand_id: engagement.brand_id,
      artifact_type: artifactType, title: text(body.title, 240) || artifactType.replaceAll('_', ' '), created_by: actorId,
    }).select('id').single()
    if (error) throw error
    artifactId = artifact.id
  }
  const { data: latest } = await admin.from('artifact_versions').select('id, version_number')
    .eq('artifact_id', artifactId).order('version_number', { ascending: false }).limit(1).maybeSingle()
  const { data: version, error: versionError } = await admin.from('artifact_versions').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifactId,
    version_number: (latest?.version_number || 0) + 1, parent_version_id: latest?.id || null,
    content, content_checksum: checksum, change_summary: text(body.change_summary, 1000),
    ai_use_allowed: body.ai_use_allowed === true, data_classification: 'internal', created_by: actorId,
  }).select('*').single()
  if (versionError) throw versionError
  if (campaignId) {
    const { data: campaign } = await admin.from('marketing_campaigns').select('id, engagement_id')
      .eq('id', campaignId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (!campaign || campaign.engagement_id !== engagement.id) throw new Error('Campaign does not match this engagement')
    const { error: linkError } = await admin.from('marketing_campaign_artifacts').upsert({
      organization_id: ORGANIZATION_ID, campaign_id: campaign.id, artifact_id: artifactId,
      relation_type: artifactType, linked_by: actorId,
    }, { onConflict: 'campaign_id,artifact_id', ignoreDuplicates: true })
    if (linkError) throw linkError
  }
  await recordEvent(admin, engagement.id, actorId, 'artifact_version_created', {
    record_type: 'artifact', record_id: artifactId, version_id: version.id,
    action: 'version_created', artifact_type: artifactType, campaign_id: campaignId || null,
  })
  return version
}

async function approveArtifact(admin: Client, body: Json, actorId: string) {
  const versionId = text(body.artifact_version_id, 80)
  const { data: version } = await admin.from('artifact_versions')
    .select('*, artifacts!inner(id, artifact_type, engagement_id, organization_id)')
    .eq('id', versionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  const artifact = version?.artifacts
  if (!version || !artifact || !MARKETING_ARTIFACT_TYPES.has(artifact.artifact_type) || !artifact.engagement_id) {
    throw Object.assign(new Error('Marketing artifact version not found'), { status: 404 })
  }
  await requireMarketingEngagement(admin, artifact.engagement_id)
  const { data: pendingRequest, error: requestError } = await admin.from('artifact_approval_requests')
    .select('id').eq('artifact_version_id', version.id).eq('status', 'pending').maybeSingle()
  if (requestError) throw requestError
  if (pendingRequest) {
    throw Object.assign(new Error('This version is governed by a pending multi-approver request'), { status: 409 })
  }
  const { data: approval, error } = await admin.from('artifact_approvals').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifact.id, artifact_version_id: version.id,
    engagement_id: artifact.engagement_id, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (error) throw error
  await recordEvent(admin, artifact.engagement_id, actorId, 'artifact_approved', {
    record_type: 'artifact', record_id: artifact.id, version_id: version.id,
    action: 'approved', artifact_type: artifact.artifact_type,
  })
  return approval
}

function normalizedMetric(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export async function fetchReadOnlyGoogleReport(
  provider: string,
  token: string,
  config: Json,
  period: { start: string; end: string },
  fetcher: typeof fetch = fetch,
  serverSecrets: { googleAdsDeveloperToken?: string } = {},
) {
  let url = ''
  let headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let requestBody: Json = {}
  if (provider === 'google_analytics') {
    const propertyId = text(config.property_id, 24)
    if (!/^\d{4,20}$/.test(propertyId)) throw new Error('GA4 property ID is not configured')
    url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`
    requestBody = {
      dateRanges: [{ startDate: period.start, endDate: period.end }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'eventCount' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 366,
    }
  } else if (provider === 'google_search_console') {
    const siteUrl = text(config.site_url, 500)
    if (!siteUrl) throw new Error('Search Console property is not configured')
    url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`
    requestBody = { startDate: period.start, endDate: period.end, dimensions: ['query'], rowLimit: 25, dataState: 'final' }
  } else if (provider === 'google_ads') {
    const customerId = text(config.customer_id, 24)
    if (!/^\d{10}$/.test(customerId)) throw new Error('Google Ads customer ID is not configured')
    const developerToken = serverSecrets.googleAdsDeveloperToken
      ?? Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')
    if (!developerToken) throw new Error('Google Ads developer token is not configured')
    url = `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:searchStream`
    headers = { ...headers, 'developer-token': developerToken }
    const loginCustomerId = text(config.login_customer_id, 24)
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId
    requestBody = { query: `SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${period.start}' AND '${period.end}' ORDER BY metrics.impressions DESC LIMIT 50` }
  } else throw new Error('Unsupported Google reporting provider')

  const result = await fetcher(url, {
    method: 'POST', headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(15_000),
  })
  const data = await result.json()
  if (!result.ok) throw Object.assign(new Error(`${provider} reporting request failed`), { code: `HTTP_${result.status}` })
  if (provider === 'google_analytics') {
    const rows = Array.isArray(data.rows) ? data.rows : []
    return {
      provider, period, totals: rows.reduce((sum: Json, row: any) => ({
        active_users: normalizedMetric(sum.active_users) + normalizedMetric(row.metricValues?.[0]?.value),
        sessions: normalizedMetric(sum.sessions) + normalizedMetric(row.metricValues?.[1]?.value),
        events: normalizedMetric(sum.events) + normalizedMetric(row.metricValues?.[2]?.value),
      }), { active_users: 0, sessions: 0, events: 0 }),
      rows: rows.map((row: any) => ({ date: row.dimensionValues?.[0]?.value, active_users: normalizedMetric(row.metricValues?.[0]?.value), sessions: normalizedMetric(row.metricValues?.[1]?.value), events: normalizedMetric(row.metricValues?.[2]?.value) })),
    }
  }
  if (provider === 'google_search_console') {
    const rows = Array.isArray(data.rows) ? data.rows : []
    return {
      provider, period, totals: rows.reduce((sum: Json, row: any) => ({
        clicks: normalizedMetric(sum.clicks) + normalizedMetric(row.clicks),
        impressions: normalizedMetric(sum.impressions) + normalizedMetric(row.impressions),
      }), { clicks: 0, impressions: 0 }),
      rows: rows.map((row: any) => ({ query: row.keys?.[0] || '', clicks: normalizedMetric(row.clicks), impressions: normalizedMetric(row.impressions), ctr: normalizedMetric(row.ctr), position: normalizedMetric(row.position) })),
    }
  }
  const batches = Array.isArray(data) ? data : []
  const rows = batches.flatMap((batch: any) => Array.isArray(batch.results) ? batch.results : [])
  return {
    provider, period, totals: rows.reduce((sum: Json, row: any) => ({
      impressions: normalizedMetric(sum.impressions) + normalizedMetric(row.metrics?.impressions),
      clicks: normalizedMetric(sum.clicks) + normalizedMetric(row.metrics?.clicks),
      cost: normalizedMetric(sum.cost) + normalizedMetric(row.metrics?.costMicros) / 1_000_000,
      conversions: normalizedMetric(sum.conversions) + normalizedMetric(row.metrics?.conversions),
    }), { impressions: 0, clicks: 0, cost: 0, conversions: 0 }),
    rows: rows.map((row: any) => ({ campaign_id: row.campaign?.id, campaign: row.campaign?.name, status: row.campaign?.status, impressions: normalizedMetric(row.metrics?.impressions), clicks: normalizedMetric(row.metrics?.clicks), cost: normalizedMetric(row.metrics?.costMicros) / 1_000_000, conversions: normalizedMetric(row.metrics?.conversions) })),
  }
}

async function analyticsDashboard(admin: Client, body: Json) {
  const engagementId = text(body.engagement_id, 80)
  const engagement = await requireMarketingEngagement(admin, engagementId)
  const period = safeDateRange(body.start_date, body.end_date)
  const { data: mappings, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', ORGANIZATION_ID)
    .eq('engagement_id', engagement.id).eq('department_id', 'marketing')
  if (mappingError) throw mappingError
  const ids = (mappings || []).map(item => item.connection_id)
  if (!ids.length) return { engagement_id: engagement.id, brand_id: engagement.brand_id, period, reports: [] }
  const { data: connections, error } = await admin.from('integration_connections')
    .select('id, provider, display_name, public_config, status').eq('organization_id', ORGANIZATION_ID)
    .eq('status', 'verified').is('archived_at', null).in('id', ids).in('provider', [...GOOGLE_PROVIDERS])
  if (error) throw error
  const reports = await Promise.all((connections || []).map(async connection => {
    try {
      const token = await googleAccessToken(admin, connection.id, connection.provider)
      const report = await fetchReadOnlyGoogleReport(connection.provider, token, connection.public_config || {}, period)
      return { connection_id: connection.id, connection_name: connection.display_name, ...report }
    } catch (reportError) {
      return { connection_id: connection.id, connection_name: connection.display_name, provider: connection.provider,
        period, error: reportError instanceof Error ? reportError.message : 'Reporting request failed' }
    }
  }))
  return { engagement_id: engagement.id, brand_id: engagement.brand_id, period, reports }
}

export async function handleRequest(
  request: Request,
  dependencies: RequestDependencies = {},
) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { admin, user, membership } = await requireContext(
      request, dependencies.createClient, dependencies.environment,
    )
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (!hasMarketingAuthority(membership, action)) {
      return response({ error: action === 'approve_artifact' ? 'Marketing manager approval required' : 'Marketing department access required' }, 403)
    }
    if (action === 'create_campaign') return response({ data: await createCampaign(admin, body, user.id) })
    if (action === 'update_campaign') return response({ data: await updateCampaign(admin, body, user.id) })
    if (action === 'create_backlink_target') return response({ data: await createBacklinkTarget(admin, body, user.id) })
    if (action === 'update_backlink_target') return response({ data: await updateBacklinkTarget(admin, body) })
    if (action === 'save_artifact') return response({ data: await saveArtifact(admin, body, user.id) })
    if (action === 'approve_artifact') return response({ data: await approveArtifact(admin, body, user.id) })
    if (action === 'analytics_dashboard') return response({ data: await analyticsDashboard(admin, body) })
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Marketing Studio error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
