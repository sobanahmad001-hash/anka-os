import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { buildWordPressTheme, referencedMediaPaths, type ThemeAsset } from './theme.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
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

export function hasWordPressExportAuthority(membership: Json) {
  const role = text(membership.role, 80)
  return LEADER_ROLES.has(role)
    || (text(membership.department_id, 80) === 'design'
      && ['department_manager', 'contributor'].includes(role))
}

async function requireUser(req: Request, url: string, anonKey: string, admin: Client) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required')
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  const { data: membership, error: membershipError } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id')
    .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id)
    .eq('member_kind', 'team').eq('status', 'active').maybeSingle()
  if (membershipError) throw membershipError
  if (!membership) throw new Error('Active team membership required')
  return { user, membership: membership as Json, userClient }
}

async function loadApprovedDesign(userClient: Client, designId: string) {
  const { data, error } = await userClient.from('website_page_designs')
    .select('id, organization_id, design_direction_version_id, slug, html_content, css_content, status')
    .eq('id', designId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Website page design not found or not visible')
  if (data.status !== 'approved') throw new Error('Only an approved website page design can be exported')
  return data
}

async function bundleAssets(admin: Client, directionVersionId: string, html: string, css: string): Promise<ThemeAsset[]> {
  const referencedPaths = referencedMediaPaths(html, css)
  if (!referencedPaths.length) return []
  const { data, error } = await admin.from('design_media_assets')
    .select('storage_path')
    .eq('organization_id', ORGANIZATION_ID)
    .eq('design_direction_version_id', directionVersionId)
    .eq('media_type', 'image').eq('status', 'ready').not('storage_path', 'is', null)
    .in('storage_path', referencedPaths)
  if (error) throw error
  const assets: ThemeAsset[] = []
  for (const asset of data || []) {
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

async function markFailed(admin: Client, jobId: string, reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  await admin.from('wordpress_export_jobs').update({
    status: 'failed', failure_reason: message.slice(0, 4000), completed_at: new Date().toISOString(),
  }).eq('id', jobId).eq('organization_id', ORGANIZATION_ID).in('status', ['queued', 'processing'])
}

async function exportTheme(admin: Client, userClient: Client, actorId: string, body: Json) {
  const designId = text(body.website_page_design_id, 80)
  const design = await loadApprovedDesign(userClient, designId)
  const { data: job, error: jobError } = await admin.from('wordpress_export_jobs').insert({
    organization_id: ORGANIZATION_ID,
    website_page_design_id: design.id,
    provider: 'native',
    status: 'processing',
    requested_by: actorId,
  }).select('*').single()
  if (jobError) throw jobError

  let storagePath = ''
  try {
    const assets = await bundleAssets(admin, design.design_direction_version_id, design.html_content, design.css_content)
    const theme = await buildWordPressTheme(design.slug, design.html_content, design.css_content, assets)
    storagePath = `${ORGANIZATION_ID}/${design.id}/${job.id}/${theme.filename}`
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
      p_organization_id: ORGANIZATION_ID,
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
    await markFailed(admin, job.id, reason)
    throw reason
  }
}

async function signedDownload(admin: Client, userClient: Client, body: Json) {
  const jobId = text(body.wordpress_export_job_id, 80)
  const { data: job, error } = await userClient.from('wordpress_export_jobs')
    .select('id, status, storage_path, website_page_design_id')
    .eq('id', jobId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error) throw error
  if (!job) throw new Error('WordPress export job not found or not visible')
  if (job.status !== 'complete' || !job.storage_path) throw new Error('WordPress export is not ready to download')
  const filename = job.storage_path.split('/').pop() || 'anka-wordpress-theme.zip'
  const { data: signed, error: signedError } = await admin.storage.from(EXPORT_BUCKET)
    .createSignedUrl(job.storage_path, 600, { download: filename })
  if (signedError) throw signedError
  return { job_id: job.id, download_url: signed.signedUrl, download_expires_in: 600 }
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
    const { user, membership, userClient } = await requireUser(req, url, anonKey, admin)
    if (!hasWordPressExportAuthority(membership)) {
      return response({ error: 'Your department role cannot export WordPress themes' }, 403)
    }
    const body = await req.json() as Json
    const action = text(body.action, 80)
    const actions: Record<string, () => Promise<unknown>> = {
      export: () => exportTheme(admin, userClient, user.id, body),
      get_download: () => signedDownload(admin, userClient, body),
    }
    if (!actions[action]) return response({ error: 'Unsupported action' }, 400)
    return response({ data: await actions[action]() })
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'WordPress export failed'
    return response({ error: message }, /Authentication|required|not visible/i.test(message) ? 401 : 400)
  }
}

if (import.meta.main) Deno.serve(handler)
