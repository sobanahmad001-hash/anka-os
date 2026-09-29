// UX acknowledgement only. Server authorization and readiness are always required.
export function textAiConsentKey({ userId, organizationId, departmentId, projectId, engagementId, contextKind, conversationId, connectionId, provider, canonical = false, recipients = [], sources = [], selectedAttachmentIds = [] }) {
  return JSON.stringify([userId, organizationId, departmentId, projectId, engagementId, contextKind, conversationId, connectionId, provider, canonical, [...recipients].sort(), [...sources].sort(), [...selectedAttachmentIds].sort()])
}
export function hasTextAiConsent(grant, key) {
  return grant?.key === key
}
