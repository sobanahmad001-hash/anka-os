function readBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  return String(value).toLowerCase() === 'true'
}

export const featureFlags = Object.freeze({
  // Client approval actions remain disabled until internal UAT is complete.
  clientApprovals: readBoolean(import.meta.env.VITE_CLIENT_APPROVALS_ENABLED, false),
  // AI can transmit authorized project context to a configured external model provider.
  // Keep it off until the organization explicitly approves that data boundary.
  aiAssistance: readBoolean(import.meta.env.VITE_AI_ASSISTANCE_ENABLED, false),
})
