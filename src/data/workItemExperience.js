import { appendWorkshopNavigation, WORKSHOP_DESTINATIONS } from './workshopNavigation.js'

export const WORK_RECORD_TYPES = Object.freeze({
  PROJECT_TASK: 'project_task',
  ENGAGEMENT_WORK_ITEM: 'engagement_work_item',
})

export const MY_WORK_HORIZON_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000
const closedStatuses = new Set(['done', 'cancelled', 'completed', 'declined', 'withdrawn', 'archived', 'delivered_published'])

const cleanDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
const utcDate = value => {
  const normalized = cleanDate(value)
  return normalized ? new Date(`${normalized}T00:00:00Z`) : null
}

export function workRecordPath(kind, id) {
  if (!Object.values(WORK_RECORD_TYPES).includes(kind) || !id) return ''
  return `/sphere/workspace/items/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
}

export function workRecordForQueue(kind, row) {
  return Object.freeze({
    kind,
    id: row?.id || '',
    title: row?.title || 'Untitled work',
    status: row?.status || 'unknown',
    priority: row?.priority || 'unrated',
    dueDate: cleanDate(row?.due_date),
    projectName: row?.projects?.name || 'Project',
    source: row,
    path: workRecordPath(kind, row?.id),
  })
}

export function buildMyWorkPlan(workspace = {}, anchorDate = new Date()) {
  const anchor = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate()))
  const horizon = new Date(anchor.getTime() + (MY_WORK_HORIZON_DAYS * DAY_MS))
  const records = [
    ...(workspace.tasks || []).map(row => workRecordForQueue(WORK_RECORD_TYPES.PROJECT_TASK, row)),
    ...(workspace.workItems || []).map(row => workRecordForQueue(WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM, row)),
  ].filter(record => record.id && !closedStatuses.has(record.status))

  const buckets = { overdue: [], next: [], later: [], undated: [], blocked: [] }
  for (const record of records) {
    const due = utcDate(record.dueDate)
    if (record.status === 'blocked') buckets.blocked.push(record)
    if (!due) buckets.undated.push(record)
    else if (due < anchor) buckets.overdue.push(record)
    else if (due <= horizon) buckets.next.push(record)
    else buckets.later.push(record)
  }
  const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3, unrated: 4 }
  const order = (left, right) => (priorityRank[left.priority] ?? 5) - (priorityRank[right.priority] ?? 5)
    || String(left.dueDate || '9999-12-31').localeCompare(String(right.dueDate || '9999-12-31'))
    || left.title.localeCompare(right.title)
  Object.values(buckets).forEach(rows => rows.sort(order))

  return Object.freeze({
    scope: 'Signed-in user · active organization',
    range: `${anchor.toISOString().slice(0, 10)} through ${horizon.toISOString().slice(0, 10)}`,
    horizonDays: MY_WORK_HORIZON_DAYS,
    total: records.length,
    ...buckets,
  })
}

export function workshopPathForRecord(detail) {
  const departmentId = detail?.record?.department_id
  const destination = WORKSHOP_DESTINATIONS[departmentId]
  const origin = workRecordPath(detail?.kind, detail?.record?.id)
  if (!destination || !origin || !detail?.record?.organization_id || !detail?.record?.project_id) return ''
  return appendWorkshopNavigation(destination, {
    organizationId: detail.record.organization_id,
    clientId: detail.project?.client_id || '',
    projectId: detail.record.project_id,
    engagementId: detail.kind === WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM ? detail.record.engagement_id : detail.engagement?.id || '',
    brandId: detail.kind === WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM ? detail.record.brand_id : detail.engagement?.brand_id || '',
    stageId: detail.record.linked_engagement_stage_instance_id || '',
    origin,
    originTab: 'overview',
    workRecord: { kind: detail.kind, id: detail.record.id },
  })
}

export function workRecordState(detail) {
  if (!detail?.record) return 'denied'
  if (detail.kind === WORK_RECORD_TYPES.PROJECT_TASK && detail.record.archived_at) return 'stale'
  if (detail.kind === WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM && detail.record.deleted_at) return 'stale'
  return 'ready'
}
