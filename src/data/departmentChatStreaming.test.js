import assert from 'node:assert/strict'
import test from 'node:test'
import { readDepartmentChatAnswerStream } from './departmentChatStreaming.js'

const stream = chunks => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  },
}), { headers: { 'Content-Type': 'text/event-stream' } })

test('reads genuine split SSE deltas and returns the durable completion event', async () => {
  const events = []
  const terminal = await readDepartmentChatAnswerStream(stream([
    'data: {"type":"started","message_id":"m"}\n\ndata: {"type":"delta","delta":"Hel',
    'lo"}\n\ndata: {"type":"completed","answer":"Hello","ai_run_id":"run"}\n\n',
  ]), { onEvent: event => events.push(event) })
  assert.deepEqual(events.map(event => event.type), ['started', 'delta', 'completed'])
  assert.equal(terminal.answer, 'Hello')
})

test('does not advertise retry when the stream closes without a terminal durable event', async () => {
  await assert.rejects(
    readDepartmentChatAnswerStream(stream(['data: {"type":"delta","delta":"partial"}\n\n'])),
    error => error.outcome === 'outcome_unknown' && /durable result/.test(error.message),
  )
})

test('preserves definite failed versus ambiguous unknown terminal states', async () => {
  for (const [type, outcome] of [['failed', 'failed'], ['unknown', 'outcome_unknown']]) {
    await assert.rejects(
      readDepartmentChatAnswerStream(stream([`data: {"type":"${type}","message":"stopped"}\n\n`])),
      error => error.outcome === outcome,
    )
  }
})
