export function createAnswerObservationController(scopeSignal) {
  const controller = new AbortController()
  let localStop = false
  const stopForScope = () => controller.abort(scopeSignal?.reason)
  if (scopeSignal?.aborted) stopForScope()
  else scopeSignal?.addEventListener('abort', stopForScope, { once: true })
  return Object.freeze({
    signal: controller.signal,
    stop() { localStop = true; controller.abort(new DOMException('Local observation stopped', 'AbortError')) },
    stoppedLocally: () => localStop,
    dispose() {
      scopeSignal?.removeEventListener('abort', stopForScope)
      if (!controller.signal.aborted) controller.abort()
    },
  })
}

export function reduceAnswerStreamState(state, event) {
  if (!event || typeof event !== 'object') return state
  if (event.type === 'started') return { status: 'streaming', text: '', durable: false }
  if (event.type === 'delta' && state.status === 'streaming') {
    return { ...state, text: state.text + String(event.delta || '') }
  }
  if (event.type === 'completed') {
    return { status: 'completed', text: String(event.answer || state.text), durable: true }
  }
  if (event.type === 'failed' || event.type === 'unknown') {
    return { ...state, status: event.type, durable: false }
  }
  return state
}
