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

test('explicit N/A cache-write pricing works only for transports without cache creation', () => {
  for (const [provider, source_url] of [
    ['openai', entry.source_url],
    ['google_gemini', 'https://ai.google.dev/gemini-api/docs/pricing'],
  ]) {
    const candidate = { ...entry, provider, source_url, cache_write_usd_per_million: null }
    const price = selectFreshPipelineRate(JSON.stringify([candidate]), entry.model_id, now, provider)
    assert.equal(price.cache_write_usd_per_million, null)
    const prompt = 'Pinned work'
    assert.equal(conservativePipelineCeiling(prompt, price),
      Math.ceil((new TextEncoder().encode(prompt).length + 4096) * 2 + 1024 * 12))
    assert.equal(measuredPipelineTokenCost({ input_tokens: 100, output_tokens: 10,
      input_tokens_details: { cached_tokens: 20 } }, price), 284)
    assert.throws(() => measuredPipelineTokenCost({ input_tokens: 100, output_tokens: 10,
      input_tokens_details: { cache_write_tokens: 1 } }, price), /cannot be settled/)
    for (const invalid of [undefined, 0, -1, 'not_applicable']) {
      assert.throws(() => selectFreshPipelineRate(JSON.stringify([
        { ...candidate, cache_write_usd_per_million: invalid },
      ]), entry.model_id, now, provider), /cache-write/)
    }
  }
  const anthropic = { ...entry, provider: 'anthropic',
    source_url: 'https://platform.claude.com/docs/en/about-claude/pricing',
    cache_write_usd_per_million: null }
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([anthropic]),
    entry.model_id, now, 'anthropic'), /cache-write/)
})

test('GPT-6 standard prices require cache writes and reserve their maximum rate', () => {
  const price = { ...entry, model_id: 'gpt-6-luna', input_usd_per_million: 0.1,
    cached_input_usd_per_million: 0.01, cache_write_usd_per_million: 0.125,
    output_usd_per_million: 0.5 }
  assert.deepEqual(selectFreshPipelineRate(JSON.stringify([price]), price.model_id, now), price)
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([{ ...price, cache_write_usd_per_million: null }]), price.model_id, now), /cache-write/)
  assert.equal(measuredPipelineTokenCost({ input_tokens: 1000, output_tokens: 100,
    input_tokens_details: { cached_tokens: 200, cache_write_tokens: 400 } }, price), 142)
  assert.equal(conservativePipelineCeiling('hello', price), Math.ceil(4101 * 0.125 + 1024 * 0.5))
})

const approved = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].map(model_id => ({ ...entry, provider: 'openai', model_id }))
const base = JSON.stringify([entry])
test('supplement adds exact approved rates and preserves legacy/provider isolation', () => {
  for (const row of approved) assert.deepEqual(selectFreshPipelineRate(base, row.model_id, now, 'openai', JSON.stringify(approved)), row)
  for (const extra of [undefined, '', '{', JSON.stringify(approved)]) {
    assert.deepEqual(selectFreshPipelineRate(base, entry.model_id, now, 'openai', extra), entry)
    const other = { ...entry, provider: 'anthropic', source_url: 'https://platform.claude.com/docs/en/about-claude/pricing' }
    assert.deepEqual(selectFreshPipelineRate(JSON.stringify([other]), other.model_id, now, 'anthropic', extra), other)
  }
})
test('supplement cannot rescue invalid base or override any identity', () => {
  for (const raw of [undefined, '{', '[]', '{}', '[null]', JSON.stringify([entry, entry])])
    assert.throws(() => selectFreshPipelineRate(raw, approved[0].model_id, now, 'openai', JSON.stringify(approved)))
  assert.throws(() => selectFreshPipelineRate(JSON.stringify([approved[0]]), approved[0].model_id, now, 'openai', JSON.stringify(approved)), /conflicting/)
  const full = Array.from({ length: 28 }, (_, i) => ({ ...entry, model_id: 'old-' + i }))
  assert.throws(() => selectFreshPipelineRate(JSON.stringify(full), approved[0].model_id, now, 'openai', JSON.stringify(approved)), /bounded/)
})
test('supplement rejects malformed bounds, aliases, duplicates and invalid evidence before selection', () => {
  const bad = ['', '{', '{}', '[]', JSON.stringify([...approved, approved[0]]), JSON.stringify([approved[0], approved[0]])]
  for (const patch of [{ model_id: 'luna' }, { provider: 'anthropic' }, { provider: undefined },
    { verified_at: '2026-09-23' }, { verified_at: '2026-01-01' }, { source_url: 'https://example.com' },
    { input_usd_per_million: 0 }, { cached_input_usd_per_million: -1 }, { output_usd_per_million: 1001 },
    { cache_write_usd_per_million: null }]) bad.push(JSON.stringify([{ ...approved[0], ...patch }]))
  for (const raw of bad) assert.throws(() => selectFreshPipelineRate(base, approved[0].model_id, now, 'openai', raw))
})
