const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function engagementFirstSendKey(scope) {
  const { userId, organizationId, projectId, engagementId, departmentId } = scope
  return 'anka:engagement-first-send:v1:' + JSON.stringify([userId, organizationId, projectId, engagementId, departmentId])
}
export function readEngagementFirstSend(key, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null')
    return value?.version === 1 && UUID.test(value.conversationId) && UUID.test(value.requestId)
      ? { version: 1, conversationId: value.conversationId, requestId: value.requestId } : null
  } catch { return null }
}
export function saveEngagementFirstSend(key, attempt, storage = globalThis.sessionStorage) {
  if (!UUID.test(attempt.conversationId) || !UUID.test(attempt.requestId) || !storage) throw new Error('First Send recovery storage is unavailable. No request was sent.')
  const value = { version: 1, conversationId: attempt.conversationId, requestId: attempt.requestId }
  try {
    storage.setItem(key, JSON.stringify(value))
    if (storage.getItem(key) !== JSON.stringify(value)) throw new Error('Storage verification failed')
  } catch { throw new Error('First Send recovery storage is unavailable. No request was sent.') }
  return value
}
export function clearEngagementFirstSend(key, storage = globalThis.sessionStorage) {
  try { storage?.removeItem(key) } catch { /* A retained identity can only lead to read-only recovery. */ }
}
