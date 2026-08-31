import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { strToU8, zipSync } from 'npm:fflate@0.8.2'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, any>
type Asset = {
  id: string
  media_type: string
  status: string
  storage_path: string | null
  prompt?: string
  provider?: string | null
  failure_reason?: string
}
type Variant = {
  id: string
  variant_format: string
  status: string
  design_media_asset_id: string | null
}

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const MEDIA_BUCKET = 'design-generated-media'
const SIGNED_URL_TTL_SECONDS = 300
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function jsonFile(value: unknown) {
  return strToU8(JSON.stringify(value, null, 2))
}

function extension(storagePath: string) {
  const match = storagePath.match(/\.[a-z0-9]{1,8}$/i)
  return match?.[0]?.toLowerCase() || '.bin'
}

function isPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  return bytes.byteLength >= signature.length
    && signature.every((value, index) => bytes[index] === value)
}

export function handoffStoragePath(organizationId: string, releaseId: string, packageId: string) {
  return `${organizationId}/${releaseId}/handoffs/${packageId}.zip`
}

export function validateReleasedSource(
  release: Json | null,
  requestedEngagementId: string,
  version: Json | null,
  direction: Json | null,
  session: Json | null,
) {
  if (!release) throw new Error('Production handoff requires an already-released direction')
  if (!requestedEngagementId || release.engagement_id !== requestedEngagementId) {
    throw new Error('Released direction does not belong to the requested engagement')
  }
  if (!version || version.id !== release.direction_version_id
    || version.organization_id !== release.organization_id) {
    throw new Error('Released direction version is unavailable')
  }
  if (!direction || direction.id !== version.direction_id
    || direction.session_id !== release.session_id
    || direction.organization_id !== release.organization_id) {
    throw new Error('Released direction is outside its recorded Workshop session')
  }
  if (!session || session.id !== release.session_id
    || session.engagement_id !== release.engagement_id
    || session.organization_id !== release.organization_id) {
    throw new Error('Released direction session does not match its engagement and organization')
  }
  return { release, version, direction, session }
}

export async function buildProductionArchive(
  input: {
    packageId: string
    release: Json
    version: Json
    assets: Asset[]
    variants: Variant[]
    createdAt: string
  },
  download: (storagePath: string) => Promise<Uint8Array>,
) {
  const files: Record<string, Uint8Array> = {}
  const variantByAsset = new Map<string, Variant>()
  for (const variant of input.variants) {
    if (variant.status !== 'ready' || !variant.design_media_asset_id) {
      throw new Error(`Variant ${variant.variant_format} is not ready for production handoff`)
    }
    variantByAsset.set(variant.design_media_asset_id, variant)
  }

  const includedAssetIds: string[] = []
  const assetManifest = []
  let sourceBytes = 0
  for (const asset of input.assets) {
    const variant = variantByAsset.get(asset.id)
    if (asset.media_type === 'video' && asset.status === 'unavailable') {
      assetManifest.push({
        id: asset.id, media_type: asset.media_type, status: asset.status,
        prompt: asset.prompt || '', failure_reason: asset.failure_reason || '',
        archive_path: null,
      })
      continue
    }
    if (asset.status !== 'ready' || !asset.storage_path) {
      throw new Error(`Asset ${asset.id} is not ready for production handoff`)
    }
    const bytes = await download(asset.storage_path)
    if (!bytes.byteLength) throw new Error(`Source asset ${asset.id} is empty or corrupt`)
    if (asset.media_type === 'image' && !isPng(bytes)) {
      throw new Error(`Source asset ${asset.id} is not a valid PNG object`)
    }
    sourceBytes += bytes.byteLength
    if (sourceBytes > MAX_PACKAGE_BYTES) throw new Error('Production handoff sources exceed the 50 MB package limit')
    const archivePath = variant
      ? `variants/${variant.variant_format}-${asset.id}${extension(asset.storage_path)}`
      : `assets/${asset.id}${extension(asset.storage_path)}`
    files[archivePath] = bytes
    includedAssetIds.push(asset.id)
    assetManifest.push({
      id: asset.id, media_type: asset.media_type, status: asset.status,
      prompt: asset.prompt || '', provider: asset.provider || null,
      archive_path: archivePath,
    })
  }

  for (const variant of input.variants) {
    if (!input.assets.some(asset => asset.id === variant.design_media_asset_id)) {
      throw new Error(`Variant ${variant.variant_format} references a missing source asset`)
    }
  }

  const manifest = {
    schema_version: 1,
    package_id: input.packageId,
    created_at: input.createdAt,
    release: {
      id: input.release.id,
      organization_id: input.release.organization_id,
      engagement_id: input.release.engagement_id,
      session_id: input.release.session_id,
      direction_version_id: input.release.direction_version_id,
      released_by: input.release.released_by,
      released_at: input.release.released_at,
    },
    direction_version: {
      id: input.version.id,
      version_number: input.version.version_number,
      content_checksum: input.version.content_checksum,
    },
    assets: assetManifest,
    variants: input.variants.map(variant => ({
      id: variant.id,
      variant_format: variant.variant_format,
      status: variant.status,
      design_media_asset_id: variant.design_media_asset_id,
    })),
    included_asset_ids: includedAssetIds,
  }
  files['manifest.json'] = jsonFile(manifest)
  files['direction/release.json'] = jsonFile({
    id: input.release.id,
    release_notes: input.release.release_notes,
    released_by: input.release.released_by,
    released_at: input.release.released_at,
  })
  files['direction/direction-version.json'] = jsonFile({
    id: input.version.id,
    version_number: input.version.version_number,
    content_checksum: input.version.content_checksum,
    content: input.version.content,
  })
  return {
    bytes: zipSync(files, { level: 0 }),
    includedAssetIds,
    manifest,
  }
}

async function requireUser(req: Request, url: string, anonKey: string, admin: Client) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required')
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  const { data: membership, error: membershipError } = await admin
    .from('organization_memberships')
    .select('organization_id')
    .eq('organization_id', ORGANIZATION_ID)
    .eq('user_id', user.id)
    .eq('member_kind', 'team')
    .eq('status', 'active')
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!membership) throw new Error('Active team membership required')
  return { user, userClient }
}

async function loadReleasedSource(userClient: Client, releaseId: string, engagementId: string) {
  const { data: release, error: releaseError } = await userClient
    .from('design_direction_releases')
    .select('*')
    .eq('id', releaseId)
    .eq('organization_id', ORGANIZATION_ID)
    .maybeSingle()
  if (releaseError) throw releaseError
  const { data: version, error: versionError } = release
    ? await userClient.from('design_direction_versions').select('*')
      .eq('id', release.direction_version_id)
      .eq('organization_id', ORGANIZATION_ID)
      .maybeSingle()
    : { data: null, error: null }
  if (versionError) throw versionError
  const { data: direction, error: directionError } = version
    ? await userClient.from('design_directions').select('*')
      .eq('id', version.direction_id)
      .eq('organization_id', ORGANIZATION_ID)
      .maybeSingle()
    : { data: null, error: null }
  if (directionError) throw directionError
  const { data: session, error: sessionError } = release
    ? await userClient.from('design_workshop_sessions').select('*')
      .eq('id', release.session_id)
      .eq('organization_id', ORGANIZATION_ID)
      .maybeSingle()
    : { data: null, error: null }
  if (sessionError) throw sessionError
  return validateReleasedSource(release, engagementId, version, direction, session)
}

async function createPackage(admin: Client, userClient: Client, body: Json, actorId: string) {
  const releaseId = text(body.design_direction_release_id, 80)
  const engagementId = text(body.engagement_id, 80)
  const source = await loadReleasedSource(userClient, releaseId, engagementId)
  const [{ data: assets, error: assetError }, { data: variants, error: variantError }] = await Promise.all([
    userClient.from('design_media_assets').select(
      'id, media_type, status, storage_path, prompt, provider, failure_reason',
    ).eq('organization_id', ORGANIZATION_ID)
      .eq('design_direction_version_id', source.version.id)
      .order('created_at'),
    userClient.from('design_direction_variants').select(
      'id, variant_format, status, design_media_asset_id',
    ).eq('organization_id', ORGANIZATION_ID)
      .eq('source_direction_version_id', source.version.id)
      .order('created_at'),
  ])
  if (assetError) throw assetError
  if (variantError) throw variantError

  const createdAt = new Date().toISOString()
  const { data: packageRow, error: packageError } = await admin
    .from('production_handoff_packages')
    .insert({
      organization_id: ORGANIZATION_ID,
      design_direction_release_id: source.release.id,
      requested_by: actorId,
      created_at: createdAt,
    })
    .select('*')
    .single()
  if (packageError) throw packageError

  const storagePath = handoffStoragePath(ORGANIZATION_ID, source.release.id, packageRow.id)
  let uploaded = false
  try {
    const archive = await buildProductionArchive({
      packageId: packageRow.id,
      release: source.release,
      version: source.version,
      assets: (assets || []) as Asset[],
      variants: (variants || []) as Variant[],
      createdAt,
    }, async path => {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(path)
      if (error || !data) throw new Error(`Required source object is unavailable: ${path}`)
      return new Uint8Array(await data.arrayBuffer())
    })
    if (archive.bytes.byteLength > MAX_PACKAGE_BYTES) {
      throw new Error('Production handoff ZIP exceeds the 50 MB package limit')
    }
    const { error: uploadError } = await admin.storage.from(MEDIA_BUCKET).upload(
      storagePath,
      archive.bytes,
      { contentType: 'application/zip', upsert: false },
    )
    if (uploadError) throw uploadError
    uploaded = true
    const { data: ready, error: readyError } = await admin
      .from('production_handoff_packages')
      .update({
        status: 'ready',
        included_asset_ids: archive.includedAssetIds,
        package_storage_path: storagePath,
        completed_at: new Date().toISOString(),
      })
      .eq('id', packageRow.id)
      .eq('organization_id', ORGANIZATION_ID)
      .select('*')
      .single()
    if (readyError) {
      const { data: persisted } = await admin.from('production_handoff_packages')
        .select('*').eq('id', packageRow.id).maybeSingle()
      if (persisted?.status === 'ready') return persisted
      throw readyError
    }
    return ready
  } catch (error) {
    if (uploaded) await admin.storage.from(MEDIA_BUCKET).remove([storagePath])
    const reason = text(error instanceof Error ? error.message : 'Production handoff failed', 2000)
      || 'Production handoff failed'
    const { error: failedError } = await admin
      .from('production_handoff_packages')
      .update({
        status: 'failed',
        failure_reason: reason,
        package_storage_path: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', packageRow.id)
      .eq('organization_id', ORGANIZATION_ID)
    if (failedError) {
      throw new Error(`Production handoff failed and its status could not be recorded: ${failedError.message}`)
    }
    throw new Error(reason)
  }
}

async function signPackage(admin: Client, userClient: Client, body: Json) {
  const packageId = text(body.package_id, 80)
  const { data: packageRow, error } = await userClient
    .from('production_handoff_packages')
    .select('id, status, package_storage_path')
    .eq('id', packageId)
    .eq('status', 'ready')
    .maybeSingle()
  if (error) throw error
  if (!packageRow?.package_storage_path) {
    throw new Error('Ready production handoff package not found or not visible')
  }
  const { data: signed, error: signedError } = await admin.storage.from(MEDIA_BUCKET)
    .createSignedUrl(packageRow.package_storage_path, SIGNED_URL_TTL_SECONDS)
  if (signedError || !signed?.signedUrl) {
    throw signedError || new Error('Production handoff download could not be signed')
  }
  return {
    package_id: packageRow.id,
    signed_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  }
}

async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase function configuration is incomplete')
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { user, userClient } = await requireUser(req, url, anonKey, admin)
    const body = await req.json() as Json
    const action = text(body.action, 80)
    if (action === 'create_package') {
      return response({ data: await createPackage(admin, userClient, body, user.id) })
    }
    if (action === 'sign_package') {
      return response({ data: await signPackage(admin, userClient, body) })
    }
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    console.error('Production handoff failure', error)
    return response({
      error: error instanceof Error ? error.message : 'Production handoff failed',
    }, 400)
  }
}

if (import.meta.main) Deno.serve(handler)

export { handler }
