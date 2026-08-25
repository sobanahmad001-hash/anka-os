function readBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

export const featureFlags = Object.freeze({
  // Formal client approval of released exact versions.
  clientApprovals: readBoolean(import.meta.env.VITE_CLIENT_APPROVALS_ENABLED, true),
  // Grounded AI assistance through the authenticated server gateway.
  aiAssistance: readBoolean(import.meta.env.VITE_AI_ASSISTANCE_ENABLED, true),
  // Secure integration center: list, save metadata, and test connections.
  // External publish/write operations stay blocked in the gateway.
  externalIntegrations: readBoolean(import.meta.env.VITE_EXTERNAL_INTEGRATIONS_ENABLED, true),
})
