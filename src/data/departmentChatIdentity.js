// Each mounted identity owns its completions, including refresh callbacks.
export function createChatCompletionGuard(signal) {
  let active = true
  let sequence = 0
  return {
    begin() { const ticket = ++sequence; return () => active && !signal?.aborted && ticket === sequence },
    dispose() { active = false; sequence += 1 },
  }
}
