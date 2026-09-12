type Json = Record<string, unknown>

type AnswerStreamCallbacks = {
  complete: (response: Json, answer: string) => Promise<Json>
  fail: (code: string) => Promise<void>
  unknown: () => Promise<void>
  waitUntil?: (promise: Promise<void>) => void
}

function finalOutputText(result: Json) {
  if (typeof result.output_text === 'string') return result.output_text
  const output = Array.isArray(result.output) ? result.output : []
  return output.flatMap(item => {
    if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) return []
    return item.content.flatMap((part: unknown) => part && typeof part === 'object'
      && 'type' in part && part.type === 'output_text' && 'text' in part && typeof part.text === 'string'
      ? [part.text] : [])
  }).join('\n')
}

function sse(value: Json) {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
}

export function createDurableDepartmentChatAnswerStream(
  upstream: Response,
  callbacks: AnswerStreamCallbacks,
) {
  let observing = true
  let downstream: ReadableStreamDefaultController<Uint8Array> | null = null
  const emit = (value: Json) => {
    if (!observing || !downstream) return
    try { downstream.enqueue(sse(value)) } catch { observing = false }
  }
  const finish = () => {
    if (!observing || !downstream) return
    try { downstream.close() } catch { /* Local observation already stopped. */ }
  }

  const pump = async () => {
    const reader = upstream.body?.getReader()
    if (!reader) {
      await callbacks.unknown()
      emit({ type: 'unknown', message: 'The provider stream could not be read. Do not retry automatically.' })
      finish()
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    let answer = ''
    let completed: Json | null = null
    let definiteFailure = ''
    try {
      emit({
        type: 'started',
        streaming: 'genuine',
        cancellation: 'Stopping this view does not prove provider cancellation or stop cost.',
      })
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart()).join('\n')
          if (!data || data === '[DONE]') continue
          let event: Json
          try { event = JSON.parse(data) as Json } catch { throw new Error('invalid_provider_stream') }
          const type = String(event.type || '')
          if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
            answer += event.delta
            if (answer.length > 80000) throw new Error('answer_too_long')
            emit({ type: 'delta', delta: event.delta })
          } else if (type === 'response.completed' && event.response && typeof event.response === 'object') {
            completed = event.response as Json
          } else if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
            definiteFailure = type === 'response.incomplete' ? 'incomplete_output' : 'provider_failed'
          }
        }
        if (done) break
      }
      if (definiteFailure) {
        await callbacks.fail(definiteFailure)
        emit({ type: 'failed', message: 'The provider did not complete this answer. Start a new request only if you choose to retry.' })
        return
      }
      if (!completed) throw new Error('provider_stream_ended')
      const finalText = finalOutputText(completed).trim() || answer.trim()
      if (!finalText) {
        await callbacks.fail('empty_output')
        emit({ type: 'failed', message: 'The configured model returned no conversational answer.' })
        return
      }
      const durable = await callbacks.complete(completed, finalText)
      emit({ type: 'completed', answer: finalText, ...durable })
    } catch (error) {
      const code = error instanceof Error ? error.message : 'provider_stream_failed'
      if (code === 'answer_too_long') {
        await callbacks.fail(code)
        emit({ type: 'failed', message: 'The answer exceeded the durable message limit and was not saved.' })
      } else {
        try { await callbacks.unknown() } catch { /* Preserve the original ambiguity. */ }
        emit({ type: 'unknown', message: 'The provider or persistence outcome is unknown. Do not retry automatically.' })
      }
    } finally {
      finish()
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      downstream = controller
      const task = pump()
      callbacks.waitUntil?.(task)
    },
    cancel() {
      observing = false
      downstream = null
      // Deliberately keep consuming upstream so local observation cancellation does
      // not become an unverified provider-cancellation or safe-retry claim.
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
