import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { decryptSecret, encryptSecret, namedKey, pkceChallenge, randomToken, sha256 } from '../_shared/googleOAuthTokens.ts'

export { decryptSecret, encryptSecret, pkceChallenge, randomToken, sha256 }

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const LEADERS = new Set(['system_owner', 'operations_admin', 'executive'])
// Intentionally organic-only: no ads_read, ads_management, publishing, or manage scopes.
export const META_OAUTH_SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'read_insights', 'instagram_basic', 'instagram_manage_insights',
]
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const value = (input: unknown, limit = 240) => typeof input === 'string' ? input.trim().slice(0, limit) : ''
const id = (input: unknown, label: string) => { const result = value(input, 64); if (!/^[0-9a-f-]{36}$/i.test(result)) throw new Error(`A valid ${label} is required`); return result }
const graphId = (input: unknown, label: string, optional = false) => { const result = value(input, 64); if (optional && !result) return null; if (!/^\d+$/.test(result)) throw new Error(`A valid ${label} is required`); return result }
const safePath = (input: unknown) => { const path = value(input) || '/settings'; return /^\/[A-Za-z0-9/_?&=.-]*$/.test(path) && !path.startsWith('//') ? path : '/settings' }

function configuration() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const appId = Deno.env.get('META_APP_ID') ?? ''
  const appSecret = Deno.env.get('META_APP_SECRET') ?? ''
  const encryptionMaterial = Deno.env.get('META_TOKEN_ENCRYPTION_KEY') ?? ''
  const appUrl = (Deno.env.get('ANKA_APP_URL') || 'https://anka-os.vercel.app').replace(/\/$/, '')
  const redirectUri = Deno.env.get('META_OAUTH_REDIRECT_URI') || `${supabaseUrl}/functions/v1/meta-oauth`
  const apiVersion = Deno.env.get('META_GRAPH_API_VERSION') || 'v24.0'
  if (!supabaseUrl || !appId || !appSecret || encryptionMaterial.length < 32) throw new Error('Meta OAuth is not configured on the server')
  return { supabaseUrl, appId, appSecret, encryptionMaterial, appUrl, redirectUri, apiVersion }
}
function admin(url: string) {
  const key = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!key) throw new Error('Function environment is incomplete')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
async function leader(request: Request, url: string) {
  const authorization = request.headers.get('Authorization')
  const anon = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  if (!authorization || !anon) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const { data: member } = await client.from('organization_memberships').select('role,status,member_kind').eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).maybeSingle()
  if (!member || member.status !== 'active' || member.member_kind !== 'team' || !LEADERS.has(member.role)) throw Object.assign(new Error('Leadership access required'), { status: 403 })
  return user
}
function redirect(appUrl: string, path: string, params: Record<string, string>) { const url = new URL(safePath(path), `${appUrl}/`); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v)); return Response.redirect(url.toString(), 303) }
async function graphGet(config: ReturnType<typeof configuration>, path: string, token: string) {
  const url = new URL(`https://graph.facebook.com/${config.apiVersion}/${path.replace(/^\//, '')}`)
  url.searchParams.set('access_token', token)
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(`Meta read failed (${response.status})`)
  return body
}
function metric(data: Record<string, unknown>, name: string) { const rows = Array.isArray(data.data) ? data.data as Array<Record<string, unknown>> : []; const row = rows.find(item => item.name === name); const first = Array.isArray(row?.values) ? row.values[0] as Record<string, unknown> : row; const raw = first?.value; return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : null }

async function start(request: Request, body: Record<string, unknown>) {
  const config = configuration(); const user = await leader(request, config.supabaseUrl); const client = admin(config.supabaseUrl)
  const brandId = id(body.brand_id, 'brand ID'); const pageId = graphId(body.facebook_page_id, 'Facebook Page ID')!; const instagramId = graphId(body.instagram_account_id, 'Instagram account ID', true)
  const state = randomToken(); const verifier = randomToken(64); const encrypted = await encryptSecret(verifier, config.encryptionMaterial)
  await client.from('meta_oauth_sessions').delete().lt('expires_at', new Date().toISOString())
  const { error } = await client.from('meta_oauth_sessions').insert({ organization_id: ORGANIZATION_ID, brand_id: brandId, facebook_page_id: pageId, instagram_account_id: instagramId, actor_id: user.id, state_hash: await sha256(state), code_verifier_ciphertext: encrypted.ciphertext, code_verifier_iv: encrypted.iv, return_path: safePath(body.return_path) })
  if (error) throw error
  const authorize = new URL(`https://www.facebook.com/${config.apiVersion}/dialog/oauth`)
  authorize.search = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri, response_type: 'code', state, code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256', scope: META_OAUTH_SCOPES.join(',') }).toString()
  return json({ authorize_url: authorize.toString() })
}
async function callback(request: Request) {
  const config = configuration(); const params = new URL(request.url).searchParams; const state = params.get('state') || ''; const code = params.get('code') || ''; const client = admin(config.supabaseUrl)
  if (!state || !code) return redirect(config.appUrl, '/settings', { meta: 'error' })
  const { data: session } = await client.from('meta_oauth_sessions').select('*').eq('state_hash', await sha256(state)).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!session) return redirect(config.appUrl, '/settings', { meta: 'expired' })
  const { error: consumeError } = await client.from('meta_oauth_sessions').update({ consumed_at: new Date().toISOString() }).eq('id', session.id).is('consumed_at', null)
  if (consumeError) return redirect(config.appUrl, session.return_path, { meta: 'error' })
  const verifier = await decryptSecret(session.code_verifier_ciphertext, session.code_verifier_iv, config.encryptionMaterial)
  const tokenUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`)
  tokenUrl.search = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code, code_verifier: verifier }).toString()
  const tokenResponse = await fetch(tokenUrl, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  const token = await tokenResponse.json() as { access_token?: string, expires_in?: number }
  if (!tokenResponse.ok || !token.access_token) return redirect(config.appUrl, session.return_path, { meta: 'error' })
  await graphGet(config, `${session.facebook_page_id}?fields=id`, token.access_token)
  if (session.instagram_account_id) await graphGet(config, `${session.instagram_account_id}?fields=id`, token.access_token)
  const encrypted = await encryptSecret(token.access_token, config.encryptionMaterial)
  const expiresAt = Number.isFinite(Number(token.expires_in)) ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null
  const { data: existing } = await client.from('meta_connections').select('id').eq('organization_id', ORGANIZATION_ID).eq('brand_id', session.brand_id).eq('facebook_page_id', session.facebook_page_id).maybeSingle()
  const record = { organization_id: ORGANIZATION_ID, brand_id: session.brand_id, facebook_page_id: session.facebook_page_id, instagram_account_id: session.instagram_account_id, access_token_ciphertext: encrypted.ciphertext, access_token_iv: encrypted.iv, token_expires_at: expiresAt, connected_by: session.actor_id, connected_at: new Date().toISOString() }
  const result = existing ? await client.from('meta_connections').update(record).eq('id', existing.id) : await client.from('meta_connections').insert(record)
  if (result.error) return redirect(config.appUrl, session.return_path, { meta: 'error' })
  return redirect(config.appUrl, session.return_path, { meta: 'connected' })
}
async function sync(request: Request, body: Record<string, unknown>) {
  const config = configuration(); await leader(request, config.supabaseUrl); const client = admin(config.supabaseUrl); const connectionId = id(body.connection_id, 'connection ID'); const date = /^\d{4}-\d{2}-\d{2}$/.test(value(body.snapshot_date, 10)) ? value(body.snapshot_date, 10) : new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const { data: connection, error } = await client.from('meta_connections').select('*').eq('id', connectionId).eq('organization_id', ORGANIZATION_ID).maybeSingle(); if (error || !connection) return json({ error: 'Meta connection not found' }, 404)
  const token = await decryptSecret(connection.access_token_ciphertext, connection.access_token_iv, config.encryptionMaterial); const until = new Date(`${date}T00:00:00Z`); until.setUTCDate(until.getUTCDate() + 1); const range = `period=day&since=${date}&until=${until.toISOString().slice(0, 10)}`
  const facebook = await graphGet(config, `${connection.facebook_page_id}/insights?metric=page_impressions,page_impressions_unique,page_post_engagements&${range}`, token)
  const rows = [{ organization_id: ORGANIZATION_ID, meta_connection_id: connection.id, snapshot_date: date, platform: 'facebook', reach: metric(facebook, 'page_impressions_unique'), impressions: metric(facebook, 'page_impressions'), engagement: metric(facebook, 'page_post_engagements'), spend: null }]
  if (connection.instagram_account_id) { const instagram = await graphGet(config, `${connection.instagram_account_id}/insights?metric=reach,impressions,accounts_engaged&${range}`, token); rows.push({ organization_id: ORGANIZATION_ID, meta_connection_id: connection.id, snapshot_date: date, platform: 'instagram', reach: metric(instagram, 'reach'), impressions: metric(instagram, 'impressions'), engagement: metric(instagram, 'accounts_engaged'), spend: null }) }
  const result = await client.from('meta_performance_snapshots').upsert(rows, { onConflict: 'meta_connection_id,snapshot_date,platform' }); if (result.error) throw result.error
  return json({ synced: rows.length })
}
async function disconnect(request: Request, body: Record<string, unknown>) { const config = configuration(); await leader(request, config.supabaseUrl); const result = await admin(config.supabaseUrl).from('meta_connections').delete().eq('id', id(body.connection_id, 'connection ID')).eq('organization_id', ORGANIZATION_ID); if (result.error) throw result.error; return json({ disconnected: true }) }

export async function handleRequest(request: Request) { if (request.method === 'OPTIONS') return new Response('ok', { headers: cors }); try { if (request.method === 'GET') return await callback(request); if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405); const body = await request.json() as Record<string, unknown>; if (body.action === 'start') return await start(request, body); if (body.action === 'sync') return await sync(request, body); if (body.action === 'disconnect') return await disconnect(request, body); return json({ error: 'Unsupported Meta connector action' }, 400) } catch (error) { return json({ error: error instanceof Error ? error.message : 'Meta connector failed' }, (error as { status?: number }).status || 500) } }

if (import.meta.main) Deno.serve(handleRequest)
