import test from 'node:test'
import assert from 'node:assert/strict'
import { canSubmitVideo, getDesignVideoQuote, videoQuoteDisplay } from './designVideoQuoteTransport.js'
const input = { direction_version_id: 'version-1', duration_seconds: 5, resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false }
const now = Date.parse('2026-09-24T12:00:00Z')
const quote = { ...input, id: 'quote-1', provider: 'higgsfield', model_id: 'bytedance/seedance-2.5/text-to-video', currency: 'USD', max_charge_microusd: 1440001, verified_at: '2026-09-24T11:00:00Z', valid_until: '2026-09-24T13:00:00Z' }
const response = { quote, organization_cap_configured: true, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap', paid_execution_enabled: false }
test('quote transport pins organization and exact parameters without forwarding prices or actions', async () => {
  let received
  const signal = new AbortController().signal
  const client = { functions: { invoke: async (name, options) => { received = { name, options }; return { data: { data: response } } } } }
  assert.deepEqual(await getDesignVideoQuote(client, 'org-1', { ...input, action: 'generate_video', organization_id: 'other', max_charge_microusd: 1 }, signal), response)
  assert.deepEqual(received, { name: 'design-workshop', options: { body: { action: 'get_video_quote', ...input, organization_id: 'org-1' }, signal } })
})
test('aborted scope makes no quote lookup and read failures remain failures', async () => {
  const controller = new AbortController(); controller.abort()
  const client = { functions: { invoke: () => { throw new Error('unexpected request') } } }
  await assert.rejects(getDesignVideoQuote(client, 'org', input, controller.signal), { name: 'AbortError' })
  await assert.rejects(getDesignVideoQuote({ functions: { invoke: async () => ({ error: { message: 'Denied', status: 403 } }) } }, 'org', input), { status: 403 })
})
test('exact quote rounds displayed maximum upward and reports the server execution gate', () => {
  const result = videoQuoteDisplay(response, input, now)
  assert.equal(result.status, 'quoted'); assert.equal(result.maximum, '1.45')
  assert.match(result.message, /disabled/)
  assert.equal(result.paidExecutionEnabled, false)
})
test('missing quote and missing spend tracking remain separate states', () => {
  assert.deepEqual(videoQuoteDisplay({ ...response, quote: null, organization_cap_configured: false, spend_tracking_configured: false, spend_guard_mode: null }, input, now), { status: 'missing', spendTrackingMissing: true, spendGuardMode: null, message: 'No verified quote is available for these exact settings.' })
  assert.equal(videoQuoteDisplay({ ...response, organization_cap_configured: false, spend_tracking_configured: false, spend_guard_mode: null }, input, now).status, 'quoted')
})
test('expired, over-limit and mismatched responses are not quoted', () => {
  assert.equal(videoQuoteDisplay(response, input, Date.parse(quote.valid_until)).status, 'expired')
  assert.equal(videoQuoteDisplay({ ...response, paid_execution_enabled: true }, input, now).paidExecutionEnabled, true)
  for (const patch of [{ max_charge_microusd: 2000001 }, { currency: 'EUR' }, { duration_seconds: 6 }, { resolution: '1080p' }, { aspect_ratio: '9:16' }, { output_format: 'mov' }, { generate_audio: true }, { verified_at: 'bad' }]) {
    assert.equal(videoQuoteDisplay({ ...response, quote: { ...quote, ...patch } }, input, now).status, 'invalid')
  }
})
test('video submission remains closed unless every exact local readiness and consent gate passes', () => {
  const display = videoQuoteDisplay({ ...response, paid_execution_enabled: true }, input, now)
  const connection = { provider: 'higgsfield', status: 'verified', organization_level: true,
    secret_configured: true, secret_name: 'ANKA_HIGGSFIELD_PRIMARY' }
  const ready = { display, connection, prompt: 'Create one short scene', supported: true, spendConfirmed: true }
  assert.equal(canSubmitVideo(ready), true)
  assert.equal(canSubmitVideo({ ...ready, display: videoQuoteDisplay({ ...response, paid_execution_enabled: true,
    organization_cap_configured: false, spend_guard_mode: 'provider_managed' }, input, now) }), true)
  assert.equal(videoQuoteDisplay({ ...response, spend_tracking_configured: true, spend_guard_mode: null }, input, now).status, 'invalid')
  for (const blocked of [
    { display: videoQuoteDisplay(response, input, now) },
    { display: videoQuoteDisplay({ ...response, paid_execution_enabled: true, organization_cap_configured: false, spend_tracking_configured: false, spend_guard_mode: null }, input, now) },
    { display: videoQuoteDisplay({ ...response, paid_execution_enabled: true }, input, Date.parse(quote.valid_until)) },
    { connection: { ...connection, organization_level: false } },
    { connection: { ...connection, secret_configured: false } },
    { connection: { ...connection, secret_name: 'HF_CREDENTIALS' } },
    { prompt: '   ' }, { supported: false }, { spendConfirmed: false },
  ]) assert.equal(canSubmitVideo({ ...ready, ...blocked }), false)
})
