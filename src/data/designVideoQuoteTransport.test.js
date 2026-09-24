import test from 'node:test'
import assert from 'node:assert/strict'
import { getDesignVideoQuote, videoQuoteDisplay } from './designVideoQuoteTransport.js'
const input = { direction_version_id: 'version-1', duration_seconds: 5, resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false }
const now = Date.parse('2026-09-24T12:00:00Z')
const quote = { ...input, id: 'quote-1', provider: 'higgsfield', model_id: 'bytedance/seedance-2.5/text-to-video', currency: 'USD', max_charge_microusd: 1440001, verified_at: '2026-09-24T11:00:00Z', valid_until: '2026-09-24T13:00:00Z' }
const response = { quote, organization_cap_configured: true, paid_execution_enabled: false }
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
test('exact quote rounds displayed maximum upward and never marks execution enabled', () => {
  const result = videoQuoteDisplay(response, input, now)
  assert.equal(result.status, 'quoted'); assert.equal(result.maximum, '1.45')
  assert.match(result.message, /disabled/)
})
test('missing quote and missing organization cap remain separate states', () => {
  assert.deepEqual(videoQuoteDisplay({ ...response, quote: null, organization_cap_configured: false }, input, now), { status: 'missing', capMissing: true, message: 'No verified quote is available for these exact settings.' })
  assert.equal(videoQuoteDisplay({ ...response, organization_cap_configured: false }, input, now).status, 'quoted')
})
test('expired, over-limit, mismatched and unexpectedly enabled responses are not quoted', () => {
  assert.equal(videoQuoteDisplay(response, input, Date.parse(quote.valid_until)).status, 'expired')
  assert.equal(videoQuoteDisplay({ ...response, paid_execution_enabled: true }, input, now).status, 'invalid')
  for (const patch of [{ max_charge_microusd: 2000001 }, { currency: 'EUR' }, { duration_seconds: 6 }, { resolution: '1080p' }, { aspect_ratio: '9:16' }, { output_format: 'mov' }, { generate_audio: true }, { verified_at: 'bad' }]) {
    assert.equal(videoQuoteDisplay({ ...response, quote: { ...quote, ...patch } }, input, now).status, 'invalid')
  }
})
