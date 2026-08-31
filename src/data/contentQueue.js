import { CONTENT_REQUEST_FORMATS } from './contentRequests.js'

export const CONTENT_QUEUE_STATUSES = Object.freeze(['planned', 'actioned', 'skipped'])
export const CONTENT_QUEUE_FORMATS = CONTENT_REQUEST_FORMATS

export function newContentQueueEntry(brandId = '') {
  return {
    brand_id: brandId,
    planned_date: new Date().toISOString().slice(0, 10),
    format: 'single_image',
    brief_template: '',
    linked_event_id: '',
  }
}

export function serializeContentQueueEntry(form) {
  return {
    brand_id: String(form.brand_id || '').trim(),
    planned_date: String(form.planned_date || '').trim(),
    format: form.format,
    brief_template: String(form.brief_template || '').trim(),
    linked_event_id: String(form.linked_event_id || '').trim() || null,
  }
}

export function queueEntriesForMonth(entries, month, brandId) {
  return (entries || []).filter(entry =>
    entry.brand_id === brandId && entry.planned_date?.startsWith(month))
    .sort((left, right) => left.planned_date.localeCompare(right.planned_date)
      || left.created_at.localeCompare(right.created_at))
}

export function groupQueueEntriesByDate(entries) {
  return entries.reduce((groups, entry) => {
    const current = groups.get(entry.planned_date) || []
    current.push(entry)
    groups.set(entry.planned_date, current)
    return groups
  }, new Map())
}
