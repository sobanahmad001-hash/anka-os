export const QUICK_TASK_STATES = Object.freeze(['active', 'preserved', 'expired', 'discarded', 'promoted'])

export function quickTaskContent(value = {}) {
  return {
    notes: String(value.notes || '').slice(0, 50000),
    checklist: Array.isArray(value.checklist)
      ? value.checklist.slice(0, 100).map(item => ({
          text: String(item?.text || '').trim().slice(0, 500),
          done: Boolean(item?.done),
        })).filter(item => item.text)
      : [],
  }
}

export function daysUntilExpiry(value, now = new Date()) {
  const expires = new Date(value)
  if (Number.isNaN(expires.getTime())) return null
  return Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / 86400000))
}
