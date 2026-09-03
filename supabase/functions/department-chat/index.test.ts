import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import {
  CHAT_MARKETING_ARTIFACT_TYPE_SET,
  ENABLED_DEPARTMENTS,
  confirmProposal,
  departmentChatExternalEndpoint,
  freezeDepartmentChatContext,
  hasDepartmentChatAuthority,
  handleRequest,
  isDepartmentChatArtifactType,
  marketingArtifactResponseFormat,
  outputText,
  proposeArtifact,
  proposeWorkItem,
  rejectProposal,
  requireDepartmentEngagement,
  resolveSingleOpenAiModel,
  selectSingleOpenAiModel,
  safeAttemptReason,
} from './index.ts'
import { contentArtifactResponseFormat } from '../_shared/contentArtifacts.ts'
import { departmentChatProfile } from '../_shared/departmentChatProfiles.ts'
import { developmentChatArtifactResponseFormat } from '../_shared/developmentChatArtifacts.ts'
import {
  CHAT_DESIGN_ARTIFACT_TYPE_SET,
  designArtifactResponseFormat,
  validateDesignSystemArtifact,
} from '../_shared/designSystemArtifacts.ts'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'

// Executes the real request, authorization, context, connector and RPC boundaries.
// The query double honors predicates; RPC results are synthetic, not SQL execution.
function selectedOrganizationFixture() {
  const rows: Record<string, any[]> = {}
  const queries: Array<{ table: string, filters: Array<[string, unknown]> }> = []
  const rpcCalls: Array<{ name: string, args: any }> = []
  let providerCalls = 0
  for (const org of ['A', 'B', 'C']) {
    const add = (table: string, value: any) => (rows[table] ||= []).push({ organization_id: org, ...value })
    add('organizations', { id: org, status: 'active', settings: { ai_monthly_budget_microusd: 100 } })
    if (org !== 'C') add('organization_memberships', { user_id: 'actor', status: 'active', member_kind: 'team', role: 'contributor', department_id: 'development' })
    add('engagements', { id: 'engagement-' + org, client_id: 'agency-' + org, project_id: 'project-' + org, brand_id: 'brand-' + org })
    add('agency_clients', { id: 'agency-' + org, canonical_client_id: 'client-' + org })
    add('clients', { id: 'client-' + org })
    add('projects', { id: 'project-' + org, client_id: 'client-' + org })
    add('brands', { id: 'brand-' + org, client_id: 'agency-' + org })
    add('engagement_services', { id: 'service-' + org, engagement_id: 'engagement-' + org, status: 'active', service_catalog: { department_id: 'development' } })
    add('engagement_stage_instances', { id: 'stage-' + org, engagement_id: 'engagement-' + org, accountable_department_id: 'development' })
    add('integration_connections', { id: 'connector-' + org, status: 'verified', provider: 'openai', archived_at: null,
      secret_name: 'SYNTHETIC', public_config: { model_id: 'offline' },
      integration_connection_departments: { department_id: 'development' },
      integration_connection_engagements: { engagement_id: 'engagement-' + org, department_id: 'development' } })
    add('department_chat_proposals', { ...pendingProposal, id: 'proposal-' + org, organization_id: org,
      engagement_id: 'engagement-' + org, project_id: 'project-' + org, proposer_id: 'actor', connector_connection_id: 'connector-' + org })
  }
  const admin: any = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const entry = { table, filters }; queries.push(entry)
      const path = (row: any, key: string) => key.split('.').reduce((value, field) => value?.[field], row)
      const result = (single = false) => {
        const matching = (rows[table] || []).filter(row => filters.every(([key, value]) => path(row, key) === value))
        return { data: single ? matching[0] || null : matching, error: null, count: matching.length }
      }
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query },
        // No dated/approved rows are present in this fixture.
        gte: () => query, in: () => query, neq: () => query, order: () => query,
        single: async () => result(true), maybeSingle: async () => result(true),
        then: (resolve: any) => Promise.resolve(result()).then(resolve),
      }
      return query
    },
    async rpc(name: string, args: any) {
      rpcCalls.push({ name, args })
      return { data: name === 'save_department_chat_proposal' ? { status: 'pending', proposal_id: 'saved-B' }
        : name === 'reject_department_chat_proposal' ? { outcome: 'rejected' }
        : { outcome: 'accepted', artifact_version_id: 'version-B' }, error: null }
    },
  }
  const request = (body: any) => handleRequest(new Request('http://offline/department-chat', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), {
    clients: { admin, userClient: { auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) } } as any },
    fetcher: (async () => { providerCalls++; return new Response(JSON.stringify({ output_text: JSON.stringify({ notes: 'Offline', checklist: ['Test'] }) })) }) as typeof fetch,
    proposal: { estimatedCost: () => 0, resolveSingleOpenAiModel: (client, engagement, department, organization) =>
      resolveSingleOpenAiModel(client, engagement, department, organization, () => 'synthetic-key') },
  })
  return { rows, queries, rpcCalls, request, providerCalls: () => providerCalls }
}

const selectedPreview = { action: 'propose_artifact', organization_id: 'B', engagement_id: 'engagement-B',
  department_id: 'development', artifact_type: 'technical_brief', engagement_stage_instance_id: 'stage-B',
  prompt: 'Offline fixture', prompt_safe_for_ai: true }

Deno.test('selected B succeeds through real request boundaries with every read, save and attempt scoped to B', async () => {
  const fixture = selectedOrganizationFixture()
  const response = await fixture.request(selectedPreview)
  assertEquals(response.status, 200)
  assertEquals(fixture.providerCalls(), 1)
  for (const { table, filters } of fixture.queries) {
    assertEquals(filters.some(([key, value]) => key === (table === 'organizations' ? 'id' : 'organization_id') && value === 'B'), true, table)
  }
  const save = fixture.rpcCalls.find(call => call.name === 'save_department_chat_proposal')!
  assertEquals(save.args.p_organization_id, 'B')
  assertEquals(save.args.p_engagement_id, 'engagement-B')
  assertEquals(save.args.p_project_id, 'project-B')
  assertEquals(save.args.p_connector_connection_id, 'connector-B')
  assertEquals(save.args.p_engagement_stage_instance_id, 'stage-B')
  assertEquals(fixture.rpcCalls.filter(call => call.name === 'record_department_chat_attempt').every(call =>
    call.args.p_organization_id === 'B' && !JSON.stringify(call.args).includes('Offline fixture')), true)
})

for (const scenario of ['missing', 'nonmember', 'inactive-organization', 'inactive-membership', 'client-membership']) {
  Deno.test('selected organization fails closed before provider/audit/mutation: ' + scenario, async () => {
    const fixture = selectedOrganizationFixture()
    const body = { ...selectedPreview }
    if (scenario === 'missing') body.organization_id = ''
    if (scenario === 'nonmember') body.organization_id = 'C'
    if (scenario === 'inactive-organization') fixture.rows.organizations.find(row => row.id === 'B').status = 'inactive'
    if (scenario === 'inactive-membership') fixture.rows.organization_memberships.find(row => row.organization_id === 'B').status = 'inactive'
    if (scenario === 'client-membership') fixture.rows.organization_memberships.find(row => row.organization_id === 'B').member_kind = 'client'
    const response = await fixture.request(body)
    assertEquals(response.status, scenario === 'missing' ? 400 : 403)
    assertEquals(fixture.providerCalls(), 0)
    assertEquals(fixture.rpcCalls.length, 0)
  })
}

for (const scenario of ['engagement-A', 'project-A', 'department-mismatch', 'stage-A']) {
  Deno.test('B selection rejects mismatched canonical/department context: ' + scenario, async () => {
    const fixture = selectedOrganizationFixture()
    const body = { ...selectedPreview }
    if (scenario === 'engagement-A') body.engagement_id = 'engagement-A'
    if (scenario === 'project-A') fixture.rows.engagements.find(row => row.organization_id === 'B').project_id = 'project-A'
    if (scenario === 'department-mismatch') fixture.rows.engagement_services.find(row => row.organization_id === 'B').service_catalog.department_id = 'design'
    if (scenario === 'stage-A') body.engagement_stage_instance_id = 'stage-A'
    const response = await fixture.request(body)
    assertEquals(response.status >= 400, true)
    assertEquals(fixture.providerCalls(), 0)
    assertEquals(fixture.rpcCalls.every(call => call.name === 'record_department_chat_attempt' && call.args.p_organization_id === 'B'), true)
    assertEquals(fixture.rpcCalls.at(-1)!.args.p_event_kind, 'preview_blocked')
  })
}

for (const action of ['confirm_proposal', 'reject_proposal']) {
  Deno.test(action + ' resolves only a B proposal before calling the unchanged atomic RPC', async () => {
    for (const org of ['A', 'B']) {
      const fixture = selectedOrganizationFixture()
      const response = await fixture.request({ action, organization_id: 'B', proposal_id: 'proposal-' + org })
      assertEquals(response.status, org === 'B' ? 200 : 404)
      assertEquals(fixture.providerCalls(), 0)
      assertEquals(fixture.rpcCalls.length, org === 'B' ? 1 : 0)
      if (org === 'B') assertEquals(fixture.rpcCalls[0].args.p_proposal_id, 'proposal-B')
      assertEquals(fixture.queries.every(({ table, filters }) => filters.some(([key, value]) => key === (table === 'organizations' ? 'id' : 'organization_id') && value === 'B')), true)
    }
  })
}

Deno.test('selected B work-item preview keeps save and audit in B', async () => {
  const fixture = selectedOrganizationFixture()
  const response = await fixture.request({ ...selectedPreview, action: 'propose_work_item', title: 'Offline task', work_item_type: 'task' })
  assertEquals(response.status, 200)
  assertEquals(fixture.rpcCalls.every(call => call.args.p_organization_id === 'B'), true)
  assertEquals(fixture.rpcCalls.at(-1)!.args.p_proposal_kind, 'work_item')
})

function schemaFixture(schema: any): any {
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf) return schemaFixture(schema.anyOf.find((item: any) => item.type === 'null') || schema.anyOf[0])
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) return null
    return schemaFixture({ ...schema, type: schema.type[0] })
  }
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, schemaFixture(value)]))
  if (schema.type === 'array') return [schemaFixture(schema.items)]
  if (schema.type === 'number' || schema.type === 'integer') return 1
  if (schema.type === 'boolean') return false
  if (schema.type === 'null') return null
  return 'fixture'
}

for (const department of ['content','design','marketing','development']) {
  for (const target of departmentChatProfile(department).artifactTypes) {
    Deno.test('preview validates and saves only a pending ' + department + '/' + target, async () => {
      const format = department === 'content' ? contentArtifactResponseFormat(target)
        : department === 'design' ? designArtifactResponseFormat(target)
        : department === 'marketing' ? marketingArtifactResponseFormat(target)
        : developmentChatArtifactResponseFormat(target)
      const { admin, rpcCalls } = proposalAdmin()
      const fixture = schemaFixture(format.schema)
      if (target === 'design_system') fixture.color_tokens[0].value = '#123456'
      await proposeArtifact({} as any, admin as any, {
        department_id: department, engagement_id: 'engagement-1', artifact_type: target,
        prompt: 'Fixture', prompt_safe_for_ai: true,
        organization_id: 'injected', project_id: 'injected', actor_id: 'injected', approval: true,
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({ output_text: JSON.stringify(fixture) })), contextDependencies)
      assertEquals(rpcCalls.length, 1)
      assertEquals(rpcCalls[0].name, 'save_department_chat_proposal')
      assertEquals(rpcCalls[0].args.p_actor_id, 'member-1')
      assertEquals(rpcCalls[0].args.p_project_id, 'project-1')
      assertEquals(rpcCalls[0].args.p_organization_id, ORGANIZATION_ID)
      assertEquals(rpcCalls[0].args.p_target_key, target)
      const invalid = proposalAdmin()
      await assertRejects(() => proposeArtifact({} as any, invalid.admin as any, {
        department_id: department, engagement_id: 'engagement-1', artifact_type: target,
        prompt: 'Fixture', prompt_safe_for_ai: true,
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({ output_text: '{}' })), contextDependencies))
      assertEquals(invalid.rpcCalls.length, 0)
    })
  }
  for (const target of ['task','bug','request']) {
    Deno.test('preview creates only a pending ' + department + '/' + target, async () => {
      const { admin, rpcCalls } = proposalAdmin()
      await proposeWorkItem({} as any, admin as any, {
        department_id: department, engagement_id: 'engagement-1', work_item_type: target,
        title: 'Fixture', prompt: 'Fixture', prompt_safe_for_ai: true, status: 'done', assignee_id: 'injected',
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({output_text:'Fixture'})), contextDependencies)
      assertEquals(rpcCalls.length, 1)
      assertEquals((rpcCalls[0].args.p_preview_payload as any).status, 'not_started')
      assertEquals((rpcCalls[0].args.p_validated_payload as any).assignee_id, undefined)
      const invalid = proposalAdmin()
      await assertRejects(() => proposeWorkItem({} as any, invalid.admin as any, {
        department_id: department, engagement_id: 'engagement-1', work_item_type: target,
        title: 'Fixture', prompt: 'Fixture', prompt_safe_for_ai: true,
      }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({ output_text: '' })), contextDependencies))
      assertEquals(invalid.rpcCalls.length, 0)
    })
  }
}

Deno.test('audit reasons never contain provider secrets or raw failures', () => {
  for (const message of ['credential sk-secret', 'model_id token-secret', 'connector Bearer secret', 'OpenAI private failure']) {
    assertEquals(['credential_missing','model_missing','connector_unavailable','provider_failed'].includes(safeAttemptReason(new Error(message))), true)
  }
})

for (const department of ['content','design','marketing','development']) {
  Deno.test('connector failures call no provider or proposal path for ' + department, async () => {
    const badConnections = [[], [{id:'one'},{id:'two'}], [{id:'one',secret_name:'KEY',public_config:{model_id:'explicit'}}], [{id:'one',secret_name:'KEY',public_config:{}}]]
    for (const [index, connections] of badConnections.entries()) {
      for (const target of [...departmentChatProfile(department).artifactTypes, 'task','bug','request']) {
        const { admin, rpcCalls } = proposalAdmin()
        let providerCalls=0
        const dependencies={...contextDependencies,resolveSingleOpenAiModel:(async () => selectSingleOpenAiModel(connections,department,() => index===2 ? undefined : 'test-key')) as any}
        const body={department_id:department,engagement_id:'engagement-1',artifact_type:target,work_item_type:target,title:'Fixture',prompt:'Fixture',prompt_safe_for_ai:true}
        const fetcher=(async () => { providerCalls++; return new Response('{}') }) as typeof fetch
        await assertRejects(() => ['task','bug','request'].includes(target)
          ? proposeWorkItem({} as any,admin as any,body,'member-1',ORGANIZATION_ID,fetcher,dependencies)
          : proposeArtifact({} as any,admin as any,body,'member-1',ORGANIZATION_ID,fetcher,dependencies))
        assertEquals(providerCalls,0)
        assertEquals(rpcCalls.length,0)
      }
    }
  })
}

Deno.test('expired and stale outcomes remain machine-readable for terminal UI state', async () => {
  for (const outcome of ['expired','stale','rejected']) {
    const {admin}=decisionAdmin({...pendingProposal,status:outcome},{outcome})
    const error=await assertRejects(() => confirmProposal(admin as any,'proposal-1','member-1',{organization_id:ORGANIZATION_ID,department_id:'development'},contextDependencies))
    assertEquals((error as any).outcome,outcome)
  }
})

Deno.test('unavailable changed context becomes stale without an official write', async () => {
  const {admin,rpcCalls}=decisionAdmin(pendingProposal,{outcome:'stale'})
  const error=await assertRejects(() => confirmProposal(admin as any,'proposal-1','member-1',{organization_id:ORGANIZATION_ID,department_id:'development'}, {
    ...contextDependencies, resolveSingleOpenAiModel:(async () => {throw new Error('No verified connector')}) as any,
  }))
  assertEquals((error as any).outcome,'stale')
  assertEquals(rpcCalls[0].args.p_context_checksum,null)
})

Deno.test('accepted replay does not require a still-available connector', async () => {
  const { admin, rpcCalls } = decisionAdmin({ ...pendingProposal, status: 'accepted' }, { outcome: 'accepted', replayed: true, artifact_version_id: 'saved-version' })
  const result = await confirmProposal(admin as any,'proposal-1','member-1',{organization_id:ORGANIZATION_ID,department_id:'development'}, {
    requireDepartmentEngagement: (async () => { throw new Error('Must not re-resolve accepted context') }) as any,
  })
  assertEquals(result.artifact_version_id,'saved-version')
  assertEquals(rpcCalls.length,1)
})

Deno.test('Shared Department Chat is department-scoped', () => {
  assertEquals(hasDepartmentChatAuthority({ organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'content' }, 'content'), true)
  assertEquals(hasDepartmentChatAuthority({ organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'design' }, 'content'), false)
  assertEquals(hasDepartmentChatAuthority({ organization_id: ORGANIZATION_ID, role: 'executive', department_id: null }, 'content'), true)
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
  const result = await requireDepartmentEngagement(client as never, 'engagement-1', 'design', ORGANIZATION_ID)
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
  }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({
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
  }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({
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
    }, 'member-1', ORGANIZATION_ID, async () => new Response(JSON.stringify({
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
    organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'development',
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
      organization_id: ORGANIZATION_ID, role: 'executive', department_id: null,
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
      organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'development',
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
    organization_id: ORGANIZATION_ID, role: 'contributor', department_id: 'development',
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
