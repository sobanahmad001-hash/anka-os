export function confirmedRetryableRejection(status: number, body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  const type = (error as { type?: unknown }).type
  if (status === 429) {
    if (code === 'slow_down' || code === 'rate_limit_exceeded') return code
    if ((code === null || code === undefined) && type === 'rate_limit_error') return 'rate_limit_error'
  }
  if (status === 503 && code === 'server_is_overloaded') return code
  return null
}
