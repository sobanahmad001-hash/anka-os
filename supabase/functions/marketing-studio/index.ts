import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { googleAccessToken, namedKey, sha256 } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

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
const AD_CAMPAIGN_TYPES = new Set(['search', 'app', 'display', 'other'])
const AD_STRUCTURE_STATUSES = new Set(['draft', 'active', 'paused', 'ended'])
const AD_MATCH_TYPES = new Set(['broad', 'phrase', 'exact'])
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
  if (startMs > endMs || endMs - startMs > 365 * 86_400_000) {
    throw new Error('Reporting period must be ordered and include no more than 366 days')
  }
  return { start, end }
}

export function requestedGoogleProviders(value: unknown) {
  if (!Array.isArray(value)) return [...GOOGLE_PROVIDERS]
  const requested = new Set(value.map(provider => text(provider, 60)).filter(provider => GOOGLE_PROVIDERS.has(provider)))
  return [...GOOGLE_PROVIDERS].filter(provider => requested.has(provider))
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

function relatedObject(value: unknown): Json | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Json : null
}

function googleId(value: unknown, length: number | null, label: string) {
  const result = text(value, 40).replaceAll('-', '')
  if (!result) return null
  const pattern = length ? new RegExp(`^[0-9]{${length}}$`) : /^[0-9]+$/
  if (!pattern.test(result)) throw new Error(`${label} must contain ${length ? `${length} ` : ''}digits`)
  return result
}

export function validateAdCampaign(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ad campaign details are required')
  const input = value as Json
  const campaignName = text(input.campaign_name, 180)
  const campaignType = text(input.campaign_type, 20)
  const status = text(input.status, 20) || 'draft'
  const startDate = safeDate(input.start_date)
  const endDate = safeDate(input.end_date)
  const providerConnectionId = text(input.provider_connection_id, 80) || null
  const externalAccountId = googleId(input.external_account_id, 10, 'External account ID')
  const externalCampaignId = googleId(input.external_campaign_id, null, 'External campaign ID')
  if (!campaignName) throw new Error('Campaign name is required')
  if (!AD_CAMPAIGN_TYPES.has(campaignType)) throw new Error('Unsupported ad campaign type')
  if (!AD_STRUCTURE_STATUSES.has(status)) throw new Error('Unsupported ad campaign status')
  if (startDate && endDate && startDate > endDate) throw new Error('Campaign end date cannot precede its start date')
  const identityParts = [providerConnectionId, externalAccountId, externalCampaignId].filter(Boolean).length
  if (identityParts !== 0 && identityParts !== 3) {
    throw new Error('Connection, external account ID, and external campaign ID must be supplied together')
  }
  return {
    campaign_name: campaignName, campaign_type: campaignType, status,
    daily_budget: optionalNumber(input.daily_budget, 'Daily budget'),
    total_budget: optionalNumber(input.total_budget, 'Total budget'),
    start_date: startDate, end_date: endDate, goal: text(input.goal, 2000),
    location_targeting: strings(input.location_targeting, 50),
    audience_segment: text(input.audience_segment, 2000),
    provider_connection_id: providerConnectionId,
    external_account_id: externalAccountId, external_campaign_id: externalCampaignId,
  }
}

export function validateAdGroup(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ad group details are required')
  const input = value as Json
  const name = text(input.name, 180)
  const status = text(input.status, 20) || 'draft'
  if (!name) throw new Error('Ad group name is required')
  if (!AD_STRUCTURE_STATUSES.has(status)) throw new Error('Unsupported ad group status')
  return { name, status }
}

export function validateAdKeyword(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Keyword details are required')
  const input = value as Json
  const keyword = text(input.keyword, 500)
  const matchType = text(input.match_type, 20)
  if (!keyword) throw new Error('Keyword is required')
  if (!AD_MATCH_TYPES.has(matchType)) throw new Error('Unsupported keyword match type')
  return { keyword, match_type: matchType, is_negative: input.is_negative === true }
}

type RequestDependencies = {
  createClient?: typeof createClient
  environment?: { supabaseUrl: string; publishableKey: string; secretKey: string }
}

type MarketingRequestContext = { admin: Client; organizationId: string }

async function requireContext(
  request: Request,
  organizationId: string,
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
  if (!organizationId) throw Object.assign(new Error('Active organization is required'), { status: 400 })
  const { data: membership } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind, organization:organizations!inner(id, status)')
    .eq('organization_id', organizationId).eq('user_id', user.id)
    .eq('member_kind', 'team').eq('status', 'active').eq('organization.status', 'active').maybeSingle()
  if (!membership || membership.organization_id !== organizationId) {
    throw Object.assign(new Error('Active team membership required'), { status: 403 })
  }
  return { admin, user, membership, organizationId: membership.organization_id }
}

async function requireMarketingEngagement(context: MarketingRequestContext, engagementId: string) {
  const { admin, organizationId } = context
  const { data: engagement, error } = await admin.from('engagements').select('id, organization_id, brand_id, name, status')
    .eq('id', engagementId).eq('organization_id', organizationId).maybeSingle()
  if (error || !engagement) throw Object.assign(new Error('Engagement not found'), { status: 404 })
  const { data: services, error: serviceError } = await admin.from('engagement_services')
    .select('id, service_catalog!inner(department_id)').eq('organization_id', organizationId)
    .eq('engagement_id', engagementId)
    .eq('service_catalog.department_id', 'marketing').limit(1)
  if (serviceError || !services?.length) {
    throw Object.assign(new Error('This engagement has no active Marketing service'), { status: 409 })
  }
  return engagement
}

async function requireBrand(context: MarketingRequestContext, brandId: string) {
  const { admin, organizationId } = context
  const { data: brand, error } = await admin.from('brands').select('id, organization_id, name')
    .eq('id', brandId).eq('organization_id', organizationId).maybeSingle()
  if (error || !brand) throw Object.assign(new Error('Brand not found'), { status: 404 })
  return brand
}

async function requireGoogleAdsConnection(context: MarketingRequestContext, engagementId: string, connectionId: string) {
  const { admin, organizationId } = context
  const { data: mapping, error } = await admin.from('integration_connection_engagements')
    .select('connection_id, integration_connections!inner(id, provider, display_name, public_config, status, archived_at)')
    .eq('organization_id', organizationId).eq('engagement_id', engagementId)
    .eq('department_id', 'marketing').eq('connection_id', connectionId).maybeSingle()
  const connection = relatedObject(mapping?.integration_connections)
  if (error || !connection || connection.provider !== 'google_ads' || connection.status !== 'verified' || connection.archived_at) {
    throw Object.assign(new Error('A verified Google Ads connection mapped to this engagement is required'), { status: 409 })
  }
  return connection
}

async function listGoogleAdsConnections(context: MarketingRequestContext, engagementId: string) {
  const { admin, organizationId } = context
  await requireMarketingEngagement(context, engagementId)
  const { data: mappings, error } = await admin.from('integration_connection_engagements')
    .select('connection_id, integration_connections!inner(id, provider, display_name, public_config, status, archived_at)')
    .eq('organization_id', organizationId).eq('engagement_id', engagementId)
    .eq('department_id', 'marketing')
  if (error) throw error
  return (mappings || []).map(item => relatedObject(item.integration_connections)).filter((connection): connection is Json =>
    connection !== null &&
    connection.provider === 'google_ads' && connection.status === 'verified' && !connection.archived_at
  ).map(connection => ({
    id: connection.id, display_name: connection.display_name,
    customer_id: text((connection.public_config as Json | null)?.customer_id, 24),
  }))
}

async function recordEvent(context: MarketingRequestContext, engagementId: string, actorId: string, eventType: string, payload: Json) {
  const { admin, organizationId } = context
  const { error } = await admin.from('engagement_events').insert({
    organization_id: organizationId, engagement_id: engagementId,
    event_type: eventType, actor_id: actorId, payload,
  })
  if (error) throw error
}

async function createCampaign(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const engagementId = text(body.engagement_id, 80)
  const engagement = await requireMarketingEngagement(context, engagementId)
  const campaign = validateCampaign(body.campaign)
  const { data, error } = await admin.from('marketing_campaigns').insert({
    organization_id: organizationId, engagement_id: engagement.id, brand_id: engagement.brand_id,
    ...campaign, created_by: actorId, updated_by: actorId,
  }).select('*').single()
  if (error) throw error
  await recordEvent(context, engagement.id, actorId, 'campaign_created', {
    record_type: 'marketing_campaign', record_id: data.id, action: 'created',
    name: data.name, status: data.status,
  })
  return data
}

async function updateCampaign(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const campaignId = text(body.campaign_id, 80)
  const { data: existing } = await admin.from('marketing_campaigns').select('*')
    .eq('id', campaignId).eq('organization_id', organizationId).maybeSingle()
  if (!existing) throw Object.assign(new Error('Campaign not found'), { status: 404 })
  await requireMarketingEngagement(context, existing.engagement_id)
  const campaign = validateCampaign(body.campaign)
  const { data, error } = await admin.from('marketing_campaigns').update({
    ...campaign, updated_by: actorId,
  }).eq('id', existing.id).eq('organization_id', organizationId).select('*').single()
  if (error) throw error
  await recordEvent(context, existing.engagement_id, actorId, 'campaign_updated', {
    record_type: 'marketing_campaign', record_id: data.id, action: 'updated',
    previous_status: existing.status, status: data.status,
  })
  return data
}

async function createBacklinkTarget(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const brandId = text(body.brand_id, 80)
  const brand = await requireBrand(context, brandId)
  const target = validateBacklinkTarget(body.target)
  const { data, error } = await admin.from('backlink_targets').insert({
    organization_id: organizationId,
    brand_id: brand.id,
    ...target,
    created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function requireAdCampaign(context: MarketingRequestContext, campaignId: string) {
  const { admin, organizationId } = context
  const { data, error } = await admin.from('ad_campaigns').select('*')
    .eq('id', campaignId).eq('organization_id', organizationId).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Ad campaign not found'), { status: 404 })
  return data
}

async function createAdCampaign(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  const campaign = validateAdCampaign(body.campaign)
  if (campaign.provider_connection_id) {
    const connection = await requireGoogleAdsConnection(context, engagement.id, campaign.provider_connection_id)
    const configuredCustomerId = text((connection.public_config as Json | null)?.customer_id, 24)
    if (configuredCustomerId && configuredCustomerId !== campaign.external_account_id) {
      throw new Error('External account ID does not match the selected Google Ads connection')
    }
  }
  const { data, error } = await admin.from('ad_campaigns').insert({
    organization_id: organizationId, brand_id: engagement.brand_id, ...campaign, created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function updateBacklinkTarget(context: MarketingRequestContext, body: Json) {
  const { admin, organizationId } = context
  const targetId = text(body.target_id, 80)
  const { data: existing, error: existingError } = await admin.from('backlink_targets')
    .select('id, brand_id').eq('id', targetId).eq('organization_id', organizationId).maybeSingle()
  if (existingError) throw existingError
  if (!existing) throw Object.assign(new Error('Backlink target not found'), { status: 404 })
  await requireBrand(context, existing.brand_id)
  const target = validateBacklinkTarget(body.target)
  const { data, error } = await admin.from('backlink_targets').update(target)
    .eq('id', existing.id).eq('organization_id', organizationId).select('*').single()
  if (error) throw error
  return data
}

async function updateAdCampaign(context: MarketingRequestContext, body: Json) {
  const { admin, organizationId } = context
  const existing = await requireAdCampaign(context, text(body.ad_campaign_id, 80))
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  if (engagement.brand_id !== existing.brand_id) throw new Error('Ad campaign does not belong to this engagement brand')
  const campaign = validateAdCampaign(body.campaign)
  if (campaign.provider_connection_id) {
    const connection = await requireGoogleAdsConnection(context, engagement.id, campaign.provider_connection_id)
    const configuredCustomerId = text((connection.public_config as Json | null)?.customer_id, 24)
    if (configuredCustomerId && configuredCustomerId !== campaign.external_account_id) {
      throw new Error('External account ID does not match the selected Google Ads connection')
    }
  }
  const { data, error } = await admin.from('ad_campaigns').update(campaign)
    .eq('id', existing.id).eq('organization_id', organizationId).select('*').single()
  if (error) throw error
  return data
}

async function deleteAdCampaign(context: MarketingRequestContext, body: Json) {
  const { admin, organizationId } = context
  const existing = await requireAdCampaign(context, text(body.ad_campaign_id, 80))
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  if (engagement.brand_id !== existing.brand_id) throw new Error('Ad campaign does not belong to this engagement brand')
  const { error } = await admin.from('ad_campaigns').delete().eq('id', existing.id).eq('organization_id', organizationId)
  if (error) throw error
  return { id: existing.id }
}

async function saveAdGroup(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const campaign = await requireAdCampaign(context, text(body.ad_campaign_id, 80))
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  if (engagement.brand_id !== campaign.brand_id) throw new Error('Ad campaign does not belong to this engagement brand')
  const values = validateAdGroup(body.ad_group)
  const groupId = text(body.ad_group_id, 80)
  if (!groupId) {
    const { data, error } = await admin.from('ad_groups').insert({
      organization_id: organizationId, ad_campaign_id: campaign.id, ...values, created_by: actorId,
    }).select('*').single()
    if (error) throw error
    return data
  }
  const { data: existing } = await admin.from('ad_groups').select('id, ad_campaign_id')
    .eq('id', groupId).eq('organization_id', organizationId).maybeSingle()
  if (!existing || existing.ad_campaign_id !== campaign.id) throw new Error('Ad group does not belong to this campaign')
  const { data, error } = await admin.from('ad_groups').update(values).eq('id', groupId).eq('organization_id', organizationId).select('*').single()
  if (error) throw error
  return data
}

async function deleteAdGroup(context: MarketingRequestContext, body: Json) {
  const { admin, organizationId } = context
  const groupId = text(body.ad_group_id, 80)
  const { data: group } = await admin.from('ad_groups').select('id, ad_campaign_id, ad_campaigns!inner(brand_id)')
    .eq('id', groupId).eq('organization_id', organizationId).maybeSingle()
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  if (!group || relatedObject(group.ad_campaigns)?.brand_id !== engagement.brand_id) throw new Error('Ad group not found for this brand')
  const { error } = await admin.from('ad_groups').delete().eq('id', group.id).eq('organization_id', organizationId)
  if (error) throw error
  return { id: group.id }
}

async function saveAdKeyword(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const groupId = text(body.ad_group_id, 80)
  const { data: group } = await admin.from('ad_groups')
    .select('id, ad_campaign_id, ad_campaigns!inner(brand_id)')
    .eq('id', groupId).eq('organization_id', organizationId).maybeSingle()
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  if (!group || relatedObject(group.ad_campaigns)?.brand_id !== engagement.brand_id) throw new Error('Ad group not found for this brand')
  const values = validateAdKeyword(body.keyword)
  const keywordId = text(body.keyword_id, 80)
  if (!keywordId) {
    const { data, error } = await admin.from('ad_group_keywords').insert({
      organization_id: organizationId, ad_group_id: group.id, ...values, created_by: actorId,
    }).select('*').single()
    if (error) throw error
    return data
  }
  const { data: existing } = await admin.from('ad_group_keywords').select('id, ad_group_id')
    .eq('id', keywordId).eq('organization_id', organizationId).maybeSingle()
  if (!existing || existing.ad_group_id !== group.id) throw new Error('Keyword does not belong to this ad group')
  const { data, error } = await admin.from('ad_group_keywords').update(values).eq('id', keywordId).eq('organization_id', organizationId).select('*').single()
  if (error) throw error
  return data
}

async function deleteAdKeyword(context: MarketingRequestContext, body: Json) {
  const { admin, organizationId } = context
  const keywordId = text(body.keyword_id, 80)
  const { data: keyword } = await admin.from('ad_group_keywords')
    .select('id, ad_groups!inner(ad_campaigns!inner(brand_id))')
    .eq('id', keywordId).eq('organization_id', organizationId).maybeSingle()
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  const brandId = relatedObject(relatedObject(keyword?.ad_groups)?.ad_campaigns)?.brand_id
  if (!keyword || brandId !== engagement.brand_id) throw new Error('Keyword not found for this brand')
  const { error } = await admin.from('ad_group_keywords').delete().eq('id', keyword.id).eq('organization_id', organizationId)
  if (error) throw error
  return { id: keyword.id }
}

async function saveArtifact(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const engagementId = text(body.engagement_id, 80)
  const campaignId = text(body.campaign_id, 80)
  const artifactType = text(body.artifact_type, 60)
  const engagement = await requireMarketingEngagement(context, engagementId)
  const content = validateMarketingArtifact(artifactType, body.content)
  const checksum = await sha256(stableJson(content))
  let artifactId = text(body.artifact_id, 80)
  if (artifactId) {
    const { data: artifact } = await admin.from('artifacts').select('id, artifact_type, engagement_id, brand_id')
      .eq('id', artifactId).eq('organization_id', organizationId).maybeSingle()
    if (!artifact || artifact.artifact_type !== artifactType || artifact.engagement_id !== engagement.id || artifact.brand_id !== engagement.brand_id) {
      throw new Error('Marketing artifact does not match this engagement and type')
    }
  } else {
    const { data: artifact, error } = await admin.from('artifacts').insert({
      organization_id: organizationId, engagement_id: engagement.id, brand_id: engagement.brand_id,
      artifact_type: artifactType, title: text(body.title, 240) || artifactType.replaceAll('_', ' '), created_by: actorId,
    }).select('id').single()
    if (error) throw error
    artifactId = artifact.id
  }
  const { data: latest } = await admin.from('artifact_versions').select('id, version_number')
    .eq('artifact_id', artifactId).eq('organization_id', organizationId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  const { data: version, error: versionError } = await admin.from('artifact_versions').insert({
    organization_id: organizationId, artifact_id: artifactId,
    version_number: (latest?.version_number || 0) + 1, parent_version_id: latest?.id || null,
    content, content_checksum: checksum, change_summary: text(body.change_summary, 1000),
    ai_use_allowed: body.ai_use_allowed === true, data_classification: 'internal', created_by: actorId,
  }).select('*').single()
  if (versionError) throw versionError
  if (campaignId) {
    const { data: campaign } = await admin.from('marketing_campaigns').select('id, engagement_id')
      .eq('id', campaignId).eq('organization_id', organizationId).maybeSingle()
    if (!campaign || campaign.engagement_id !== engagement.id) throw new Error('Campaign does not match this engagement')
    const { error: linkError } = await admin.from('marketing_campaign_artifacts').upsert({
      organization_id: organizationId, campaign_id: campaign.id, artifact_id: artifactId,
      relation_type: artifactType, linked_by: actorId,
    }, { onConflict: 'campaign_id,artifact_id', ignoreDuplicates: true })
    if (linkError) throw linkError
  }
  await recordEvent(context, engagement.id, actorId, 'artifact_version_created', {
    record_type: 'artifact', record_id: artifactId, version_id: version.id,
    action: 'version_created', artifact_type: artifactType, campaign_id: campaignId || null,
  })
  return version
}

async function approveArtifact(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const versionId = text(body.artifact_version_id, 80)
  const { data: version } = await admin.from('artifact_versions')
    .select('*, artifacts!inner(id, artifact_type, engagement_id, organization_id)')
    .eq('id', versionId).eq('organization_id', organizationId).maybeSingle()
  const artifact = version?.artifacts
  if (!version || !artifact || !MARKETING_ARTIFACT_TYPES.has(artifact.artifact_type) || !artifact.engagement_id) {
    throw Object.assign(new Error('Marketing artifact version not found'), { status: 404 })
  }
  await requireMarketingEngagement(context, artifact.engagement_id)
  const { data: pendingRequest, error: requestError } = await admin.from('artifact_approval_requests')
    .select('id').eq('artifact_version_id', version.id).eq('organization_id', organizationId)
    .eq('status', 'pending').maybeSingle()
  if (requestError) throw requestError
  if (pendingRequest) {
    throw Object.assign(new Error('This version is governed by a pending multi-approver request'), { status: 409 })
  }
  const { data: approval, error } = await admin.from('artifact_approvals').insert({
    organization_id: organizationId, artifact_id: artifact.id, artifact_version_id: version.id,
    engagement_id: artifact.engagement_id, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (error) throw error
  await recordEvent(context, artifact.engagement_id, actorId, 'artifact_approved', {
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
    requestBody = { startDate: period.start, endDate: period.end, dimensions: ['date'], rowLimit: 366, dataState: 'final' }
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
      rows: rows.map((row: any) => ({ date: row.keys?.[0] || '', clicks: normalizedMetric(row.clicks), impressions: normalizedMetric(row.impressions), ctr: normalizedMetric(row.ctr), position: normalizedMetric(row.position) })),
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

export async function fetchGoogleAdsCampaignSnapshot(
  token: string,
  config: Json,
  externalCampaignId: string,
  snapshotDate: string,
  fetcher: typeof fetch = fetch,
  serverSecrets: { googleAdsDeveloperToken?: string } = {},
) {
  const customerId = googleId(config.customer_id, 10, 'Google Ads customer ID')
  const campaignId = googleId(externalCampaignId, null, 'External campaign ID')
  const date = safeDate(snapshotDate, true) as string
  if (!customerId || !campaignId) throw new Error('Google Ads campaign identity is incomplete')
  const developerToken = serverSecrets.googleAdsDeveloperToken ?? Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')
  if (!developerToken) throw new Error('Google Ads developer token is not configured')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'developer-token': developerToken,
  }
  const loginCustomerId = googleId(config.login_customer_id, 10, 'Google Ads manager ID')
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId
  const query = `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = ${campaignId} AND segments.date = '${date}' LIMIT 1`
  const result = await fetcher(`https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15_000),
  })
  const data = await result.json()
  if (!result.ok) throw Object.assign(new Error('Google Ads reporting request failed'), { code: `HTTP_${result.status}` })
  const row = (Array.isArray(data) ? data : []).flatMap((batch: any) => batch.results || [])[0]
  if (!row) throw Object.assign(new Error('No finalized Google Ads metrics were returned for this campaign and date'), { status: 404 })
  return {
    snapshot_date: date,
    impressions: normalizedMetric(row.metrics?.impressions),
    clicks: normalizedMetric(row.metrics?.clicks),
    cost: normalizedMetric(row.metrics?.costMicros) / 1_000_000,
    conversions: Math.round(normalizedMetric(row.metrics?.conversions)),
  }
}

async function importAdCampaignPerformance(context: MarketingRequestContext, body: Json, actorId: string) {
  const { admin, organizationId } = context
  const campaign = await requireAdCampaign(context, text(body.ad_campaign_id, 80))
  const engagement = await requireMarketingEngagement(context, text(body.engagement_id, 80))
  if (engagement.brand_id !== campaign.brand_id) throw new Error('Ad campaign does not belong to this engagement brand')
  if (!campaign.provider_connection_id || !campaign.external_campaign_id || !campaign.external_account_id) {
    throw new Error('Link this planning campaign to its Google Ads identity before importing performance')
  }
  const connection = await requireGoogleAdsConnection(context, engagement.id, campaign.provider_connection_id)
  const config = (connection.public_config || {}) as Json
  if (text(config.customer_id, 24) !== campaign.external_account_id) {
    throw new Error('Campaign account identity no longer matches the selected connection')
  }
  const token = await googleAccessToken(admin, campaign.provider_connection_id, 'google_ads')
  const snapshot = await fetchGoogleAdsCampaignSnapshot(
    token, config, campaign.external_campaign_id, text(body.snapshot_date, 10),
  )
  const insert = {
    organization_id: organizationId, ad_campaign_id: campaign.id,
    provider_connection_id: campaign.provider_connection_id,
    external_campaign_id: campaign.external_campaign_id, created_by: actorId, ...snapshot,
  }
  const { data: created, error } = await admin.from('ad_campaign_performance_snapshots')
    .upsert(insert, { onConflict: 'ad_campaign_id,snapshot_date', ignoreDuplicates: true })
    .select('*').maybeSingle()
  if (error) throw error
  if (created) return { snapshot: created, imported: true }
  const { data: existing, error: existingError } = await admin.from('ad_campaign_performance_snapshots')
    .select('*').eq('organization_id', organizationId).eq('ad_campaign_id', campaign.id)
    .eq('snapshot_date', snapshot.snapshot_date).single()
  if (existingError) throw existingError
  return { snapshot: existing, imported: false }
}

async function analyticsDashboard(context: MarketingRequestContext, body: Json) {
  const { admin, organizationId } = context
  const engagementId = text(body.engagement_id, 80)
  const engagement = await requireMarketingEngagement(context, engagementId)
  const period = safeDateRange(body.start_date, body.end_date)
  const providers = requestedGoogleProviders(body.providers)
  if (!providers.length) return { engagement_id: engagement.id, brand_id: engagement.brand_id, period, reports: [] }
  const { data: mappings, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', organizationId)
    .eq('engagement_id', engagement.id).eq('department_id', 'marketing')
  if (mappingError) throw mappingError
  const ids = (mappings || []).map(item => item.connection_id)
  if (!ids.length) return { engagement_id: engagement.id, brand_id: engagement.brand_id, period, reports: [] }
  const { data: connections, error } = await admin.from('integration_connections')
    .select('id, provider, display_name, public_config, status').eq('organization_id', organizationId)
    .eq('status', 'verified').is('archived_at', null).in('id', ids).in('provider', providers)
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
    const body = await request.json() as Json
    const requestedOrganizationId = text(body.organization_id, 80)
    const { admin, user, membership, organizationId } = await requireContext(
      request, requestedOrganizationId, dependencies.createClient, dependencies.environment,
    )
    const context = { admin, organizationId }
    const action = text(body.action, 60)
    if (action !== 'list_google_ads_connections' && !hasMarketingAuthority(membership, action)) {
      return response({ error: action === 'approve_artifact' ? 'Marketing manager approval required' : 'Marketing department access required' }, 403)
    }
    if (action === 'create_campaign') return response({ data: await createCampaign(context, body, user.id) })
    if (action === 'update_campaign') return response({ data: await updateCampaign(context, body, user.id) })
    if (action === 'create_backlink_target') return response({ data: await createBacklinkTarget(context, body, user.id) })
    if (action === 'update_backlink_target') return response({ data: await updateBacklinkTarget(context, body) })
    if (action === 'list_google_ads_connections') return response({ data: await listGoogleAdsConnections(context, text(body.engagement_id, 80)) })
    if (action === 'create_ad_campaign') return response({ data: await createAdCampaign(context, body, user.id) })
    if (action === 'update_ad_campaign') return response({ data: await updateAdCampaign(context, body) })
    if (action === 'delete_ad_campaign') return response({ data: await deleteAdCampaign(context, body) })
    if (action === 'save_ad_group') return response({ data: await saveAdGroup(context, body, user.id) })
    if (action === 'delete_ad_group') return response({ data: await deleteAdGroup(context, body) })
    if (action === 'save_ad_keyword') return response({ data: await saveAdKeyword(context, body, user.id) })
    if (action === 'delete_ad_keyword') return response({ data: await deleteAdKeyword(context, body) })
    if (action === 'import_ad_campaign_performance') return response({ data: await importAdCampaignPerformance(context, body, user.id) })
    if (action === 'save_artifact') return response({ data: await saveArtifact(context, body, user.id) })
    if (action === 'approve_artifact') return response({ data: await approveArtifact(context, body, user.id) })
    if (action === 'analytics_dashboard') return response({ data: await analyticsDashboard(context, body) })
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected Marketing Studio error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve((request) => handleRequest(request))
