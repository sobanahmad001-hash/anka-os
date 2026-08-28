import { assertEquals } from 'jsr:@std/assert@1.0.14'
import {
  departmentChatExternalEndpoint,
  hasDepartmentChatAuthority,
  outputText,
} from './index.ts'

Deno.test('Shared Department Chat is department-scoped', () => {
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'content' }, 'content'), true)
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'design' }, 'content'), false)
  assertEquals(hasDepartmentChatAuthority({ role: 'executive', department_id: null }, 'content'), true)
})

Deno.test('Shared Department Chat has one external allowlisted model endpoint', () => {
  const endpoint = departmentChatExternalEndpoint()
  assertEquals(endpoint, 'https://api.openai.com/v1/responses')
  assertEquals(/connector|mutate|publish|send|upload|deploy|ads/i.test(endpoint), false)
})

Deno.test('model output parser accepts only response text', () => {
  assertEquals(outputText({ output_text: '{"summary":"draft"}' }), '{"summary":"draft"}')
  assertEquals(outputText({ output: [{ content: [{ type: 'output_text', text: 'nested' }] }] }), 'nested')
})
