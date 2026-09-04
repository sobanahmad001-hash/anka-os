const CLOSED_PROJECT = new Set(['completed', 'cancelled', 'archived'])
const CLOSED_TASK = new Set(['done', 'cancelled'])
const CLOSED_ITEM = new Set(['done'])
const CLOSED_MILESTONE = new Set(['completed', 'cancelled'])
const CLOSED_REQUEST = new Set(['completed', 'declined', 'withdrawn'])
const CLOSED_DELIVERABLE = new Set(['delivered_published', 'withdrawn', 'archived'])

const dateOnly = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null
const isOverdue = (value, today) => Boolean(value && dateOnly(value) < today)
const sameProject = (row, project) => row?.project_id === project.id && row.organization_id === project.organization_id
const ownerLabel = (profile) => profile?.full_name || profile?.email || 'Unassigned'

function group(rows, key) {
  return rows.reduce((map, row) => map.set(row[key], [...(map.get(row[key]) || []), row]), new Map())
}

export function buildInternalWorkspace(snapshot, options = {}) {
  const today = dateOnly(options.today || new Date().toISOString())
  const projects = snapshot.projects.filter((project) => project.engagement_type === 'internal' && !project.archived_at)
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const validChild = (row) => {
    const project = projectById.get(row?.project_id)
    return Boolean(project && sameProject(row, project))
  }
  const membershipKeys = new Set(snapshot.memberships.map((row) => `${row.organization_id}:${row.user_id}`))
  const profiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile]))
  const owner = (id, organizationId) => ({ id: id || null, name: membershipKeys.has(`${organizationId}:${id}`) ? ownerLabel(profiles.get(id)) : 'Unassigned' })
  const engagements = snapshot.engagements.filter(validChild)
  const engagementByProject = new Map(engagements.map((row) => [row.project_id, row]))
  const workstreams = snapshot.workstreams.filter(validChild)
  const tasks = snapshot.tasks.filter((row) => validChild(row) && !row.archived_at)
  const workItems = snapshot.workItems.filter((row) => validChild(row) && !row.deleted_at && engagementByProject.get(row.project_id)?.id === row.engagement_id)
  const milestones = snapshot.milestones.filter((row) => validChild(row) && !row.archived_at)
  const requests = snapshot.requests.filter((row) => validChild(row) && !row.archived_at)
  const deliverables = snapshot.deliverables.filter((row) => validChild(row) && !row.archived_at)
  const activity = snapshot.activity.filter(validChild)
  const livingRecords = snapshot.livingRecords.filter(validChild)
  const streamsByProject = group(workstreams, 'project_id')
  const tasksByProject = group(tasks, 'project_id')
  const itemsByProject = group(workItems, 'project_id')
  const milestonesByProject = group(milestones, 'project_id')
  const requestsByProject = group(requests, 'project_id')
  const deliverablesByProject = group(deliverables, 'project_id')
  const activityByProject = group(activity, 'project_id')
  const livingByProject = new Map(livingRecords.map((row) => [row.project_id, row]))
  const projectRows = projects.map((project) => {
    const projectTasks = (tasksByProject.get(project.id) || []).map((row) => ({ ...row, owner: owner(row.assigned_to, project.organization_id), overdue: !CLOSED_TASK.has(row.status) && isOverdue(row.due_date, today) }))
    const engagementWorkItems = (itemsByProject.get(project.id) || []).map((row) => ({ ...row, owner: owner(row.assignee_id, project.organization_id), overdue: !CLOSED_ITEM.has(row.status) && isOverdue(row.due_date, today) }))
    const projectMilestones = (milestonesByProject.get(project.id) || []).map((row) => ({ ...row, owner: owner(row.owner_id, project.organization_id), overdue: !CLOSED_MILESTONE.has(row.status) && isOverdue(row.target_date, today) }))
    const projectRequests = (requestsByProject.get(project.id) || []).map((row) => ({ ...row, owner: owner(row.owner_id, project.organization_id), overdue: !CLOSED_REQUEST.has(row.status) && isOverdue(row.required_by, today) }))
    const projectDeliverables = (deliverablesByProject.get(project.id) || []).map((row) => ({ ...row, owner: owner(row.owner_id, project.organization_id), overdue: !CLOSED_DELIVERABLE.has(row.status) && isOverdue(row.due_date, today) }))
    const signals = []
    if (!CLOSED_PROJECT.has(project.status) && isOverdue(project.due_date, today)) signals.push('Project due date has passed')
    if (['at_risk', 'blocked'].includes(project.health)) signals.push(`Health is ${project.health.replace('_', ' ')}`)
    if (projectTasks.some((row) => row.status === 'blocked')) signals.push('Project Tasks include blocked work')
    if (engagementWorkItems.some((row) => row.status === 'blocked')) signals.push('Engagement Work Items include blocked work')
    if (projectMilestones.some((row) => row.overdue || row.status === 'at_risk')) signals.push('Milestones need attention')
    if (projectRequests.some((row) => row.overdue || row.status === 'blocked')) signals.push('Requests need attention')
    return {
      ...project,
      owner: owner(project.owner_id, project.organization_id),
      workstreams: (streamsByProject.get(project.id) || []).map((row) => ({ ...row, owner: owner(row.owner_id, project.organization_id) })),
      projectTasks, engagementWorkItems, milestones: projectMilestones, requests: projectRequests, deliverables: projectDeliverables,
      activity: (activityByProject.get(project.id) || []).map((row) => ({ ...row, actor: owner(row.actor_id, project.organization_id) })).sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)),
      livingRecord: livingByProject.get(project.id) || null,
      engagement: engagementByProject.get(project.id) || null,
      attentionSignals: signals,
    }
  })
  const dueWork = projectRows.flatMap((project) => [
    ...project.projectTasks.filter((row) => !CLOSED_TASK.has(row.status)).map((row) => ({ ...row, source: 'Project Task', date: row.due_date, projectName: project.name })),
    ...project.engagementWorkItems.filter((row) => !CLOSED_ITEM.has(row.status)).map((row) => ({ ...row, source: 'Engagement Work Item', date: row.due_date, projectName: project.name })),
    ...project.milestones.filter((row) => !CLOSED_MILESTONE.has(row.status)).map((row) => ({ ...row, title: row.name, source: 'Milestone', date: row.target_date, projectName: project.name })),
    ...project.requests.filter((row) => !CLOSED_REQUEST.has(row.status)).map((row) => ({ ...row, source: 'Request', date: row.required_by, projectName: project.name })),
    ...project.deliverables.filter((row) => !CLOSED_DELIVERABLE.has(row.status)).map((row) => ({ ...row, source: 'Deliverable', date: row.due_date, projectName: project.name })),
  ]).sort((a, b) => (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31'))
  return {
    projects: projectRows,
    dueWork,
    activity: projectRows.flatMap((row) => row.activity).sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)),
    summary: {
      activeProjects: projectRows.filter((row) => !CLOSED_PROJECT.has(row.status)).length,
      openProjectTasks: projectRows.flatMap((row) => row.projectTasks).filter((row) => !CLOSED_TASK.has(row.status)).length,
      openEngagementWorkItems: projectRows.flatMap((row) => row.engagementWorkItems).filter((row) => !CLOSED_ITEM.has(row.status)).length,
      openMilestones: projectRows.flatMap((row) => row.milestones).filter((row) => !CLOSED_MILESTONE.has(row.status)).length,
      openRequests: projectRows.flatMap((row) => row.requests).filter((row) => !CLOSED_REQUEST.has(row.status)).length,
      activeDeliverables: projectRows.flatMap((row) => row.deliverables).filter((row) => !CLOSED_DELIVERABLE.has(row.status)).length,
      livingRecords: projectRows.filter((row) => row.livingRecord).length,
    },
  }
}
