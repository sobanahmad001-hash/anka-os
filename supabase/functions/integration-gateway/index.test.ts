import { assertEquals } from 'jsr:@std/assert@1.0.14'
import {
  currentConnectionHealthObservation, handleRequest, safeConnectionHealthObservations,
  syncInitialDepartmentChatModel,
} from './index.ts'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

function fixture(options: {
  role?: string
  membershipOrganizationId?: string
  connectionStatus?: string
  mappedDepartments?: string[]
  verifiedModelIds?: string[]
  history?: Array<Record<string, unknown>>
  connections?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
} = {}) {
  const calls: Array<{ client: string; table?: string; operation: string; value?: unknown }> = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  let providerCalls = 0
  const connection = {
    id: '44444444-4444-4444-8444-444444444444',
    organization_id: ORG_B,
    provider: 'openai',
    status: options.connectionStatus || 'verified',
    archived_at: null,
    display_name: 'Organization B OpenAI',
    public_config: {
      model_id: 'gpt-default',
      verified_model_ids: options.verifiedModelIds || ['gpt-default', 'gpt-other'],
    },
    updated_at: '2026-09-11T00:00:00Z',
    last_checked_at: '2026-09-11T00:00:00Z',
    integration_connection_departments: (options.mappedDepartments || ['content'])
      .map(department_id => ({ department_id })),
  }
  const rows: Record<string, any[]> = {
    organization_memberships: [{
      organization_id: options.membershipOrganizationId || ORG_B,
      user_id: USER_ID,
      role: options.role || 'operations_admin',
      status: 'active',
      member_kind: 'team',
    }],
    integration_connections: options.connections || [connection],
    integration_connection_departments: (options.mappedDepartments || ['content'])
      .map(department_id => ({ organization_id: ORG_B, connection_id: connection.id, department_id })),
    department_chat_model_configurations: (options.history || []).map(row => ({
      organization_id: ORG_B,
      connector_connection_id: connection.id,
      ...row,
    })),
    integration_events: options.events || [],
  }

  function client(name: string) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from(table: string) {
        const filters: Array<[string, unknown]> = []
        const included: Array<[string, unknown[]]> = []
        const ordering: Array<{ key: string; ascending: boolean }> = []
        let limitCount: number | null = null
        let operation = 'select'
        let inserted: unknown = null
        const matching = () => {
          const data = (rows[table] || []).filter(row => filters.every(([key, value]) => row[key] === value)
            && included.every(([key, values]) => values.includes(row[key])))
          data.sort((left, right) => {
            for (const item of ordering) {
              const comparison = String(left[item.key] || '').localeCompare(String(right[item.key] || ''))
              if (comparison) return item.ascending ? comparison : -comparison
            }
            return 0
          })
          return limitCount === null ? data : data.slice(0, limitCount)
        }
        const result = (single = false) => {
          if (operation === 'insert') {
            calls.push({ client: name, table, operation, value: inserted })
            return { data: inserted, error: null }
          }
          const data = matching()
          return { data: single ? data[0] || null : data, error: null }
        }
        const query: any = {
          select: () => query,
          eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
          in: (key: string, values: unknown[]) => { included.push([key, values]); return query },
          is: (key: string, value: unknown) => { filters.push([key, value]); return query },
          order: (key: string, options: { ascending?: boolean } = {}) => {
            ordering.push({ key, ascending: options.ascending !== false }); return query
          },
          limit: (value: number) => { limitCount = value; return query },
          insert: (value: unknown) => { operation = 'insert'; inserted = value; return query },
          update: (value: unknown) => { operation = 'update'; inserted = value; return query },
          delete: () => { operation = 'delete'; return query },
          single: async () => result(true),
          maybeSingle: async () => result(true),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
        }
        return query
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args })
        return { data: null, error: null }
      },
    }
  }

  const userClient = client('user')
  const adminClient = client('admin')
  const request = (body: Record<string, unknown>) => handleRequest(new Request('http://offline/integration-gateway', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), {
    clients: { userClient, adminClient },
    env: () => undefined,
    fetcher: async () => {
      providerCalls++
      return new Response('{}')
    },
  })
  return { request, adminClient, connection, calls, rpcCalls, providerCalls: () => providerCalls }
}

Deno.test('P9 gateway lists model access only for the selected active organization', async () => {
  const test = fixture({ history: [{
    id: '55555555-5555-4555-8555-555555555555',
    organization_id: ORG_B,
    connector_connection_id: '44444444-4444-4444-8444-444444444444',
    department_id: 'content',
    model_id: 'gpt-default',
    revoked_at: null,
  }] })
  const response = await test.request({ action: 'list_model_allowlist', organization_id: ORG_B })
  const body = await response.json()
  assertEquals(response.status, 200)
  assertEquals(body.organization_id, ORG_B)
  assertEquals(body.can_manage, true)
  assertEquals(body.connections.length, 1)
  assertEquals(body.connections[0].model_configurations.length, 1)
})

Deno.test('P9 gateway leader configures only verified mapped models in the selected organization', async () => {
  const test = fixture()
  const response = await test.request({
    action: 'configure_model_allowlist',
    organization_id: ORG_B,
    connection_id: test.connection.id,
    department_model_ids: { content: ['gpt-other'] },
  })
  assertEquals(response.status, 200)
  assertEquals(test.rpcCalls, [{
    name: 'configure_department_chat_model_allowlist',
    args: {
      p_organization_id: ORG_B,
      p_connector_connection_id: test.connection.id,
      p_actor_id: USER_ID,
      p_department_model_ids: { content: ['gpt-other'] },
    },
  }])
})

for (const scenario of ['nonleader', 'organization-mismatch', 'unverified-connector', 'unverified-model', 'unmapped-department']) {
  Deno.test('P9 gateway rejects without provider or allowlist call: ' + scenario, async () => {
    const test = fixture({
      role: scenario === 'nonleader' ? 'contributor' : undefined,
      membershipOrganizationId: scenario === 'organization-mismatch' ? ORG_A : undefined,
      connectionStatus: scenario === 'unverified-connector' ? 'configured' : undefined,
      mappedDepartments: scenario === 'unmapped-department' ? ['design'] : undefined,
    })
    const response = await test.request({
      action: 'configure_model_allowlist',
      organization_id: ORG_B,
      connection_id: test.connection.id,
      department_model_ids: scenario === 'unmapped-department'
        ? { content: ['gpt-default'] }
        : { content: [scenario === 'unverified-model' ? 'browser-invented' : 'gpt-default'] },
    })
    assertEquals(response.status >= 400, true)
    assertEquals(test.rpcCalls, [])
    assertEquals(test.providerCalls(), 0)
  })
}

Deno.test('P9 gateway accepts an explicit empty mapped allowlist as revocation', async () => {
  const test = fixture()
  const response = await test.request({
    action: 'configure_model_allowlist',
    organization_id: ORG_B,
    connection_id: test.connection.id,
    department_model_ids: { content: [] },
  })
  assertEquals(response.status, 200)
  assertEquals(test.rpcCalls[0].args.p_department_model_ids, { content: [] })
})

Deno.test('P9 initial sync seeds once, preserves deliberate revocation, and resyncs changed verified facts', async () => {
  const initial = fixture({ history: [] })
  await syncInitialDepartmentChatModel(initial.adminClient as any, initial.connection, USER_ID, ORG_B)
  assertEquals(initial.rpcCalls.length, 1)
  assertEquals(initial.rpcCalls[0].args.p_organization_id, ORG_B)

  const revoked = fixture({ history: [{ model_id: 'gpt-default', revoked_at: '2026-09-11T01:00:00Z' }] })
  await syncInitialDepartmentChatModel(revoked.adminClient as any, revoked.connection, USER_ID, ORG_B)
  assertEquals(revoked.rpcCalls, [])

  const changed = fixture({ history: [{ model_id: 'gpt-old', revoked_at: null }] })
  await syncInitialDepartmentChatModel(changed.adminClient as any, changed.connection, USER_ID, ORG_B)
  assertEquals(changed.rpcCalls.length, 1)
})

Deno.test('B05 health observations are restricted to visible connection IDs and safe codes', () => {
  const observations = safeConnectionHealthObservations(['visible'], [
    { connection_id: 'foreign', outcome: 'failed', error_code: 'HTTP_403', occurred_at: '2026-09-12T10:02:00Z' },
    { connection_id: 'visible', outcome: 'failed', error_code: 'RAW_PROVIDER_SECRET_MESSAGE', occurred_at: '2026-09-12T10:01:00Z' },
  ])
  assertEquals(observations.has('foreign'), false)
  assertEquals(observations.get('visible'), {
    outcome: 'failed', error_code: 'UNKNOWN', observed_at: '2026-09-12T10:01:00Z',
  })
})

Deno.test('B05 latest success supersedes failure and stale observations do not survive reconnect', () => {
  const observations = safeConnectionHealthObservations(['visible'], [
    { connection_id: 'visible', outcome: 'failed', error_code: 'HTTP_403', occurred_at: '2026-09-12T10:00:00Z' },
    { connection_id: 'visible', outcome: 'succeeded', error_code: null, occurred_at: '2026-09-12T10:01:00Z' },
  ])
  assertEquals(observations.get('visible'), {
    outcome: 'succeeded', error_code: null, observed_at: '2026-09-12T10:01:00Z',
  })
  assertEquals(currentConnectionHealthObservation(
    { id: 'visible', updated_at: '2026-09-12T10:02:00Z' }, observations.get('visible'),
  ), null)
  assertEquals(currentConnectionHealthObservation(
    { id: 'visible', updated_at: '2026-09-12T10:00:30Z' }, observations.get('visible'),
  ), observations.get('visible'))
})

Deno.test('B05 scoped list uses the selected organization for contributor and leader views', async () => {
  const foreign = {
    id: '66666666-6666-4666-8666-666666666666', organization_id: ORG_A,
    provider: 'figma', status: 'verified', archived_at: null, display_name: 'Foreign Figma',
    integration_connection_departments: [{ department_id: 'design' }],
  }
  for (const [role, canManage] of [['contributor', false], ['operations_admin', true]] as const) {
    const test = fixture({ role, connections: [foreign, {
      ...fixture().connection, provider: 'figma', display_name: 'Selected Figma',
      integration_connection_departments: [{ department_id: 'design' }],
    }] })
    const response = await test.request({ action: 'list', organization_id: ORG_B, department_id: 'design' })
    const body = await response.json()
    assertEquals(response.status, 200)
    assertEquals(body.organization_id, ORG_B)
    assertEquals(body.can_manage, canManage)
    assertEquals(body.connections.map((item: Record<string, unknown>) => item.display_name), ['Selected Figma'])
  }
  const wrongOrganization = fixture({ membershipOrganizationId: ORG_A })
  const denied = await wrongOrganization.request({ action: 'list', organization_id: ORG_B, department_id: 'design' })
  assertEquals(denied.status, 403)
})

Deno.test('B05 scoped test requires selected-organization leadership without calling a provider', async () => {
  const contributor = fixture({ role: 'contributor' })
  const response = await contributor.request({
    action: 'test', organization_id: ORG_B, connection_id: contributor.connection.id,
  })
  assertEquals(response.status, 403)
  assertEquals(contributor.providerCalls(), 0)
})

Deno.test('B05 latest lookup stays deterministic beyond a provider row cap', async () => {
  const connectionId = '44444444-4444-4444-8444-444444444444'
  const historical = Array.from({ length: 1100 }, (_, index) => ({
    id: String(index).padStart(4, '0'), organization_id: ORG_B, connection_id: connectionId,
    operation: 'tested', outcome: 'failed', error_code: 'HTTP_403',
    occurred_at: `2026-09-10T${String(index % 24).padStart(2, '0')}:00:00Z`,
  }))
  const test = fixture({
    connections: [{ ...fixture().connection, provider: 'figma',
      integration_connection_departments: [{ department_id: 'design' }] }],
    events: [...historical, {
      id: 'latest-success', organization_id: ORG_B, connection_id: connectionId,
      operation: 'tested', outcome: 'succeeded', error_code: null, occurred_at: '2026-09-12T12:00:00Z',
    }],
  })
  const response = await test.request({ action: 'list', organization_id: ORG_B, department_id: 'design' })
  const body = await response.json()
  assertEquals(response.status, 200)
  assertEquals(body.connections[0].health_observation, {
    outcome: 'succeeded', error_code: null, observed_at: '2026-09-12T12:00:00Z',
  })
})
