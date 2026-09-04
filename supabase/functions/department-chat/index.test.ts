import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import {
  CHAT_MARKETING_ARTIFACT_TYPE_SET,
  ENABLED_DEPARTMENTS,
  createDesignArtifactVersion,
  createMarketingArtifactVersion,
  departmentChatExternalEndpoint,
  freezeDepartmentChatContext,
  hasDepartmentChatAuthority,
  isDepartmentChatArtifactType,
  marketingArtifactResponseFormat,
  outputText,
  proposeArtifact,
  proposeWorkItem,
  requireDepartmentEngagement,
  selectSingleOpenAiModel,
} from './index.ts'
import { developmentChatArtifactResponseFormat, validateDevelopmentChatArtifact } from '../_shared/developmentChatArtifacts.ts'
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

Deno.test('Shared Department Chat keeps Development schema-only while enabling existing runtime departments', () => {
  assertEquals([...ENABLED_DEPARTMENTS].sort(), ['content', 'design', 'marketing'])
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_system'), true)
  assertEquals(CHAT_DESIGN_ARTIFACT_TYPE_SET.has('design_direction'), false)
  assertEquals([...CHAT_MARKETING_ARTIFACT_TYPE_SET].sort(), ['campaign_brief', 'channel_strategy', 'measurement_plan'])
  assertEquals(CHAT_MARKETING_ARTIFACT_TYPE_SET.has('marketing_report'), false)
  assertEquals(isDepartmentChatArtifactType('marketing', 'measurement_plan'), true)
  assertEquals(marketingArtifactResponseFormat('measurement_plan').schema.required, ['business_objectives', 'kpis', 'conversions', 'tracking_requirements', 'reporting_cadence'])
  assertEquals(isDepartmentChatArtifactType('development', 'technical_brief'), true)
  assertEquals(isDepartmentChatArtifactType('development', 'launch_checklist'), true)
  assertEquals(developmentChatArtifactResponseFormat('technical_brief').schema.required, ['notes', 'checklist'])
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
      const rows: Record<string, unknown> = {
        engagements: { id: 'engagement-1', organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', client_id: 'agency-client-1', project_id: 'project-1', brand_id: 'brand-1' },
        agency_clients: { id: 'agency-client-1', organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', canonical_client_id: 'client-1', name: 'Operating client' },
        clients: { id: 'client-1', organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', name: 'Canonical client' },
        projects: { id: 'project-1', organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', client_id: 'client-1', name: 'Canonical project' },
        brands: { id: 'brand-1', organization_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25', client_id: 'agency-client-1', name: 'Brand' },
        engagement_services: [{ id: 'design-service', service_catalog: { department_id: 'design', slug: 'design_systems', name: 'Design Systems' } }],
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
  assertEquals(JSON.stringify(result.services).includes('"department_id":"design"'), true)
  assertEquals(result.commercialContext.canonical_client.id, 'client-1')
  assertEquals(result.commercialContext.project.id, 'project-1')
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

Deno.test('Marketing chat creates an internal, unapproved immutable artifact version', async () => {
  const writes: Array<{ table: string, value: Record<string, unknown> }> = []
  const admin = { from(table: string) {
    const query: any = {
      insert: (value: Record<string, unknown>) => { writes.push({ table, value }); return query },
      select: () => query, single: async () => ({ data: table === 'artifacts' ? { id: 'marketing-artifact' } : { id: 'marketing-version', version_number: 1 }, error: null }),
      eq: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: null, error: null }),
    }
    return query
  } }
  const content = { business_objectives: ['Increase qualified leads'], kpis: ['MQLs'], conversions: ['Demo request'], tracking_requirements: ['GA4 event'], reporting_cadence: 'Weekly' }
  const result = await createMarketingArtifactVersion(admin as any, { engagement: { id: 'engagement', brand_id: 'brand' }, artifactId: null, artifactType: 'measurement_plan', title: 'Q4 measurement plan', content, changeSummary: 'Initial draft', actorId: 'member', aiRunId: 'run' })
  assertEquals(result.artifact_id, 'marketing-artifact')
  const artifact = writes.find(write => write.table === 'artifacts')?.value
  const version = writes.find(write => write.table === 'artifact_versions')?.value
  const event = writes.find(write => write.table === 'engagement_events')?.value
  assertEquals(artifact?.artifact_type, 'measurement_plan')
  assertEquals(version?.content, content)
  assertEquals(version?.version_number, 1)
  assertEquals(version?.parent_version_id, null)
  assertEquals(version?.ai_use_allowed, false)
  assertEquals(version?.data_classification, 'internal')
  assertEquals(event?.event_type, 'artifact_draft_proposed_via_chat')
  assertEquals((event?.payload as Record<string, unknown>).action, 'draft_proposed_via_chat')
  assertEquals(writes.some(write => write.table === 'artifact_approvals'), false)
})

Deno.test('Marketing proposal completes with only an isolated Marketing service and empty upstream context', async () => {
  const runWrites: Record<string, unknown>[] = []
  let requestBody: Record<string, unknown> | null = null
  let savedInput: Record<string, unknown> | null = null
  const admin = { from(table: string) {
    let inserting = false
    const query: any = {
      select: () => query, eq: () => query, gte: () => query,
      single: async () => table === 'organizations' ? { data: { settings: {} }, error: null } : { data: { id: 'marketing-run' }, error: null },
      insert: (value: Record<string, unknown>) => { inserting = true; if (table === 'ai_runs') runWrites.push(value); return query },
      then: (resolve: (value: unknown) => unknown) => resolve({ count: table === 'ai_runs' && !inserting ? 0 : null, data: null, error: null }),
    }
    return query
  } }
  const content = { business_objectives: ['Increase qualified leads'], kpis: ['MQLs'], conversions: ['Demo request'], tracking_requirements: ['GA4 event'], reporting_cadence: 'Weekly' }
  const result = await proposeArtifact({} as any, admin as any, { department_id: 'marketing', engagement_id: 'marketing-engagement', artifact_type: 'measurement_plan', prompt: 'Create the initial plan', prompt_safe_for_ai: true }, 'member', async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ output_text: JSON.stringify(content), usage: { input_tokens: 10, output_tokens: 20 } }))
  }, {
    requireDepartmentEngagement: (async () => ({
      engagement: { id: 'marketing-engagement', brand_id: 'brand' },
      services: [{ id: 'marketing-service', service_catalog: { department_id: 'marketing' } }],
      commercialContext: {
        canonical_client: { id: 'client' }, agency_client: { id: 'agency-client' },
        project: { id: 'project' }, engagement: { id: 'marketing-engagement' }, brand: { id: 'brand' },
      },
    })) as any,
    safeStage: (async () => null) as any, approvedSafeContext: (async () => []) as any,
    resolveSingleOpenAiModel: (async () => ({ connectorId: 'marketing-connector', credential: 'test-key', model: 'test-model' })) as any,
    estimatedCost: () => null,
    createMarketingArtifactVersion: (async (_admin: unknown, input: unknown) => { savedInput = input as Record<string, unknown>; return { artifact_id: 'marketing-artifact', version: { id: 'marketing-version' }, warnings: [] } }) as any,
  })
  assertEquals(result.artifact_id, 'marketing-artifact')
  assertEquals(result.content, content)
  const saved = savedInput as unknown as Record<string, unknown>
  const request = requestBody as unknown as Record<string, unknown>
  assertEquals(saved.artifactType, 'measurement_plan')
  assertEquals(saved.content, content)
  assertEquals(saved.aiRunId, 'marketing-run')
  const manifest = runWrites[0].context_manifest as Record<string, unknown>
  assertEquals(runWrites[0].project_id, 'project')
  assertEquals(manifest.purpose, 'marketing_artifact_draft')
  assertEquals(manifest.profile_version, 'wch2-v1')
  assertEquals(manifest.canonical_client_id, 'client')
  assertEquals(manifest.agency_client_id, 'agency-client')
  assertEquals(manifest.project_id, 'project')
  assertEquals(manifest.approved_artifact_version_ids, [])
  assertEquals(typeof manifest.context_checksum, 'string')
  assertEquals((request.text as Record<string, unknown>).format, marketingArtifactResponseFormat('measurement_plan'))
  assertEquals(String(request.instructions).includes('"approved_artifacts":[]'), true)
  assertEquals(String(request.instructions).includes('marketing-service'), true)
})

Deno.test('connector resolution rejects ambiguity and requires an explicit model', async () => {
  await assertRejects(
    async () => selectSingleOpenAiModel([], 'content', () => 'test-key'),
    Error,
    'No verified OpenAI connector',
  )
  await assertRejects(
    async () => selectSingleOpenAiModel([{ id: 'one' }, { id: 'two' }], 'content', () => 'test-key'),
    Error,
    'Exactly one verified OpenAI connector',
  )
  await assertRejects(
    async () => selectSingleOpenAiModel([{ id: 'one', secret_name: 'OPENAI_KEY', public_config: {} }], 'content', () => 'test-key'),
    Error,
    'requires an explicit model_id',
  )
})

Deno.test('context freeze is deterministic across canonical roots and exact approved versions', async () => {
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
  assertEquals(first.manifest.project_id, 'project')
  assertEquals(first.manifest.engagement_stage_instance_id, 'stage')
})

Deno.test('context freeze rejects incomplete ownership and out-of-profile artifacts', async () => {
  const base = {
    departmentId: 'development',
    commercialContext: {
      canonical_client: { id: 'client' }, agency_client: { id: 'agency-client' },
      project: { id: 'project' }, engagement: { id: 'engagement' }, brand: { id: 'brand' },
    },
    services: [{ id: 'service' }],
    approvedContext: [] as Record<string, unknown>[],
    provider: { connectorId: 'connector', model: 'explicit-model' },
  }
  await assertRejects(
    () => freezeDepartmentChatContext({ ...base, commercialContext: { ...base.commercialContext, project: { id: '' } } }),
    Error,
    'canonical context envelope is incomplete',
  )
  await assertRejects(
    () => freezeDepartmentChatContext({
      ...base,
      approvedContext: [{ artifact_id: 'artifact', artifact_version_id: 'version', artifact_type: 'marketing_report', content: {} }],
    }),
    Error,
    'outside the development profile',
  )
})

Deno.test('direct Development proposals are rejected before any official or model path is reached', async () => {
  let touchedRuntime = false
  const forbidden = () => {
    touchedRuntime = true
    throw new Error('Development runtime path must be unreachable in WCH2')
  }
  const admin = new Proxy({}, { get: forbidden })
  const dependencies = {
    requireDepartmentEngagement: forbidden,
    approvedSafeContext: forbidden,
    resolveSingleOpenAiModel: forbidden,
    createMarketingArtifactVersion: forbidden,
    estimatedCost: forbidden,
  }
  const fetcher = async () => {
    forbidden()
    return new Response()
  }

  await assertRejects(
    () => proposeArtifact({} as any, admin as any, {
      department_id: 'development', engagement_id: 'engagement', artifact_type: 'technical_brief',
      prompt: 'Draft a technical brief', prompt_safe_for_ai: true,
    }, 'member', fetcher, dependencies as any),
    Error,
    'Unsupported development department',
  )
  await assertRejects(
    () => proposeWorkItem({} as any, admin as any, {
      department_id: 'development', engagement_id: 'engagement', work_item_type: 'task',
      title: 'Implementation task', prompt: 'Draft a work item', prompt_safe_for_ai: true,
    }, 'member', fetcher, dependencies as any),
    Error,
    'Unsupported development department',
  )
  assertEquals(touchedRuntime, false)
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
