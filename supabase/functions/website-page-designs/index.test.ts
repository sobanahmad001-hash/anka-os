import {
  applySeoMetadata,
  generateOpenAiPage,
  handler,
  hasPageDesignAuthority,
  normalizePagePath,
  pageDesignSchema,
  preflightWebsitePageDesignRequest,
  SEO_DESCRIPTION_PLACEHOLDER,
  SEO_TITLE_PLACEHOLDER,
  seoMetadata,
  transition,
  validatePageOutput,
  websitePageDesignScope,
} from './index.ts'

type Json = Record<string, unknown>

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

assert.equal = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) {
    throw new Error('Expected ' + JSON.stringify(expected) + ', received ' + JSON.stringify(actual))
  }
}

assert.throws = (callback: () => unknown) => {
  try { callback() } catch { return }
  throw new Error('Expected callback to throw')
}

async function assertRejects(callback: () => Promise<unknown>, expected: string) {
  try { await callback() } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), 'Expected error containing ' + expected)
    return
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
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this }
  async maybeSingle() {
    const row = this.rows.find(candidate =>
      this.filters.every(([column, value]) => Object.is(nested(candidate, column), value)))
    return { data: row || null, error: null }
  }
}

class FixtureClient {
  readonly reads: string[] = []
  constructor(readonly fixtures: Record<string, Json[]>) {}
  from(table: string) { this.reads.push(table); return new Query(this.fixtures[table] || []) }
}

function fixtures() {
  return {
    design_direction_versions: [
      { id: 'version-1', organization_id: 'org-1', direction_id: 'direction-1', content: { title: 'Direction' } },
      { id: 'version-2', organization_id: 'org-2', direction_id: 'direction-2', content: { title: 'Other' } },
    ],
    design_directions: [
      { id: 'direction-1', organization_id: 'org-1', session_id: 'session-1' },
      { id: 'direction-2', organization_id: 'org-2', session_id: 'session-2' },
    ],
    design_workshop_sessions: [
      { id: 'session-1', organization_id: 'org-1', engagement_id: 'engagement-1', brand_id: 'brand-1' },
      { id: 'session-2', organization_id: 'org-2', engagement_id: 'engagement-2', brand_id: 'brand-2' },
    ],
    engagements: [
      { id: 'engagement-1', organization_id: 'org-1', brand_id: 'brand-1' },
      { id: 'engagement-2', organization_id: 'org-2', brand_id: 'brand-2' },
    ],
    website_page_designs: [
      {
        id: 'page-draft', organization_id: 'org-1', design_direction_version_id: 'version-1',
        slug: 'home', status: 'draft',
      },
      {
        id: 'page-review', organization_id: 'org-1', design_direction_version_id: 'version-1',
        slug: 'home', status: 'in_review',
      },
    ],
    organization_memberships: [{
      organization_id: 'org-1', user_id: 'user-1', role: 'executive', department_id: null,
      status: 'active', member_kind: 'team', organization: { id: 'org-1', status: 'active' },
    }],
    design_model_registry: [{
      id: 'model-1', organization_id: 'org-1', provider: 'openai', is_active: true,
      supported_output_types: ['html_css'],
    }, {
      id: 'model-2', organization_id: 'org-2', provider: 'openai', is_active: true,
      supported_output_types: ['html_css'],
    }],
  }
}

Deno.test('RP4 uses architecture slug and normalizes content page_path only for matching', () => {
  assert.equal(normalizePagePath('/about/?ref=test'), 'about')
  assert.equal(normalizePagePath('https://raahbaan.example/'), 'home')
})

Deno.test('missing website content produces explicit SEO placeholders', () => {
  assert.equal(seoMetadata(null).title, SEO_TITLE_PLACEHOLDER)
  assert.equal(seoMetadata({}).description, SEO_DESCRIPTION_PLACEHOLDER)
})

Deno.test('approved content SEO is injected exactly into the complete document', () => {
  const html = applySeoMetadata(
    '<!doctype html><html><head></head><body><h1>Raahbaan</h1></body></html>',
    'Find a home',
    'Trusted property guidance',
  )
  assert(html.includes('<title>Find a home</title>'))
  assert(html.includes('content="Trusted property guidance"'))
  assert.equal(validatePageOutput(html, 'body { color: #111; }').css, 'body { color: #111; }')
})

Deno.test('page validation rejects executable content and missing heading structure', () => {
  const base = '<!doctype html><html><head><title>Home</title><meta content="Page" name="description"></head><body><h1>Home</h1></body></html>'
  assert.equal(validatePageOutput(base, 'body{}').html, base)
  assert.throws(() => validatePageOutput(base.replace('</body>', '<script>alert(1)</script></body>'), 'body{}'))
  assert.throws(() => validatePageOutput(base.replace('<h1>Home</h1>', ''), 'body{}'))
})

Deno.test('page-design capabilities remain team-only and action-specific', () => {
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'team', role: 'contributor', department_id: 'design' }, 'generate',
  ), true)
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'team', role: 'contributor', department_id: 'design' }, 'submit_review',
  ), true)
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'team', role: 'contributor', department_id: 'design' }, 'approve',
  ), false)
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'team', role: 'department_manager', department_id: 'design' }, 'approve',
  ), true)
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'team', role: 'executive', department_id: 'operations' }, 'approve',
  ), true)
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'client', role: 'executive', department_id: null }, 'approve',
  ), false)
  assert.equal(hasPageDesignAuthority(
    { member_kind: 'team', role: 'executive', department_id: null }, 'unknown',
  ), false)
})

Deno.test('OpenAI page adapter routes through the selected registered model and strict schema', async () => {
  let requestBody: Record<string, unknown> = {}
  const generated = await generateOpenAiPage('secret', 'registered-model', 'Page context', async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'))
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ html_content: '<!doctype html>', css_content: 'body{}' }),
    }), { status: 200 })
  })
  assert.equal(requestBody.model, 'registered-model')
  assert.equal((requestBody.text as Record<string, unknown>).format !== undefined, true)
  assert.equal(pageDesignSchema().strict, true)
  assert.equal(generated.css_content, 'body{}')
})

Deno.test('all three actions map to caller-readable canonical engagement roots', async () => {
  const client = new FixtureClient(fixtures())
  const generate = await websitePageDesignScope(client as never, {
    action: 'generate', design_direction_version_id: 'version-1',
    model_registry_id: 'model-1', slug: 'home', organization_id: 'org-1',
  })
  assert.equal(generate.action, 'generate')
  assert.equal(generate.scope.root?.kind, 'engagement')
  assert.equal(generate.scope.root?.id, 'engagement-1')

  const submit = await websitePageDesignScope(client as never, {
    action: 'submit_review', website_page_design_id: 'page-draft',
  })
  assert.equal(submit.action, 'submit_review')
  assert.equal(submit.directionVersionId, 'version-1')

  const approve = await websitePageDesignScope(client as never, {
    action: 'approve', website_page_design_id: 'page-review',
  })
  assert.equal(approve.action, 'approve')
  assert.equal(approve.organizationId, 'org-1')
})

Deno.test('positive preflight succeeds for generate, submit, and approve families', async () => {
  const client = new FixtureClient(fixtures())
  for (const body of [
    {
      action: 'generate', design_direction_version_id: 'version-1',
      model_registry_id: 'model-1', slug: 'home',
    },
    { action: 'submit_review', website_page_design_id: 'page-draft' },
    { action: 'approve', website_page_design_id: 'page-review' },
  ]) {
    const result = await preflightWebsitePageDesignRequest(client as never, 'user-1', body)
    assert.equal(result.organizationId, 'org-1')
    assert.equal(result.engagementId, 'engagement-1')
  }
})

Deno.test('same-shaped cross-tenant direction graphs are rejected before membership or model access', async () => {
  const rows = fixtures()
  rows.design_directions[0].organization_id = 'org-2'
  const client = new FixtureClient(rows)
  await assertRejects(() => websitePageDesignScope(client as never, {
    action: 'generate', design_direction_version_id: 'version-1',
    model_registry_id: 'model-1', slug: 'home',
  }), 'invalid organization chain')
  assert.equal(client.reads.includes('organization_memberships'), false)
  assert.equal(client.reads.includes('design_model_registry'), false)
})

Deno.test('requested organization mismatch and injected model IDs fail closed', async () => {
  const mismatch = new FixtureClient(fixtures())
  await assertRejects(() => preflightWebsitePageDesignRequest(mismatch as never, 'user-1', {
    action: 'generate', organization_id: 'org-2', design_direction_version_id: 'version-1',
    model_registry_id: 'model-1', slug: 'home',
  }), 'Requested organization')
  assert.equal(mismatch.reads.includes('organization_memberships'), false)

  const injected = new FixtureClient(fixtures())
  await assertRejects(() => preflightWebsitePageDesignRequest(injected as never, 'user-1', {
    action: 'generate', design_direction_version_id: 'version-1',
    model_registry_id: 'model-2', slug: 'home',
  }), 'HTML/CSS-capable OpenAI model')
})

Deno.test('inactive, revoked, client, and inactive-organization memberships fail closed', async () => {
  for (const variant of ['inactive', 'revoked', 'client', 'organization']) {
    const rows = structuredClone(fixtures())
    const membership = rows.organization_memberships[0] as Json
    if (variant === 'inactive' || variant === 'revoked') membership.status = variant
    if (variant === 'client') membership.member_kind = 'client'
    if (variant === 'organization') (membership.organization as Json).status = 'suspended'
    await assertRejects(() => preflightWebsitePageDesignRequest(
      new FixtureClient(rows) as never,
      'user-1',
      {
        action: 'generate', design_direction_version_id: 'version-1',
        model_registry_id: 'model-1', slug: 'home',
      },
    ), 'Active team membership')
  }
})

Deno.test('unreadable roots, unknown actions, and missing roots fail closed', async () => {
  const rows = fixtures()
  rows.design_direction_versions = []
  await assertRejects(() => websitePageDesignScope(new FixtureClient(rows) as never, {
    action: 'generate', design_direction_version_id: 'missing',
    model_registry_id: 'model-1', slug: 'home',
  }), 'Direction version not found')
  await assertRejects(() => websitePageDesignScope(new FixtureClient(fixtures()) as never, {
    action: 'unknown',
  }), 'Unsupported action')
  await assertRejects(() => websitePageDesignScope(new FixtureClient(fixtures()) as never, {
    action: 'approve',
  }), 'Website page design is required')
})

Deno.test('page-design canonical mismatch and invalid transitions fail before resolver access', async () => {
  const rows = fixtures()
  rows.website_page_designs[0].organization_id = 'org-2'
  await assertRejects(() => websitePageDesignScope(new FixtureClient(rows) as never, {
    action: 'submit_review', website_page_design_id: 'page-draft',
  }), 'invalid organization chain')

  await assertRejects(() => preflightWebsitePageDesignRequest(
    new FixtureClient(fixtures()) as never,
    'user-1',
    { action: 'approve', website_page_design_id: 'page-draft' },
  ), 'Only in_review')
})

Deno.test('submit and approve transitions update only exact organization, version, and expected state', async () => {
  for (const nextStatus of ['in_review', 'approved'] as const) {
    const visible = nextStatus === 'in_review'
      ? fixtures().website_page_designs[0]
      : fixtures().website_page_designs[1]
    const filters: Array<[string, unknown]> = []
    let updatePayload: Json = {}
    const query = {
      update(payload: Json) { updatePayload = payload; return this },
      eq(column: string, value: unknown) { filters.push([column, value]); return this },
      select() { return this },
      async single() { return { data: { ...visible, ...updatePayload }, error: null } },
    }
    const admin = { organizationId: 'org-1', from: () => query }
    const result = await transition(
      admin as never,
      new FixtureClient({ website_page_designs: [visible] }) as never,
      { website_page_design_id: visible.id },
      nextStatus,
    )
    assert.equal(result.status, nextStatus)
    assert(filters.some(([column, value]) => column === 'organization_id' && value === 'org-1'))
    assert(filters.some(([column, value]) =>
      column === 'design_direction_version_id' && value === 'version-1'))
    assert(filters.some(([column, value]) =>
      column === 'status' && value === (nextStatus === 'in_review' ? 'draft' : 'in_review')))
  }
})

Deno.test('all caller denials occur before resolver, admin, storage, or provider stages', async () => {
  const cases: Array<{ rows: ReturnType<typeof fixtures>; body: Json }> = []
  cases.push({
    rows: fixtures(),
    body: {
      action: 'generate', organization_id: 'org-2', design_direction_version_id: 'version-1',
      model_registry_id: 'model-1', slug: 'home',
    },
  })
  const revoked = fixtures()
  ;(revoked.organization_memberships[0] as Json).status = 'revoked'
  cases.push({
    rows: revoked,
    body: {
      action: 'generate', design_direction_version_id: 'version-1',
      model_registry_id: 'model-1', slug: 'home',
    },
  })
  cases.push({
    rows: fixtures(),
    body: {
      action: 'generate', design_direction_version_id: 'version-1',
      model_registry_id: 'model-2', slug: 'home',
    },
  })
  cases.push({
    rows: fixtures(),
    body: { action: 'approve', website_page_design_id: 'page-draft' },
  })

  for (const testCase of cases) {
    let resolverCalls = 0
    const result = await handler(new Request('http://local/website-page-designs', {
      method: 'POST',
      headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(testCase.body),
    }), {
      createCallerIdentity: async () => ({
        userClient: new FixtureClient(testCase.rows) as never,
        userId: 'user-1',
      }),
      resolveContext: async () => {
        resolverCalls += 1
        throw new Error('Resolver must not be called')
      },
    })
    assert(result.status >= 400)
    assert.equal(resolverCalls, 0)
  }

  let callerCalls = 0
  for (const body of [[], { action: 'unknown' }, { action: 'generate' }]) {
    const result = await handler(new Request('http://local/website-page-designs', {
      method: 'POST',
      headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), {
      createCallerIdentity: async () => {
        callerCalls += 1
        return { userClient: new FixtureClient(fixtures()) as never, userId: 'user-1' }
      },
    })
    assert.equal(result.status, 400)
  }
  assert.equal(callerCalls, 0)
})
