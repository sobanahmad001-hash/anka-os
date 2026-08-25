function readBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  return String(value).toLowerCase() === 'true'
}

export const featureFlags = Object.freeze({
  // Client approval actions remain disabled until internal UAT is complete.
  clientApprovals: readBoolean(import.meta.env.VITE_CLIENT_APPROVALS_ENABLED, false),
})
