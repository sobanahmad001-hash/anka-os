export const MARKETING_ARTIFACT_FORMS = Object.freeze({
  channel_strategy: Object.freeze({
    label: 'Channel strategy',
    description: 'Defines channel roles, sequencing, audiences, objectives, and success measures.',
    fields: Object.freeze([
      ['objectives', 'Objectives', 'list'], ['priority_audiences', 'Priority audiences', 'list'],
      ['channel_roles', 'Channel roles', 'list'], ['sequencing', 'Channel sequencing', 'textarea'],
      ['success_measures', 'Success measures', 'list'],
    ]),
  }),
  campaign_brief: Object.freeze({
    label: 'Campaign brief',
    description: 'A governed campaign plan with explicit goals, channels, measures, and exact-version assets.',
    fields: Object.freeze([
      ['campaign_goal', 'Campaign goal', 'textarea'], ['channels', 'Channels', 'list'],
      ['market', 'Market', 'text'], ['audience', 'Audience', 'textarea'],
      ['offer', 'Offer', 'textarea'], ['key_message', 'Key message', 'textarea'],
      ['starts_on', 'Starts on', 'date'], ['ends_on', 'Ends on', 'date'],
      ['measurement_target', 'Measurement target', 'text'],
      ['measurement_value', 'Measurement value', 'number'],
      ['measurement_unit', 'Measurement unit', 'text'],
      ['measurement_evidence', 'Measurement evidence', 'textarea'],
      ['deliverables', 'Deliverables', 'list'],
      ['existing_asset_version_ids', 'Existing asset version IDs', 'list'],
    ]),
  }),
  measurement_plan: Object.freeze({
    label: 'Measurement plan',
    description: 'Connects business objectives to KPIs, conversions, tracking, and reporting cadence.',
    fields: Object.freeze([
      ['business_objectives', 'Business objectives', 'list'], ['kpis', 'KPIs', 'list'],
      ['conversions', 'Conversions', 'list'], ['tracking_requirements', 'Tracking requirements', 'list'],
      ['reporting_cadence', 'Reporting cadence', 'textarea'],
    ]),
  }),
  marketing_report: Object.freeze({
    label: 'Marketing report',
    description: 'A traceable source-and-period report with evidence, insight, and recommended action.',
    fields: Object.freeze([
      ['sources', 'Sources', 'list'], ['period_start', 'Period start', 'date'],
      ['period_end', 'Period end', 'date'], ['executive_summary', 'Executive summary', 'textarea'],
      ['insights', 'Insights', 'list'], ['recommended_actions', 'Recommended actions', 'list'],
    ]),
  }),
})

export const CAMPAIGN_STATUSES = Object.freeze(['draft', 'planned', 'active', 'paused', 'completed', 'cancelled'])
export const AD_CAMPAIGN_TYPES = Object.freeze(['search', 'app', 'display', 'other'])
export const AD_STRUCTURE_STATUSES = Object.freeze(['draft', 'active', 'paused', 'ended'])
export const AD_MATCH_TYPES = Object.freeze(['broad', 'phrase', 'exact'])

export function adPerformanceMetrics(snapshot = {}) {
  const impressions = Number(snapshot.impressions) || 0
  const clicks = Number(snapshot.clicks) || 0
  const cost = Number(snapshot.cost) || 0
  const conversions = Number(snapshot.conversions) || 0
  return {
    ctr: impressions ? clicks / impressions : null,
    cpc: clicks ? cost / clicks : null,
    cost_per_conversion: conversions ? cost / conversions : null,
  }
}

export function campaignAfterDeletion(campaigns = [], deletedCampaignId = '') {
  return campaigns.find(campaign => campaign.id !== deletedCampaignId) || null
}

export function blankMarketingArtifact(type) {
  return Object.fromEntries((MARKETING_ARTIFACT_FORMS[type]?.fields || []).map(([key, , kind]) => [key, kind === 'list' ? [] : '']))
}

export function validateCampaignBriefDraft(value = {}) {
  const content = { ...blankMarketingArtifact('campaign_brief'), ...value }
  const channels = Array.isArray(content.channels) ? content.channels.map(item => String(item).trim()).filter(Boolean) : lines(content.channels)
  if (!String(content.campaign_goal || '').trim()) throw new Error('Campaign goal is required')
  if (!channels.length) throw new Error('At least one channel is required')
  if (content.starts_on && !/^\d{4}-\d{2}-\d{2}$/.test(content.starts_on)) throw new Error('Start date must use YYYY-MM-DD')
  if (content.ends_on && !/^\d{4}-\d{2}-\d{2}$/.test(content.ends_on)) throw new Error('End date must use YYYY-MM-DD')
  if (content.starts_on && content.ends_on && content.ends_on < content.starts_on) throw new Error('End date cannot precede start date')
  if (content.measurement_value !== '' && content.measurement_value !== null && content.measurement_value !== undefined) {
    if (!Number.isFinite(Number(content.measurement_value))) throw new Error('Measurement value must be a number')
    if (!String(content.measurement_unit || '').trim()) throw new Error('Measurement unit is required when a value is provided')
  }
  return {
    campaign_goal: String(content.campaign_goal).trim(), channels,
    market: String(content.market || '').trim(), audience: String(content.audience || '').trim(),
    offer: String(content.offer || '').trim(), key_message: String(content.key_message || '').trim(),
    starts_on: content.starts_on || '', ends_on: content.ends_on || '',
    measurement_target: String(content.measurement_target || '').trim(),
    measurement_value: content.measurement_value === '' || content.measurement_value === null || content.measurement_value === undefined ? null : Number(content.measurement_value),
    measurement_unit: String(content.measurement_unit || '').trim(),
    measurement_evidence: String(content.measurement_evidence || '').trim(),
    deliverables: Array.isArray(content.deliverables) ? content.deliverables.map(item => String(item).trim()).filter(Boolean) : lines(content.deliverables),
    existing_asset_version_ids: [...new Set(Array.isArray(content.existing_asset_version_ids) ? content.existing_asset_version_ids.map(item => String(item).trim()).filter(Boolean) : lines(content.existing_asset_version_ids))],
  }
}

export function selectedCampaignBriefSuggestions(current, suggested, selectedFields = []) {
  return selectedFields.reduce((next, field) => Object.prototype.hasOwnProperty.call(suggested || {}, field)
    ? { ...next, [field]: suggested[field] } : next, { ...current })
}

export function lines(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean)
}

export function latestVersion(rows = []) {
  return [...rows].sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function resolveMarketingArtifactDestination(workspace, output, campaignId = '') {
  if (!output) return null
  if (output.kind !== 'artifact' || !output.id || !output.versionId || !workspace?.engagement) return Object.freeze({ status: 'invalid' })
  const organizationId = workspace.engagement.organization_id
  const engagementId = workspace.engagement.id
  const artifact = workspace.artifacts.find(item => item.id === output.id && item.organization_id === organizationId && item.engagement_id === engagementId)
  const version = workspace.versions.find(item => item.id === output.versionId && item.organization_id === organizationId && item.artifact_id === artifact?.id)
  if (!artifact || !version) return Object.freeze({ status: 'invalid' })
  const links = workspace.links.filter(item => item.organization_id === organizationId && item.artifact_id === artifact.id)
  const link = campaignId ? links.find(item => item.campaign_id === campaignId) : links.length === 1 ? links[0] : null
  const campaign = workspace.campaigns.find(item => item.id === link?.campaign_id && item.organization_id === organizationId && item.engagement_id === engagementId)
  if (!link || !campaign) return Object.freeze({ status: 'invalid' })
  return Object.freeze({ status: 'ready', artifact, version, campaign, link })
}

export function defaultReportingPeriod(now = new Date(), timeZone = null) {
  if (!timeZone) return { start: '', end: '', timeZone: null, automatic: false }
  let parts
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  } catch {
    return { start: '', end: '', timeZone: null, automatic: false }
  }
  const end = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 29)
  return {
    start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10),
    timeZone, automatic: true,
  }
}
