import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'

import {
  actionResponseFormat,
  outputText,
  parseAction,
  safetyIdentifier,
  safeDepartmentId,
} from './index.ts'

Deno.test('operating department validation accepts only canonical departments', () => {
  assertEquals(safeDepartmentId('design'), 'design')
  assertEquals(safeDepartmentId(''), null)
  assertThrows(() => safeDepartmentId('finance'), Error, 'Unknown operating department')
})

Deno.test('Responses API output text is extracted from both supported response shapes', () => {
  assertEquals(outputText({ output_text: 'Direct text' }), 'Direct text')
  assertEquals(outputText({
    output: [{ content: [{ type: 'output_text', text: 'Nested text' }] }],
  }), 'Nested text')
})

Deno.test('action proposal format requires strict structured output', () => {
  const format = actionResponseFormat()
  assertEquals(format.type, 'json_schema')
  assertEquals(format.strict, true)
  assertEquals(format.schema.additionalProperties, false)
})

Deno.test('action proposals remain project and workstream scoped', () => {
  const proposal = JSON.stringify({
    summary: 'Create the review task',
    action: {
      type: 'create_task',
      params: { project_id: 'project-1', workstream_id: 'workstream-1', title: 'Review homepage' },
    },
  })
  assertEquals(
    parseAction(proposal, 'project-1', new Set(['workstream-1'])).action.params.title,
    'Review homepage',
  )
  assertThrows(
    () => parseAction(proposal, 'project-1', new Set(['other-workstream'])),
    Error,
    'inaccessible workstream',
  )
})

Deno.test('OpenAI safety identifier is stable and does not transmit the user UUID', async () => {
  const first = await safetyIdentifier('user-uuid')
  const second = await safetyIdentifier('user-uuid')
  assertEquals(first, second)
  assertEquals(first.length, 64)
  if (first === 'user-uuid') throw new Error('Safety identifier was not hashed')
})

Deno.test('unsupported departments reject asynchronously when used by a caller', async () => {
  await assertRejects(async () => safeDepartmentId('sales'), Error, 'Unknown operating department')
})
