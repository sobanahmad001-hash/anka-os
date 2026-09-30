const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PREFIX = 'anka:direct-chat:b1:'
const FIELDS = ['conversation_id', 'client_request_id', 'dispatch_request_id', 'message_id']

export const directChatRecoveryKey = (actor, organization, kind, project, department) =>
  PREFIX + JSON.stringify([actor, organization, kind, project || '', department || ''])

export function readDirectChatRecovery(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key))
    if (!value || !UUID.test(value.conversation_id) || !UUID.test(value.client_request_id)
      || Object.keys(value).some(field => !FIELDS.includes(field) || !UUID.test(value[field]))) return null
    return value
  } catch { return null }
}

export function writeDirectChatRecovery(key, value) {
  // One bounded, UUID-only record per scope. Failure blocks dispatch, rather than
  // silently losing the identity needed to recover a potentially billable request.
  const record = Object.fromEntries(FIELDS.filter(field => value[field]).map(field => [field, value[field]]))
  if (!UUID.test(record.conversation_id) || !UUID.test(record.client_request_id)
    || Object.values(record).some(id => !UUID.test(id))) throw new Error('Invalid recovery identity')
  sessionStorage.setItem(key, JSON.stringify(record))
}

export function clearDirectChatRecovery(key) { sessionStorage.removeItem(key) }
