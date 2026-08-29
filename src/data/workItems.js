export const WORK_ITEM_TYPES = Object.freeze(['task', 'bug', 'request'])
export const WORK_ITEM_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent'])
export const WORK_ITEM_STATUSES = Object.freeze(['not_started', 'in_progress', 'blocked', 'done'])
export const WORK_ITEM_BOARD_COLUMNS = Object.freeze([
  Object.freeze({ value: 'not_started', label: 'Not Started' }),
  Object.freeze({ value: 'in_progress', label: 'In Progress' }),
  Object.freeze({ value: 'blocked', label: 'Blocked' }),
  Object.freeze({ value: 'done', label: 'Done' }),
])

const PRIORITY_ORDER = Object.freeze({ urgent: 0, high: 1, medium: 2, low: 3 })
const STATUS_ORDER = Object.freeze({ blocked: 0, in_progress: 1, not_started: 2, done: 3 })

export const EMPTY_WORK_ITEM = Object.freeze({
  id: '',
  title: '',
  description: '',
  work_item_type: 'task',
  priority: 'medium',
  status: 'not_started',
  assignee_id: '',
  department_id: '',
  linked_artifact_id: '',
  linked_artifact_version_id: '',
  linked_engagement_stage_instance_id: '',
  start_date: '',
  due_date: '',
  position: 0,
})

export function artifactRoute(artifactType) {
  if (['technical_brief', 'launch_checklist'].includes(artifactType)) return '/sphere/engagements'
  if (['campaign_messaging', 'scripts', 'channel_strategy', 'campaign_brief', 'measurement_plan', 'marketing_report'].includes(artifactType)) return '/sphere/marketing/studio'
  if (['content', 'website_architecture', 'keyword_strategy', 'audience', 'discovery', 'vision'].includes(artifactType)) return '/sphere/content/studio'
  return '/sphere/design/workshop'
}

export function filterAndSortWorkItems(items, filters = {}, sort = {}, today = new Date()) {
  const date = today.toISOString().slice(0, 10)
  const sevenDays = new Date(`${date}T00:00:00Z`)
  sevenDays.setUTCDate(sevenDays.getUTCDate() + 7)
  const sevenDayDate = sevenDays.toISOString().slice(0, 10)
  const filtered = (items || []).filter(item => {
    if (filters.status && item.status !== filters.status) return false
    if (filters.assignee && item.assignee_id !== filters.assignee) return false
    if (filters.department && item.department_id !== filters.department) return false
    if (filters.priority && item.priority !== filters.priority) return false
    if (filters.due === 'overdue' && (!item.due_date || item.due_date >= date || item.status === 'done')) return false
    if (filters.due === 'next_7_days' && (!item.due_date || item.due_date < date || item.due_date > sevenDayDate)) return false
    if (filters.due === 'no_due_date' && item.due_date) return false
    return true
  })
  const key = sort.key || 'position'
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...filtered].sort((left, right) => {
    let leftValue = left[key]
    let rightValue = right[key]
    if (key === 'priority') { leftValue = PRIORITY_ORDER[left.priority]; rightValue = PRIORITY_ORDER[right.priority] }
    if (key === 'status') { leftValue = STATUS_ORDER[left.status]; rightValue = STATUS_ORDER[right.status] }
    if (leftValue == null || leftValue === '') return 1
    if (rightValue == null || rightValue === '') return -1
    return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * direction
  })
}

export function workItemSaveInput(item, engagementId, overrides = {}) {
  const next = { ...item, ...overrides }
  return {
    workItemId: next.id || null,
    engagementId,
    title: next.title,
    description: next.description,
    workItemType: next.work_item_type,
    priority: next.priority,
    status: next.status,
    assigneeId: next.assignee_id || null,
    departmentId: next.department_id || null,
    linkedArtifactId: next.linked_artifact_id || null,
    linkedArtifactVersionId: next.linked_artifact_version_id || null,
    linkedEngagementStageInstanceId: next.linked_engagement_stage_instance_id || null,
    startDate: next.start_date || null,
    dueDate: next.due_date || null,
    position: Math.max(0, Number(next.position || 0)),
  }
}

export function groupWorkItemsForBoard(items) {
  const columns = Object.fromEntries(WORK_ITEM_STATUSES.map(status => [status, []]))
  for (const item of items || []) {
    if (columns[item.status]) columns[item.status].push(item)
  }
  for (const status of WORK_ITEM_STATUSES) {
    columns[status].sort((left, right) => Number(left.position || 0) - Number(right.position || 0) || String(left.created_at || left.id).localeCompare(String(right.created_at || right.id)))
  }
  return columns
}

export function planWorkItemBoardMove(items, workItemId, targetStatus, beforeWorkItemId = null) {
  if (!WORK_ITEM_STATUSES.includes(targetStatus)) return []
  const moved = (items || []).find(item => item.id === workItemId)
  if (!moved) return []

  const columns = groupWorkItemsForBoard(items)
  const targetItems = columns[targetStatus].filter(item => item.id !== workItemId)
  const targetIndex = beforeWorkItemId
    ? targetItems.findIndex(item => item.id === beforeWorkItemId)
    : targetItems.length
  const insertionIndex = targetIndex < 0 ? targetItems.length : targetIndex
  const previous = targetItems[insertionIndex - 1]
  const next = targetItems[insertionIndex]
  const previousPosition = previous ? Number(previous.position || 0) : null
  const nextPosition = next ? Number(next.position || 0) : null

  let position
  if (previousPosition == null && nextPosition == null) position = 0
  else if (previousPosition == null && nextPosition > 0) position = Math.floor(nextPosition / 2)
  else if (nextPosition == null) position = previousPosition + 1000
  else if (nextPosition - previousPosition > 1) position = previousPosition + Math.floor((nextPosition - previousPosition) / 2)

  if (position != null) {
    if (moved.status === targetStatus && Number(moved.position || 0) === position) return []
    return [{ ...moved, status: targetStatus, position }]
  }

  const reordered = [...targetItems]
  reordered.splice(insertionIndex, 0, { ...moved, status: targetStatus })
  return reordered
    .map((item, index) => ({ ...item, status: targetStatus, position: (index + 1) * 1000 }))
    .filter(item => item.id === moved.id || item.status !== (items.find(existing => existing.id === item.id)?.status) || item.position !== Number(items.find(existing => existing.id === item.id)?.position || 0))
}
