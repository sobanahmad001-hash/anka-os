import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import {
  CHAT_MARKETING_ARTIFACT_TYPE_SET,
  ENABLED_DEPARTMENTS,
  confirmProposal,
  departmentChatExternalEndpoint,
  freezeDepartmentChatContext,
  hasDepartmentChatAuthority,
  isDepartmentChatArtifactType,
  marketingArtifactResponseFormat,
  outputText,
  proposeArtifact,
  proposeWorkItem,
  rejectProposal,
  requireDepartmentEngagement,
  selectSingleOpenAiModel,
} from './index.ts'
import { developmentChatArtifactResponseFormat } from '../_shared/developmentChatArtifacts.ts'
import {
  CHAT_DESIGN_ARTIFACT_TYPE_SET,
  designArtifactResponseFormat,
  validateDesignSystemArtifact,
} from '../_shared/designSystemArtifacts.ts'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'

Deno.test('Shared Department Chat is department-scoped', () => {
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'content' }, 'content'), true)
  assertEquals(hasDepartmentChatAuthority({ role: 'contributor', department_id: 'design' }, 'content'), false)
  assertEquals(hasDepartmentChatAuthority({ role: 'executive', department_id: null }, 'content'), true)
})

Deno.test('WCH3 enables all profiles while preserving narrow artifact allowlists', () => {
  assertEquals([...ENABLED_DEPARTMENTS].sort(), ['content', 'design', 'development', 'marketing'])
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_system'), true)
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_direction'), false)
  assertEquals([...CHAT_MARKETING_ARTIFACT_TYPE_SET].sort(), ['campaign_brief', 'channel_strategy', 'measurement_plan'])
  assertEquals(isDepartmentChatArtifactType('marketing', 'marketing_report'), false)
  assertEquals(isDepartmentChatArtifactType('development', 'technical_brief'), true)
  assertEquals(marketingArtifactResponseFormat('measurement_plan').schema.required.length, 5)
  assertEquals(developmentChatArtifactResponseFormat('launch_checklist').schema.required, ['notes', 'checklist'])
})

Deno.test('Design chat schema remains the Design System library schema', () => {
  const content = validateDesignSystemArtifact('design_system', {
    color_tokens: [{ name: 'Primary', value: '#4f46e5' }],
    typography_scale: [{ name: 'Body', font: 'Inter', size: '16px', weight: '400' }],
    components: [{ name: 'Button', description: 'Primary action.', usage_notes: 'Use once.' }],
    usage_rules: 'Keep sufficient contrast.',
  })
  assertEquals(Object.hasOwn(content, 'color_tokens'), true)
  assertEquals(designArtifactResponseFormat('design_system').name, 'anka_design_system_draft')
})

function resolved(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error })
}

Deno.test('canonical engagement resolution accepts an isolated active department service', async () => {
  const client = {
    from(table: string) {
      const rows: Record<string, unknown> = {
        engagements: { id: 'engagement-1', organization_id: ORGANIZATION_ID, client_id: 'agency-client-1', project_id: 'project-1', brand_id: 'brand-1' },
        agency_clients: { id: 'agency-client-1', organization_id: ORGANIZATION_ID, canonical_client_id: 'client-1', name: 'Operating client' },
        clients: { id: 'client-1', organization_id: ORGANIZATION_ID, name: 'Canonical client' },
        projects: { id: 'project-1', organization_id: ORGANIZATION_ID, client_id: 'client-1', name: 'Canonical project' },
        brands: { id: 'brand-1', organization_id: ORGANIZATION_ID, client_id: 'agency-client-1', name: 'Brand' },
        engagement_services: [{ id: 'design-service', service_catalog: { department_id: 'design' } }],
      }
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) chain[method] = () => chain
      chain.maybeSingle = () => resolved(rows[table])
      chain.then = (resolve: (value: unknown) => unknown) => resolved(rows[table]).then(resolve)
      return chain
    },
  }
  const result = await requireDepartmentEngagement(client as never, 'engagement-1', 'design')
  assertEquals(result.services.length, 1)
  assertEquals(result.commercialContext.canonical_client.id, 'client-1')
  assertEquals(result.commercialContext.project.id, 'project-1')
})

function proposalAdmin(rpcResult: Record<string, unknown> = {
  proposal_id: 'proposal-1', status: 'pending', proposal_kind: 'artifact_version',
  target_key: 'technical_brief', preview: { notes: 'Preview' },
  expires_at: '2099-01-01T00:00:00Z',
}) {
  const rpcCalls: Array<{ name: string, args: Record<string, unknown> }> = []
  const admin = {
    from(table: string) {
      const query: any = {
        select: () => query, eq: () => query, gte: () => query,
        single: async () => table === 'organizations'
          ? { data: { settings: {} }, error: null }
          : { data: null, error: null },
        then: (resolve: (value: unknown) => unknown) => resolve({ count: 0, data: null, error: null }),
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return { data: rpcResult, error: null }
    },
  }
  return { admin, rpcCalls }
}

const contextDependencies = {
  requireDepartmentEngagement: (async (_admin: unknown, engagementId: string) => ({
    engagement: { id: engagementId, brand_id: 'brand-1' },
    services: [{ id: 'service-1', service_catalog: { department_id: 'development' } }],
    commercialContext: {
      canonical_client: { id: 'client-1' }, agency_client: { id: 'agency-client-1' },
      project: { id: 'project-1' }, engagement: { id: engagementId }, brand: { id: 'brand-1' },
    },
  })) as any,
  safeStage: (async () => null) as any,
  approvedSafeContext: (async () => []) as any,
  resolveSingleOpenAiModel: (async () => ({
    connectorId: 'connector-1', credential: 'test-key', model: 'gpt-test',
  })) as any,
  estimatedCost: () => 12,
}

Deno.test('Development artifact preview persists only an atomic pending proposal', async () => {
  const { admin, rpcCalls } = proposalAdmin()
  const result = await proposeArtifact({} as any, admin as any, {
    department_id: 'development', engagement_id: 'engagement-1',
    artifact_type: 'technical_brief', title: 'Technical brief',
    prompt: 'Draft the implementation notes', prompt_safe_for_ai: true,
  }, 'member-1', async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ notes: 'Use the existing API.', checklist: ['Add tests'] }),
    usage: { input_tokens: 10, output_tokens: 20 },
  })), contextDependencies)
  assertEquals(result.status, 'pending')
  assertEquals(rpcCalls.length, 1)
  assertEquals(rpcCalls[0].name, 'save_department_chat_proposal')
  assertEquals(rpcCalls[0].args.p_proposal_kind, 'artifact_version')
  assertEquals(rpcCalls[0].args.p_target_key, 'technical_brief')
  assertEquals((rpcCalls[0].args.p_validated_payload as any).content.notes, 'Use the existing API.')
  assertEquals(rpcCalls[0].args.p_estimated_cost_microusd, 12)
})

Deno.test('work-item preview fixes the future official state to not_started without writing it', async () => {
  const { admin, rpcCalls } = proposalAdmin({
    proposal_id: 'proposal-2', status: 'pending', proposal_kind: 'work_item',
    target_key: 'bug', preview: { status: 'not_started' }, expires_at: '2099-01-01T00:00:00Z',
  })
  const result = await proposeWorkItem({} as any, admin as any, {
    department_id: 'development', engagement_id: 'engagement-1',
    work_item_type: 'bug', title: 'Fix the issue',
    prompt: 'Draft the bug description', prompt_safe_for_ai: true,
  }, 'member-1', async () => new Response(JSON.stringify({
    output_text: 'Reproduce and correct the issue.', usage: { input_tokens: 4, output_tokens: 8 },
  })), contextDependencies)
  assertEquals((result.preview as any).status, 'not_started')
  assertEquals(rpcCalls[0].name, 'save_department_chat_proposal')
  assertEquals(rpcCalls[0].args.p_proposal_kind, 'work_item')
  assertEquals(rpcCalls[0].args.p_target_key, 'bug')
})

Deno.test('schema-invalid model output creates no proposal', async () => {
  const { admin, rpcCalls } = proposalAdmin()
  await assertRejects(
    () => proposeArtifact({} as any, admin as any, {
      department_id: 'development', engagement_id: 'engagement-1',
      artifact_type: 'technical_brief', prompt: 'Draft', prompt_safe_for_ai: true,
    }, 'member-1', async () => new Response(JSON.stringify({
      output_text: JSON.stringify({ notes: '', checklist: [] }),
    })), contextDependencies),
    Error,
    'requires notes or checklist',
  )
  assertEquals(rpcCalls.length, 0)
})

function decisionAdmin(proposal: Record<string, unknown>, outcome: Record<string, unknown>) {
  const rpcCalls: Array<{ name: string, args: Record<string, unknown> }> = []
  return {
    rpcCalls,
    admin: {
      from() {
        const query: any = {
          select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: proposal, error: null }),
        }
        return query
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args })
        return { data: outcome, error: null }
      },
    },
  }
}

const pendingProposal = {
  id: 'proposal-1', organization_id: ORGANIZATION_ID, engagement_id: 'engagement-1',
  project_id: 'project-1', department_id: 'development', proposer_id: 'member-1',
  proposal_kind: 'artifact_version', target_key: 'technical_brief',
  artifact_id: null, engagement_stage_instance_id: null,
  context_checksum: 'a'.repeat(64), connector_connection_id: 'connector-1',
  model_id: 'gpt-test', status: 'pending', expires_at: '2099-01-01T00:00:00Z',
}

Deno.test('confirmation re-resolves context and returns the atomic official result', async () => {
  const { admin, rpcCalls } = decisionAdmin(pendingProposal, {
    outcome: 'accepted', replayed: false, artifact_version_id: 'version-1',
  })
  const result = await confirmProposal(admin as any, 'proposal-1', 'member-1', {
    role: 'contributor', department_id: 'development',
  }, contextDependencies)
  assertEquals(result.artifact_version_id, 'version-1')
  assertEquals(rpcCalls[0].name, 'confirm_department_chat_proposal')
  assertEquals(rpcCalls[0].args.p_connector_connection_id, 'connector-1')
  assertEquals(typeof rpcCalls[0].args.p_context_checksum, 'string')
})

Deno.test('only the proposer may confirm, before context or official paths run', async () => {
  const { admin, rpcCalls } = decisionAdmin(pendingProposal, { outcome: 'accepted' })
  await assertRejects(
    () => confirmProposal(admin as any, 'proposal-1', 'other-member', {
      role: 'executive', department_id: null,
    }, contextDependencies),
    Error,
    'Only the proposer',
  )
  assertEquals(rpcCalls.length, 0)
})

Deno.test('stale confirmation fails closed and requires regeneration', async () => {
  const { admin } = decisionAdmin(pendingProposal, { outcome: 'stale' })
  await assertRejects(
    () => confirmProposal(admin as any, 'proposal-1', 'member-1', {
      role: 'contributor', department_id: 'development',
    }, contextDependencies),
    Error,
    'Regenerate a fresh preview',
  )
})

Deno.test('rejection is proposer-only and idempotent', async () => {
  const { admin, rpcCalls } = decisionAdmin(pendingProposal, {
    outcome: 'rejected', replayed: true, proposal_id: 'proposal-1',
  })
  const result = await rejectProposal(admin as any, 'proposal-1', 'member-1', {
    role: 'contributor', department_id: 'development',
  })
  assertEquals(result.replayed, true)
  assertEquals(rpcCalls[0].name, 'reject_department_chat_proposal')
})

Deno.test('connector selection rejects ambiguity and missing explicit model', () => {
  assertThrows(() => selectSingleOpenAiModel([], 'content', () => 'test-key'), Error, 'No verified OpenAI connector')
  assertThrows(
    () => selectSingleOpenAiModel([{ id: 'one' }, { id: 'two' }], 'content', () => 'test-key'),
    Error,
    'Exactly one verified OpenAI connector',
  )
  assertThrows(
    () => selectSingleOpenAiModel([{ id: 'one', secret_name: 'KEY', public_config: {} }], 'content', () => 'test-key'),
    Error,
    'requires an explicit model_id',
  )
})

Deno.test('context freeze is deterministic across exact approved versions', async () => {
  const input = {
    departmentId: 'development',
    commercialContext: {
      canonical_client: { id: 'client' }, agency_client: { id: 'agency-client' },
      project: { id: 'project' }, engagement: { id: 'engagement' }, brand: { id: 'brand' },
    },
    services: [{ id: 'service-b' }, { id: 'service-a' }],
    approvedContext: [
      { artifact_id: 'artifact-b', artifact_version_id: 'version-b', artifact_type: 'design_system', content: { summary: 'B' } },
      { artifact_id: 'artifact-a', artifact_version_id: 'version-a', artifact_type: 'technical_brief', content: { summary: 'A' } },
    ],
    provider: { connectorId: 'connector', model: 'explicit-model' },
    stageId: 'stage',
  }
  const first = await freezeDepartmentChatContext(input)
  const second = await freezeDepartmentChatContext(input)
  assertEquals(first.manifest.context_checksum, second.manifest.context_checksum)
  assertEquals(first.manifest.active_service_ids, ['service-a', 'service-b'])
  assertEquals(first.manifest.approved_artifact_version_ids, ['version-a', 'version-b'])
})

Deno.test('Shared Department Chat exposes only the OpenAI Responses endpoint', () => {
  const endpoint = departmentChatExternalEndpoint()
  assertEquals(endpoint, 'https://api.openai.com/v1/responses')
  assertEquals(/connector|mutate|publish|send|upload|deploy|ads/i.test(endpoint), false)
  assertEquals(outputText({ output_text: '{"summary":"draft"}' }), '{"summary":"draft"}')
})
