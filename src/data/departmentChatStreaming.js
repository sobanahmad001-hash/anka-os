function streamFailure(message, outcome = 'outcome_unknown') {
  return Object.assign(new Error(message), { status: 503, outcome })
}

export async function readDepartmentChatAnswerStream(response, { onEvent } = {}) {
  if (!(response instanceof Response) || !response.body) {
    throw streamFailure('Department Chat did not return a readable answer stream')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = null

  const dispatch = block => {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    let event
    try { event = JSON.parse(data) } catch { throw streamFailure('Department Chat returned an invalid stream event') }
    onEvent?.(event)
    if (['completed', 'failed', 'unknown'].includes(event.type)) terminal = event
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) dispatch(block)
    if (done) break
  }
  if (buffer.trim()) dispatch(buffer)
  if (!terminal) throw streamFailure('The answer stream ended before a durable result was reported')
  if (terminal.type !== 'completed') {
    throw streamFailure(terminal.message || 'The answer did not complete', terminal.type === 'failed' ? 'failed' : 'outcome_unknown')
  }
  return terminal
}
