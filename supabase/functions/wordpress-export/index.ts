import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import {
  resolveServerOrganizationContext,
  type ServerOrganizationScope,
} from '../_shared/serverOrganizationContext.ts'
import { buildWordPressTheme, referencedMediaPaths, type ThemeAsset } from './theme.ts'

type Client = ReturnType<typeof createClient<any>>
type ScopedClient = Client & { organizationId: string }
type Json = Record<string, unknown>

const EXPORT_BUCKET = 'wordpress-theme-exports'
const MEDIA_BUCKET = 'design-generated-media'
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 8000) {
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

export function hasWordPressExportAuthority(membership: Json) {
  if (membership.member_kind !== 'team') return false
  const role = text(membership.role, 80)
  return LEADER_ROLES.has(role)
    || (text(membership.department_id, 80) === 'design'
      && ['department_manager', 'contributor'].includes(role))
}

type ExportRoot = {
  organizationId: string
  engagementId: string
  brandId: string
  directionVersionId: string
  design: Json
  job?: Json
}

type ExportPreflight = ExportRoot & {
  action: 'export' | 'get_download'
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

async function callerDirectionVersionRoot(userClient: Client, directionVersionId: string): Promise<Omit<ExportRoot, 'design'>> {
  const { data: version, error: versionError } = await userClient.from('design_direction_versions')
    .select('id, organization_id, direction_id').eq('id', directionVersionId).maybeSingle()
  if (versionError || !version) throw httpError('Direction version not found or not visible', 404)
  const { data: direction, error: directionError } = await userClient.from('design_directions')
    .select('id, organization_id, session_id').eq('id', version.direction_id).maybeSingle()
  if (directionError || !direction) throw httpError('Direction version has no accessible Workshop direction', 404)
  const { data: session, error: sessionError } = await userClient.from('design_workshop_sessions')
    .select('id, organization_id, engagement_id, brand_id').eq('id', direction.session_id).maybeSingle()
  if (sessionError || !session) throw httpError('Direction version has no accessible Workshop session', 404)
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id, brand_id').eq('id', session.engagement_id).maybeSingle()
  if (engagementError || !engagement) throw httpError('Direction version engagement is not visible', 404)
  if (version.organization_id !== direction.organization_id
    || direction.organization_id !== session.organization_id
    || session.organization_id !== engagement.organization_id
    || session.brand_id !== engagement.brand_id) {
    throw httpError('WordPress export source has an invalid organization chain', 409)
  }
  return {
    organizationId: String(version.organization_id),
    engagementId: String(session.engagement_id),
    brandId: String(session.brand_id),
    directionVersionId: String(version.id),
  }
}

async function callerApprovedDesignRoot(userClient: Client, designId: string): Promise<ExportRoot> {
  const { data: design, error } = await userClient.from('website_page_designs')
    .select('id, organization_id, design_direction_version_id, slug, html_content, css_content, status')
    .eq('id', designId).maybeSingle()
  if (error || !design) throw httpError('Website page design not found or not visible', 404)
  const root = await callerDirectionVersionRoot(userClient, requiredId(design.design_direction_version_id, 'Design direction version'))
  if (design.organization_id !== root.organizationId
    || design.design_direction_version_id !== root.directionVersionId) {
    throw httpError('WordPress export source has an invalid organization chain', 409)
  }
  if (design.status !== 'approved') throw httpError('Only an approved website page design can be exported', 409)
  return { ...root, design: design as Json }
}

function expectedExportPrefix(organizationId: string, designId: string, jobId: string) {
  return `${organizationId}/${designId}/${jobId}/`
}

export function assertExportStoragePath(path: unknown, organizationId: string, designId: string, jobId: string) {
  const storagePath = text(path, 1000)
  const prefix = expectedExportPrefix(organizationId, designId, jobId)
  const filename = storagePath.slice(prefix.length)
  if (!storagePath.startsWith(prefix) || !filename || filename.includes('/')
    || filename.includes('\\') || filename.includes('..') || !filename.toLowerCase().endsWith('.zip')) {
    throw httpError('WordPress export has an invalid private storage path', 409)
  }
  return storagePath
}

async function callerJobRoot(userClient: Client, jobId: string): Promise<ExportRoot> {
  const { data: job, error } = await userClient.from('wordpress_export_jobs')
    .select('id, organization_id, status, storage_path, website_page_design_id').eq('id', jobId).maybeSingle()
  if (error || !job) throw httpError('WordPress export job not found or not visible', 404)
  const root = await callerApprovedDesignRoot(userClient, requiredId(job.website_page_design_id, 'Website page design'))
  if (job.organization_id !== root.organizationId || job.website_page_design_id !== root.design.id) {
    throw httpError('WordPress export job has an invalid organization chain', 409)
  }
  if (job.status !== 'complete' || !job.storage_path) throw httpError('WordPress export is not ready to download', 409)
  assertExportStoragePath(job.storage_path, root.organizationId, String(root.design.id), String(job.id))
  return { ...root, job: job as Json }
}

export async function wordpressExportScope(userClient: Client, body: Json): Promise<ExportRoot & {
  action: 'export' | 'get_download'
  scope: ServerOrganizationScope
}> {
  const action = text(body.action, 80)
  if (action !== 'export' && action !== 'get_download') throw new Error('Unsupported action')
  const root = action === 'export'
    ? await callerApprovedDesignRoot(userClient, requiredId(body.website_page_design_id, 'Website page design'))
    : await callerJobRoot(userClient, requiredId(body.wordpress_export_job_id, 'WordPress export job'))
  const requestedOrganizationId = text(body.organization_id, 80) || null
  if (requestedOrganizationId && requestedOrganizationId !== root.organizationId) {
    throw httpError('Requested organization does not match the root resource', 403)
  }
  return { ...root, action, scope: { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId } }
}

export async function preflightWordPressExportRequest(userClient: Client, userId: string, body: Json): Promise<ExportPreflight> {
  const root = await wordpressExportScope(userClient, body)
  const { data: membership, error } = await userClient.from('organization_memberships')
    .select('organization_id, role, department_id, status, member_kind, organization:organizations!inner(id, status)')
    .eq('organization_id', root.organizationId).eq('user_id', userId).eq('status', 'active')
    .eq('member_kind', 'team').eq('organization.status', 'active').maybeSingle()
  const organization = Array.isArray(membership?.organization) ? membership.organization[0] : membership?.organization
  if (error || !membership || membership.organization_id !== root.organizationId
    || membership.status !== 'active' || membership.member_kind !== 'team' || organization?.status !== 'active') {
    throw httpError('Active team membership required', 403)
  }
  if (!hasWordPressExportAuthority(membership as Json)) {
    throw httpError('Your department role cannot export WordPress themes', 403)
  }
  return { ...root, membership: membership as Json }
}

type AssetRow = { storage_path: string }

async function loadAssetManifest(admin: ScopedClient, directionVersionId: string, html: string, css: string): Promise<AssetRow[]> {
  const referencedPaths = referencedMediaPaths(html, css)
  if (!referencedPaths.length) return []
  const prefix = `${admin.organizationId}/${directionVersionId}/`
  if (referencedPaths.some(path => !path.startsWith(prefix) || path.slice(prefix.length).includes('/')
    || path.includes('\\') || path.includes('..'))) {
    throw httpError('WordPress source references media outside its organization and direction version', 409)
  }
  const { data, error } = await admin.from('design_media_assets')
    .select('id, organization_id, design_direction_version_id, storage_path')
    .eq('organization_id', admin.organizationId)
    .eq('design_direction_version_id', directionVersionId)
    .eq('media_type', 'image').eq('status', 'ready').not('storage_path', 'is', null)
    .in('storage_path', referencedPaths)
  if (error) throw error
  const rows = (data || []) as Array<Json & AssetRow>
  const returnedPaths = new Set(rows.map(asset => String(asset.storage_path)))
  if (rows.some(asset => asset.organization_id !== admin.organizationId
    || asset.design_direction_version_id !== directionVersionId
    || !String(asset.storage_path).startsWith(prefix))
    || referencedPaths.some(path => !returnedPaths.has(path))) {
    throw httpError('WordPress source media is missing or has an invalid organization chain', 409)
  }
  return rows.map(asset => ({ storage_path: String(asset.storage_path) }))
}

async function bundleAssets(admin: ScopedClient, rows: AssetRow[]): Promise<ThemeAsset[]> {
  const assets: ThemeAsset[] = []
  for (const asset of rows) {
    const { data: blob, error: downloadError } = await admin.storage.from(MEDIA_BUCKET).download(asset.storage_path)
    if (downloadError) throw downloadError
    assets.push({
      storagePath: asset.storage_path,
      contentType: blob.type || 'application/octet-stream',
      bytes: new Uint8Array(await blob.arrayBuffer()),
    })
  }
  return assets
}

async function markFailed(admin: ScopedClient, jobId: string, designId: string, reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  await admin.from('wordpress_export_jobs').update({
    status: 'failed', failure_reason: message.slice(0, 4000), completed_at: new Date().toISOString(),
  }).eq('id', jobId).eq('organization_id', admin.organizationId)
    .eq('website_page_design_id', designId).in('status', ['queued', 'processing'])
}

async function loadExactApprovedDesign(admin: ScopedClient, preflight: ExportPreflight) {
  const { data, error } = await admin.from('website_page_designs')
    .select('id, organization_id, design_direction_version_id, slug, html_content, css_content, status')
    .eq('id', preflight.design.id).eq('organization_id', admin.organizationId)
    .eq('design_direction_version_id', preflight.directionVersionId).eq('status', 'approved').maybeSingle()
  if (error || !data) throw httpError('Approved WordPress export source changed after caller validation', 409)
  return data
}

export async function exportTheme(admin: ScopedClient, actorId: string, preflight: ExportPreflight) {
  const design = await loadExactApprovedDesign(admin, preflight)
  const assetManifest = await loadAssetManifest(
    admin, preflight.directionVersionId, String(design.html_content || ''), String(design.css_content || ''),
  )
  const { data: job, error: jobError } = await admin.from('wordpress_export_jobs').insert({
    organization_id: admin.organizationId,
    website_page_design_id: design.id,
    provider: 'native',
    status: 'processing',
    requested_by: actorId,
  }).select('*').single()
  if (jobError) throw jobError

  let storagePath = ''
  try {
    const assets = await bundleAssets(admin, assetManifest)
    const theme = await buildWordPressTheme(design.slug, design.html_content, design.css_content, assets)
    storagePath = `${admin.organizationId}/${design.id}/${job.id}/${theme.filename}`
    assertExportStoragePath(storagePath, admin.organizationId, String(design.id), String(job.id))
    const archiveBuffer = new ArrayBuffer(theme.bytes.byteLength)
    new Uint8Array(archiveBuffer).set(theme.bytes)
    const { error: uploadError } = await admin.storage.from(EXPORT_BUCKET).upload(
      storagePath,
      new Blob([archiveBuffer], { type: 'application/zip' }),
      { contentType: 'application/zip', cacheControl: '3600', upsert: false },
    )
    if (uploadError) throw uploadError

    const { data: signed, error: signedError } = await admin.storage.from(EXPORT_BUCKET)
      .createSignedUrl(storagePath, 600, { download: theme.filename })
    if (signedError) throw signedError

    const { error: completionError } = await admin.rpc('complete_native_wordpress_export', {
      p_job_id: job.id,
      p_organization_id: admin.organizationId,
      p_storage_path: storagePath,
      p_artifact_sha256: theme.sha256,
      p_seo_verification: theme.seoVerification,
    })
    if (completionError) throw completionError
    return {
      job: { ...job, status: 'complete', storage_path: storagePath, artifact_sha256: theme.sha256,
        seo_verification: theme.seoVerification, completed_at: new Date().toISOString() },
      download_url: signed.signedUrl,
      download_expires_in: 600,
    }
  } catch (reason) {
    if (storagePath) await admin.storage.from(EXPORT_BUCKET).remove([storagePath])
    await markFailed(admin, String(job.id), String(design.id), reason)
    throw reason
  }
}

async function signedDownload(admin: ScopedClient, preflight: ExportPreflight) {
  const callerJob = preflight.job as Json
  const storagePath = assertExportStoragePath(callerJob.storage_path, admin.organizationId, String(preflight.design.id), String(callerJob.id))
  const { data: job, error } = await admin.from('wordpress_export_jobs')
    .select('id, organization_id, status, storage_path, website_page_design_id')
    .eq('id', callerJob.id).eq('organization_id', admin.organizationId)
    .eq('website_page_design_id', preflight.design.id).eq('status', 'complete')
    .eq('storage_path', storagePath).maybeSingle()
  if (error || !job) throw httpError('Completed WordPress export changed after caller validation', 409)
  const filename = storagePath.split('/').pop() || 'anka-wordpress-theme.zip'
  const { data: signed, error: signedError } = await admin.storage.from(EXPORT_BUCKET)
    .createSignedUrl(storagePath, 600, { download: filename })
  if (signedError) throw signedError
  return { job_id: job.id, download_url: signed.signedUrl, download_expires_in: 600 }
}

type HandlerDependencies = {
  createCallerIdentity?: (request: Request) => Promise<CallerIdentity>
  resolveContext?: typeof resolveServerOrganizationContext
}

export async function handler(req: Request, dependencies: HandlerDependencies = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Request body must be an object')
    }
    const body = parsed as Json
    const action = text(body.action, 80)
    if (action !== 'export' && action !== 'get_download') throw new Error('Unsupported action')
    if (action === 'export') requiredId(body.website_page_design_id, 'Website page design')
    else requiredId(body.wordpress_export_job_id, 'WordPress export job')

    const identity = await (dependencies.createCallerIdentity || callerIdentity)(req)
    const preflight = await preflightWordPressExportRequest(identity.userClient, identity.userId, body)
    const context = await (dependencies.resolveContext || resolveServerOrganizationContext)(req, preflight.scope)
    if (context.organizationId !== preflight.organizationId
      || context.engagementId !== preflight.engagementId
      || context.brandId !== preflight.brandId) {
      throw httpError('Resolved WordPress export context changed after caller validation', 409)
    }
    if (!hasWordPressExportAuthority(context.membership as Json)) {
      throw httpError('Your department role cannot export WordPress themes', 403)
    }
    const admin = context.admin as ScopedClient
    admin.organizationId = context.organizationId
    return response({ data: preflight.action === 'export'
      ? await exportTheme(admin, context.user.id, preflight)
      : await signedDownload(admin, preflight) })
  } catch (error) {
    console.error('WordPress export failure', error)
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'WordPress export failed' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(request => handler(request))
