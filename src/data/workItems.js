export const WORK_ITEM_TYPES = Object.freeze(['task', 'bug', 'request'])
export const WORK_ITEM_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent'])
export const WORK_ITEM_STATUSES = Object.freeze(['not_started', 'in_progress', 'blocked', 'done'])

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
