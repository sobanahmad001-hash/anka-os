import { workRecordPath } from './workItemExperience.js'

// Presentation only: dependencies retain their own source kind and status.
export function projectWorkCard(workspace, kind, id, workshopPath = '') {
  const task = kind === 'project_task'
  if (!task && kind !== 'engagement_work_item') return null
  const root = workspace.project
  const rows = (task ? workspace.projectTasks : workspace.engagementWorkItems).filter(row => row.organization_id === root.organization_id && row.project_id === root.id && (task || row.engagement_id === workspace.engagement?.id))
  const item = rows.find(row => row.id === id)
  if (!item) return null
  const sourceKey = task ? 'task_id' : 'work_item_id', targetKey = task ? 'depends_on_task_id' : 'depends_on_work_item_id'
  const relations = task ? workspace.taskDependencies : workspace.workItemDependencies
  const targets = new Map(rows.map(row => [row.id, row]))
  const dependencies = [...new Set((relations || []).filter(row => row.organization_id === root.organization_id && (!task || row.project_id === root.id) && row[sourceKey] === id).map(row => row[targetKey]))].map(target => targets.get(target)).filter(Boolean)
  const unavailable = workspace.dependencyGaps?.[kind]?.[id] || 0
  const unfinished = dependencies.filter(row => row.status !== 'done')
  const own = workRecordPath(kind, id)
  let next
  if (item.status === 'done' || (task && item.status === 'cancelled')) next = { label: 'View saved work', path: own, reason: 'Review the saved record and its evidence.' }
  else if (unavailable) next = { label: 'Review dependencies', path: own, reason: 'A prerequisite is unavailable in this project view. Review access and the original dependency record.' }
  else if (unfinished.length) next = { label: 'Review dependency', path: workRecordPath(kind, unfinished[0].id), reason: `${unfinished.length} dependency record(s) are not marked Done. Review ${unfinished[0].title}.` }
  else if (!item.owner?.id) next = { label: 'Review owner', path: own, reason: 'No owner is recorded. Review ownership in the existing work workflow.' }
  else if (item.status === 'blocked') next = { label: 'Review blocker', path: own, reason: 'This record is marked Blocked. Review its details before continuing.' }
  else next = { label: workshopPath ? 'Continue in Workshop' : 'Open work record', path: workshopPath || own, reason: 'Continue in the existing workflow; permissions and approvals are checked there.' }
  return { dependencies, unavailable, next }
}
