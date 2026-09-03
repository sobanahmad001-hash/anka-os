import {
  designSystemContent,
  designSystemsScope,
  handleRequest,
  hasDesignSystemsAuthority,
  preflightDesignSystemsRequest,
  releaseDesignSystem,
  requireActiveDesignSystemsService,
  saveDesignSystem,
} from './index.ts'

type Json = Record<string, unknown>

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown) {
  if (!Object.is(actual, expected)) {
    throw new Error('Expected ' + JSON.stringify(expected) + ', received ' + JSON.stringify(actual))
  }
}

async function assertRejects(callback: () => Promise<unknown>, expected: string) {
  try {
    await callback()
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), 'Expected error containing ' + expected)
    return error
  }
  throw new Error('Expected callback to reject')
}

function nested(row: Json, path: string) {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    const selected = Array.isArray(value) ? value[0] : value
    return (selected as Json)[key]
  }, row)
}

class Query {
  private filters: Array<[string, unknown]> = []

  constructor(private rows: Json[]) {}

  select() { return this }

  eq(column: string, value: unknown) {
    this.filters.push([column, value])
    return this
  }

  async maybeSingle() {
    const row = this.rows.find(candidate =>
      this.filters.every(([column, value]) => Object.is(nested(candidate, column), value)))
    return { data: row || null, error: null }
  }
}

class FixtureClient {
  readonly reads: string[] = []

  constructor(readonly fixtures: Record<string, Json[]>) {}

  from(table: string) {
    this.reads.push(table)
    return new Query(this.fixtures[table] || [])
  }
}

class AdminQuery {
  private operation = 'select'
  private payload: Json | null = null

  constructor(private client: ScriptedAdmin, private table: string) {}

  select() { return this }
  eq(column: string, value: unknown) {
    this.client.filters.push({ table: this.table, column, value })
    return this
  }
  order() { return this }
  limit() { return this }
  insert(payload: Json) {
    this.operation = 'insert'
    this.payload = payload
    this.client.writes.push({ table: this.table, operation: this.operation, payload })
    return this
  }
  delete() {
    this.operation = 'delete'
    this.client.writes.push({ table: this.table, operation: this.operation, payload: null })
    return this
  }
  async maybeSingle() {
    return { data: this.client.next(this.client.maybeRows, this.table), error: null }
  }
  async single() {
    return { data: this.client.next(this.client.singleRows, this.table), error: null }
  }
  then(resolve: (value: { data: Json | null; error: null }) => unknown) {
    return Promise.resolve({ data: this.payload, error: null }).then(resolve)
  }
}

class ScriptedAdmin {
  organizationId = 'org-1'
  readonly writes: Array<{ table: string; operation: string; payload: Json | null }> = []
  readonly filters: Array<{ table: string; column: string; value: unknown }> = []

  constructor(
    readonly maybeRows: Record<string, Array<Json | null>>,
    readonly singleRows: Record<string, Array<Json | null>> = {},
  ) {}

  next(queues: Record<string, Array<Json | null>>, table: string) {
    const queue = queues[table] || []
    return queue.length ? queue.shift() || null : null
  }

  from(table: string) {
    return new AdminQuery(this, table)
  }
}

function baseFixtures() {
  const artifactOne = {
    id: 'artifact-1',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    brand_id: 'brand-1',
    artifact_type: 'design_system',
  }
  const artifactTwo = {
    id: 'artifact-2',
    organization_id: 'org-2',
    engagement_id: 'engagement-2',
    brand_id: 'brand-2',
    artifact_type: 'design_system',
  }
  return {
    engagements: [
      { id: 'engagement-1', organization_id: 'org-1', brand_id: 'brand-1' },
      { id: 'engagement-2', organization_id: 'org-2', brand_id: 'brand-2' },
    ],
    artifacts: [artifactOne, artifactTwo],
    artifact_versions: [
      {
        id: 'version-1',
        organization_id: 'org-1',
        artifact_id: 'artifact-1',
        artifact: artifactOne,
      },
      {
        id: 'version-2',
        organization_id: 'org-2',
        artifact_id: 'artifact-2',
        artifact: artifactTwo,
      },
    ],
    organization_memberships: [
      {
        organization_id: 'org-1',
        user_id: 'user-1',
        role: 'executive',
        department_id: null,
        status: 'active',
        member_kind: 'team',
        organization: { id: 'org-1', status: 'active' },
      },
      {
        organization_id: 'org-2',
        user_id: 'user-1',
        role: 'executive',
        department_id: null,
        status: 'active',
        member_kind: 'team',
        organization: { id: 'org-2', status: 'active' },
      },
    ],
    engagement_services: [
      {
        id: 'service-1',
        organization_id: 'org-1',
        engagement_id: 'engagement-1',
        status: 'active',
        service_catalog: {
          slug: 'design_systems',
          department_id: 'design',
          is_active: true,
        },
      },
      {
        id: 'service-2',
        organization_id: 'org-2',
        engagement_id: 'engagement-2',
        status: 'active',
        service_catalog: {
          slug: 'design_systems',
          department_id: 'design',
          is_active: true,
        },
      },
    ],
  }
}

function fixtureClient(fixtures = baseFixtures()) {
  return new FixtureClient(fixtures)
}

const validContent = {
  color_tokens: [{ name: 'Brand blue', value: '#2563eb' }],
  typography_scale: [{ name: 'Display', font: 'Inter', size: '48px', weight: '700' }],
  components: [{ name: 'Button', description: 'Primary action', usage_notes: 'One primary action per view' }],
  usage_rules: 'Use approved tokens and document exceptions.',
}

Deno.test('Design Systems accepts only the exact manual content shape', () => {
  assertEquals(designSystemContent(validContent).color_tokens.length, 1)
  let rejected = false
  try {
    designSystemContent({ ...validContent, live_preview: true })
  } catch {
    rejected = true
  }
  assert(rejected, 'Unexpected renderer fields must be rejected')
})

Deno.test('Design Systems preserves authoring and release role boundaries', () => {
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'team', role: 'contributor', department_id: 'design' },
    'save_design_system',
  ), true)
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'team', role: 'contributor', department_id: 'content' },
    'save_design_system',
  ), false)
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'team', role: 'contributor', department_id: 'design' },
    'release_design_system',
  ), false)
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'team', role: 'department_manager', department_id: 'design' },
    'release_design_system',
  ), true)
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'team', role: 'executive', department_id: null },
    'release_design_system',
  ), true)
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'client', role: 'executive', department_id: null },
    'release_design_system',
  ), false)
  assertEquals(hasDesignSystemsAuthority(
    { member_kind: 'team', role: 'executive', department_id: null },
    'unknown_action',
  ), false)
})

Deno.test('Design Systems maps only save and release to literal caller-readable roots', () => {
  assertEquals(
    JSON.stringify(designSystemsScope({
      action: 'save_design_system',
      content: validContent,
      engagement_id: 'engagement-1',
      engagement_service_id: 'service-1',
      organization_id: 'org-1',
    })),
    JSON.stringify({
      root: { kind: 'engagement', id: 'engagement-1' },
      requestedOrganizationId: 'org-1',
    }),
  )
  assertEquals(
    JSON.stringify(designSystemsScope({
      action: 'release_design_system',
      artifact_version_id: 'version-1',
      engagement_service_id: 'service-1',
    })),
    JSON.stringify({
      root: { kind: 'artifact_version', id: 'version-1' },
      requestedOrganizationId: null,
    }),
  )
  let unknown = false
  try {
    designSystemsScope({ action: 'list_design_systems', organization_id: 'org-1' })
  } catch (error) {
    unknown = error instanceof Error && error.message.includes('Unsupported action')
  }
  assert(unknown, 'No rootless or unknown action may enter the resolver')
})

Deno.test('positive caller preflight succeeds for both Design Systems action families', async () => {
  const client = fixtureClient()
  const save = await preflightDesignSystemsRequest(client as never, 'user-1', {
    action: 'save_design_system',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    engagement_service_id: 'service-1',
    artifact_id: 'artifact-1',
  })
  assertEquals(save.action, 'save_design_system')
  assertEquals(save.organizationId, 'org-1')
  assertEquals(save.engagementId, 'engagement-1')
  assertEquals(save.artifactId, 'artifact-1')

  const release = await preflightDesignSystemsRequest(client as never, 'user-1', {
    action: 'release_design_system',
    organization_id: 'org-1',
    artifact_version_id: 'version-1',
    engagement_service_id: 'service-1',
  })
  assertEquals(release.action, 'release_design_system')
  assertEquals(release.organizationId, 'org-1')
  assertEquals(release.artifactId, 'artifact-1')
  assertEquals(release.artifactVersionId, 'version-1')
})

Deno.test('same-role same-shaped cross-tenant artifact injection is rejected', async () => {
  const client = fixtureClient()
  await assertRejects(() => preflightDesignSystemsRequest(client as never, 'user-1', {
    action: 'save_design_system',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    engagement_service_id: 'service-1',
    artifact_id: 'artifact-2',
  }), 'does not match this engagement')
})

Deno.test('requested organization mismatch is equality-only and fails before service access', async () => {
  const client = fixtureClient()
  await assertRejects(() => preflightDesignSystemsRequest(client as never, 'user-1', {
    action: 'save_design_system',
    organization_id: 'org-2',
    engagement_id: 'engagement-1',
    engagement_service_id: 'service-1',
  }), 'Requested organization')
  assertEquals(client.reads.includes('engagement_services'), false)
})

Deno.test('inactive, revoked, client, and inactive-organization memberships fail closed', async () => {
  for (const variant of ['inactive', 'revoked', 'client', 'organization']) {
    const fixtures = structuredClone(baseFixtures())
    const membership = fixtures.organization_memberships[0]
    if (variant === 'inactive' || variant === 'revoked') membership.status = variant
    if (variant === 'client') membership.member_kind = 'client'
    if (variant === 'organization') (membership.organization as Json).status = 'suspended'
    const client = fixtureClient(fixtures)
    await assertRejects(() => preflightDesignSystemsRequest(client as never, 'user-1', {
      action: 'save_design_system',
      content: validContent,
      organization_id: 'org-1',
      engagement_id: 'engagement-1',
      engagement_service_id: 'service-1',
    }), 'Active team membership')
    assertEquals(client.reads.includes('engagement_services'), false)
  }
})

Deno.test('unreadable and missing roots fail before membership or privileged resolution', async () => {
  const fixtures = baseFixtures()
  fixtures.engagements = []
  const client = fixtureClient(fixtures)
  await assertRejects(() => preflightDesignSystemsRequest(client as never, 'user-1', {
    action: 'save_design_system',
    engagement_id: 'missing',
    engagement_service_id: 'service-1',
  }), 'Engagement not found')
  assertEquals(client.reads.includes('organization_memberships'), false)

  let missing = false
  try {
    designSystemsScope({ action: 'release_design_system', engagement_service_id: 'service-1' })
  } catch (error) {
    missing = error instanceof Error && error.message.includes('Artifact version is required')
  }
  assert(missing, 'Missing release root must fail before caller or resolver access')
})

Deno.test('injected services and artifact-version canonical-chain mismatches fail closed', async () => {
  const serviceClient = fixtureClient()
  await assertRejects(() => preflightDesignSystemsRequest(serviceClient as never, 'user-1', {
    action: 'save_design_system',
    engagement_id: 'engagement-1',
    engagement_service_id: 'service-2',
  }), 'active Design Systems service')

  const fixtures = structuredClone(baseFixtures())
  fixtures.artifact_versions[0].artifact = fixtures.artifacts[1]
  const versionClient = fixtureClient(fixtures)
  await assertRejects(() => preflightDesignSystemsRequest(versionClient as never, 'user-1', {
    action: 'release_design_system',
    artifact_version_id: 'version-1',
    engagement_service_id: 'service-1',
  }), 'invalid organization chain')
  assertEquals(versionClient.reads.includes('organization_memberships'), false)
})

Deno.test('role and action denials do not reach resolver or privileged side effects', async () => {
  const fixtures = baseFixtures()
  ;(fixtures.organization_memberships[0] as Json).role = 'contributor'
  ;(fixtures.organization_memberships[0] as Json).department_id = 'design'
  const client = fixtureClient(fixtures)
  let resolverCalls = 0
  const request = new Request('http://local/design-systems', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'release_design_system',
      artifact_version_id: 'version-1',
      engagement_service_id: 'service-1',
    }),
  })
  const denied = await handleRequest(request, {
    createCallerIdentity: async () => ({ userClient: client as never, userId: 'user-1' }),
    resolveContext: async () => {
      resolverCalls += 1
      throw new Error('Resolver must not be called')
    },
  })
  assertEquals(denied.status, 403)
  assertEquals(resolverCalls, 0)
  assertEquals(client.reads.includes('engagement_services'), false)

  let callerCalls = 0
  const unknown = await handleRequest(new Request('http://local/design-systems', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unknown_design_action', organization_id: 'org-1' }),
  }), {
    createCallerIdentity: async () => {
      callerCalls += 1
      return { userClient: client as never, userId: 'user-1' }
    },
    resolveContext: async () => {
      resolverCalls += 1
      throw new Error('Resolver must not be called')
    },
  })
  assertEquals(unknown.status, 400)
  assertEquals(callerCalls, 0)
  assertEquals(resolverCalls, 0)
})

Deno.test('all caller-validation denials remain before resolver and privileged access', async () => {
  const cases: Array<{ fixtures: ReturnType<typeof baseFixtures>; body: Json }> = []

  cases.push({
    fixtures: baseFixtures(),
    body: {
      action: 'save_design_system',
      content: validContent,
      organization_id: 'org-2',
      engagement_id: 'engagement-1',
      engagement_service_id: 'service-1',
    },
  })

  const inactive = baseFixtures()
  ;(inactive.organization_memberships[0] as Json).status = 'revoked'
  cases.push({
    fixtures: inactive,
    body: {
      action: 'save_design_system',
      content: validContent,
      engagement_id: 'engagement-1',
      engagement_service_id: 'service-1',
    },
  })

  const unreadable = baseFixtures()
  unreadable.engagements = []
  cases.push({
    fixtures: unreadable,
    body: {
      action: 'save_design_system',
      content: validContent,
      engagement_id: 'missing',
      engagement_service_id: 'service-1',
    },
  })

  cases.push({
    fixtures: baseFixtures(),
    body: {
      action: 'save_design_system',
      content: validContent,
      engagement_id: 'engagement-1',
      engagement_service_id: 'service-2',
    },
  })

  const mismatchedVersion = baseFixtures()
  mismatchedVersion.artifact_versions[0].artifact = mismatchedVersion.artifacts[1]
  cases.push({
    fixtures: mismatchedVersion,
    body: {
      action: 'release_design_system',
      artifact_version_id: 'version-1',
      engagement_service_id: 'service-1',
    },
  })

  for (const testCase of cases) {
    const client = fixtureClient(testCase.fixtures)
    let resolverCalls = 0
    const result = await handleRequest(new Request('http://local/design-systems', {
      method: 'POST',
      headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(testCase.body),
    }), {
      createCallerIdentity: async () => ({ userClient: client as never, userId: 'user-1' }),
      resolveContext: async () => {
        resolverCalls += 1
        throw new Error('Resolver must not be called')
      },
    })
    assert(result.status >= 400, 'Denied caller input must return an error')
    assertEquals(resolverCalls, 0)
  }

  let callerCalls = 0
  const malformed = await handleRequest(new Request('http://local/design-systems', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
    body: JSON.stringify([]),
  }), {
    createCallerIdentity: async () => {
      callerCalls += 1
      return { userClient: fixtureClient() as never, userId: 'user-1' }
    },
  })
  assertEquals(malformed.status, 400)
  assertEquals(callerCalls, 0)

  const invalidContent = await handleRequest(new Request('http://local/design-systems', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save_design_system',
      engagement_id: 'engagement-1',
      engagement_service_id: 'service-1',
      content: { unexpected: true },
    }),
  }), {
    createCallerIdentity: async () => {
      callerCalls += 1
      return { userClient: fixtureClient() as never, userId: 'user-1' }
    },
  })
  assertEquals(invalidContent.status, 400)
  assertEquals(callerCalls, 0)
})

Deno.test('save appends an immutable version and emits an organization-scoped event', async () => {
  const artifact = {
    id: 'artifact-1',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    brand_id: 'brand-1',
    artifact_type: 'design_system',
  }
  const activeService = {
    id: 'service-1',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    status: 'active',
    service_catalog: { slug: 'design_systems', department_id: 'design', is_active: true },
  }
  const admin = new ScriptedAdmin({
    engagements: [{ id: 'engagement-1', organization_id: 'org-1', brand_id: 'brand-1' }],
    engagement_services: [activeService],
    artifacts: [artifact],
    artifact_versions: [{ id: 'version-1', version_number: 1 }],
  }, {
    artifact_versions: [{ id: 'version-2', version_number: 2 }],
  })
  const result = await saveDesignSystem(admin as never, {
    engagement_id: 'engagement-1',
    engagement_service_id: 'service-1',
    artifact_id: 'artifact-1',
    content: validContent,
    change_summary: 'Second immutable version',
  }, 'user-1')
  assertEquals(result.version.id, 'version-2')
  const versionWrite = admin.writes.find(write => write.table === 'artifact_versions')
  assertEquals(versionWrite?.operation, 'insert')
  assertEquals(versionWrite?.payload?.organization_id, 'org-1')
  assertEquals(versionWrite?.payload?.artifact_id, 'artifact-1')
  assertEquals(versionWrite?.payload?.parent_version_id, 'version-1')
  const eventWrite = admin.writes.find(write => write.table === 'engagement_events')
  assertEquals(eventWrite?.payload?.organization_id, 'org-1')
  assertEquals(eventWrite?.payload?.engagement_id, 'engagement-1')
  assertEquals(admin.writes.some(write => write.operation === 'delete'), false)
})

Deno.test('release approves only the exact version and existing references never move', async () => {
  const artifact = {
    id: 'artifact-1',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    artifact_type: 'design_system',
  }
  const version = { id: 'version-1', artifact_id: 'artifact-1', artifacts: artifact }
  const activeService = {
    id: 'service-1',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    status: 'active',
    service_catalog: { slug: 'design_systems', department_id: 'design', is_active: true },
  }
  const admin = new ScriptedAdmin({
    artifact_versions: [version],
    engagement_services: [activeService],
    artifact_approvals: [null],
    artifact_approval_requests: [null],
  }, {
    artifact_approvals: [{
      id: 'approval-1',
      organization_id: 'org-1',
      artifact_id: 'artifact-1',
      artifact_version_id: 'version-1',
    }],
  })
  const approval = await releaseDesignSystem(admin as never, {
    artifact_version_id: 'version-1',
    engagement_service_id: 'service-1',
  }, 'user-1')
  assertEquals(approval.artifact_version_id, 'version-1')
  const approvalWrite = admin.writes.find(write => write.table === 'artifact_approvals')
  assertEquals(approvalWrite?.payload?.organization_id, 'org-1')
  assertEquals(approvalWrite?.payload?.artifact_id, 'artifact-1')
  assertEquals(approvalWrite?.payload?.artifact_version_id, 'version-1')
  assertEquals(admin.writes.some(write => write.operation === 'update'), false)

  const existing = {
    id: 'approval-existing',
    organization_id: 'org-1',
    artifact_id: 'artifact-1',
    artifact_version_id: 'version-1',
  }
  const repeat = new ScriptedAdmin({
    artifact_versions: [version],
    engagement_services: [activeService],
    artifact_approvals: [existing],
  })
  const unchanged = await releaseDesignSystem(repeat as never, {
    artifact_version_id: 'version-1',
    engagement_service_id: 'service-1',
  }, 'user-1')
  assertEquals(unchanged.id, 'approval-existing')
  assertEquals(repeat.writes.length, 0)
})

Deno.test('active Design Systems service validation remains slug-specific and organization-scoped', async () => {
  class ServiceQuery {
    constructor(private row: Json | null) {}
    select() { return this }
    eq() { return this }
    async maybeSingle() { return { data: this.row, error: null } }
  }
  const active = {
    id: 'service-1',
    organization_id: 'org-1',
    engagement_id: 'engagement-1',
    status: 'active',
    service_catalog: { slug: 'design_systems', department_id: 'design', is_active: true },
  }
  const result = await requireActiveDesignSystemsService(
    { admin: { from: () => new ServiceQuery(active) } as never, organizationId: 'org-1' },
    'engagement-1',
    'service-1',
  )
  assertEquals(result.catalog.slug, 'design_systems')
  await assertRejects(() => requireActiveDesignSystemsService(
    {
      admin: {
        from: () => new ServiceQuery({
          ...active,
          service_catalog: { ...active.service_catalog, slug: 'campaign_creative' },
        }),
      } as never,
      organizationId: 'org-1',
    },
    'engagement-1',
    'service-1',
  ), 'Design Systems service')
})
