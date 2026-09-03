const CLOSED_TASK_STATUSES = new Set(['done', 'cancelled'])
const CLOSED_WORK_ITEM_STATUSES = new Set(['done'])
const SOURCE_AVAILABLE_STATES = new Set(['healthy', 'stale', 'connected_no_data'])

const relation = value => Array.isArray(value) ? value[0] || null : value || null
const belongsTo = (row, organizationId) => row?.organization_id === organizationId
const isoDay = value => {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function profileLabel(profile, fallback = 'Unassigned') {
  return profile?.full_name || profile?.email || fallback
}

export function buildMarketingOverview({ organizationId, engagement, tasks = [], workItems = [], approvalRequests = [], memberships = [], profiles = [], readiness = [] }) {
  if (!organizationId || !engagement?.id || engagement.organization_id !== organizationId) {
    throw Object.assign(new Error('Marketing Overview organization mismatch'), { status: 403, membershipMismatch: true })
  }
  const profileById = new Map(profiles.map(item => [item.id, item]))
  const authorizedOwnerIds = new Set(memberships.filter(item => belongsTo(item, organizationId) && item.status === 'active' && item.member_kind === 'team').map(item => item.user_id))
  const records = []
  for (const task of tasks) {
    if (!belongsTo(task, organizationId) || task.project_id !== engagement.project_id || task.department_id !== 'marketing' || task.archived_at || CLOSED_TASK_STATUSES.has(task.status)) continue
    const ownerId = authorizedOwnerIds.has(task.assigned_to) ? task.assigned_to : ''
    records.push(Object.freeze({ id: `project_task:${task.id}`, recordKind: 'project_task', recordId: task.id, title: task.title || 'Untitled Project Task', status: task.status || 'backlog', dueDate: task.due_date || '', ownerId, ownerLabel: profileLabel(profileById.get(ownerId)), facets: Object.freeze(['due_work', ...(task.status === 'blocked' ? ['blockers'] : [])]) }))
  }
  for (const item of workItems) {
    if (!belongsTo(item, organizationId) || item.engagement_id !== engagement.id || item.department_id !== 'marketing' || item.deleted_at || CLOSED_WORK_ITEM_STATUSES.has(item.status)) continue
    const ownerId = authorizedOwnerIds.has(item.assignee_id) ? item.assignee_id : ''
    records.push(Object.freeze({ id: `engagement_work_item:${item.id}`, recordKind: 'engagement_work_item', recordId: item.id, title: item.title || 'Untitled Engagement Work Item', status: item.status || 'not_started', dueDate: item.due_date || '', ownerId, ownerLabel: profileLabel(profileById.get(ownerId)), facets: Object.freeze(['due_work', ...(item.status === 'blocked' ? ['blockers'] : [])]) }))
  }
  for (const request of approvalRequests) {
    const version = relation(request.artifact_versions)
    const artifact = relation(version?.artifacts)
    if (!belongsTo(request, organizationId) || request.status !== 'pending' || artifact?.engagement_id !== engagement.id || artifact?.artifact_type !== 'campaign_brief') continue
    const ownerId = authorizedOwnerIds.has(request.requested_by) ? request.requested_by : ''
    records.push(Object.freeze({ id: `artifact_review:${request.id}`, recordKind: 'artifact_review', recordId: request.id, artifactId: artifact.id, versionId: version.id, versionNumber: version.version_number, title: artifact.title || 'Marketing Brief', status: 'awaiting_review', dueDate: '', ownerId, ownerLabel: profileLabel(profileById.get(ownerId), 'Requester unavailable'), facets: Object.freeze(['awaiting_review']) }))
  }
  for (const source of readiness) {
    if (source.organizationId !== organizationId || source.brand?.id !== engagement.brand_id) continue
    records.push(Object.freeze({ id: `source:${source.id}`, recordKind: 'source', recordId: source.connectionId || source.id, title: source.providerLabel, detail: `${source.accountLabel} · ${source.mappingLabel}`, status: source.state, dueDate: '', ownerId: '', ownerLabel: 'Shared source', available: SOURCE_AVAILABLE_STATES.has(source.state), facets: Object.freeze(['available_sources']) }))
  }
  const owners = [...new Map(records.filter(item => item.ownerId).map(item => [item.ownerId, { id: item.ownerId, label: item.ownerLabel }])).values()].sort((a, b) => a.label.localeCompare(b.label))
  const statuses = [...new Set(records.filter(item => item.recordKind !== 'source').map(item => item.status))].sort()
  return Object.freeze({ records: Object.freeze(records), owners: Object.freeze(owners), statuses: Object.freeze(statuses) })
}

export function filterMarketingOverview(records, filters = {}, now = new Date()) {
  const today = isoDay(now)
  const horizon = new Date(`${today}T00:00:00Z`)
  horizon.setUTCDate(horizon.getUTCDate() + Number(filters.dueWindow === '30_days' ? 30 : 7))
  const horizonDay = isoDay(horizon)
  return (records || []).filter(item => {
    if (filters.facet && !item.facets.includes(filters.facet)) return false
    if (filters.owner === '__unassigned__' && item.ownerId) return false
    if (filters.owner && filters.owner !== '__unassigned__' && item.ownerId !== filters.owner) return false
    if (filters.status && item.status !== filters.status) return false
    if (filters.dueWindow === 'overdue' && (!item.dueDate || item.dueDate >= today)) return false
    if (['7_days', '30_days'].includes(filters.dueWindow) && (!item.dueDate || item.dueDate < today || item.dueDate > horizonDay)) return false
    if (filters.dueWindow === 'no_due' && item.dueDate) return false
    return true
  }).sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || a.title.localeCompare(b.title))
}

export function marketingOverviewCounts(records, filters = {}, now = new Date()) {
  const filtered = filterMarketingOverview(records, { ...filters, facet: '' }, now)
  return Object.freeze({ due_work: filtered.filter(item => item.facets.includes('due_work')).length, blockers: filtered.filter(item => item.facets.includes('blockers')).length, awaiting_review: filtered.filter(item => item.facets.includes('awaiting_review')).length, available_sources: filtered.filter(item => item.facets.includes('available_sources') && item.available).length })
}
