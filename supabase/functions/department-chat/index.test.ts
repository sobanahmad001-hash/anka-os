import { assertEquals } from 'jsr:@std/assert@1.0.14'
import {
  ENABLED_DEPARTMENTS,
  departmentChatExternalEndpoint,
  hasDepartmentChatAuthority,
  outputText,
} from './index.ts'
import {
  CHAT_DESIGN_ARTIFACT_TYPE_SET,
  designArtifactResponseFormat,
  validateDesignSystemArtifact,
} from '../_shared/designSystemArtifacts.ts'

Deno.test('Shared Department Chat is department-scoped', () => {
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'content' }, 'content'), true)
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'design' }, 'content'), false)
  assertEquals(hasDepartmentChatAuthority({ role: 'executive', department_id: null }, 'content'), true)
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'design' }, 'design'), true)
})

Deno.test('Shared Department Chat enables only Content and Design', () => {
  assertEquals([...ENABLED_DEPARTMENTS].sort(), ['content', 'design'])
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_system'), true)
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_direction'), false)
})

Deno.test('Design chat output is the same structured Design System draft accepted by the library', () => {
  const content = validateDesignSystemArtifact('design_system', {
    color_tokens: [{ name: 'Primary', value: '#4f46e5' }],
    typography_scale: [{ name: 'Body', font: 'Inter', size: '16px', weight: '400' }],
    components: [{ name: 'Button', description: 'Primary action.', usage_notes: 'Use for a single main action.' }],
    usage_rules: 'Keep sufficient contrast.',
  })
  assertEquals(content.color_tokens[0].name, 'Primary')
  assertEquals(designArtifactResponseFormat('design_system').name, 'anka_design_system_draft')
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
