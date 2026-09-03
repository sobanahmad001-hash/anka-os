export const PORTFOLIO_OWNER_KINDS = ['all', 'client', 'internal']
export const PORTFOLIO_DUE_FILTERS = ['all', 'overdue', 'next_14_days', 'no_due_date']

const CLOSED_PROJECT = new Set(['completed', 'cancelled', 'archived'])
const CLOSED_TASK = new Set(['done', 'cancelled'])
const CLOSED_ITEM = new Set(['done'])
const CLOSED_STAGE = new Set(['completed', 'skipped'])
const CLOSED_MILESTONE = new Set(['completed', 'cancelled'])

const sameOrg = (child, project) => child?.organization_id === project.organization_id
const dateOnly = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null
const isOverdue = (value, today) => Boolean(value && dateOnly(value) < today)
const displayOwner = (profile) => profile?.full_name || profile?.email || 'Unassigned'

function groupBy(rows, field) {
  return rows.reduce((groups, row) => {
    if (!row[field]) return groups
    const values = groups.get(row[field]) || []
    values.push(row)
    groups.set(row[field], values)
    return groups
  }, new Map())
}

function counts(rows, closed, today) {
  const open = rows.filter((row) => !closed.has(row.status))
  return {
    open: open.length,
    blocked: open.filter((row) => row.status === 'blocked').length,
    overdue: open.filter((row) => isOverdue(row.due_date, today)).length,
  }
}

function compareRows(sort) {
  return (left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name)
    if (sort === 'status') return left.status.localeCompare(right.status) || left.name.localeCompare(right.name)
    if (sort === 'owner') return left.owner.name.localeCompare(right.owner.name) || left.name.localeCompare(right.name)
    return (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31') || left.name.localeCompare(right.name)
  }
}

export function buildPortfolioWorkspace(snapshot, options = {}) {
  const today = dateOnly(options.today || new Date().toISOString())
  const profiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile]))
  const activeMemberships = new Set(snapshot.memberships.map((membership) => `${membership.organization_id}:${membership.user_id}`))
  const clients = new Map(snapshot.clients.map((client) => [client.id, client]))
  const brands = new Map(snapshot.brands.map((brand) => [brand.id, brand]))
  const engagements = groupBy(snapshot.engagements, 'project_id')
  const tasks = groupBy(snapshot.tasks, 'project_id')
  const workItems = groupBy(snapshot.workItems, 'project_id')
  const stages = groupBy(snapshot.stages, 'engagement_id')
  const milestones = groupBy(snapshot.milestones, 'project_id')
  const versions = groupBy(snapshot.versions, 'project_id')

  const rows = snapshot.projects.filter((project) => !project.archived_at).map((project) => {
    const extension = (engagements.get(project.id) || []).find((row) => sameOrg(row, project)) || null
    const projectTasks = (tasks.get(project.id) || []).filter((row) => sameOrg(row, project) && !row.archived_at)
    const engagementItems = (workItems.get(project.id) || []).filter((row) => sameOrg(row, project) && !row.deleted_at && extension && row.engagement_id === extension.id)
    const journey = extension ? (stages.get(extension.id) || []).filter((row) => sameOrg(row, project) && !CLOSED_STAGE.has(row.status)) : []
    const projectMilestones = (milestones.get(project.id) || []).filter((row) => sameOrg(row, project) && !row.archived_at && !CLOSED_MILESTONE.has(row.status))
    const awaitingReview = (versions.get(project.id) || []).filter((row) => sameOrg(row, project) && !row.withdrawn_at).length
    const client = clients.get(project.client_id)
    const brand = extension ? brands.get(extension.brand_id) : null
    const projectTaskCounts = counts(projectTasks, CLOSED_TASK, today)
    const engagementItemCounts = counts(engagementItems, CLOSED_ITEM, today)
    const owner = activeMemberships.has(`${project.organization_id}:${project.owner_id}`) ? profiles.get(project.owner_id) : null
    const signals = []
    if (isOverdue(project.due_date, today)) signals.push('Project due date has passed')
    if (project.health === 'at_risk' || project.health === 'blocked') signals.push(`Health is ${project.health.replace('_', ' ')}`)
    if (projectTaskCounts.blocked) signals.push(`${projectTaskCounts.blocked} blocked Project Task${projectTaskCounts.blocked === 1 ? '' : 's'}`)
    if (engagementItemCounts.blocked) signals.push(`${engagementItemCounts.blocked} blocked Engagement Work Item${engagementItemCounts.blocked === 1 ? '' : 's'}`)
    if (awaitingReview) signals.push(`${awaitingReview} deliverable version${awaitingReview === 1 ? '' : 's'} awaiting review`)

    const departmentNames = new Set([
      ...journey.map((stage) => stage.accountable_department_id),
      ...projectTasks.map((task) => task.department_id),
      ...engagementItems.map((item) => item.department_id),
    ].filter(Boolean))

    return {
      id: project.id,
      name: project.name,
      ownerKind: project.engagement_type === 'internal' ? 'internal' : 'client',
      owner: { id: project.owner_id, name: displayOwner(owner) },
      clientName: client && sameOrg(client, project) ? (client.company || client.name) : null,
      brandName: brand && sameOrg(brand, project) ? brand.name : null,
      engagementId: extension?.id || null,
      status: project.status || 'unknown',
      health: project.health || 'unknown',
      dueDate: project.due_date,
      projectTasks: projectTaskCounts,
      engagementWorkItems: { ...engagementItemCounts, automationFlags: engagementItems.filter((item) => item.automation_flagged_at).length },
      journey: { incomplete: journey.length, blocked: journey.filter((stage) => stage.status === 'blocked').length },
      milestones: { open: projectMilestones.length, atRisk: projectMilestones.filter((milestone) => milestone.status === 'at_risk' || isOverdue(milestone.target_date, today)).length },
      awaitingReview,
      attentionSignals: signals,
      departmentLoad: [...departmentNames].map((department) => ({
        department,
        projectTasks: projectTasks.filter((task) => task.department_id === department && !CLOSED_TASK.has(task.status)).length,
        engagementWorkItems: engagementItems.filter((item) => item.department_id === department && !CLOSED_ITEM.has(item.status)).length,
      })),
    }
  })

  return { rows, today: today.toISOString().slice(0, 10), summary: summarize(rows), departmentLoad: departmentLoad(rows) }
}

export function summarize(rows) {
  const active = rows.filter((row) => !CLOSED_PROJECT.has(row.status))
  return {
    activeProjects: active.length,
    clientWork: active.filter((row) => row.ownerKind === 'client').length,
    internalWork: active.filter((row) => row.ownerKind === 'internal').length,
    openProjectTasks: active.reduce((total, row) => total + row.projectTasks.open, 0),
    openEngagementWorkItems: active.reduce((total, row) => total + row.engagementWorkItems.open, 0),
    awaitingReview: active.reduce((total, row) => total + row.awaitingReview, 0),
  }
}

export function departmentLoad(rows) {
  const load = new Map()
  rows.forEach((row) => row.departmentLoad.forEach((entry) => {
    const current = load.get(entry.department) || { department: entry.department, projects: 0, projectTasks: 0, engagementWorkItems: 0 }
    current.projects += 1
    current.projectTasks += entry.projectTasks
    current.engagementWorkItems += entry.engagementWorkItems
    load.set(entry.department, current)
  }))
  return [...load.values()].sort((left, right) => left.department.localeCompare(right.department))
}

export function filterPortfolioRows(rows, filters = {}) {
  const ownerKind = filters.ownerKind || 'all'
  const status = filters.status || 'all'
  const due = filters.due || 'all'
  const owner = filters.owner || 'all'
  const today = dateOnly(filters.today || new Date().toISOString())
  const twoWeeks = new Date(today)
  twoWeeks.setUTCDate(twoWeeks.getUTCDate() + 14)

  return rows.filter((row) => {
    if (ownerKind !== 'all' && row.ownerKind !== ownerKind) return false
    if (status !== 'all' && row.status !== status) return false
    if (owner !== 'all' && (row.owner.id || 'unassigned') !== owner) return false
    if (due === 'overdue' && !isOverdue(row.dueDate, today)) return false
    if (due === 'no_due_date' && row.dueDate) return false
    if (due === 'next_14_days' && (!row.dueDate || dateOnly(row.dueDate) < today || dateOnly(row.dueDate) > twoWeeks)) return false
    return true
  }).sort(compareRows(filters.sort || 'due'))
}
