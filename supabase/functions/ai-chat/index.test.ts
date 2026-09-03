import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'

import {
  actionResponseFormat,
  outputText,
  parseAction,
  resolveCanonicalCommercialContext,
  safetyIdentifier,
  safeDepartmentId,
  withAiCommercialContext,
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

Deno.test('matching project and engagement are accepted as one stored commercial context', async () => {
  const storedContext = await resolveCanonicalCommercialContext(
    'project-1',
    'engagement-1',
    async () => 'project-1',
  )
  const storedRun = withAiCommercialContext({ capability: 'project_pulse' }, storedContext)
  assertEquals(storedRun, {
    capability: 'project_pulse',
    project_id: 'project-1',
    engagement_id: 'engagement-1',
  })
})

Deno.test('mismatched project and engagement are rejected', async () => {
  await assertRejects(
    () => resolveCanonicalCommercialContext('project-2', 'engagement-1', async () => 'project-1'),
    Error,
    'do not share canonical ownership',
  )
})

Deno.test('engagement-only context derives and stores its canonical project', async () => {
  const storedContext = await resolveCanonicalCommercialContext(
    null,
    'engagement-1',
    async () => 'project-1',
  )
  assertEquals(storedContext, { project_id: 'project-1', engagement_id: 'engagement-1' })
})

Deno.test('project-only context remains project-only without an engagement lookup', async () => {
  let lookupCount = 0
  const storedContext = await resolveCanonicalCommercialContext('project-1', null, async () => {
    lookupCount += 1
    return 'unexpected'
  })
  assertEquals(storedContext, { project_id: 'project-1', engagement_id: null })
  assertEquals(lookupCount, 0)
})

Deno.test('daily brief context with neither project nor engagement remains unscoped', async () => {
  let lookupCount = 0
  const storedContext = await resolveCanonicalCommercialContext(null, null, async () => {
    lookupCount += 1
    return 'unexpected'
  })
  assertEquals(storedContext, { project_id: null, engagement_id: null })
  assertEquals(lookupCount, 0)
})
