export const WORK_ITEM_TYPES = Object.freeze(['task', 'bug', 'request'])
export const WORK_ITEM_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent'])
export const WORK_ITEM_STATUSES = Object.freeze(['not_started', 'in_progress', 'blocked', 'done'])
export const WORKLOAD_OPEN_ITEM_THRESHOLD = 8
export const UNASSIGNED_WORK_ITEM_FILTER = '__unassigned__'
export const AUTOMATION_TRIGGER_TYPES = Object.freeze([
  'work_item_status_changed',
  'artifact_approved',
  'design_direction_released',
  'due_date_arrived',
])
export const AUTOMATION_ACTION_TYPES = Object.freeze(['move_status', 'notify_assignee'])
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
  parent_work_item_id: '',
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
    if (filters.assignee === UNASSIGNED_WORK_ITEM_FILTER && item.assignee_id) return false
    if (filters.assignee && filters.assignee !== UNASSIGNED_WORK_ITEM_FILTER && item.assignee_id !== filters.assignee) return false
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

export function buildWorkloadRows(items, owners = [], threshold = WORKLOAD_OPEN_ITEM_THRESHOLD) {
  const ownerById = new Map(owners.map(owner => [owner.id, owner]))
  const groups = new Map()

  for (const item of items || []) {
    const assigneeId = item.assignee_id || UNASSIGNED_WORK_ITEM_FILTER
    const current = groups.get(assigneeId) || {
      assigneeId,
      label: assigneeId === UNASSIGNED_WORK_ITEM_FILTER
        ? 'Unassigned'
        : ownerById.get(assigneeId)?.label || 'Unknown member',
      not_started: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      total: 0,
      open: 0,
    }
    if (WORK_ITEM_STATUSES.includes(item.status)) current[item.status] += 1
    current.total += 1
    if (item.status !== 'done') current.open += 1
    groups.set(assigneeId, current)
  }

  return [...groups.values()]
    .map(row => ({ ...row, overAllocated: row.assigneeId !== UNASSIGNED_WORK_ITEM_FILTER && row.open > threshold }))
    .sort((left, right) => {
      if (left.assigneeId === UNASSIGNED_WORK_ITEM_FILTER) return 1
      if (right.assigneeId === UNASSIGNED_WORK_ITEM_FILTER) return -1
      if (left.overAllocated !== right.overAllocated) return left.overAllocated ? -1 : 1
      return right.open - left.open || left.label.localeCompare(right.label)
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
    parentWorkItemId: next.parent_work_item_id || null,
    startDate: next.start_date || null,
    dueDate: next.due_date || null,
    position: Math.max(0, Number(next.position || 0)),
  }
}

export function buildWorkItemRelations(items, dependencies) {
  const itemById = new Map((items || []).map(item => [item.id, item]))
  const subtasksByParent = new Map()
  const blockedByByItem = new Map()
  const blocksByItem = new Map()

  for (const item of items || []) {
    if (item.parent_work_item_id && itemById.has(item.parent_work_item_id)) {
      subtasksByParent.set(item.parent_work_item_id, [...(subtasksByParent.get(item.parent_work_item_id) || []), item])
    }
  }
  for (const dependency of dependencies || []) {
    const workItem = itemById.get(dependency.work_item_id)
    const dependsOn = itemById.get(dependency.depends_on_work_item_id)
    if (!workItem || !dependsOn) continue
    blockedByByItem.set(workItem.id, [...(blockedByByItem.get(workItem.id) || []), dependsOn])
    blocksByItem.set(dependsOn.id, [...(blocksByItem.get(dependsOn.id) || []), workItem])
  }

  return {
    itemById,
    subtasksByParent,
    blockedByByItem,
    blocksByItem,
    openSubtaskCount: workItemId => (subtasksByParent.get(workItemId) || []).filter(item => item.status !== 'done').length,
    unresolvedDependencyCount: workItemId => (blockedByByItem.get(workItemId) || []).filter(item => item.status !== 'done').length,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function utcDate(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + (days * DAY_MS))
}

function mondayOnOrBefore(date) {
  const day = date.getUTCDay() || 7
  return addUtcDays(date, 1 - day)
}

export function buildWorkItemCalendar(items, anchorDate = new Date(), mode = 'month') {
  const safeAnchor = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate()))
  const periodStart = mode === 'week'
    ? mondayOnOrBefore(safeAnchor)
    : mondayOnOrBefore(new Date(Date.UTC(safeAnchor.getUTCFullYear(), safeAnchor.getUTCMonth(), 1)))
  const dayCount = mode === 'week' ? 7 : 42
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = addUtcDays(periodStart, index)
    return { date: isoDate(date), inMonth: date.getUTCMonth() === safeAnchor.getUTCMonth(), items: [] }
  })
  const dayByDate = new Map(days.map(day => [day.date, day]))
  const noDueDate = []

  for (const item of items || []) {
    const due = utcDate(item.due_date)
    if (!due) {
      noDueDate.push(item)
      continue
    }
    const start = utcDate(item.start_date) || due
    const first = start <= due ? start : due
    for (let cursor = first; cursor <= due; cursor = addUtcDays(cursor, 1)) {
      const day = dayByDate.get(isoDate(cursor))
      if (day) day.items.push({ item, isStart: isoDate(cursor) === isoDate(first), isDue: isoDate(cursor) === item.due_date })
    }
  }

  return { days, noDueDate, periodStart: isoDate(periodStart), mode }
}

export function orderWorkItemsWithSubtasks(items) {
  const source = items || []
  const itemById = new Map(source.map(item => [item.id, item]))
  const children = new Map()
  for (const item of source) {
    if (item.parent_work_item_id && itemById.has(item.parent_work_item_id)) {
      children.set(item.parent_work_item_id, [...(children.get(item.parent_work_item_id) || []), item])
    }
  }
  const result = []
  const seen = new Set()
  for (const item of source) {
    if (item.parent_work_item_id && itemById.has(item.parent_work_item_id)) continue
    result.push({ item, depth: 0 })
    seen.add(item.id)
    for (const child of children.get(item.id) || []) {
      result.push({ item: child, depth: 1 })
      seen.add(child.id)
    }
  }
  for (const item of source) if (!seen.has(item.id)) result.push({ item, depth: 0 })
  return result
}

export function buildWorkItemTimeline(items, dependencies) {
  const ordered = orderWorkItemsWithSubtasks(items)
  const scheduled = ordered.filter(({ item }) => item.start_date || item.due_date)
  const unscheduled = ordered.filter(({ item }) => !item.start_date && !item.due_date)
  const dates = scheduled.flatMap(({ item }) => [utcDate(item.start_date), utcDate(item.due_date)]).filter(Boolean)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const rangeStart = dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : today
  let rangeEnd = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : addUtcDays(today, 13)
  if (rangeEnd <= rangeStart) rangeEnd = addUtcDays(rangeStart, 6)
  const totalDays = Math.max(1, Math.round((rangeEnd - rangeStart) / DAY_MS) + 1)
  const itemById = new Map(scheduled.map(({ item }) => [item.id, item]))
  const rowById = new Map()
  const rows = scheduled.map(({ item, depth }, index) => {
    const start = utcDate(item.start_date)
    const due = utcDate(item.due_date)
    const first = start && due ? new Date(Math.min(start.getTime(), due.getTime())) : start || due
    const last = start && due ? new Date(Math.max(start.getTime(), due.getTime())) : due || start
    const left = Math.max(0, Math.round((first - rangeStart) / DAY_MS)) / totalDays * 100
    const spanDays = start && due ? Math.max(1, Math.round((last - first) / DAY_MS) + 1) : 0
    const width = spanDays ? Math.max(1.4, spanDays / totalDays * 100) : 0
    const row = { item, depth, index, left, width, point: !(start && due) }
    rowById.set(item.id, row)
    return row
  })
  const links = (dependencies || []).flatMap(dependency => {
    const workItem = rowById.get(dependency.work_item_id)
    const dependsOn = rowById.get(dependency.depends_on_work_item_id)
    if (!workItem || !dependsOn || !itemById.has(workItem.item.id) || !itemById.has(dependsOn.item.id)) return []
    return [{
      workItemId: workItem.item.id,
      dependsOnWorkItemId: dependsOn.item.id,
      fromRow: workItem.index,
      toRow: dependsOn.index,
      fromX: workItem.left,
      toX: dependsOn.left + (dependsOn.width || 0),
    }]
  })
  return { rows, unscheduled, links, rangeStart: isoDate(rangeStart), rangeEnd: isoDate(rangeEnd), totalDays }
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
