import { invokeDesignFunction } from './designWorkshopRequest.js'

export function getDesignVideoQuote(client, organizationId, input, signal) {
  if (!organizationId || !input?.direction_version_id) throw new Error('Exact Design context is required')
  const { direction_version_id, duration_seconds, resolution, aspect_ratio, output_format, generate_audio } = input
  return invokeDesignFunction(client, 'design-workshop', organizationId, 'get_video_quote',
    { direction_version_id, duration_seconds, resolution, aspect_ratio, output_format, generate_audio }, { signal })
}

// Display validation only. Server revalidation, quote trust and spending remain
// server-owned. A displayed quote alone never authorizes generation.
export function videoQuoteDisplay(data, input, now = Date.now()) {
  if (!data || typeof data.paid_execution_enabled !== 'boolean' || typeof data.organization_cap_configured !== 'boolean') {
    return { status: 'invalid', message: 'Quote response unavailable. Check again.' }
  }
  const capMissing = !data.organization_cap_configured
  const quote = data.quote
  if (quote === null) return { status: 'missing', capMissing, message: 'No verified quote is available for these exact settings.' }
  const fields = ['duration_seconds', 'resolution', 'aspect_ratio', 'output_format', 'generate_audio']
  if (!quote || !quote.id || quote.provider !== 'higgsfield'
    || quote.model_id !== 'bytedance/seedance-2.5/text-to-video'
    || fields.some(key => quote[key] !== input[key]) || quote.currency !== 'USD'
    || !Number.isSafeInteger(quote.max_charge_microusd) || quote.max_charge_microusd <= 0
    || quote.max_charge_microusd > 2_000_000
    || !Number.isFinite(Date.parse(quote.verified_at)) || !Number.isFinite(Date.parse(quote.valid_until))
    || Date.parse(quote.verified_at) > now || Date.parse(quote.valid_until) - Date.parse(quote.verified_at) > 86400000) {
    return { status: 'invalid', capMissing, message: 'No valid quote matches these settings. Check again.' }
  }
  if (Date.parse(quote.valid_until) <= now) return { status: 'expired', capMissing, message: 'This quote expired. Check again for these exact settings.' }
  return { status: 'quoted', capMissing, quoteId: quote.id, validUntil: quote.valid_until,
    // Upward rounding avoids displaying a lower maximum than the quoted amount.
    maximum: (Math.ceil(quote.max_charge_microusd / 10000) / 100).toFixed(2),
    paidExecutionEnabled: data.paid_execution_enabled,
    message: data.paid_execution_enabled
      ? 'Verified quote for these exact settings. Submission still requires a verified connection, budget, and your confirmation.'
      : 'Verified quote for these exact settings. Paid execution remains disabled.' }
}

// Display gating only. The server must recheck every condition before reserve/dispatch.
export function canSubmitVideo({ display, connection, prompt, supported, spendConfirmed }) {
  return supported === true && spendConfirmed === true
    && display?.status === 'quoted' && display.capMissing === false
    && display.paidExecutionEnabled === true && typeof display.quoteId === 'string'
    && connection?.provider === 'higgsfield' && connection.status === 'verified'
    && connection.organization_level === true && connection.secret_configured === true
    && /^ANKA_HIGGSFIELD_[A-Z0-9_]+$/.test(connection.secret_name || '')
    && typeof prompt === 'string' && prompt.trim().length >= 1
    && prompt.trim().length <= 12000
}
