import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { buildN7TextRequest, normalizeN7TextResult } from './n7TextProvider.ts'

const route = (provider: 'openai' | 'anthropic' | 'google_gemini') =>
  ({ provider, model_id: 'verified-model' })

Deno.test('N7 text requests use fixed provider hosts and the pinned model without tools', () => {
  const openai = buildN7TextRequest(route('openai'), 'secret', 'Pinned prompt', 'claim-1', 'safe-id')
  assertEquals(openai.url, 'https://api.openai.com/v1/responses')
  assertEquals(JSON.parse(String(openai.init.body)).store, false)
  assertEquals(JSON.parse(String(openai.init.body)).tools, [])
  const anthropic = buildN7TextRequest(route('anthropic'), 'secret', 'Pinned prompt', 'claim-1', 'safe-id')
  assertEquals(anthropic.url, 'https://api.anthropic.com/v1/messages')
  assertEquals(JSON.parse(String(anthropic.init.body)).messages[0].content, 'Pinned prompt')
  const google = buildN7TextRequest(route('google_gemini'), 'secret', 'Pinned prompt', 'claim-1', 'safe-id')
  assertEquals(google.url, 'https://generativelanguage.googleapis.com/v1beta/models/verified-model:generateContent')
  assertEquals(JSON.parse(String(google.init.body)).store, false)
  assertThrows(() => buildN7TextRequest({ provider: 'google_gemini', model_id: '../bad' },
    'secret', 'Pinned prompt', 'claim-1', 'safe-id'))
})

Deno.test('private chat can supply a bounded no-action system instruction', () => {
  const instruction = 'Answer the private conversation without taking actions.'
  for (const provider of ['openai', 'anthropic', 'google_gemini'] as const) {
    const request = buildN7TextRequest(route(provider), 'secret', 'Owner prompt', 'claim-1', 'safe-id', instruction)
    const body = JSON.parse(String(request.init.body))
    assertEquals(provider === 'openai' ? body.instructions
      : provider === 'anthropic' ? body.system
      : body.systemInstruction.parts[0].text, instruction)
  }
  assertThrows(() => buildN7TextRequest(route('openai'), 'secret', 'Owner prompt',
    'claim-1', 'safe-id', 'x'.repeat(2001)))
})
Deno.test('N7 normalizes complete OpenAI, Claude and Gemini text usage without losing cache costs', () => {
  assertEquals(normalizeN7TextResult('openai', {
    id: 'resp-1', model: 'verified-model', status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Draft' }] }],
    usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30 } },
  }).usage, { input_tokens: 100, output_tokens: 20,
    input_tokens_details: { cached_tokens: 30, cache_write_tokens: 0 } })
  assertEquals(normalizeN7TextResult('anthropic', {
    id: 'msg-1', model: 'verified-model', type: 'message', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Draft' }],
    usage: { input_tokens: 70, cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10, output_tokens: 20 },
  }).usage, { input_tokens: 100, output_tokens: 20,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 } })
  assertEquals(normalizeN7TextResult('google_gemini', {
    responseId: 'gem-1', modelVersion: 'verified-model',
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Draft' }] } }],
    usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 30,
      candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 },
  }).usage, { input_tokens: 100, output_tokens: 25,
    input_tokens_details: { cached_tokens: 30, cache_write_tokens: 0 } })
})

Deno.test('N7 refuses incomplete, blocked, tool, or unmetered outcomes', () => {
  assertThrows(() => normalizeN7TextResult('openai', {
    id: 'resp-1', model: 'verified-model', status: 'completed',
    output: [{ type: 'function_call' }], usage: { input_tokens: 1, output_tokens: 1 },
  }))
  assertThrows(() => normalizeN7TextResult('anthropic', {
    id: 'msg-1', model: 'verified-model', type: 'message', stop_reason: 'tool_use',
    content: [{ type: 'tool_use' }], usage: { input_tokens: 1, output_tokens: 1 },
  }))
  assertThrows(() => normalizeN7TextResult('google_gemini', {
    responseId: 'gem-1', modelVersion: 'verified-model',
    candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  }))
  assertThrows(() => normalizeN7TextResult('google_gemini', {
    responseId: 'gem-1', modelVersion: 'verified-model',
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Draft' }] } }],
  }))
})

Deno.test('N7 rejects Gemini token totals or hidden tool-use usage that cannot be settled', () => {
  const response = {
    responseId: 'gem-2', modelVersion: 'verified-model',
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Draft' }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
  }
  assertEquals(normalizeN7TextResult('google_gemini', response).usage.output_tokens, 20)
  assertThrows(() => normalizeN7TextResult('google_gemini', {
    ...response, usageMetadata: { ...response.usageMetadata, totalTokenCount: 121 },
  }))
  assertThrows(() => normalizeN7TextResult('google_gemini', {
    ...response, usageMetadata: { ...response.usageMetadata, toolUsePromptTokenCount: 1 },
  }))
})
