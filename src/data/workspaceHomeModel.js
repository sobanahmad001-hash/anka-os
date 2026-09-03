const CLOSED_PROJECTS = new Set(['completed', 'cancelled', 'archived'])
const CLOSED_PROJECT_TASKS = new Set(['done', 'cancelled'])
const CLOSED_ENGAGEMENT_ITEMS = new Set(['done'])
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }

export const WORKSPACE_DEPARTMENTS = [
  ['content', 'Content'],
  ['design', 'Design'],
  ['marketing', 'Marketing'],
  ['development', 'Delivery & Development'],
]

const dateOnly = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null
const sameOrganization = (row, organizationId) => row?.organization_id === organizationId

function compareWork(left, right) {
  return (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9)
    || (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31')
    || left.title.localeCompare(right.title)
}

function normalizeWork(row, project, source) {
  return {
    id: row.id,
    source,
    title: row.title,
    projectId: project.id,
    projectName: project.name,
    department: row.department_id || 'unassigned',
    status: row.status,
    priority: row.priority || 'medium',
    dueDate: row.due_date,
    tab: source === 'Project Task' ? 'project-tasks' : 'engagement-work',
  }
}

export function buildWorkspaceHome(snapshot, { organizationId, today = new Date().toISOString() } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const currentDay = dateOnly(today)
  const nextTwoWeeks = new Date(currentDay)
  nextTwoWeeks.setUTCDate(nextTwoWeeks.getUTCDate() + 14)

  const projects = snapshot.projects.filter((row) => sameOrganization(row, organizationId) && !row.archived_at)
  const activeProjects = projects.filter((row) => !CLOSED_PROJECTS.has(row.status))
  const projectsById = new Map(projects.map((row) => [row.id, row]))
  const validEngagements = new Set(snapshot.engagements
    .filter((row) => sameOrganization(row, organizationId) && projectsById.has(row.project_id))
    .map((row) => `${row.project_id}:${row.id}`))

  const projectTasks = snapshot.tasks
    .filter((row) => sameOrganization(row, organizationId) && projectsById.has(row.project_id) && !row.archived_at && !CLOSED_PROJECT_TASKS.has(row.status))
    .map((row) => normalizeWork(row, projectsById.get(row.project_id), 'Project Task'))
  const engagementWorkItems = snapshot.workItems
    .filter((row) => sameOrganization(row, organizationId) && projectsById.has(row.project_id) && !row.deleted_at && !CLOSED_ENGAGEMENT_ITEMS.has(row.status) && validEngagements.has(`${row.project_id}:${row.engagement_id}`))
    .map((row) => normalizeWork(row, projectsById.get(row.project_id), 'Engagement Work Item'))
  const allWork = [...projectTasks, ...engagementWorkItems]
  const dueWork = allWork.filter((row) => row.dueDate).map((row) => ({
    ...row,
    overdue: dateOnly(row.dueDate) < currentDay,
    dueSoon: dateOnly(row.dueDate) >= currentDay && dateOnly(row.dueDate) <= nextTwoWeeks,
  })).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || compareWork(left, right))
  const blockers = allWork.filter((row) => row.status === 'blocked').sort(compareWork)
  const priorities = allWork.filter((row) => ['urgent', 'high'].includes(row.priority)).sort(compareWork)

  const reviews = snapshot.versions
    .filter((row) => sameOrganization(row, organizationId) && projectsById.has(row.project_id) && !row.withdrawn_at)
    .map((row) => ({ ...row, projectName: projectsById.get(row.project_id).name }))
    .sort((left, right) => new Date(left.created_at) - new Date(right.created_at))

  const departments = WORKSPACE_DEPARTMENTS.map(([id, name]) => {
    const tasks = projectTasks.filter((row) => row.department === id)
    const items = engagementWorkItems.filter((row) => row.department === id)
    const work = [...tasks, ...items]
    return {
      id,
      name,
      projectTasks: tasks.length,
      engagementWorkItems: items.length,
      blocked: work.filter((row) => row.status === 'blocked').length,
      dueSoon: work.filter((row) => row.dueDate && dateOnly(row.dueDate) >= currentDay && dateOnly(row.dueDate) <= nextTwoWeeks).length,
    }
  })

  const activities = snapshot.activities
    .filter((row) => sameOrganization(row, organizationId))
    .map((row) => ({ ...row, projectName: projectsById.get(row.project_id)?.name || null }))
    .sort((left, right) => new Date(right.occurred_at) - new Date(left.occurred_at))

  return {
    today: currentDay.toISOString().slice(0, 10),
    summary: {
      activeProjects: activeProjects.length,
      projectTasks: projectTasks.length,
      engagementWorkItems: engagementWorkItems.length,
      dueSoon: dueWork.filter((row) => row.dueSoon).length,
      overdue: dueWork.filter((row) => row.overdue).length,
      blocked: blockers.length,
      reviews: reviews.length,
    },
    priorities,
    dueWork,
    blockers,
    reviews,
    departments,
    activities,
  }
}
