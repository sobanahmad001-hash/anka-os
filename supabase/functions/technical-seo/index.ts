import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { googleAccessToken, namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ACTIONS = new Set(['save_page', 'save_audit', 'inspect_page'])
const PAGE_TYPES = new Set(['homepage', 'service', 'location', 'event', 'blog', 'other'])
const INDEX_STATUSES = new Set(['indexed', 'discovered_not_indexed', 'requested', 'excluded'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function id(value: unknown, label: string) {
  const result = text(value, 80)
  if (!result) throw new Error(`${label} is required`)
  return result
}

function optionalId(value: unknown) { return text(value, 80) || null }

function date(value: unknown) {
  const result = text(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new Error('Audit date must use YYYY-MM-DD')
  return result
}

function optionalScore(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const score = Number(value)
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Core Web Vitals scores must be between 0 and 100')
  return Math.round(score * 100) / 100
}

function optionalBoolean(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Boolean fields must be true, false, or empty')
}

function stringList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(item => text(item, 120)).filter(Boolean))].slice(0, 50) : []
}

export function normalizePageUrl(value: unknown) {
  const raw = text(value, 2048)
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error('Page URL must be valid') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('Page URL must use HTTP or HTTPS')
  parsed.hash = ''
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString()
}

export function mapInspectionResult(value: Json) {
  const result = value.inspectionResult as Json | undefined
  const index = result?.indexStatusResult as Json | undefined
  const verdict = text(index?.verdict, 40)
  const coverageState = text(index?.coverageState, 500)
  let indexed: boolean | null = null
  let indexStatus: string | null = null
  if (verdict === 'PASS') { indexed = true; indexStatus = 'indexed' }
  else if (coverageState.toLowerCase().includes('discovered')) { indexed = false; indexStatus = 'discovered_not_indexed' }
  else if (['FAIL', 'NEUTRAL'].includes(verdict)) { indexed = false; indexStatus = 'excluded' }
  return {
    indexed, index_status: indexStatus,
    source_details: {
      verdict: verdict || null,
      coverage_state: coverageState || null,
      indexing_state: text(index?.indexingState, 80) || null,
      page_fetch_state: text(index?.pageFetchState, 80) || null,
      robots_txt_state: text(index?.robotsTxtState, 80) || null,
      last_crawl_time: text(index?.lastCrawlTime, 80) || null,
      google_canonical: text(index?.googleCanonical, 2048) || null,
      user_canonical: text(index?.userCanonical, 2048) || null,
    },
  }
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return { userClient, admin, user }
}

async function requireWriter(admin: Client, organizationId: string, userId: string) {
  const { data: membership } = await admin.from('organization_memberships')
    .select('role, department_id, status, member_kind').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle()
  const allowed = membership?.status === 'active' && membership?.member_kind === 'team'
    && (membership.department_id === 'marketing' || LEADER_ROLES.has(membership.role))
  if (!allowed) throw Object.assign(new Error('Marketing department or organization leadership access required'), { status: 403 })
}

async function readableBrand(userClient: Client, brandId: string) {
  const { data, error } = await userClient.from('brands').select('id, organization_id').eq('id', brandId).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Brand is unavailable'), { status: 404 })
  return data
}

async function readablePage(userClient: Client, pageId: string) {
  const { data, error } = await userClient.from('tracked_pages').select('*').eq('id', pageId).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Tracked page is unavailable'), { status: 404 })
  return data
}

async function savePage(userClient: Client, admin: Client, actorId: string, body: Json) {
  const pageId = optionalId(body.pageId)
  const existing = pageId ? await readablePage(userClient, pageId) : null
  const brand = await readableBrand(userClient, existing?.brand_id || id(body.brandId, 'Brand'))
  await requireWriter(admin, brand.organization_id, actorId)
  const pageType = text(body.pageType, 30)
  if (!PAGE_TYPES.has(pageType)) throw new Error('Unsupported page type')
  const parentPageId = optionalId(body.parentPageId)
  if (parentPageId) {
    const parent = await readablePage(userClient, parentPageId)
    if (parent.organization_id !== brand.organization_id || parent.brand_id !== brand.id) throw new Error('Parent page must belong to the same brand')
  }
  const payload = { page_url: normalizePageUrl(body.pageUrl), page_type: pageType, parent_page_id: parentPageId }
  const query = existing
    ? admin.from('tracked_pages').update(payload).eq('id', existing.id).eq('organization_id', brand.organization_id)
    : admin.from('tracked_pages').insert({ ...payload, organization_id: brand.organization_id, brand_id: brand.id, created_by: actorId })
  const { data, error } = await query.select('*').single()
  if (error) throw error
  return data
}

async function saveAudit(userClient: Client, admin: Client, actorId: string, body: Json) {
  const page = await readablePage(userClient, id(body.pageId, 'Tracked page'))
  await requireWriter(admin, page.organization_id, actorId)
  const indexStatus = text(body.indexStatus, 40) || null
  if (indexStatus && !INDEX_STATUSES.has(indexStatus)) throw new Error('Unsupported index status')
  const indexed = optionalBoolean(body.indexed)
  if (indexed === true && indexStatus !== 'indexed') throw new Error('Indexed pages must use indexed status')
  if (indexStatus === 'indexed' && indexed !== true) throw new Error('Indexed status requires indexed = true')
  const { data, error } = await admin.from('tracked_page_audits').insert({
    organization_id: page.organization_id, tracked_page_id: page.id,
    audit_date: date(body.auditDate), indexed, index_status: indexStatus,
    core_web_vitals_mobile: optionalScore(body.mobileScore), core_web_vitals_desktop: optionalScore(body.desktopScore),
    schema_valid: optionalBoolean(body.schemaValid),
    issues: stringList(body.issues), notes: text(body.notes, 8000) || null,
    source_type: 'manual', source_details: {}, created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function searchConsoleConnection(admin: Client, page: Json) {
  const { data: engagements, error } = await admin.from('engagements').select('id')
    .eq('organization_id', page.organization_id).eq('brand_id', page.brand_id)
  if (error) throw error
  const engagementIds = (engagements || []).map(item => item.id)
  if (!engagementIds.length) throw Object.assign(new Error('No engagement exists for this brand'), { status: 409 })
  const { data: mappings, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', page.organization_id).eq('department_id', 'marketing').in('engagement_id', engagementIds)
  if (mappingError) throw mappingError
  const connectionIds = [...new Set((mappings || []).map(item => item.connection_id))]
  if (!connectionIds.length) throw Object.assign(new Error('No Marketing Search Console connection is mapped to this brand'), { status: 409 })
  const { data: connection, error: connectionError } = await admin.from('integration_connections')
    .select('id, organization_id, provider, public_config').eq('organization_id', page.organization_id)
    .eq('provider', 'google_search_console').eq('status', 'verified').is('archived_at', null).in('id', connectionIds).limit(1).maybeSingle()
  if (connectionError || !connection) throw Object.assign(new Error('A verified Search Console connection is required'), { status: 409 })
  return connection
}

export async function fetchUrlInspection(token: string, pageUrl: string, siteUrl: string, fetcher: typeof fetch = fetch) {
  const result = await fetcher('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl, languageCode: 'en-US' }), signal: AbortSignal.timeout(15_000),
  })
  const data = await result.json() as Json
  if (!result.ok) throw new Error(`Search Console URL inspection failed (${result.status})`)
  return data
}

async function inspectPage(userClient: Client, admin: Client, actorId: string, body: Json) {
  const page = await readablePage(userClient, id(body.pageId, 'Tracked page'))
  await requireWriter(admin, page.organization_id, actorId)
  const connection = await searchConsoleConnection(admin, page)
  const siteUrl = text(connection.public_config?.site_url, 2048)
  if (!siteUrl) throw new Error('Search Console property is not configured')
  const token = await googleAccessToken(admin, connection.id, 'google_search_console')
  const mapped = mapInspectionResult(await fetchUrlInspection(token, page.page_url, siteUrl))
  const { data, error } = await admin.from('tracked_page_audits').insert({
    organization_id: page.organization_id, tracked_page_id: page.id, audit_date: new Date().toISOString().slice(0, 10),
    indexed: mapped.indexed, index_status: mapped.index_status, issues: [], source_type: 'search_console',
    source_connection_id: connection.id, source_details: mapped.source_details, created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const body = await request.json() as Json
    const action = text(body.action, 40)
    if (!ACTIONS.has(action)) return response({ error: 'Unsupported action' }, 400)
    const { userClient, admin, user } = await requireContext(request)
    if (action === 'save_page') return response({ data: await savePage(userClient, admin, user.id, body) })
    if (action === 'save_audit') return response({ data: await saveAudit(userClient, admin, user.id, body) })
    return response({ data: await inspectPage(userClient, admin, user.id, body) })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected technical SEO error' }, Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
