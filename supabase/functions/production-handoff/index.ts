import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { strToU8, zipSync } from 'npm:fflate@0.8.2'
import {
  resolveServerOrganizationContext,
  type ServerOrganizationScope,
} from '../_shared/serverOrganizationContext.ts'

type Client = ReturnType<typeof createClient<any>>
type ScopedClient = Client & { organizationId: string }
type Json = Record<string, any>
type Asset = {
  id: string
  organization_id?: string
  design_direction_version_id?: string
  content_request_id?: string | null
  media_type: string
  status: string
  storage_path: string | null
  prompt?: string
  provider?: string | null
  failure_reason?: string
}
type Variant = {
  id: string
  organization_id?: string
  source_direction_version_id?: string
  variant_format: string
  status: string
  design_media_asset_id: string | null
}

const MEDIA_BUCKET = 'design-generated-media'
const SIGNED_URL_TTL_SECONDS = 300
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024
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

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status })
}

function requiredId(value: unknown, label: string) {
  const id = text(value, 80)
  if (!id) throw httpError(`${label} is required`, 400)
  return id
}

export function hasProductionHandoffAuthority(membership: Json) {
  return membership.member_kind === 'team'
}

type HandoffRoot = {
  organizationId: string
  engagementId: string
  brandId: string
  release: Json
  version: Json
  direction: Json
  session: Json
  packageRow?: Json
}

type HandoffPreflight = HandoffRoot & {
  action: 'create_package' | 'sign_package'
  membership: Json
  scope: ServerOrganizationScope
}

type CallerIdentity = { userClient: Client; userId: string }

function publicApiKey() {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')?.split(',').map(value => value.trim()).find(Boolean)
    || Deno.env.get('SUPABASE_ANON_KEY') || ''
}

async function callerIdentity(req: Request): Promise<CallerIdentity> {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) {
    throw httpError('Authentication required', 401)
  }
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = publicApiKey()
  if (!url || !key) throw new Error('Supabase function configuration is incomplete')
  const userClient = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw httpError('Authentication required', 401)
  return { userClient, userId: user.id }
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
    if (sourceBytes > MAX_PACKAGE_BYTES) throw new Error('Production handoff sources exceed the 32 MiB package limit')
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

async function callerReleasedSource(userClient: Client, releaseId: string, requestedEngagementId = ''): Promise<HandoffRoot> {
  const { data: release, error: releaseError } = await userClient
    .from('design_direction_releases')
    .select('*')
    .eq('id', releaseId)
    .maybeSingle()
  if (releaseError || !release) throw httpError('Production handoff requires an already-released direction', 404)
  const { data: version, error: versionError } = release
    ? await userClient.from('design_direction_versions').select('*')
      .eq('id', release.direction_version_id)
      .maybeSingle()
    : { data: null, error: null }
  if (versionError) throw versionError
  const { data: direction, error: directionError } = version
    ? await userClient.from('design_directions').select('*')
      .eq('id', version.direction_id)
      .maybeSingle()
    : { data: null, error: null }
  if (directionError) throw directionError
  const { data: session, error: sessionError } = release
    ? await userClient.from('design_workshop_sessions').select('*')
      .eq('id', release.session_id)
      .maybeSingle()
    : { data: null, error: null }
  if (sessionError) throw sessionError
  const engagementId = requestedEngagementId || String(release.engagement_id || '')
  const source = validateReleasedSource(release, engagementId, version, direction, session)
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id, brand_id').eq('id', engagementId).maybeSingle()
  if (engagementError || !engagement) throw httpError('Released direction engagement is not visible', 404)
  if (engagement.organization_id !== release.organization_id
    || engagement.id !== release.engagement_id
    || session?.brand_id !== engagement.brand_id) {
    throw httpError('Production handoff source has an invalid organization chain', 409)
  }
  return {
    organizationId: String(release.organization_id),
    engagementId,
    brandId: String(engagement.brand_id),
    ...source,
  }
}

export function assertHandoffStoragePath(path: unknown, organizationId: string, releaseId: string, packageId: string) {
  const storagePath = text(path, 1000)
  if (storagePath !== handoffStoragePath(organizationId, releaseId, packageId)) {
    throw httpError('Production handoff package has an invalid private storage path', 409)
  }
  return storagePath
}

async function callerPackageRoot(userClient: Client, packageId: string): Promise<HandoffRoot> {
  const { data: packageRow, error } = await userClient.from('production_handoff_packages')
    .select('id, organization_id, design_direction_release_id, status, package_storage_path')
    .eq('id', packageId).maybeSingle()
  if (error || !packageRow) throw httpError('Ready production handoff package not found or not visible', 404)
  const root = await callerReleasedSource(
    userClient, requiredId(packageRow.design_direction_release_id, 'Design direction release'),
  )
  if (packageRow.organization_id !== root.organizationId
    || packageRow.design_direction_release_id !== root.release.id) {
    throw httpError('Production handoff package has an invalid organization chain', 409)
  }
  if (packageRow.status !== 'ready' || !packageRow.package_storage_path) {
    throw httpError('Ready production handoff package not found or not visible', 404)
  }
  assertHandoffStoragePath(packageRow.package_storage_path, root.organizationId, String(root.release.id), String(packageRow.id))
  return { ...root, packageRow: packageRow as Json }
}

export async function productionHandoffScope(userClient: Client, body: Json): Promise<HandoffRoot & {
  action: 'create_package' | 'sign_package'
  scope: ServerOrganizationScope
}> {
  const action = text(body.action, 80)
  if (action !== 'create_package' && action !== 'sign_package') throw new Error('Unsupported action')
  const root = action === 'create_package'
    ? await callerReleasedSource(
      userClient,
      requiredId(body.design_direction_release_id, 'Design direction release'),
      requiredId(body.engagement_id, 'Engagement'),
    )
    : await callerPackageRoot(userClient, requiredId(body.package_id, 'Production handoff package'))
  const requestedOrganizationId = text(body.organization_id, 80) || null
  if (requestedOrganizationId && requestedOrganizationId !== root.organizationId) {
    throw httpError('Requested organization does not match the root resource', 403)
  }
  return { ...root, action, scope: { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId } }
}

export async function preflightProductionHandoffRequest(userClient: Client, userId: string, body: Json): Promise<HandoffPreflight> {
  const root = await productionHandoffScope(userClient, body)
  const { data: membership, error } = await userClient.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind, organization:organizations!inner(id, status)')
    .eq('organization_id', root.organizationId).eq('user_id', userId).eq('status', 'active')
    .eq('member_kind', 'team').eq('organization.status', 'active').maybeSingle()
  const organization = Array.isArray(membership?.organization) ? membership.organization[0] : membership?.organization
  if (error || !membership || membership.organization_id !== root.organizationId
    || membership.status !== 'active' || membership.member_kind !== 'team' || organization?.status !== 'active') {
    throw httpError('Active team membership required', 403)
  }
  if (!hasProductionHandoffAuthority(membership as Json)) throw httpError('Production handoff requires team access', 403)
  return { ...root, membership: membership as Json }
}

async function loadExactRelease(admin: ScopedClient, preflight: HandoffPreflight) {
  const { data, error } = await admin.from('design_direction_releases').select('*')
    .eq('id', preflight.release.id).eq('organization_id', admin.organizationId)
    .eq('engagement_id', preflight.engagementId).eq('session_id', preflight.session.id)
    .eq('direction_version_id', preflight.version.id).maybeSingle()
  if (error || !data) throw httpError('Released direction changed after caller validation', 409)
  return { ...preflight, release: data as Json }
}

export function validateHandoffRows(
  organizationId: string,
  directionVersionId: string,
  assets: Asset[],
  variants: Variant[],
) {
  const mediaPrefix = `${organizationId}/${directionVersionId}/`
  if (assets.some(asset => asset.organization_id !== organizationId
    || asset.design_direction_version_id !== directionVersionId || asset.content_request_id !== null
    || (asset.storage_path && (!asset.storage_path.startsWith(mediaPrefix)
      || asset.storage_path.slice(mediaPrefix.length).includes('/') || asset.storage_path.includes('..'))))) {
    throw httpError('Production handoff media has an invalid organization or source chain', 409)
  }
  if (variants.some(variant => variant.organization_id !== organizationId
    || variant.source_direction_version_id !== directionVersionId)) {
    throw httpError('Production handoff variants have an invalid organization or source chain', 409)
  }
}

async function createPackage(admin: ScopedClient, userClient: Client, actorId: string, preflight: HandoffPreflight) {
  const source = await loadExactRelease(admin, preflight)
  const [{ data: assets, error: assetError }, { data: variants, error: variantError }] = await Promise.all([
    userClient.from('design_media_assets').select(
      'id, organization_id, design_direction_version_id, content_request_id, media_type, status, storage_path, prompt, provider, failure_reason',
    ).eq('organization_id', admin.organizationId)
      .eq('design_direction_version_id', source.version.id)
      .is('content_request_id', null)
      .order('created_at'),
    userClient.from('design_direction_variants').select(
      'id, organization_id, source_direction_version_id, variant_format, status, design_media_asset_id',
    ).eq('organization_id', admin.organizationId)
      .eq('source_direction_version_id', source.version.id)
      .order('created_at'),
  ])
  if (assetError) throw assetError
  if (variantError) throw variantError
  const scopedAssets = (assets || []) as Asset[]
  const scopedVariants = (variants || []) as Variant[]
  validateHandoffRows(admin.organizationId, String(source.version.id), scopedAssets, scopedVariants)

  const createdAt = new Date().toISOString()
  const { data: packageRow, error: packageError } = await admin
    .from('production_handoff_packages')
    .insert({
      organization_id: admin.organizationId,
      design_direction_release_id: source.release.id,
      requested_by: actorId,
      created_at: createdAt,
    })
    .select('*')
    .single()
  if (packageError) throw packageError

  const storagePath = handoffStoragePath(admin.organizationId, source.release.id, packageRow.id)
  assertHandoffStoragePath(storagePath, admin.organizationId, String(source.release.id), String(packageRow.id))
  let uploaded = false
  try {
    const archive = await buildProductionArchive({
      packageId: packageRow.id,
      release: source.release,
      version: source.version,
      assets: scopedAssets,
      variants: scopedVariants,
      createdAt,
    }, async path => {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(path)
      if (error || !data) throw new Error(`Required source object is unavailable: ${path}`)
      return new Uint8Array(await data.arrayBuffer())
    })
    if (archive.bytes.byteLength > MAX_PACKAGE_BYTES) {
      throw new Error('Production handoff ZIP exceeds the 32 MiB package limit')
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
      .eq('organization_id', admin.organizationId)
      .eq('design_direction_release_id', source.release.id)
      .eq('status', 'preparing')
      .select('*')
      .single()
    if (readyError) {
      const { data: persisted } = await admin.from('production_handoff_packages')
        .select('*').eq('id', packageRow.id).eq('organization_id', admin.organizationId)
        .eq('design_direction_release_id', source.release.id).maybeSingle()
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
      .eq('organization_id', admin.organizationId)
      .eq('design_direction_release_id', source.release.id)
      .eq('status', 'preparing')
    if (failedError) {
      throw new Error(`Production handoff failed and its status could not be recorded: ${failedError.message}`)
    }
    throw new Error(reason)
  }
}

async function signPackage(admin: ScopedClient, preflight: HandoffPreflight) {
  const callerPackage = preflight.packageRow as Json
  const storagePath = assertHandoffStoragePath(
    callerPackage.package_storage_path,
    admin.organizationId,
    String(preflight.release.id),
    String(callerPackage.id),
  )
  const { data: packageRow, error } = await admin
    .from('production_handoff_packages')
    .select('id, organization_id, design_direction_release_id, status, package_storage_path')
    .eq('id', callerPackage.id)
    .eq('organization_id', admin.organizationId)
    .eq('design_direction_release_id', preflight.release.id)
    .eq('status', 'ready')
    .eq('package_storage_path', storagePath)
    .maybeSingle()
  if (error) throw error
  if (!packageRow?.package_storage_path) {
    throw httpError('Ready production handoff package changed after caller validation', 409)
  }
  const { data: signed, error: signedError } = await admin.storage.from(MEDIA_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (signedError || !signed?.signedUrl) {
    throw signedError || new Error('Production handoff download could not be signed')
  }
  return {
    package_id: packageRow.id,
    signed_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  }
}

type HandlerDependencies = {
  createCallerIdentity?: (request: Request) => Promise<CallerIdentity>
  resolveContext?: typeof resolveServerOrganizationContext
}

async function handler(req: Request, dependencies: HandlerDependencies = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be an object')
    const body = parsed as Json
    const action = text(body.action, 80)
    if (action !== 'create_package' && action !== 'sign_package') throw new Error('Unsupported action')
    if (action === 'create_package') {
      requiredId(body.design_direction_release_id, 'Design direction release')
      requiredId(body.engagement_id, 'Engagement')
    } else {
      requiredId(body.package_id, 'Production handoff package')
    }

    const identity = await (dependencies.createCallerIdentity || callerIdentity)(req)
    const preflight = await preflightProductionHandoffRequest(identity.userClient, identity.userId, body)
    const context = await (dependencies.resolveContext || resolveServerOrganizationContext)(req, preflight.scope)
    if (context.organizationId !== preflight.organizationId
      || context.engagementId !== preflight.engagementId
      || context.brandId !== preflight.brandId) {
      throw httpError('Resolved Production Handoff context changed after caller validation', 409)
    }
    if (!hasProductionHandoffAuthority(context.membership as Json)) {
      throw httpError('Production handoff requires team access', 403)
    }
    const admin = context.admin as ScopedClient
    admin.organizationId = context.organizationId
    return response({ data: preflight.action === 'create_package'
      ? await createPackage(admin, context.userClient, context.user.id, preflight)
      : await signPackage(admin, preflight) })
  } catch (error) {
    console.error('Production handoff failure', error)
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({
      error: error instanceof Error ? error.message : 'Production handoff failed',
    }, Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(request => handler(request))

export { handler }
