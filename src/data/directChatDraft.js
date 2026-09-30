const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TTL = 60 * 60 * 1000
const validText = value => typeof value === 'string' && value.length <= 8000
const validAttempt = value => !value || (UUID.test(value.conversation_id) && UUID.test(value.client_request_id)
  && validText(value.text) && typeof value.isNew === 'boolean'
  && Object.keys(value).every(key => ['conversation_id', 'client_request_id', 'text', 'isNew'].includes(key)))
export function readDirectChatDraft(key, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(`${key}:draft`))
    if (!value) return null
    if (!Number.isFinite(value.expires_at) || value.expires_at <= now || value.expires_at > now + TTL
      || !UUID.test(value.new_conversation_id) || (value.conversation_id != null && !UUID.test(value.conversation_id))
      || !validText(value.text) || !validAttempt(value.attempt)
      || !Object.keys(value).every(field => ['expires_at', 'new_conversation_id', 'conversation_id', 'text', 'attempt'].includes(field))) {
      storage.removeItem(`${key}:draft`); return null
    }
    return value
  } catch { return null }
}
export function writeDirectChatDraft(key, value, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!validText(value.text) || !UUID.test(value.new_conversation_id) || (value.conversation_id != null && !UUID.test(value.conversation_id)) || !validAttempt(value.attempt) || Object.keys(value).some(field => !['new_conversation_id', 'conversation_id', 'text', 'attempt'].includes(field))) throw new Error('Invalid scoped chat draft')
  if (!value.text && !value.attempt) storage.removeItem(`${key}:draft`)
  else storage.setItem(`${key}:draft`, JSON.stringify({ ...value, expires_at: now + TTL }))
}
export function clearDirectChatDraft(key, storage = globalThis.sessionStorage) { storage.removeItem(`${key}:draft`) }
