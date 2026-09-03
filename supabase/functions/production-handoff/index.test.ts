import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import {
  assertHandoffStoragePath,
  buildProductionArchive,
  handler,
  handoffStoragePath,
  hasProductionHandoffAuthority,
  preflightProductionHandoffRequest,
  productionHandoffScope,
  validateHandoffRows,
  validateReleasedSource,
} from './index.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

assert.equal = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

assert.rejects = async (callback: () => Promise<unknown>, pattern: RegExp) => {
  try {
    await callback()
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw error
  }
  throw new Error('Expected promise to reject')
}

assert.throws = (callback: () => unknown, pattern: RegExp) => {
  try {
    callback()
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw error
  }
  throw new Error('Expected callback to throw')
}

const release = {
  id: 'release-1',
  organization_id: 'org-1',
  engagement_id: 'engagement-1',
  session_id: 'session-1',
  direction_version_id: 'version-1',
  release_notes: 'Approved for production',
  released_by: 'user-1',
  released_at: '2026-09-01T00:00:00Z',
}
const version = {
  id: 'version-1',
  organization_id: 'org-1',
  direction_id: 'direction-1',
  version_number: 3,
  content_checksum: 'abc123',
  content: { title: 'Released concept', palette: [{ name: 'Ink', hex: '#111827' }] },
}
const direction = {
  id: 'direction-1',
  organization_id: 'org-1',
  session_id: 'session-1',
}
const session = {
  id: 'session-1',
  organization_id: 'org-1',
  engagement_id: 'engagement-1',
}

Deno.test('DS6 rejects a non-release and cross-engagement source directly', () => {
  assert.throws(
    () => validateReleasedSource(null, 'engagement-1', null, null, null),
    /already-released direction/,
  )
  assert.throws(
    () => validateReleasedSource(release, 'other-engagement', version, direction, session),
    /requested engagement/,
  )
  assert.equal(
    validateReleasedSource(release, 'engagement-1', version, direction, session).version.id,
    'version-1',
  )
})

Deno.test('DS6 archive contains exact release content, images, and DS2 variants', async () => {
  const archive = await buildProductionArchive({
    packageId: 'package-1',
    release,
    version,
    createdAt: '2026-09-01T01:00:00Z',
    assets: [
      {
        id: 'asset-base', media_type: 'image', status: 'ready',
        storage_path: 'org/version/asset-base.png', prompt: 'Hero',
      },
      {
        id: 'asset-variant', media_type: 'image', status: 'ready',
        storage_path: 'org/version/asset-variant.png', prompt: 'Square',
      },
      {
        id: 'asset-video', media_type: 'video', status: 'unavailable',
        storage_path: null, prompt: 'Motion', failure_reason: 'Provider unavailable',
      },
    ],
    variants: [{
      id: 'variant-1', variant_format: 'square_1x1', status: 'ready',
      design_media_asset_id: 'asset-variant',
    }],
  }, async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]))
  const files = unzipSync(archive.bytes)
  assert(files['manifest.json'])
  assert(files['direction/release.json'])
  assert(files['direction/direction-version.json'])
  assert(files['assets/asset-base.png'])
  assert(files['variants/square_1x1-asset-variant.png'])
  const directionContent = JSON.parse(strFromU8(files['direction/direction-version.json']))
  assert.equal(directionContent.content.title, 'Released concept')
  assert.equal(archive.includedAssetIds.length, 2)
  assert.equal(archive.manifest.variants[0].variant_format, 'square_1x1')
})

Deno.test('DS6 fails honestly when a required source object is missing', async () => {
  await assert.rejects(() => buildProductionArchive({
    packageId: 'package-2',
    release,
    version,
    createdAt: '2026-09-01T01:00:00Z',
    assets: [{
      id: 'asset-missing', media_type: 'image', status: 'ready',
      storage_path: 'org/version/missing.png',
    }],
    variants: [],
  }, async () => {
    throw new Error('Required source object is unavailable')
  }), /Required source object is unavailable/)
})

Deno.test('DS6 rejects a non-empty corrupt image before upload', async () => {
  await assert.rejects(() => buildProductionArchive({
    packageId: 'package-3',
    release,
    version,
    createdAt: '2026-09-01T01:00:00Z',
    assets: [{
      id: 'asset-corrupt', media_type: 'image', status: 'ready',
      storage_path: 'org/version/corrupt.png',
    }],
    variants: [],
  }, async () => new TextEncoder().encode('not a PNG')), /not a valid PNG object/)
})

Deno.test('DS6 package paths are release-scoped private ZIP objects', () => {
  assert.equal(
    handoffStoragePath('org-1', 'release-1', 'package-1'),
    'org-1/release-1/handoffs/package-1.zip',
  )
})

Deno.test('Gate 0 excludes content-request media and rejects cross-source asset rows', () => {
  const base = {
    id: 'asset-1', organization_id: 'org-1', design_direction_version_id: 'version-1',
    content_request_id: null, media_type: 'image', status: 'ready',
    storage_path: 'org-1/version-1/asset-1.png',
  }
  validateHandoffRows('org-1', 'version-1', [base], [])
  assert.throws(() => validateHandoffRows('org-1', 'version-1', [{
    ...base, content_request_id: 'request-1',
  }], []), /invalid organization or source chain/)
  assert.throws(() => validateHandoffRows('org-1', 'version-1', [{
    ...base, storage_path: 'org-2/version-1/asset-1.png',
  }], []), /invalid organization or source chain/)
})

Deno.test('the approved 32 MiB source cap rejects an oversized package before ZIP creation', async () => {
  const oversized = new Uint8Array((32 * 1024 * 1024) + 1)
  oversized.set([137, 80, 78, 71, 13, 10, 26, 10])
  await assert.rejects(() => buildProductionArchive({
    packageId: 'package-large', release, version, createdAt: '2026-09-01T01:00:00Z',
    assets: [{
      id: 'asset-large', media_type: 'image', status: 'ready',
      storage_path: 'org/version/asset-large.png',
    }],
    variants: [],
  }, async () => oversized), /sources exceed the 32 MiB package limit/)
})

type FixtureJson = Record<string, unknown>

function nested(row: FixtureJson, path: string) {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    const selected = Array.isArray(value) ? value[0] : value
    return (selected as FixtureJson)[key]
  }, row)
}

class Query {
  private filters: Array<[string, unknown]> = []
  constructor(private rows: FixtureJson[]) {}
  select() { return this }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this }
  async maybeSingle() {
    const row = this.rows.find(candidate => this.filters.every(([column, value]) => Object.is(nested(candidate, column), value)))
    return { data: row || null, error: null }
  }
}

class FixtureClient {
  readonly reads: string[] = []
  constructor(readonly fixtures: Record<string, FixtureJson[]>) {}
  from(table: string) { this.reads.push(table); return new Query(this.fixtures[table] || []) }
}

function fixtures() {
  return {
    design_direction_releases: [{ ...release }],
    design_direction_versions: [{ ...version }],
    design_directions: [{ ...direction }],
    design_workshop_sessions: [{ ...session, brand_id: 'brand-1' }],
    engagements: [{ id: 'engagement-1', organization_id: 'org-1', brand_id: 'brand-1' }],
    production_handoff_packages: [{
      id: 'package-1', organization_id: 'org-1', design_direction_release_id: 'release-1',
      status: 'ready', package_storage_path: 'org-1/release-1/handoffs/package-1.zip',
    }],
    organization_memberships: [{
      organization_id: 'org-1', user_id: 'user-1', role: 'contributor', department_id: 'design',
      status: 'active', member_kind: 'team', organization: { id: 'org-1', status: 'active' },
    }],
  }
}

Deno.test('both handoff actions map caller-readable exact sources to the canonical engagement root', async () => {
  const client = new FixtureClient(fixtures())
  const create = await productionHandoffScope(client as never, {
    action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1',
    organization_id: 'org-1',
  })
  assert.equal(create.scope.root?.kind, 'engagement')
  assert.equal(create.scope.root?.id, 'engagement-1')
  assert.equal(create.version.id, 'version-1')

  const sign = await productionHandoffScope(client as never, {
    action: 'sign_package', package_id: 'package-1',
  })
  assert.equal(sign.organizationId, 'org-1')
  assert.equal(sign.packageRow?.id, 'package-1')
})

Deno.test('active team authority is required in the source-derived organization', async () => {
  assert.equal(hasProductionHandoffAuthority({ member_kind: 'team' }), true)
  assert.equal(hasProductionHandoffAuthority({ member_kind: 'client' }), false)
  for (const body of [
    { action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1' },
    { action: 'sign_package', package_id: 'package-1' },
  ]) {
    const result = await preflightProductionHandoffRequest(new FixtureClient(fixtures()) as never, 'user-1', body)
    assert.equal(result.organizationId, 'org-1')
  }
})

Deno.test('requested organization and same-shaped cross-tenant chains fail before membership access', async () => {
  const mismatch = new FixtureClient(fixtures())
  await assert.rejects(() => preflightProductionHandoffRequest(mismatch as never, 'user-1', {
    action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1',
    organization_id: 'org-2',
  }), /Requested organization/)
  assert.equal(mismatch.reads.includes('organization_memberships'), false)

  const rows = fixtures()
  rows.design_directions[0].organization_id = 'org-2'
  const chain = new FixtureClient(rows)
  await assert.rejects(() => productionHandoffScope(chain as never, {
    action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1',
  }), /Recorded Workshop session|organization chain|outside its recorded Workshop session/i)
  assert.equal(chain.reads.includes('organization_memberships'), false)
})

Deno.test('inactive, revoked, client, and inactive-organization memberships fail closed', async () => {
  for (const variant of ['inactive', 'revoked', 'client', 'organization']) {
    const rows = structuredClone(fixtures())
    const membership = rows.organization_memberships[0] as FixtureJson
    if (variant === 'inactive' || variant === 'revoked') membership.status = variant
    if (variant === 'client') membership.member_kind = 'client'
    if (variant === 'organization') (membership.organization as FixtureJson).status = 'suspended'
    await assert.rejects(() => preflightProductionHandoffRequest(
      new FixtureClient(rows) as never, 'user-1', {
        action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1',
      },
    ), /Active team membership/)
  }
})

Deno.test('signing requires exact package/release identity and canonical private ZIP path', async () => {
  assert.equal(assertHandoffStoragePath(
    'org-1/release-1/handoffs/package-1.zip', 'org-1', 'release-1', 'package-1',
  ), 'org-1/release-1/handoffs/package-1.zip')
  assert.throws(() => assertHandoffStoragePath(
    'org-2/release-1/handoffs/package-1.zip', 'org-1', 'release-1', 'package-1',
  ), /invalid private storage path/)
  const rows = fixtures()
  rows.production_handoff_packages[0].design_direction_release_id = 'foreign-release'
  await assert.rejects(() => productionHandoffScope(new FixtureClient(rows) as never, {
    action: 'sign_package', package_id: 'package-1',
  }), /already-released direction/)
})

Deno.test('all caller denials occur before resolver, admin, storage, or archive stages', async () => {
  const cases: Array<{ rows: ReturnType<typeof fixtures>; body: FixtureJson }> = []
  cases.push({ rows: fixtures(), body: {
    action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1',
    organization_id: 'org-2',
  } })
  const revoked = fixtures()
  ;(revoked.organization_memberships[0] as FixtureJson).status = 'revoked'
  cases.push({ rows: revoked, body: {
    action: 'create_package', design_direction_release_id: 'release-1', engagement_id: 'engagement-1',
  } })
  const badPath = fixtures()
  badPath.production_handoff_packages[0].package_storage_path = 'org-2/release-1/handoffs/package-1.zip'
  cases.push({ rows: badPath, body: { action: 'sign_package', package_id: 'package-1' } })

  for (const testCase of cases) {
    let resolverCalls = 0
    const result = await handler(new Request('http://local/production-handoff', {
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
  for (const body of [[], { action: 'unknown' }, { action: 'create_package' }, { action: 'sign_package' }]) {
    const result = await handler(new Request('http://local/production-handoff', {
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
