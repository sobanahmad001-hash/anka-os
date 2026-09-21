const DATE = /^\d{4}-\d{2}-\d{2}$/

const clean = value => typeof value === 'string' ? value.trim() : ''

function isCalendarDate(value) {
  if (!DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export function reportLines(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split('\n')
  return [...new Set(rows.map(item => clean(String(item))).filter(Boolean))]
}

export function emptyMarketingReportDraft() {
  return { title: '', period_start: '', period_end: '', sources: [], metric_snapshot_refs: [], executive_summary: '', insights: [], recommended_actions: [] }
}

export function marketingReportDraft(artifact = null, version = null) {
  const content = version?.content && typeof version.content === 'object' ? version.content : {}
  return {
    ...emptyMarketingReportDraft(), title: clean(content.report_title) || clean(artifact?.title), period_start: clean(content.period_start),
    period_end: clean(content.period_end), sources: reportLines(content.sources),
    metric_snapshot_refs: Array.isArray(content.metric_snapshot_refs) ? content.metric_snapshot_refs : [],
    executive_summary: clean(content.executive_summary), insights: reportLines(content.insights),
    recommended_actions: reportLines(content.recommended_actions),
  }
}

export function validateMarketingReportDraft(value = {}) {
  const title = clean(value.title).slice(0, 240)
  const periodStart = clean(value.period_start)
  const periodEnd = clean(value.period_end)
  const contractLines = input => reportLines(input).slice(0, 20).map(item => item.slice(0, 500))
  const sources = contractLines(value.sources)
  const metricRefs = Array.isArray(value.metric_snapshot_refs) ? value.metric_snapshot_refs : []
  if (metricRefs.length > 30 || metricRefs.some(ref => !ref || !['google_ads', 'keyword_tracking', 'meta'].includes(ref.source) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(ref.snapshot_id || ''))) ||
    new Set(metricRefs.map(ref => ref.source + ':' + String(ref.snapshot_id).toLowerCase())).size !== metricRefs.length) {
    throw new Error('Choose up to 30 distinct exact metric snapshots')
  }
  const executiveSummary = clean(value.executive_summary).slice(0, 4000)
  const insights = contractLines(value.insights)
  const recommendedActions = contractLines(value.recommended_actions)
  if (!title) throw new Error('Report title is required')
  if (!isCalendarDate(periodStart) || !isCalendarDate(periodEnd)) throw new Error('Reporting period requires exact start and end dates')
  if (periodEnd < periodStart) throw new Error('Reporting period end cannot precede its start')
  if (!sources.length) throw new Error('Select at least one report source')
  if (!executiveSummary) throw new Error('Executive summary is required by the current report contract')
  if (!insights.length) throw new Error('At least one insight is required by the current report contract')
  if (!recommendedActions.length) throw new Error('At least one recommended action is required by the current report contract')
  return { title, content: { report_title: title, sources, period_start: periodStart, period_end: periodEnd,
    ...(metricRefs.length ? { metric_snapshot_refs: metricRefs.map(ref => ({ source: ref.source, snapshot_id: ref.snapshot_id.toLowerCase() })).sort((a, b) => a.source.localeCompare(b.source) || a.snapshot_id.localeCompare(b.snapshot_id)) } : {}),
    executive_summary: executiveSummary, insights, recommended_actions: recommendedActions } }
}

export function marketingReportRecords(workspace = {}) {
  const engagement = workspace.engagement
  if (!engagement?.id || !engagement.organization_id) return []
  return (workspace.artifacts || [])
    .filter(artifact => artifact.artifact_type === 'marketing_report' && artifact.organization_id === engagement.organization_id && artifact.engagement_id === engagement.id && (!artifact.brand_id || artifact.brand_id === engagement.brand_id))
    .map(artifact => ({
      artifact,
      versions: (workspace.versions || []).filter(version => version.organization_id === engagement.organization_id && version.artifact_id === artifact.id).sort((left, right) => Number(right.version_number) - Number(left.version_number)),
    }))
    .filter(record => record.versions.length)
    .sort((left, right) => String(right.versions[0].created_at || '').localeCompare(String(left.versions[0].created_at || '')))
}

export function marketingReportVersion(records = [], artifactId = '', versionId = '') {
  const record = artifactId ? records.find(item => item.artifact.id === artifactId) || null : records[0] || null
  if (!record) return { record: null, version: null }
  return { record, version: versionId ? record.versions.find(item => item.id === versionId) || null : record.versions[0] || null }
}

export function stableMarketingReportJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableMarketingReportJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableMarketingReportJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle || typeof TextEncoder === 'undefined') throw new Error('Safe report save reconciliation is unavailable in this browser')
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export function marketingReportContentChecksum(content, cryptoApi = globalThis.crypto) {
  return sha256(stableMarketingReportJson(content), cryptoApi)
}

export function marketingReportActorHash(actorId, cryptoApi = globalThis.crypto) {
  if (!actorId) throw new Error('An authenticated actor is required for report recovery')
  return sha256(String(actorId), cryptoApi)
}

// Content equality cannot attribute a version to an uncertain write operation.
export function reconcileMarketingReportSave() {
  return null
}

export function marketingReportReviewState(version, approvals = []) {
  if (!version) return 'missing'
  return approvals.some(approval => approval.organization_id === version.organization_id && approval.artifact_version_id === version.id) ? 'approved' : 'draft'
}

export function marketingReportMetricCandidates(stored = {}) {
  const campaigns = new Map((stored.adCampaigns || []).map(row => [row.id, row]))
  const keywords = new Map((stored.trackedKeywords || []).map(row => [row.id, row]))
  const connections = new Map((stored.metaConnections || []).map(row => [row.id, row]))
  return [
    ...(stored.adSnapshots || []).map(row => ({ source: 'google_ads', snapshot_id: row.id, date: row.snapshot_date,
      label: campaigns.get(row.ad_campaign_id)?.campaign_name || 'Google Ads campaign' })),
    ...(stored.rankSnapshots || []).map(row => ({ source: 'keyword_tracking', snapshot_id: row.id, date: row.snapshot_date,
      label: keywords.get(row.tracked_keyword_id)?.keyword || 'Tracked keyword' })),
    ...(stored.metaSnapshots || []).map(row => ({ source: 'meta', snapshot_id: row.id, date: row.snapshot_date,
      label: [row.platform, connections.get(row.meta_connection_id)?.instagram_account_id ||
        connections.get(row.meta_connection_id)?.facebook_page_id || 'Meta account'].join(' · ') })),
  ].filter(row => row.snapshot_id && row.date).sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || a.source.localeCompare(b.source) ||
    String(a.snapshot_id).localeCompare(String(b.snapshot_id)))
}

function metricPins(version) {
  return Array.isArray(version?.content?.metric_snapshots) ? version.content.metric_snapshots : []
}

export function marketingReportMetricFreshness(pin) {
  const collected = Date.parse(pin?.retrieved_at || '')
  const pinned = Date.parse(pin?.pinned_at || '')
  if (!Number.isFinite(collected) || !Number.isFinite(pinned) || collected > pinned) {
    return { status: 'unknown', age_hours: null }
  }
  const ageHours = Math.floor((pinned - collected) / 3600000)
  return { status: ageHours > 24 ? 'stale_at_pin' : 'current_at_pin', age_hours: ageHours }
}

export function marketingReportEvidenceState(version) {
  const sources = reportLines(version?.content?.sources)
  if (!version) return { status: 'missing', message: 'Choose an exact saved report version.' }
  if (!sources.length) return { status: 'missing', message: 'This exact version has no selected source notes.' }
  const pins = metricPins(version)
  if (!pins.length) return { status: 'unverified', message: 'Source notes are preserved, but this version has no pinned metric snapshots.' }
  const stale = pins.filter(pin => marketingReportMetricFreshness(pin).status === 'stale_at_pin').length
  const unknown = pins.filter(pin => marketingReportMetricFreshness(pin).status === 'unknown').length
  return { status: 'pinned', message: `${pins.length} exact metric snapshot${pins.length === 1 ? '' : 's'} pinned in this version. ${stale} were over 24 hours old when pinned; ${unknown} have unknown collection age. Unknown source definitions remain unavailable. This does not prove current provider access.` }
}

export function buildMarketingReportExport({ artifact, version, approval = null, brandName = 'Brand' }) {
  if (!artifact || !version || artifact.id !== version.artifact_id || artifact.organization_id !== version.organization_id) throw new Error('Choose one authorized exact report version to export')
  const draft = marketingReportDraft(artifact, version)
  const status = approval?.artifact_version_id === version.id && approval.organization_id === version.organization_id ? 'APPROVED VERSION' : 'DRAFT - NOT APPROVED OR RELEASED'
  const safe = value => String(value || '').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const list = values => values.length ? values.map(item => `- ${safe(item)}`).join('\n') : '- Unavailable'
  return [
    `# ${safe(draft.title || 'Marketing report')}`, '', status, '',
    `Title provenance: ${version.content?.report_title ? 'Pinned in this exact version' : 'Legacy artifact label; not pinned to this version'}`,
    `Brand: ${safe(brandName)}`,
    `Reporting period: ${draft.period_start || 'Unavailable'} to ${draft.period_end || 'Unavailable'}`,
    `Exact artifact version: ${version.id}`,
    `Version number: ${version.version_number}`, '',
    '## Selected source notes', list(draft.sources), '',
    '## Pinned metric snapshots',
    metricPins(version).length ? metricPins(version).map(pin => {
      const metrics = Object.entries(pin.metrics || {}).map(([key, value]) => `${key}=${value ?? 'unknown'}`).join(', ')
      const unknown = Object.entries(pin.definitions || {}).filter(([, value]) => value === null).map(([key]) => key).join(', ')
      const freshness = marketingReportMetricFreshness(pin)
      const age = freshness.age_hours === null ? 'unknown' : `${freshness.age_hours}h (${freshness.status === 'stale_at_pin' ? 'over 24h' : 'within 24h'})`
      const filter = Object.entries(pin.source_filter || {}).map(([key, value]) => `${key}=${value}`).join(', ')
      const units = Object.entries(pin.definitions?.metric_units || {}).map(([key, value]) => `${key}=${value}`).join(', ')
      return `- ${safe(pin.source)} | row ${safe(pin.source_record_id)} | parent ${safe(pin.source_parent_id)} | label ${safe(pin.label)} | date ${safe(pin.snapshot_date)} | collected ${safe(pin.retrieved_at)} | pinned ${safe(pin.pinned_at)} | age at pin ${age} | account ${safe(pin.account_id || 'unavailable')} | connection ${safe(pin.connection_id || 'unavailable')} | filter ${safe(filter)} | ${safe(metrics)} | units ${safe(units)} | unavailable definitions: ${safe(unknown || 'none')}`
    }).join('\n') : '- No metric snapshots pinned to this exact version.', '',
    '## Executive summary', safe(draft.executive_summary) || 'Unavailable', '',
    '## Insights', list(draft.insights), '',
    '## Recommended actions', list(draft.recommended_actions), '',
    'Exporting this exact version does not approve, release, publish, refresh, or share it.', '',
  ].join('\n')
}
