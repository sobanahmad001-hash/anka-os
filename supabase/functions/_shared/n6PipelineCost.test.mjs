import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  selectFreshPipelineRate, conservativePipelineCeiling, measuredPipelineTokenCost,
} from './n6PipelineCost.ts'

const now = new Date('2026-09-22T00:00:00Z')
const entry = {
  model_id: 'verified-test-model',
  verified_at: '2026-09-21T00:00:00Z',
  source_url: 'https://developers.openai.com/api/docs/pricing',
  input_usd_per_million: 2,
  cached_input_usd_per_million: 0.2,
  cache_write_usd_per_million: 2.5,
  output_usd_per_million: 12,
}

test('pricing requires exact fresh model evidence', () => {
  assert.deepEqual(selectFreshPipelineRate(JSON.stringify([entry]), entry.model_id, now), entry)
  assert.throws(() => selectFreshPipelineRate(undefined, entry.model_id, now), /not configured/)
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([entry, entry]), entry.model_id, now), /one exact/)
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([{ ...entry, verified_at: '2026-07-01T00:00:00Z' }]), entry.model_id, now), /stale/)
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([{ ...entry, source_url: 'https://example.com/rates' }]), entry.model_id, now), /unverified/)
})

test('reservation ceiling is conservative and bounded', () => {
  const ceiling = conservativePipelineCeiling('Pinned work', entry)
  assert.ok(ceiling > 1024 * entry.output_usd_per_million)
  assert.throws(() => conservativePipelineCeiling('x'.repeat(24001), entry), /invalid/)
})

test('token cost uses provider usage and refuses incomplete counters', () => {
  const measured = measuredPipelineTokenCost({
    input_tokens: 1000, output_tokens: 100,
    input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
  }, entry)
  assert.equal(measured, Math.ceil(700 * 2 + 200 * 0.2 + 100 * 2.5 + 100 * 12))
  assert.throws(() => measuredPipelineTokenCost({
    input_tokens: 10, output_tokens: 2,
    input_tokens_details: { cached_tokens: 11 },
  }, entry), /incomplete/)
})

test('N7 pricing evidence is provider-specific and fresh', () => {
  for (const [provider, source_url] of [
    ['anthropic', 'https://platform.claude.com/docs/en/about-claude/pricing'],
    ['google_gemini', 'https://ai.google.dev/gemini-api/docs/pricing'],
  ]) {
    const providerRate = { ...entry, provider, source_url }
    assert.deepEqual(selectFreshPipelineRate(JSON.stringify([providerRate]),
      entry.model_id, now, provider), providerRate)
    assert.throws(() => selectFreshPipelineRate(JSON.stringify([providerRate]),
      entry.model_id, now, 'openai'), /unverified/)
    assert.throws(() => selectFreshPipelineRate(JSON.stringify([{ ...providerRate, provider: 'openai' }]),
      entry.model_id, now, provider), /unverified/)
  }
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([{
    ...entry, provider: 'anthropic', source_url: 'https://platform.claude.com.evil.test/docs/en/about-claude/pricing',
  }]), entry.model_id, now, 'anthropic'), /unverified/)
})
