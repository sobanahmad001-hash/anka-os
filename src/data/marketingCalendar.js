const CLOSED = new Set(['done', 'cancelled', 'completed'])
const clean = value => typeof value === 'string' ? value.trim() : ''
const unique = values => [...new Set(values.filter(Boolean))]
const state = status => CLOSED.has(status) ? 'completed' : 'planned'
const range = entry => ({ start: clean(entry.plannedDate), end: clean(entry.endDate) || clean(entry.plannedDate) })

function scoped(row, organizationId) {
  if (row?.organization_id !== organizationId) throw Object.assign(new Error('Marketing Calendar returned a foreign organization row'), { status: 403, membershipMismatch: true })
}

function owner(id, profiles, active) {
  if (!id) return { ownerId: '', ownerLabel: 'Unassigned' }
  if (!active.has(id)) return { ownerId: '', ownerLabel: 'Owner unavailable' }
  const profile = profiles.get(id)
  return { ownerId: id, ownerLabel: profile?.full_name || profile?.email || 'Owner name unavailable' }
}

export function effectiveMarketingTimezone(project, client) {
  if (project?.engagement_type === 'internal') return clean(project.planning_timezone) || 'UTC'
  return clean(project?.planning_timezone) || clean(client?.default_timezone) || 'UTC'
}

export function monthInTimezone(now = new Date(), timezone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(now)
    return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`
  } catch { return now.toISOString().slice(0, 7) }
}

export function buildMarketingCalendar(input) {
  const { organizationId, engagement, project, client, tasks = [], taskDependencies = [], workItems = [], workItemDependencies = [], memberships = [], profiles = [], campaigns = [], planVersions = [], campaignLinks = [] } = input || {}
  if (!organizationId || engagement?.organization_id !== organizationId || engagement?.project_id !== project?.id) throw Object.assign(new Error('Marketing Calendar context mismatch'), { status: 403, membershipMismatch: true })
  scoped(project, organizationId); if (client) scoped(client, organizationId)
  for (const rows of [tasks, taskDependencies, workItems, workItemDependencies, memberships, campaigns, planVersions, campaignLinks]) for (const row of rows) scoped(row, organizationId)
  const profilesById = new Map(profiles.map(item => [item.id, item]))
  const active = new Set(memberships.filter(item => item.member_kind === 'team' && item.status === 'active').map(item => item.user_id))
  const campaignsById = new Map(campaigns.filter(item => item.engagement_id === engagement.id).map(item => [item.id, item]))
  const campaignByArtifact = new Map(campaignLinks.filter(item => campaignsById.has(item.campaign_id)).map(item => [item.artifact_id, item.campaign_id]))
  const latestPlans = new Map()
  for (const item of planVersions.filter(item => item.engagement_id === engagement.id && campaignsById.has(item.campaign_id))) {
    const current = latestPlans.get(item.campaign_id)
    if (!current || Number(item.version_number) > Number(current.version_number)) latestPlans.set(item.campaign_id, item)
  }
  const statuses = new Map([...tasks.map(item => [`task:${item.id}`, item.status]), ...workItems.map(item => [`work:${item.id}`, item.status])])
  const taskBlocks = new Map(); const workBlocks = new Map()
  for (const item of taskDependencies) if (!CLOSED.has(statuses.get(`task:${item.depends_on_task_id}`))) taskBlocks.set(item.task_id, (taskBlocks.get(item.task_id) || 0) + 1)
  for (const item of workItemDependencies) if (!CLOSED.has(statuses.get(`work:${item.depends_on_work_item_id}`))) workBlocks.set(item.work_item_id, (workBlocks.get(item.work_item_id) || 0) + 1)
  const entries = []
  for (const item of tasks) {
    if (item.project_id !== project.id || item.department_id !== 'marketing' || item.archived_at) continue
    entries.push(Object.freeze({ id: `project_task:${item.id}`, recordKind: 'project_task', recordId: item.id, title: item.title || 'Untitled Project Task', calendarState: state(item.status), plannedDate: item.due_date || '', endDate: item.due_date || '', engagementId: engagement.id, campaignLabel: '', channels: [], ...owner(item.assigned_to, profilesById, active), unresolvedDependencies: taskBlocks.get(item.id) || 0, externallyPublished: false, href: `/sphere/workspace/items/project_task/${encodeURIComponent(item.id)}` }))
  }
  for (const item of workItems) {
    if (item.engagement_id !== engagement.id || item.project_id !== project.id || item.department_id !== 'marketing' || item.deleted_at) continue
    const campaignId = campaignByArtifact.get(item.linked_artifact_id) || ''
    const campaign = campaignsById.get(campaignId); const plan = latestPlans.get(campaignId)
    entries.push(Object.freeze({ id: `engagement_work_item:${item.id}`, recordKind: 'engagement_work_item', recordId: item.id, title: item.title || 'Untitled Engagement Work Item', calendarState: state(item.status), plannedDate: item.start_date || item.due_date || '', endDate: item.due_date || item.start_date || '', engagementId: engagement.id, campaignLabel: campaign?.name || '', channels: unique(plan?.channels || campaign?.planned_channels || []), ...owner(item.assignee_id, profilesById, active), unresolvedDependencies: workBlocks.get(item.id) || 0, externallyPublished: false, href: `/sphere/workspace/items/engagement_work_item/${encodeURIComponent(item.id)}`, plannerHref: item.recurring_occurrence_id ? `/sphere/workspace/projects/${encodeURIComponent(project.id)}?tab=retainer-planning` : '' }))
  }
  for (const [campaignId, item] of latestPlans) {
    if (!item.starts_on && !item.ends_on) continue
    const campaign = campaignsById.get(campaignId)
    entries.push(Object.freeze({ id: `campaign_plan:${item.id}`, recordKind: 'campaign_plan_draft', recordId: item.id, title: item.title || campaign?.name || 'Untitled campaign plan', calendarState: 'draft', plannedDate: item.starts_on || item.ends_on, endDate: item.ends_on || item.starts_on, engagementId: engagement.id, campaignLabel: campaign?.name || '', channels: unique(item.channels || campaign?.planned_channels || []), ...owner(item.created_by, profilesById, active), unresolvedDependencies: 0, externallyPublished: false, href: `/sphere/marketing/studio?engagement=${encodeURIComponent(engagement.id)}&tab=campaigns&campaign=${encodeURIComponent(campaignId)}` }))
  }
  return Object.freeze({
    timezone: effectiveMarketingTimezone(project, client),
    entries: Object.freeze(entries.sort((a, b) => (a.plannedDate || '9999-12-31').localeCompare(b.plannedDate || '9999-12-31') || a.title.localeCompare(b.title))),
    owners: Object.freeze([...new Map(entries.filter(item => item.ownerId).map(item => [item.ownerId, { id: item.ownerId, label: item.ownerLabel }])).values()].sort((a, b) => a.label.localeCompare(b.label))),
    channels: Object.freeze(unique(entries.flatMap(item => item.channels)).sort()),
    statuses: Object.freeze(unique(entries.map(item => item.calendarState)).sort()),
  })
}

export function filterMarketingCalendar(entries, filters = {}, month = '') {
  const monthStart = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : ''
  const monthEnd = monthStart ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate().toString().padStart(2, '0')}` : ''
  return (entries || []).filter(entry => {
    const dates = range(entry)
    if (filters.engagement && entry.engagementId !== filters.engagement) return false
    if (filters.owner === '__unassigned__' && entry.ownerId) return false
    if (filters.owner && filters.owner !== '__unassigned__' && entry.ownerId !== filters.owner) return false
    if (filters.channel && !entry.channels.includes(filters.channel)) return false
    if (filters.status && entry.calendarState !== filters.status) return false
    return !monthStart || Boolean(dates.start && dates.end >= monthStart && dates.start <= monthEnd)
  })
}

export function marketingMonthDays(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  return Object.freeze(Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`))
}

export function entriesForDay(entries, day) { return (entries || []).filter(entry => { const dates = range(entry); return dates.start && dates.start <= day && dates.end >= day }) }
export function moveMarketingMonth(month, delta) { if (!/^\d{4}-\d{2}$/.test(month)) return month; return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 7) }
