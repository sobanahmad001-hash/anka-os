export const EVENT_CATEGORIES = Object.freeze([
  'concert', 'sports', 'festival', 'awards', 'holiday', 'fashion', 'conference', 'other',
])

export const EVENT_CONTENT_TYPES = Object.freeze(['blog', 'social', 'email', 'design_asset'])
export const EVENT_LINK_STATUSES = Object.freeze(['planned', 'in_progress', 'ready', 'published'])

export function dueLabel(date, today = new Date()) {
  const target = new Date(`${date}T00:00:00`)
  const baseline = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((target - baseline) / 86400000)
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Due today'
  return `Due in ${days}d`
}

export function calendarMonth(events, month) {
  const prefix = `${month}-`
  return (events || []).filter(event => event.start_date?.startsWith(prefix))
}

export function displayWorkItem(link) {
  const relation = Array.isArray(link.work_items) ? link.work_items[0] : link.work_items
  if (!relation) return 'No linked work item'
  if (relation.deleted_at) return `${relation.title} (historical)`
  return relation.title
}
