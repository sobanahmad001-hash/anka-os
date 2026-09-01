import { assertEquals } from 'jsr:@std/assert@1.0.14'
import {
  ENABLED_DEPARTMENTS,
  createDesignArtifactVersion,
  departmentChatExternalEndpoint,
  hasDepartmentChatAuthority,
  outputText,
  requireDepartmentEngagement,
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
  assertEquals(Object.hasOwn(content, 'color_tokens'), true)
  assertEquals(designArtifactResponseFormat('design_system').name, 'anka_design_system_draft')
})

function resolved(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error })
}

Deno.test('Design-only service is accepted without a Content service', async () => {
  const client = {
    from(table: string) {
      const rows = table === 'engagements'
        ? { id: 'engagement-1', organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', brand_id: 'brand-1' }
        : [{ id: 'design-service', service_catalog: { department_id: 'design', slug: 'design_systems', name: 'Design Systems' } }]
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) chain[method] = () => chain
      chain.maybeSingle = () => resolved(rows)
      chain.then = (resolve: (value: unknown) => unknown) => resolved(rows).then(resolve)
      return chain
    },
  }
  const result = await requireDepartmentEngagement(client as never, 'engagement-1', 'design')
  assertEquals(result.services.length, 1)
  assertEquals(JSON.stringify(result.services).includes('"department_id":"design"'), true)
})

Deno.test('Design chat draft persists a canonical immutable version and no approval', async () => {
  const calls: Array<{ table: string; operation: string; value?: Record<string, unknown> }> = []
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const result = (data: unknown) => Promise.resolve({ data, error: null })
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = () => result(table === 'artifact_versions' ? null : null)
      chain.insert = (value: Record<string, unknown>) => {
        calls.push({ table, operation: 'insert', value })
        const created = table === 'artifacts' ? { id: 'artifact-1' }
          : table === 'artifact_versions' ? { id: 'version-1', version_number: 1 }
            : { id: 'event-1' }
        return { select: () => ({ single: () => result(created) }) }
      }
      chain.delete = () => chain
      return chain
    },
  }
  const saved = await createDesignArtifactVersion(client as never, {
    engagement: { id: 'engagement-1', brand_id: 'brand-1' }, stageId: null, artifactId: null,
    title: 'Chat system', content: validateDesignSystemArtifact('design_system', {
      color_tokens: [{ name: 'Primary', value: '#4f46e5' }],
      typography_scale: [{ name: 'Body', font: 'Inter', size: '16px', weight: '400' }],
      components: [{ name: 'Button', description: 'Primary action.', usage_notes: 'Use for a single main action.' }],
      usage_rules: 'Keep sufficient contrast.',
    }), changeSummary: 'Draft proposed via Shared Department Chat', actorId: 'user-1', aiRunId: 'run-1',
  })
  assertEquals(saved.version.id, 'version-1')
  assertEquals(calls.map(call => call.table), ['artifacts', 'artifact_versions', 'engagement_events'])
  assertEquals(calls[1].value?.ai_use_allowed, false)
  assertEquals(calls[1].value?.data_classification, 'internal')
  assertEquals(calls.some(call => call.table === 'artifact_approvals'), false)
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
