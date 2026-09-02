import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import {
  decryptSecret,
  encryptSecret,
  namedKey,
  pkceChallenge,
  randomToken,
  sha256,
} from '../_shared/googleOAuthTokens.ts'

export { decryptSecret, encryptSecret, pkceChallenge, randomToken, sha256 }

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const LEADERS = new Set(['system_owner', 'operations_admin', 'executive'])
const META_DEPARTMENTS = new Set(['design', 'marketing'])

// Meta names its Instagram analytics permission "manage_insights", but it grants
// insights reads only. No ads, publishing, messaging, comment, or content scope is requested.
export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
]

export const META_READ_METRICS = Object.freeze({
  facebook: ['page_impressions', 'page_impressions_unique', 'page_post_engagements'],
  instagram: ['reach', 'impressions', 'accounts_engaged'],
})

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...cors, 'Content-Type': 'application/json' } },
)

const value = (input: unknown, limit = 240) =>
  typeof input === 'string' ? input.trim().slice(0, limit) : ''

const uuid = (input: unknown, label: string, optional = false) => {
  const result = value(input, 64)
  if (optional && !result) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error(`A valid ${label} is required`)
  }
  return result
}

const graphId = (input: unknown, label: string, optional = false) => {
  const result = value(input, 64)
  if (optional && !result) return null
  if (!/^\d+$/.test(result)) throw new Error(`A valid ${label} is required`)
  return result
}

const safePath = (input: unknown) => {
  const path = value(input) || '/settings'
  return /^\/[A-Za-z0-9/_?&=.-]*$/.test(path) && !path.startsWith('//') ? path : '/settings'
}

const safeDepartments = (input: unknown) => {
  if (!Array.isArray(input)) throw new Error('Select Meta department access')
  const departments = [...new Set(input.map(item => value(item, 40)).filter(Boolean))]
  if (!departments.length || departments.some(department => !META_DEPARTMENTS.has(department))) {
    throw new Error('Meta access is limited to Design and Marketing')
  }
  return departments
}

export function snapshotDate(input: unknown, now = new Date()) {
  const requested = value(input, 10)
  if (requested) {
    const parsed = new Date(`${requested}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== requested) {
      throw new Error('Snapshot date must be a real ISO date')
    }
    return requested
  }
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
}

function configuration() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const appId = Deno.env.get('META_APP_ID') ?? ''
  const appSecret = Deno.env.get('META_APP_SECRET') ?? ''
  const encryptionMaterial = Deno.env.get('META_TOKEN_ENCRYPTION_KEY') ?? ''
  const appUrl = (Deno.env.get('ANKA_APP_URL') || 'https://anka-os.vercel.app').replace(/\/$/, '')
  const redirectUri = Deno.env.get('META_OAUTH_REDIRECT_URI') || `${supabaseUrl}/functions/v1/meta-oauth`
  const apiVersion = Deno.env.get('META_GRAPH_API_VERSION') || 'v24.0'
  if (!supabaseUrl || !appId || !appSecret || encryptionMaterial.length < 32) {
    throw new Error('Meta OAuth is not configured on the server')
  }
  return { supabaseUrl, appId, appSecret, encryptionMaterial, appUrl, redirectUri, apiVersion }
}

function admin(url: string) {
  const key = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!key) throw new Error('Function environment is incomplete')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function leader(request: Request, url: string) {
  const authorization = request.headers.get('Authorization')
  const publishable = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  if (!authorization || !publishable) {
    throw Object.assign(new Error('Authentication required'), { status: 401 })
  }
  const client = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const { data: member } = await client.from('organization_memberships')
    .select('role,status,member_kind')
    .eq('organization_id', ORGANIZATION_ID)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!member || member.status !== 'active' || member.member_kind !== 'team' || !LEADERS.has(member.role)) {
    throw Object.assign(new Error('Leadership access required'), { status: 403 })
  }
  return user
}

function redirect(appUrl: string, path: string, params: Record<string, string>) {
  const url = new URL(safePath(path), `${appUrl}/`)
  Object.entries(params).forEach(([key, entry]) => url.searchParams.set(key, entry))
  return Response.redirect(url.toString(), 303)
}

async function graphGet(
  config: ReturnType<typeof configuration>,
  path: string,
  token: string,
  parameters: Record<string, string> = {},
) {
  const url = new URL(`https://graph.facebook.com/${config.apiVersion}/${path.replace(/^\//, '')}`)
  Object.entries(parameters).forEach(([key, entry]) => url.searchParams.set(key, entry))
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok) throw Object.assign(new Error(`Meta read failed (${response.status})`), { code: `HTTP_${response.status}` })
  return body
}

function metric(data: Record<string, unknown>, name: string) {
  const rows = Array.isArray(data.data) ? data.data as Array<Record<string, unknown>> : []
  const row = rows.find(item => item.name === name)
  const first = Array.isArray(row?.values) ? row.values[0] as Record<string, unknown> : row
  const raw = first?.value
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : null
}

async function recordEvent(
  client: ReturnType<typeof admin>,
  connectionId: string,
  actorId: string,
  operation: string,
  outcome: string,
  metadata: Record<string, unknown> = {},
  errorCode: string | null = null,
) {
  await client.from('integration_events').insert({
    organization_id: ORGANIZATION_ID,
    connection_id: connectionId,
    actor_id: actorId,
    operation,
    outcome,
    provider: 'meta',
    error_code: errorCode,
    metadata,
  })
}

async function start(request: Request, body: Record<string, unknown>) {
  const config = configuration()
  const user = await leader(request, config.supabaseUrl)
  const client = admin(config.supabaseUrl)
  const brandId = uuid(body.brand_id, 'brand ID')!
  const pageId = graphId(body.facebook_page_id, 'Facebook Page ID')!
  const instagramId = graphId(body.instagram_account_id, 'Instagram account ID', true)
  const displayName = value(body.display_name, 120)
  const departments = safeDepartments(body.department_ids)
  if (!displayName) throw new Error('Connection name is required')

  const { data: brand } = await client.from('brands').select('id')
    .eq('id', brandId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!brand) throw new Error('Brand not found')

  const requestedConnectionId = uuid(body.connection_id, 'connection ID', true)
  let connectionId = requestedConnectionId
  const publicConfig = {
    brand_id: brandId,
    facebook_page_id: pageId,
    instagram_account_id: instagramId,
  }
  if (requestedConnectionId) {
    const { data: existing } = await client.from('integration_connections').select('id,provider')
      .eq('id', requestedConnectionId).eq('organization_id', ORGANIZATION_ID).is('archived_at', null).maybeSingle()
    if (!existing || existing.provider !== 'meta') throw new Error('Meta connection not found')
    const { error } = await client.from('integration_connections').update({
      display_name: displayName,
      public_config: publicConfig,
      status: 'authorizing',
      archived_at: null,
    }).eq('id', existing.id)
    if (error) throw error
  } else {
    const { data: created, error } = await client.from('integration_connections').insert({
      organization_id: ORGANIZATION_ID,
      provider: 'meta',
      display_name: displayName,
      public_config: publicConfig,
      status: 'authorizing',
      created_by: user.id,
    }).select('id').single()
    if (error) throw error
    connectionId = created.id
  }

  await client.from('integration_connection_departments').delete()
    .eq('connection_id', connectionId).eq('organization_id', ORGANIZATION_ID)
  const { error: mappingError } = await client.from('integration_connection_departments').insert(
    departments.map(departmentId => ({
      connection_id: connectionId,
      organization_id: ORGANIZATION_ID,
      department_id: departmentId,
      created_by: user.id,
    })),
  )
  if (mappingError) throw mappingError

  const state = randomToken()
  const verifier = randomToken(64)
  const encrypted = await encryptSecret(verifier, config.encryptionMaterial)
  await client.from('meta_oauth_sessions').delete().lt('expires_at', new Date().toISOString())
  const { error: sessionError } = await client.from('meta_oauth_sessions').insert({
    organization_id: ORGANIZATION_ID,
    integration_connection_id: connectionId,
    brand_id: brandId,
    facebook_page_id: pageId,
    instagram_account_id: instagramId,
    actor_id: user.id,
    state_hash: await sha256(state),
    code_verifier_ciphertext: encrypted.ciphertext,
    code_verifier_iv: encrypted.iv,
    return_path: safePath(body.return_path),
  })
  if (sessionError) throw sessionError
  await recordEvent(client, connectionId!, user.id, 'authorization_started', 'succeeded', {
    display_name: displayName,
    department_ids: departments,
  })

  const authorize = new URL(`https://www.facebook.com/${config.apiVersion}/dialog/oauth`)
  authorize.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    scope: META_OAUTH_SCOPES.join(','),
  }).toString()
  return json({ authorize_url: authorize.toString() })
}

async function callback(request: Request) {
  let config: ReturnType<typeof configuration>
  try {
    config = configuration()
  } catch {
    return new Response('Meta OAuth is not configured on the server.', { status: 503 })
  }
  const params = new URL(request.url).searchParams
  const state = value(params.get('state'), 180)
  if (!state) return redirect(config.appUrl, '/settings', { oauth: 'error', provider: 'meta', reason: 'missing_state' })

  const client = admin(config.supabaseUrl)
  const claimedAt = new Date().toISOString()
  const { data: session, error: claimError } = await client.from('meta_oauth_sessions')
    .update({ consumed_at: claimedAt })
    .eq('state_hash', await sha256(state))
    .is('consumed_at', null)
    .gt('expires_at', claimedAt)
    .select('*')
    .maybeSingle()
  if (claimError || !session) {
    return redirect(config.appUrl, '/settings', { oauth: 'error', provider: 'meta', reason: 'invalid_or_expired_state' })
  }

  const returnPath = safePath(session.return_path)
  const oauthError = value(params.get('error'), 80)
  const code = value(params.get('code'), 4096)
  if (oauthError || !code) {
    await client.from('integration_connections').update({ status: 'error', last_check_status: 'failed' })
      .eq('id', session.integration_connection_id)
    await recordEvent(client, session.integration_connection_id, session.actor_id, 'authorization_failed', 'failed', {}, oauthError || 'MISSING_CODE')
    await client.from('meta_oauth_sessions').delete().eq('id', session.id)
    return redirect(config.appUrl, returnPath, { oauth: 'error', provider: 'meta', reason: oauthError || 'missing_code' })
  }

  try {
    const verifier = await decryptSecret(
      session.code_verifier_ciphertext,
      session.code_verifier_iv,
      config.encryptionMaterial,
    )
    const tokenResponse = await fetch(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const token = await tokenResponse.json() as { access_token?: string; expires_in?: number; error?: { code?: number } }
    if (!tokenResponse.ok || !token.access_token) {
      throw Object.assign(new Error('Meta token exchange failed'), { code: `TOKEN_${token.error?.code || tokenResponse.status}` })
    }

    const page = await graphGet(config, session.facebook_page_id, token.access_token, {
      fields: 'id,name,access_token,instagram_business_account',
    }) as { id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string } }
    if (page.id !== session.facebook_page_id || !page.access_token) {
      throw Object.assign(new Error('The selected Facebook Page was not granted'), { code: 'PAGE_NOT_GRANTED' })
    }
    const linkedInstagramId = graphId(page.instagram_business_account?.id, 'linked Instagram account ID', true)
    if (session.instagram_account_id && session.instagram_account_id !== linkedInstagramId) {
      throw Object.assign(new Error('The Instagram account is not linked to the selected Facebook Page'), { code: 'INSTAGRAM_MISMATCH' })
    }
    const instagramId = session.instagram_account_id || linkedInstagramId
    if (instagramId) await graphGet(config, instagramId, page.access_token, { fields: 'id' })

    const encrypted = await encryptSecret(page.access_token, config.encryptionMaterial)
    const expiresIn = Number(token.expires_in)
    const expiresAt = Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null
    const { error: credentialError } = await client.from('meta_connections').upsert({
      organization_id: ORGANIZATION_ID,
      integration_connection_id: session.integration_connection_id,
      brand_id: session.brand_id,
      facebook_page_id: session.facebook_page_id,
      instagram_account_id: instagramId,
      access_token_ciphertext: encrypted.ciphertext,
      access_token_iv: encrypted.iv,
      token_expires_at: expiresAt,
      connected_by: session.actor_id,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'integration_connection_id' })
    if (credentialError) throw credentialError

    const connectedAt = new Date().toISOString()
    const { error: connectionError } = await client.from('integration_connections').update({
      status: 'verified',
      last_checked_at: connectedAt,
      last_check_status: 'passed',
      public_config: {
        brand_id: session.brand_id,
        facebook_page_id: session.facebook_page_id,
        facebook_page_name: value(page.name, 120),
        instagram_account_id: instagramId,
        granted_scopes: META_OAUTH_SCOPES,
        oauth_connected_at: connectedAt,
      },
    }).eq('id', session.integration_connection_id)
    if (connectionError) throw connectionError
    await recordEvent(client, session.integration_connection_id, session.actor_id, 'authorized', 'succeeded', {
      facebook_page_id: session.facebook_page_id,
      instagram_connected: Boolean(instagramId),
      granted_scope_count: META_OAUTH_SCOPES.length,
    })
    await client.from('meta_oauth_sessions').delete().eq('id', session.id)
    return redirect(config.appUrl, returnPath, { oauth: 'success', provider: 'meta' })
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? value(error.code, 80) || 'AUTHORIZATION_FAILED'
      : 'AUTHORIZATION_FAILED'
    await client.from('integration_connections').update({ status: 'error', last_check_status: 'failed' })
      .eq('id', session.integration_connection_id)
    await recordEvent(client, session.integration_connection_id, session.actor_id, 'authorization_failed', 'failed', {}, errorCode)
    await client.from('meta_oauth_sessions').delete().eq('id', session.id)
    return redirect(config.appUrl, returnPath, { oauth: 'error', provider: 'meta', reason: errorCode.toLowerCase() })
  }
}

async function sync(request: Request, body: Record<string, unknown>) {
  const config = configuration()
  const user = await leader(request, config.supabaseUrl)
  const client = admin(config.supabaseUrl)
  const connectionId = uuid(body.connection_id, 'connection ID')!
  const date = snapshotDate(body.snapshot_date)
  const { data: connection, error } = await client.from('meta_connections').select('*')
    .eq('integration_connection_id', connectionId)
    .eq('organization_id', ORGANIZATION_ID)
    .maybeSingle()
  if (error || !connection) return json({ error: 'Meta connection not found' }, 404)
  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) {
    return json({ error: 'Meta authorization has expired; reauthorise the connection' }, 409)
  }

  const token = await decryptSecret(
    connection.access_token_ciphertext,
    connection.access_token_iv,
    config.encryptionMaterial,
  )
  const untilDate = new Date(`${date}T00:00:00Z`)
  untilDate.setUTCDate(untilDate.getUTCDate() + 1)
  const range = { period: 'day', since: date, until: untilDate.toISOString().slice(0, 10) }
  const facebook = await graphGet(config, `${connection.facebook_page_id}/insights`, token, {
    metric: META_READ_METRICS.facebook.join(','),
    ...range,
  })
  const rows: Array<Record<string, unknown>> = [{
    organization_id: ORGANIZATION_ID,
    meta_connection_id: connection.id,
    snapshot_date: date,
    platform: 'facebook',
    reach: metric(facebook, 'page_impressions_unique'),
    impressions: metric(facebook, 'page_impressions'),
    engagement: metric(facebook, 'page_post_engagements'),
    spend: null,
  }]
  if (connection.instagram_account_id) {
    const instagram = await graphGet(config, `${connection.instagram_account_id}/insights`, token, {
      metric: META_READ_METRICS.instagram.join(','),
      ...range,
    })
    rows.push({
      organization_id: ORGANIZATION_ID,
      meta_connection_id: connection.id,
      snapshot_date: date,
      platform: 'instagram',
      reach: metric(instagram, 'reach'),
      impressions: metric(instagram, 'impressions'),
      engagement: metric(instagram, 'accounts_engaged'),
      spend: null,
    })
  }
  const { error: snapshotError } = await client.from('meta_performance_snapshots')
    .upsert(rows, { onConflict: 'meta_connection_id,snapshot_date,platform' })
  if (snapshotError) throw snapshotError
  await client.from('integration_connections').update({
    last_checked_at: new Date().toISOString(),
    last_check_status: 'passed',
  }).eq('id', connectionId)
  await recordEvent(client, connectionId, user.id, 'synced', 'succeeded', {
    snapshot_date: date,
    platforms: rows.map(row => row.platform),
  })
  return json({ synced: rows.length, snapshot_date: date })
}

async function disconnect(request: Request, body: Record<string, unknown>) {
  const config = configuration()
  const user = await leader(request, config.supabaseUrl)
  const client = admin(config.supabaseUrl)
  const connectionId = uuid(body.connection_id, 'connection ID')!
  const { data: connection } = await client.from('integration_connections').select('id,provider,public_config')
    .eq('id', connectionId).eq('organization_id', ORGANIZATION_ID).is('archived_at', null).maybeSingle()
  if (!connection || connection.provider !== 'meta') return json({ error: 'Meta connection not found' }, 404)
  const { error: deleteError } = await client.from('meta_connections').delete()
    .eq('integration_connection_id', connectionId).eq('organization_id', ORGANIZATION_ID)
  if (deleteError) throw deleteError
  await client.from('meta_oauth_sessions').delete().eq('integration_connection_id', connectionId)
  const existing = connection.public_config && typeof connection.public_config === 'object'
    ? connection.public_config as Record<string, unknown>
    : {}
  const {
    granted_scopes: _scopes,
    oauth_connected_at: _connectedAt,
    facebook_page_name: _pageName,
    ...retainedConfig
  } = existing
  const { error: updateError } = await client.from('integration_connections').update({
    status: 'disconnected',
    last_checked_at: new Date().toISOString(),
    last_check_status: 'not_configured',
    public_config: retainedConfig,
  }).eq('id', connectionId)
  if (updateError) throw updateError
  await recordEvent(client, connectionId, user.id, 'disconnected', 'succeeded')
  return json({ disconnected: true })
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method === 'GET') return callback(request)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!request.headers.get('Authorization')) return json({ error: 'Authentication required' }, 401)
  try {
    const body = await request.json() as Record<string, unknown>
    if (body.action === 'start') return await start(request, body)
    if (body.action === 'sync') return await sync(request, body)
    if (body.action === 'disconnect') return await disconnect(request, body)
    return json({ error: 'Unsupported Meta connector action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500
    return json(
      { error: error instanceof Error ? error.message : 'Meta connector failed' },
      Number.isFinite(status) ? status : 500,
    )
  }
}

if (import.meta.main) Deno.serve(handleRequest)
