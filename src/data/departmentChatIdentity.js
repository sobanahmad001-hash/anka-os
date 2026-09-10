// Each mounted identity owns its completions, including refresh callbacks.
export function createChatCompletionGuard(signal) {
  let active = true
  let sequence = 0
  return {
    begin() { const ticket = ++sequence; return () => active && !signal?.aborted && ticket === sequence },
    dispose() { active = false; sequence += 1 },
  }
}

export function handleCurrentChatFailure(isCurrent, reason, handleOrganizationAccessError, showError) {
  if (!isCurrent()) return
  handleOrganizationAccessError(reason)
  if (isCurrent()) showError(reason)
}

export async function runCurrentChatOperation(guard, handlers) {
  const isCurrent = guard.begin()
  if (!isCurrent()) return undefined
  handlers.start?.()
  try {
    const value = await handlers.operation(isCurrent)
    if (isCurrent()) await handlers.success?.(value, isCurrent)
    return isCurrent() ? value : undefined
  } catch (reason) {
    if (isCurrent()) await handlers.failure?.(reason, isCurrent)
    return undefined
  } finally {
    if (isCurrent()) await handlers.settle?.()
  }
}
