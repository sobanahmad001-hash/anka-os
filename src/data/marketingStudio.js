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
    description: 'The campaign goal, audience, offer, message, channels, and deliverables.',
    fields: Object.freeze([
      ['campaign_goal', 'Campaign goal', 'textarea'], ['audience', 'Audience', 'textarea'],
      ['offer', 'Offer', 'textarea'], ['key_message', 'Key message', 'textarea'],
      ['channels', 'Channels', 'list'], ['deliverables', 'Deliverables', 'list'],
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

export function lines(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean)
}

export function latestVersion(rows = []) {
  return [...rows].sort((left, right) => right.version_number - left.version_number)[0] || null
}

export function defaultReportingPeriod(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 27)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}
