// A server-loaded, exact-configuration price record is required before any
// Design video reservation. Browser-provided price fields are never trusted.
export const MAX_VIDEO_COST_MICROUSD = 2_000_000
const model = 'bytedance/seedance-2.5/text-to-video'
const provider = 'higgsfield'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = () => { throw new Error('Verified video price is unavailable for this exact request') }

export function requireFreshVideoQuote(input, quote, now = new Date()) {
  if (!quote || typeof quote !== 'object'
    || !uuid.test(quote.id || '')
    || quote.provider !== provider || quote.model_id !== model
    || quote.duration_seconds !== input?.duration
    || quote.resolution !== input?.resolution
    || quote.generate_audio !== input?.generate_audio
    || quote.aspect_ratio !== input?.aspect_ratio
    || quote.output_format !== input?.output_format
    || quote.currency !== 'USD'
    || !Number.isSafeInteger(quote.max_charge_microusd)
    || quote.max_charge_microusd < 1
    || quote.max_charge_microusd > MAX_VIDEO_COST_MICROUSD
    || typeof quote.source_url !== 'string'
    || !quote.source_url.startsWith(
      'https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video')
    || !Number.isFinite(Date.parse(quote.verified_at))
    || !Number.isFinite(Date.parse(quote.valid_until))
    || Date.parse(quote.verified_at) > now.getTime()
    || Date.parse(quote.valid_until) <= now.getTime()
    || Date.parse(quote.valid_until) - Date.parse(quote.verified_at) > 86_400_000) fail()
  return { quote_id: quote.id, max_cost_microusd: quote.max_charge_microusd }
}
