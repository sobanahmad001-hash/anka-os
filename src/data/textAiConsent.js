// UX acknowledgement only. Server authorization and readiness are always required.
export function textAiConsentKey({ userId, organizationId, departmentId, projectId, engagementId, contextKind, conversationId, connectionId, provider, canonical = false, recipients = [], sources = [], selectedAttachmentIds = [] }) {
  return JSON.stringify([userId, organizationId, departmentId, projectId, engagementId, contextKind, conversationId, connectionId, provider, canonical, [...recipients].sort(), [...sources].sort(), [...selectedAttachmentIds].sort()])
}
export function hasTextAiConsent(grant, key) {
  return grant?.key === key
}

// Explicit Send covers ordinary chat text. Additional data needs scoped review.
export function textAiConsentNeedsReview(key) {
  try {
    const scope = JSON.parse(key)
    if (!Array.isArray(scope) || scope.length !== 13 || !Array.isArray(scope[11]) || !Array.isArray(scope[12])) return true
    return Boolean(scope[9] || scope[11].length || scope[12].length)
  } catch { return true }
}
const storageKey = 'anka:text-ai-consent:v2'
export function readTextAiConsent(key, storage) {
  try {
    const keys = JSON.parse(storage?.getItem(storageKey) || '[]')
    return Array.isArray(keys) && keys.includes(key) ? { key } : null
  } catch { return null }
}
export function rememberTextAiConsent(key, storage) {
  try {
    const value = JSON.parse(storage?.getItem(storageKey) || '[]')
    const keys = Array.isArray(value) ? value.filter(item => typeof item === 'string' && item !== key) : []
    storage?.setItem(storageKey, JSON.stringify([...keys.slice(-49), key]))
  } catch { /* Storage unavailable: retain only the current mounted grant. */ }
}
