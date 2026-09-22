import type { PipelineModelRate } from './n6PipelineCost.ts'

export function confirmedRetryableRejection(status: number, body: unknown,
  provider = 'openai', retryAfter = ''): string | null {
  if (!body || typeof body !== 'object') return null
  if ('id' in body || 'output' in body || 'usage' in body) return null
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  const type = (error as { type?: unknown }).type
  if (provider === 'anthropic') {
    const details = (error as { details?: unknown }).details
    const spendLimit = details && typeof details === 'object'
      && (details as { error_code?: unknown }).error_code === 'enforced_spend_limit_reached'
    if (status === 429 && type === 'rate_limit_error' && !spendLimit
      && /^\d+(\.\d+)?$/.test(retryAfter)) return 'rate_limit_error'
    if (status === 529 && type === 'overloaded_error') return 'overloaded_error'
    return null
  }
  if (provider === 'google_gemini') {
    const providerStatus = (error as { status?: unknown }).status
    if (status === 503 && (providerStatus === 'UNAVAILABLE' || code === 'service_unavailable'))
      return 'service_unavailable'
    if (status === 429 && (code === 'rate_limit_exceeded' || code === 'too_many_requests'))
      return code
    return null
  }
  if (provider !== 'openai') return null
  if (status === 429) {
    if (code === 'slow_down' || code === 'rate_limit_exceeded') return code
    if ((code === null || code === undefined) && type === 'rate_limit_error') return 'rate_limit_error'
  }
  if (status === 503 && code === 'server_is_overloaded') return code
  return null
}

export type PinnedRoute = {
  priority: number
  provider: string
  connection_id: string
  model_id: string
  model_configuration_id?: string
}
export type PipelineFallbackContext = { route: PinnedRoute; price: PipelineModelRate; credential: string }
type ProviderResult = { ok: boolean; status: number; body: Record<string, any>; requestId: string; retryAfter?: string }
type FallbackClaim = {
  status: string
  must_not_submit: boolean
  fallback_claim_id: string
  route: PinnedRoute
}

export async function runConfirmedPipelineFallback<T extends PipelineFallbackContext>(
  contexts: T[],
  initialClaimId: string,
  send: (context: T, claimId: string) => Promise<ProviderResult>,
  record: (priority: number, status: number, code: string, requestId: string) => Promise<{ idempotent_replay?: boolean }>,
  claim: (priority: number) => Promise<FallbackClaim>,
  markUnknown: (reason: string) => Promise<void>,
): Promise<
  | { status: 'completed'; context: T; result: Record<string, any>; routeClaimId: string; providerRequestId: string }
  | { status: 'all_routes_refused' | 'already_claimed' | 'outcome_unknown' }
> {
  let routeClaimId = initialClaimId
  for (let index = 0; index < contexts.length; index += 1) {
    const context = contexts[index]
    let response: ProviderResult
    try {
      response = await send(context, routeClaimId)
    } catch {
      await markUnknown(`provider outcome unknown; claim=${routeClaimId}`)
      return { status: 'outcome_unknown' }
    }
    if (response.ok) {
      return { status: 'completed', context, result: response.body,
        routeClaimId, providerRequestId: response.requestId }
    }
    const code = confirmedRetryableRejection(response.status, response.body, context.route.provider, response.retryAfter)
    if (!code) {
      await markUnknown(`provider refusal needs reconciliation; claim=${routeClaimId}; request=${response.requestId || 'unavailable'}`)
      return { status: 'outcome_unknown' }
    }
    try {
      const rejection = await record(index + 1, response.status, code, response.requestId.slice(0, 120))
      if (rejection.idempotent_replay === true) throw new Error('Refusal already recorded')
      if (index === contexts.length - 1) return { status: 'all_routes_refused' }
      const backup = await claim(index + 2)
      if (backup.must_not_submit === true) return { status: 'already_claimed' }
      const expected = contexts[index + 1].route
      if (backup.status !== 'claimed' || backup.route.priority !== expected.priority
        || backup.route.provider !== expected.provider
        || backup.route.connection_id !== expected.connection_id
        || backup.route.model_id !== expected.model_id
        || backup.route.model_configuration_id !== expected.model_configuration_id
        || !backup.fallback_claim_id) {
        throw new Error('Claimed backup differs from pinned route')
      }
      routeClaimId = backup.fallback_claim_id
    } catch {
      await markUnknown(`fallback reconciliation required after claim=${routeClaimId}`)
      return { status: 'outcome_unknown' }
    }
  }
  await markUnknown('No pinned route was available')
  return { status: 'outcome_unknown' }
}
