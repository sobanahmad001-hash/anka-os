// A suggestion is never a saved opt-in. Existing {} remains unscheduled.
export const SUGGESTED_LOCAL_TIME = '09:00'
export function validateScheduleDefinition(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Schedule definition must be an object')
  const definition = value as Record<string, unknown>
  if (!('scheduler' in definition)) return definition
  const scheduler = definition.scheduler as Record<string, unknown>
  if (!scheduler || typeof scheduler !== 'object' || Array.isArray(scheduler)
    || Object.keys(scheduler).sort().join(',') !== 'enabled,local_time,policy'
    || scheduler.enabled !== true || scheduler.policy !== 'ret4_v1'
    || typeof scheduler.local_time !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(scheduler.local_time)) {
    throw new Error('Explicit scheduler consent, local time and ret4_v1 policy required')
  }
  return definition
}
