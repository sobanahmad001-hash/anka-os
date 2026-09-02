import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import {
  buildProductionArchive,
  handoffStoragePath,
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
