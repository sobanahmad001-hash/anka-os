import assert from 'node:assert/strict'
import test from 'node:test'
import { requireFreshVideoQuote } from '../../supabase/functions/_shared/designVideoQuote.js'

const input = { duration: 5, resolution: '720p', generate_audio: false, aspect_ratio: '16:9', output_format: 'mp4' }
const quote = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  provider: 'higgsfield', model_id: 'bytedance/seedance-2.5/text-to-video',
  duration_seconds: 5, resolution: '720p', generate_audio: false,
  aspect_ratio: '16:9', output_format: 'mp4', currency: 'USD',
  max_charge_microusd: 1_800_000, source_url: 'https://example.com/price',
  verified_at: '2026-09-24T09:00:00Z', valid_until: '2026-09-24T18:00:00Z',
}
const now = new Date('2026-09-24T10:00:00Z')

test('only an exact fresh server quote below the user cap can reserve', () => {
  assert.deepEqual(requireFreshVideoQuote(input, quote, now), {
    quote_id: quote.id, max_cost_microusd: 1_800_000,
  })
  for (const altered of [
    { max_charge_microusd: 2_000_001 },
    { max_charge_microusd: null },
    { valid_until: '2026-09-24T09:59:59Z' },
    { valid_until: '2026-09-26T09:00:00Z' },
    { source_url: 'http://example.com/price' },
    { resolution: '480p' },
    { generate_audio: true },
    { duration_seconds: 6 },
    { model_id: 'other' },
  ]) {
    assert.throws(() => requireFreshVideoQuote(input, { ...quote, ...altered }, now))
  }
})
