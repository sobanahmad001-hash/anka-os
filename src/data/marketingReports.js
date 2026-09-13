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
  return { title: '', period_start: '', period_end: '', sources: [], executive_summary: '', insights: [], recommended_actions: [] }
}

export function marketingReportDraft(artifact = null, version = null) {
  const content = version?.content && typeof version.content === 'object' ? version.content : {}
  return {
    ...emptyMarketingReportDraft(), title: clean(artifact?.title), period_start: clean(content.period_start),
    period_end: clean(content.period_end), sources: reportLines(content.sources),
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
  return { title, content: { sources, period_start: periodStart, period_end: periodEnd, executive_summary: executiveSummary, insights, recommended_actions: recommendedActions } }
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

export async function marketingReportContentChecksum(content, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle || typeof TextEncoder === 'undefined') throw new Error('Safe report save reconciliation is unavailable in this browser')
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(stableMarketingReportJson(content)))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export function reconcileMarketingReportSave(records = [], pending = null) {
  if (!pending?.contentChecksum) return null
  const known = new Set(pending.knownVersionIds || [])
  const matches = records.flatMap(record => {
    if (pending.artifactId && record.artifact.id !== pending.artifactId) return []
    return record.versions
      .filter(version => !known.has(version.id) && version.content_checksum === pending.contentChecksum)
      .map(version => ({ record, version }))
  })
  return matches.length === 1 ? matches[0] : null
}

export function marketingReportReviewState(version, approvals = []) {
  if (!version) return 'missing'
  return approvals.some(approval => approval.organization_id === version.organization_id && approval.artifact_version_id === version.id) ? 'approved' : 'draft'
}

export function marketingReportEvidenceState(version) {
  const sources = reportLines(version?.content?.sources)
  if (!version) return { status: 'missing', message: 'Choose an exact saved report version.' }
  if (!sources.length) return { status: 'missing', message: 'This exact version has no selected source notes.' }
  return { status: 'unverified', message: 'Source notes are preserved, but the current report contract does not pin metric rows, definitions, filters, or retrieval timestamps.' }
}

export function buildMarketingReportExport({ artifact, version, approval = null, brandName = 'Brand' }) {
  if (!artifact || !version || artifact.id !== version.artifact_id || artifact.organization_id !== version.organization_id) throw new Error('Choose one authorized exact report version to export')
  const draft = marketingReportDraft(artifact, version)
  const status = approval?.artifact_version_id === version.id && approval.organization_id === version.organization_id ? 'APPROVED VERSION' : 'DRAFT - NOT APPROVED OR RELEASED'
  const safe = value => String(value || '').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const list = values => values.length ? values.map(item => `- ${safe(item)}`).join('\n') : '- Unavailable'
  return [
    `# ${safe(draft.title || 'Marketing report')}`, '', status, '',
    `Brand: ${safe(brandName)}`,
    `Reporting period: ${draft.period_start || 'Unavailable'} to ${draft.period_end || 'Unavailable'}`,
    `Exact artifact version: ${version.id}`,
    `Version number: ${version.version_number}`, '',
    '## Selected source notes', list(draft.sources), '',
    'Metric snapshot: Unavailable in the current report artifact contract.', '',
    '## Executive summary', safe(draft.executive_summary) || 'Unavailable', '',
    '## Insights', list(draft.insights), '',
    '## Recommended actions', list(draft.recommended_actions), '',
    'Exporting this exact version does not approve, release, publish, refresh, or share it.', '',
  ].join('\n')
}
