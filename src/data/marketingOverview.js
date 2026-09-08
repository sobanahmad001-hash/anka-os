import { appendWorkshopNavigation, WORKSHOP_DESTINATIONS } from './workshopNavigation.js'

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

export function buildMarketingOverview({ organizationId, engagement, tasks = [], workItems = [], approvalRequests = [], memberships = [], profiles = [], campaignLinks = [], readiness = [], sectionAvailability = {} }) {
  if (!organizationId || !engagement?.id || engagement.organization_id !== organizationId) {
    throw Object.assign(new Error('Marketing Overview organization mismatch'), { status: 403, membershipMismatch: true })
  }
  const profileById = new Map(profiles.map(item => [item.id, item]))
  const authorizedOwnerIds = new Set(memberships.filter(item => belongsTo(item, organizationId) && item.status === 'active' && item.member_kind === 'team').map(item => item.user_id))
  const membershipsAvailable = sectionAvailability.memberships !== false
  const profilesAvailable = sectionAvailability.profiles !== false
  const owner = assignedId => {
    if (!assignedId) return { ownerId: '', ownerLabel: 'Unassigned', ownerUnavailable: false }
    if (!membershipsAvailable || !authorizedOwnerIds.has(assignedId)) return { ownerId: '', ownerLabel: 'Owner unavailable', ownerUnavailable: true }
    return { ownerId: assignedId, ownerLabel: profilesAvailable ? profileLabel(profileById.get(assignedId), 'Owner name unavailable') : 'Owner name unavailable', ownerUnavailable: !profilesAvailable || !profileById.has(assignedId) }
  }
  const records = []
  for (const task of tasks) {
    if (!belongsTo(task, organizationId) || task.project_id !== engagement.project_id || task.department_id !== 'marketing' || task.archived_at || CLOSED_TASK_STATUSES.has(task.status)) continue
    records.push(Object.freeze({ id: `project_task:${task.id}`, recordKind: 'project_task', recordId: task.id, title: task.title || 'Untitled Project Task', status: task.status || 'backlog', dueDate: task.due_date || '', ...owner(task.assigned_to), facets: Object.freeze(['due_work', ...(task.status === 'blocked' ? ['blockers'] : [])]) }))
  }
  for (const item of workItems) {
    if (!belongsTo(item, organizationId) || item.engagement_id !== engagement.id || item.department_id !== 'marketing' || item.deleted_at || CLOSED_WORK_ITEM_STATUSES.has(item.status)) continue
    records.push(Object.freeze({ id: `engagement_work_item:${item.id}`, recordKind: 'engagement_work_item', recordId: item.id, title: item.title || 'Untitled Engagement Work Item', status: item.status || 'not_started', dueDate: item.due_date || '', ...owner(item.assignee_id), facets: Object.freeze(['due_work', ...(item.status === 'blocked' ? ['blockers'] : [])]) }))
  }
  for (const request of approvalRequests) {
    const version = relation(request.artifact_versions)
    const artifact = relation(version?.artifacts)
    if (!belongsTo(request, organizationId) || request.status !== 'pending' || artifact?.engagement_id !== engagement.id || artifact?.artifact_type !== 'campaign_brief') continue
    const links = campaignLinks.filter(link => belongsTo(link, organizationId) && link.artifact_id === artifact.id)
    if (links.length !== 1) continue
    records.push(Object.freeze({ id: `artifact_review:${request.id}`, recordKind: 'artifact_review', recordId: request.id, artifactId: artifact.id, versionId: version.id, versionNumber: version.version_number, campaignId: links[0].campaign_id, title: artifact.title || 'Marketing Brief', status: 'awaiting_review', dueDate: '', ...owner(request.requested_by), facets: Object.freeze(['awaiting_review']) }))
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
    if (filters.facet === 'available_sources' && item.available !== true) return false
    if (filters.owner === '__unassigned__' && item.ownerId) return false
    if (filters.owner === '__unassigned__' && item.ownerUnavailable) return false
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

export function marketingOverviewRowHref(item, { organizationId, clientId = '', projectId, engagementId, brandId, serviceId }) {
  if (!item || !organizationId || !projectId || !engagementId || !brandId || !serviceId) throw new TypeError('Complete authorized Marketing context is required')
  const workRecord = ['project_task', 'engagement_work_item'].includes(item.recordKind)
    ? { kind: item.recordKind, id: item.recordId } : null
  const output = item.recordKind === 'artifact_review'
    ? { kind: 'artifact', id: item.artifactId, versionId: item.versionId } : null
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.marketing, {
    organizationId, clientId, projectId, engagementId, brandId, activeServiceId: serviceId,
    workRecord, output, workshopTab: item.recordKind === 'artifact_review' ? 'artifacts' : 'overview',
  })
  const target = new URL(href, 'https://anka.invalid')
  if (item.campaignId) target.searchParams.set('campaign', item.campaignId)
  if (item.recordKind === 'artifact_review') {
    target.searchParams.set('artifact', 'campaign_brief')
    target.searchParams.set('version', item.versionId)
  }
  return target.pathname + target.search
}

export function marketingOverviewLoadFailure({ requestGeneration, currentGeneration, aborted = false, error, hasWork = false }) {
  if (aborted || error?.name === 'AbortError' || requestGeneration !== currentGeneration) return Object.freeze({ ignored: true, stale: false, message: '' })
  const access = [401, 403].includes(Number(error?.status))
  return Object.freeze({ ignored: false, stale: hasWork, access, message: error?.message || 'Marketing Overview could not be loaded' })
}

export async function composeMarketingOverviewFamilies(settled, loadProfiles) {
  const [tasks, workItems, approvalRequests, memberships, campaignLinks] = settled.map(item => item?.status === 'fulfilled' ? item.value : [])
  if (settled[0].status === 'rejected' && settled[1].status === 'rejected' && settled[2].status === 'rejected') throw settled[0].reason
  const userIds = [...new Set(memberships.map(item => item.user_id).filter(Boolean))]
  let profiles = []
  let profileError = ''
  if (userIds.length) {
    try { profiles = await loadProfiles(userIds) }
    catch (error) { profileError = error.message || 'Profiles unavailable' }
  }
  const failed = index => settled[index]?.status === 'rejected' ? settled[index].reason.message : ''
  return {
    tasks, workItems, approvalRequests, memberships, campaignLinks, profiles,
    sectionAvailability: Object.freeze({ memberships: !failed(3), profiles: !profileError, campaignLinks: !failed(4) }),
    sectionErrors: Object.freeze({ tasks: failed(0), workItems: failed(1), approvalRequests: failed(2), memberships: failed(3), campaignLinks: failed(4), profiles: profileError }),
  }
}
