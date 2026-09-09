export const PROJECT_TASK_STATUSES = Object.freeze(['backlog', 'ready', 'in_progress', 'blocked', 'ready_for_review', 'changes_required', 'done', 'cancelled'])
export const WORK_ITEM_STATUSES = Object.freeze(['not_started', 'in_progress', 'blocked', 'done'])
export const PLANNING_VIEWS = Object.freeze(['list', 'board', 'calendar', 'timeline', 'workload'])

const closed = new Set(['done', 'cancelled'])
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
const compareDate = (left, right) => (dateOnly(left.due_date) || '9999-12-31').localeCompare(dateOnly(right.due_date) || '9999-12-31')
  || String(left.created_at || '').localeCompare(String(right.created_at || ''))
  || String(left.id).localeCompare(String(right.id))

export function effectivePlanningTimezone(project, client) {
  if (!project) return 'UTC'
  if (project.planning_timezone) return project.planning_timezone
  if (project.engagement_type !== 'internal' && project.client_id && client?.id === project.client_id && client.default_timezone) return client.default_timezone
  return 'UTC'
}
export function planningRecord(recordKind, row, context = {}) {
  if (!['project_task', 'engagement_work_item'].includes(recordKind)) throw new TypeError('Unsupported planning record kind')
  const isTask = recordKind === 'project_task'
  return Object.freeze({
    recordKind,
    id: row.id,
    key: `${recordKind}:${row.id}`,
    title: row.title || 'Untitled work',
    status: row.status,
    priority: row.priority || 'medium',
    dueDate: dateOnly(row.due_date),
    startDate: dateOnly(row.start_date),
    rowVersion: Number(row.row_version || 1),
    assigneeId: isTask ? row.assigned_to : row.assignee_id,
    departmentId: row.department_id || null,
    position: isTask ? null : Number(row.position || 0),
    canDrag: !isTask,
    lifecycle: isTask ? PROJECT_TASK_STATUSES : WORK_ITEM_STATUSES,
    dependencies: context.dependencies || [],
    source: row,
  })
}

export function buildPlanningWorkspace(workspace) {
  const taskDependencies = new Map()
  for (const relation of workspace.taskDependencies || []) {
    taskDependencies.set(relation.task_id, [...(taskDependencies.get(relation.task_id) || []), relation])
  }
  const itemDependencies = new Map()
  for (const relation of workspace.workItemDependencies || []) {
    itemDependencies.set(relation.work_item_id, [...(itemDependencies.get(relation.work_item_id) || []), relation])
  }
  const projectTasks = (workspace.projectTasks || [])
    .map(row => planningRecord('project_task', row, { dependencies: taskDependencies.get(row.id) || [] }))
    .sort((a, b) => compareDate(a.source, b.source))
  const engagementWorkItems = (workspace.engagementWorkItems || [])
    .map(row => planningRecord('engagement_work_item', row, { dependencies: itemDependencies.get(row.id) || [] }))
    .sort((a, b) => a.position - b.position || String(a.source.created_at || a.id).localeCompare(String(b.source.created_at || b.id)))
  const records = [...projectTasks, ...engagementWorkItems]
  const board = {
    projectTasks: Object.fromEntries(PROJECT_TASK_STATUSES.map(status => [status, projectTasks.filter(row => row.status === status)])),
    engagementWorkItems: Object.fromEntries(WORK_ITEM_STATUSES.map(status => [status, engagementWorkItems.filter(row => row.status === status)])),
  }
  const calendar = new Map()
  for (const record of records) {
    const key = record.dueDate || 'undated'
    calendar.set(key, [...(calendar.get(key) || []), record])
  }
  const workload = new Map()
  for (const record of records.filter(row => !closed.has(row.status))) {
    const key = record.assigneeId || 'unassigned'
    const current = workload.get(key) || { assigneeId: key, projectTasks: 0, engagementWorkItems: 0, blocked: 0, due: 0 }
    if (record.recordKind === 'project_task') current.projectTasks += 1
    else current.engagementWorkItems += 1
    if (record.status === 'blocked') current.blocked += 1
    if (record.dueDate) current.due += 1
    workload.set(key, current)
  }
  return Object.freeze({
    timezone: effectivePlanningTimezone(workspace.project, workspace.context?.client),
    projectTasks,
    engagementWorkItems,
    records,
    board,
    calendar: [...calendar.entries()].sort(([a], [b]) => a === 'undated' ? 1 : b === 'undated' ? -1 : a.localeCompare(b)),
    timeline: records.filter(row => row.startDate || row.dueDate).sort((a, b) =>
      String(a.startDate || a.dueDate).localeCompare(String(b.startDate || b.dueDate))
        || String(a.dueDate || a.startDate).localeCompare(String(b.dueDate || b.startDate))
        || a.key.localeCompare(b.key)),
    workload: [...workload.values()].sort((a, b) => (b.projectTasks + b.engagementWorkItems) - (a.projectTasks + a.engagementWorkItems) || a.assigneeId.localeCompare(b.assigneeId)),
  })
}
