// Bound read-only waits even when a transport ignores cancellation.
export function readOnlyChatRequest(task, { signal, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => {
      finish(reject, signal.reason || new DOMException('Chat scope changed', 'AbortError'))
      controller.abort()
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      const error = Object.assign(new Error('Recovery check timed out. The original request is still unresolved. Your draft and request identity are kept; you can leave this chat and check again later.'), { code: 'CHAT_READ_TIMEOUT' })
      finish(reject, error)
      controller.abort()
    }, timeoutMs)
    Promise.resolve().then(() => {
      if (settled) return
      return task(controller.signal)
    }).then(value => finish(resolve, value), error => finish(reject, error))
  })
}
