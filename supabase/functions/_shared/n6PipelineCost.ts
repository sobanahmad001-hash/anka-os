export type PipelineModelRate = {
  model_id: string
  verified_at: string
  source_url: string
  input_usd_per_million: number
  cached_input_usd_per_million: number
  cache_write_usd_per_million: number
  output_usd_per_million: number
}

export type ResponseUsage = {
  input_tokens: number
  output_tokens: number
  input_tokens_details?: {
    cached_tokens?: number
    cache_write_tokens?: number
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function rate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value > 0 && value <= 1000
}

export function selectFreshPipelineRate(raw: string | undefined, modelId: string, now = new Date()): PipelineModelRate {
  if (!raw) throw new Error('N6 model pricing is not configured')
  let catalog: unknown
  try { catalog = JSON.parse(raw) } catch { throw new Error('N6 model pricing is invalid') }
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 30) {
    throw new Error('N6 model pricing requires a bounded catalog')
  }
  const matches = catalog.filter((entry: unknown) => entry && typeof entry === 'object'
    && (entry as PipelineModelRate).model_id === modelId)
  if (matches.length !== 1) throw new Error('N6 model requires one exact pricing entry')
  const item = matches[0] as PipelineModelRate
  const checkedAt = Date.parse(item.verified_at)
  if (!Number.isFinite(checkedAt) || checkedAt > now.getTime()
    || now.getTime() - checkedAt > 30 * 24 * 60 * 60 * 1000
    || !/^https:\/\/developers\.openai\.com\/api\/docs\/(pricing|models\/[^/?#]+)$/.test(item.source_url)) {
    throw new Error('N6 model price evidence is stale or unverified')
  }
  if (![item.input_usd_per_million, item.cached_input_usd_per_million,
    item.cache_write_usd_per_million, item.output_usd_per_million].every(rate)) {
    throw new Error('N6 model price rates are invalid')
  }
  return item
}

export function conservativePipelineCeiling(prompt: string, price: PipelineModelRate, maxOutputTokens = 1024): number {
  const bytes = new TextEncoder().encode(prompt).length
  if (bytes < 1 || bytes > 24000 || !nonnegativeInteger(maxOutputTokens)
    || maxOutputTokens < 1 || maxOutputTokens > 1024) {
    throw new Error('N6 prompt or output bound is invalid')
  }
  const inputRate = Math.max(price.input_usd_per_million,
    price.cached_input_usd_per_million, price.cache_write_usd_per_million)
  const ceiling = Math.ceil((bytes + 4096) * inputRate
    + maxOutputTokens * price.output_usd_per_million)
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0) throw new Error('N6 cost ceiling is invalid')
  return ceiling
}

export function measuredPipelineTokenCost(usage: ResponseUsage, price: PipelineModelRate): number {
  const input = usage?.input_tokens
  const output = usage?.output_tokens
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0
  const cacheWrite = usage?.input_tokens_details?.cache_write_tokens ?? 0
  if (![input, output, cached, cacheWrite].every(nonnegativeInteger)
    || cached + cacheWrite > input) {
    throw new Error('N6 provider token usage is incomplete')
  }
  const regular = input - cached - cacheWrite
  const measured = Math.ceil(
    regular * price.input_usd_per_million
    + cached * price.cached_input_usd_per_million
    + cacheWrite * price.cache_write_usd_per_million
    + output * price.output_usd_per_million
  )
  if (!Number.isSafeInteger(measured) || measured < 0) throw new Error('N6 measured token cost is invalid')
  return measured
}
