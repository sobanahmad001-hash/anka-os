import {
  assertExportStoragePath,
  handler,
  hasWordPressExportAuthority,
  preflightWordPressExportRequest,
  wordpressExportScope,
} from './index.ts'
import { buildWordPressTheme, createStoredZip, referencedMediaPaths, wordpressSlug } from './theme.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

assert.equal = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

assert.rejects = async (callback: () => Promise<unknown>) => {
  try { await callback() } catch { return }
  throw new Error('Expected promise to reject')
}

const html = '<!doctype html><html><head><title>Raahbaan Homes</title><meta name="description" content="Trusted homes"></head><body><main><h1>Find a home</h1><h2>Featured</h2><img src="https://project.supabase.co/storage/v1/object/sign/design-generated-media/org/version/hero.png?token=temporary" alt="Raahbaan property adviser"></main></body></html>'

Deno.test('native exporter builds the minimum valid classic theme without a paid provider', async () => {
  const theme = await buildWordPressTheme('Home', html, 'body { color: #111; }', [{
    storagePath: 'org/version/hero.png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]),
  }])
  const archive = new TextDecoder().decode(theme.bytes)
  for (const filename of ['style.css', 'index.php', 'header.php', 'footer.php', 'functions.php', 'readme.txt', 'assets/media-01.png']) {
    assert(archive.includes(`anka-home/${filename}`), `${filename} missing from theme ZIP`)
  }
  assert(archive.includes('get_template_directory_uri'))
  assert(!archive.includes('token=temporary'))
  assert.equal(theme.seoVerification.all_checks_passed, true)
  assert.equal(theme.sha256.length, 64)
})

Deno.test('SEO preservation blocks export when an image has no alternative text', async () => {
  await assert.rejects(() => buildWordPressTheme('home', html.replace(' alt="Raahbaan property adviser"', ''), 'body{}', [{
    storagePath: 'org/version/hero.png', contentType: 'image/png', bytes: new Uint8Array([1]),
  }]))
})

Deno.test('private signed images must be bundled instead of exported with expiring links', async () => {
  assert.equal(referencedMediaPaths(html)[0], 'org/version/hero.png')
  await assert.rejects(() => buildWordPressTheme('home', html, 'body{}'))
})

Deno.test('theme naming and ZIP output are deterministic for controlled inputs', async () => {
  assert.equal(wordpressSlug('/Luxury Homes/'), 'luxury-homes')
  const first = createStoredZip([{ name: 'theme/index.php', bytes: new TextEncoder().encode('hello') }])
  const second = createStoredZip([{ name: 'theme/index.php', bytes: new TextEncoder().encode('hello') }])
  assert.equal([...first].join(','), [...second].join(','))
})

Deno.test('Design contributors and accountable leaders can export, other departments cannot', () => {
  assert.equal(hasWordPressExportAuthority({ member_kind: 'team', role: 'contributor', department_id: 'design' }), true)
  assert.equal(hasWordPressExportAuthority({ member_kind: 'team', role: 'department_manager', department_id: 'design' }), true)
  assert.equal(hasWordPressExportAuthority({ member_kind: 'team', role: 'executive', department_id: 'operations' }), true)
  assert.equal(hasWordPressExportAuthority({ member_kind: 'team', role: 'contributor', department_id: 'marketing' }), false)
  assert.equal(hasWordPressExportAuthority({ member_kind: 'client', role: 'executive', department_id: 'design' }), false)
})

type Json = Record<string, unknown>

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
    const row = this.rows.find(candidate => this.filters.every(([column, value]) => Object.is(nested(candidate, column), value)))
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
    website_page_designs: [{
      id: 'design-1', organization_id: 'org-1', design_direction_version_id: 'version-1',
      slug: 'home', html_content: html, css_content: 'body{}', status: 'approved',
    }],
    design_direction_versions: [{ id: 'version-1', organization_id: 'org-1', direction_id: 'direction-1' }],
    design_directions: [{ id: 'direction-1', organization_id: 'org-1', session_id: 'session-1' }],
    design_workshop_sessions: [{
      id: 'session-1', organization_id: 'org-1', engagement_id: 'engagement-1', brand_id: 'brand-1',
    }],
    engagements: [{ id: 'engagement-1', organization_id: 'org-1', brand_id: 'brand-1' }],
    wordpress_export_jobs: [{
      id: 'job-1', organization_id: 'org-1', website_page_design_id: 'design-1', status: 'complete',
      storage_path: 'org-1/design-1/job-1/anka-home.zip',
    }],
    organization_memberships: [{
      organization_id: 'org-1', user_id: 'user-1', role: 'contributor', department_id: 'design',
      status: 'active', member_kind: 'team', organization: { id: 'org-1', status: 'active' },
    }],
  }
}

async function assertRejectsMessage(callback: () => Promise<unknown>, expected: string) {
  try { await callback() } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), `Expected error containing ${expected}`)
    return
  }
  throw new Error('Expected promise to reject')
}

Deno.test('export and download actions map caller-readable sources to the canonical engagement root', async () => {
  const client = new FixtureClient(fixtures())
  const create = await wordpressExportScope(client as never, {
    action: 'export', website_page_design_id: 'design-1', organization_id: 'org-1',
  })
  assert.equal(create.scope.root?.kind, 'engagement')
  assert.equal(create.scope.root?.id, 'engagement-1')
  assert.equal(create.directionVersionId, 'version-1')

  const download = await wordpressExportScope(client as never, {
    action: 'get_download', wordpress_export_job_id: 'job-1',
  })
  assert.equal(download.organizationId, 'org-1')
  assert.equal(download.job?.id, 'job-1')
})

Deno.test('positive preflight requires an active team membership in the derived organization', async () => {
  for (const body of [
    { action: 'export', website_page_design_id: 'design-1' },
    { action: 'get_download', wordpress_export_job_id: 'job-1' },
  ]) {
    const result = await preflightWordPressExportRequest(new FixtureClient(fixtures()) as never, 'user-1', body)
    assert.equal(result.organizationId, 'org-1')
    assert.equal(result.engagementId, 'engagement-1')
  }
})

Deno.test('requested organization, source status, and canonical-chain mismatches fail before membership access', async () => {
  const mismatch = new FixtureClient(fixtures())
  await assertRejectsMessage(() => preflightWordPressExportRequest(mismatch as never, 'user-1', {
    action: 'export', website_page_design_id: 'design-1', organization_id: 'org-2',
  }), 'Requested organization')
  assert.equal(mismatch.reads.includes('organization_memberships'), false)

  const draftRows = fixtures()
  draftRows.website_page_designs[0].status = 'draft'
  const draft = new FixtureClient(draftRows)
  await assertRejectsMessage(() => preflightWordPressExportRequest(draft as never, 'user-1', {
    action: 'export', website_page_design_id: 'design-1',
  }), 'Only an approved')
  assert.equal(draft.reads.includes('organization_memberships'), false)

  const chainRows = fixtures()
  chainRows.design_directions[0].organization_id = 'org-2'
  const chain = new FixtureClient(chainRows)
  await assertRejectsMessage(() => preflightWordPressExportRequest(chain as never, 'user-1', {
    action: 'export', website_page_design_id: 'design-1',
  }), 'invalid organization chain')
  assert.equal(chain.reads.includes('organization_memberships'), false)
})

Deno.test('inactive, revoked, client, and inactive-organization memberships fail closed', async () => {
  for (const variant of ['inactive', 'revoked', 'client', 'organization']) {
    const rows = structuredClone(fixtures())
    const membership = rows.organization_memberships[0] as Json
    if (variant === 'inactive' || variant === 'revoked') membership.status = variant
    if (variant === 'client') membership.member_kind = 'client'
    if (variant === 'organization') (membership.organization as Json).status = 'suspended'
    await assertRejectsMessage(() => preflightWordPressExportRequest(
      new FixtureClient(rows) as never, 'user-1', { action: 'export', website_page_design_id: 'design-1' },
    ), 'Active team membership')
  }
})

Deno.test('download requires exact complete job composition and a canonical private ZIP path', async () => {
  assert.equal(assertExportStoragePath(
    'org-1/design-1/job-1/anka-home.zip', 'org-1', 'design-1', 'job-1',
  ), 'org-1/design-1/job-1/anka-home.zip')
  for (const path of [
    'org-2/design-1/job-1/anka-home.zip',
    'org-1/design-2/job-1/anka-home.zip',
    'org-1/design-1/job-1/../secret.zip',
    'org-1/design-1/job-1/not-a-zip.txt',
  ]) {
    let rejected = false
    try { assertExportStoragePath(path, 'org-1', 'design-1', 'job-1') } catch { rejected = true }
    assert.equal(rejected, true)
  }

  const rows = fixtures()
  rows.wordpress_export_jobs[0].organization_id = 'org-2'
  await assertRejectsMessage(() => wordpressExportScope(new FixtureClient(rows) as never, {
    action: 'get_download', wordpress_export_job_id: 'job-1',
  }), 'invalid organization chain')
})

Deno.test('all caller denials occur before resolver, admin, storage, or provider stages', async () => {
  const cases: Array<{ rows: ReturnType<typeof fixtures>; body: Json }> = []
  cases.push({ rows: fixtures(), body: { action: 'export', website_page_design_id: 'design-1', organization_id: 'org-2' } })
  const revoked = fixtures()
  ;(revoked.organization_memberships[0] as Json).status = 'revoked'
  cases.push({ rows: revoked, body: { action: 'export', website_page_design_id: 'design-1' } })
  const draft = fixtures()
  draft.website_page_designs[0].status = 'draft'
  cases.push({ rows: draft, body: { action: 'export', website_page_design_id: 'design-1' } })
  const badPath = fixtures()
  badPath.wordpress_export_jobs[0].storage_path = 'org-2/design-1/job-1/anka-home.zip'
  cases.push({ rows: badPath, body: { action: 'get_download', wordpress_export_job_id: 'job-1' } })

  for (const testCase of cases) {
    let resolverCalls = 0
    const result = await handler(new Request('http://local/wordpress-export', {
      method: 'POST', headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(testCase.body),
    }), {
      createCallerIdentity: async () => ({ userClient: new FixtureClient(testCase.rows) as never, userId: 'user-1' }),
      resolveContext: async () => { resolverCalls += 1; throw new Error('Resolver must not be called') },
    })
    assert(result.status >= 400)
    assert.equal(resolverCalls, 0)
  }

  let callerCalls = 0
  for (const body of [[], { action: 'unknown' }, { action: 'export' }, { action: 'get_download' }]) {
    const result = await handler(new Request('http://local/wordpress-export', {
      method: 'POST', headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), { createCallerIdentity: async () => {
      callerCalls += 1
      return { userClient: new FixtureClient(fixtures()) as never, userId: 'user-1' }
    } })
    assert.equal(result.status, 400)
  }
  assert.equal(callerCalls, 0)
})
