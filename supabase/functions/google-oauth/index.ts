import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import {
  decryptSecret,
  encryptSecret,
  googleCredentialConfiguration,
  namedKey,
  pkceChallenge,
  randomToken,
  sha256,
} from '../_shared/googleOAuthTokens.ts'

export { decryptSecret, encryptSecret, pkceChallenge, randomToken, sha256 }

type AnySupabaseClient = ReturnType<typeof createClient<any>>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const GOOGLE_PROVIDERS = new Set(['google_analytics', 'google_search_console', 'google_ads'])
const DEPARTMENTS = new Set(['content', 'design', 'development', 'marketing'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const PROVIDER_DEPARTMENTS: Record<string, Set<string>> = {
  google_analytics: new Set(['development', 'marketing']),
  google_search_console: new Set(['content', 'development', 'marketing']),
  google_ads: new Set(['marketing']),
}
const PROVIDER_SCOPES: Record<string, string> = {
  google_analytics: 'https://www.googleapis.com/auth/analytics.readonly',
  google_search_console: 'https://www.googleapis.com/auth/webmasters.readonly',
  google_ads: 'https://www.googleapis.com/auth/adwords',
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function text(value: unknown, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeProvider(value: unknown) {
  const provider = text(value, 40)
  if (!GOOGLE_PROVIDERS.has(provider)) throw new Error('Unsupported Google connector')
  return provider
}

export function safeReportingConfig(provider: string, value: unknown) {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  if (provider === 'google_analytics') {
    const propertyId = text(input.property_id, 24).replace(/^properties\//, '')
    if (!/^\d{4,20}$/.test(propertyId)) throw new Error('A valid GA4 property ID is required')
    return { property_id: propertyId }
  }
  if (provider === 'google_search_console') {
    const siteUrl = text(input.site_url, 500)
    if (siteUrl.startsWith('sc-domain:')) {
      const domain = siteUrl.slice(10).toLowerCase()
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('A valid Search Console domain property is required')
      return { site_url: `sc-domain:${domain}` }
    }
    const parsed = new URL(siteUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('A valid Search Console property URL is required')
    }
    return { site_url: parsed.toString() }
  }
  const customerId = text(input.customer_id, 24).replaceAll('-', '')
  const loginCustomerId = text(input.login_customer_id, 24).replaceAll('-', '')
  if (!/^\d{10}$/.test(customerId)) throw new Error('A valid 10-digit Google Ads customer ID is required')
  if (loginCustomerId && !/^\d{10}$/.test(loginCustomerId)) {
    throw new Error('Google Ads manager ID must contain 10 digits')
  }
  return { customer_id: customerId, login_customer_id: loginCustomerId }
}

export function safeDepartmentIds(provider: string, value: unknown) {
  if (!Array.isArray(value)) throw new Error('Select at least one department')
  const departmentIds = [...new Set(value.map(item => text(item, 40)).filter(Boolean))]
  const allowed = PROVIDER_DEPARTMENTS[provider]
  if (
    !departmentIds.length
    || departmentIds.some(departmentId => !DEPARTMENTS.has(departmentId) || !allowed?.has(departmentId))
  ) {
    throw new Error('Select valid departments for this Google connector')
  }
  return departmentIds
}

function safeReturnPath(value: unknown) {
  const path = text(value, 240) || '/settings'
  return /^\/[A-Za-z0-9/_?&=.-]*$/.test(path) && !path.startsWith('//') ? path : '/settings'
}

function oauthConfiguration() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const { clientId, clientSecret, encryptionMaterial } = googleCredentialConfiguration()
  const appUrl = (Deno.env.get('ANKA_APP_URL') || 'https://anka-os.vercel.app').replace(/\/$/, '')
  const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')
    || `${supabaseUrl}/functions/v1/google-oauth`
  if (!supabaseUrl) {
    throw new Error('Google OAuth is not configured on the server')
  }
  return { supabaseUrl, clientId, clientSecret, encryptionMaterial, appUrl, redirectUri }
}

function appRedirect(appUrl: string, returnPath: string, params: Record<string, string>) {
  const url = new URL(safeReturnPath(returnPath), `${appUrl}/`)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return Response.redirect(url.toString(), 303)
}

async function authenticatedLeader(request: Request, supabaseUrl: string) {
  const authorization = request.headers.get('Authorization')
  if (!authorization) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  if (!publishableKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const { data: membership, error: membershipError } = await userClient
    .from('organization_memberships')
    .select('role, status, member_kind')
    .eq('organization_id', ORGANIZATION_ID)
    .eq('user_id', user.id)
    .single()
  if (
    membershipError
    || membership?.status !== 'active'
    || membership?.member_kind !== 'team'
    || !LEADER_ROLES.has(membership.role)
  ) {
    throw Object.assign(new Error('Leadership access required'), { status: 403 })
  }
  return user
}

function adminClient(supabaseUrl: string): AnySupabaseClient {
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!secretKey) throw new Error('Function environment is incomplete')
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function startAuthorization(request: Request, body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!supabaseUrl) throw new Error('Function environment is incomplete')
  const user = await authenticatedLeader(request, supabaseUrl)
  const config = oauthConfiguration()
  const admin = adminClient(config.supabaseUrl)
  const provider = safeProvider(body.provider)
  const reportingConfig = safeReportingConfig(provider, body.public_config)
  const departmentIds = safeDepartmentIds(provider, body.department_ids)
  const displayName = text(body.display_name, 120)
  if (!displayName) return json({ error: 'Connection name is required' }, 400)
  const returnPath = safeReturnPath(body.return_path)
  const requestedConnectionId = text(body.connection_id, 80)
  let connection: Record<string, unknown>

  if (requestedConnectionId) {
    const { data: existing, error } = await admin.from('integration_connections')
      .select('id, provider, display_name, public_config')
      .eq('id', requestedConnectionId)
      .eq('organization_id', ORGANIZATION_ID)
      .is('archived_at', null)
      .single()
    if (error || !existing || existing.provider !== provider) {
      return json({ error: 'Google connection not found' }, 404)
    }
    const existingConfig = existing.public_config && typeof existing.public_config === 'object'
      ? existing.public_config as Record<string, unknown> : {}
    const { data: updated, error: updateError } = await admin.from('integration_connections')
      .update({ display_name: displayName, status: 'authorizing', last_check_status: null,
        public_config: { ...existingConfig, ...reportingConfig } })
      .eq('id', existing.id)
      .select()
      .single()
    if (updateError) throw updateError
    connection = updated
  } else {
    const { data: inserted, error } = await admin.from('integration_connections').insert({
      organization_id: ORGANIZATION_ID,
      provider,
      display_name: displayName,
      public_config: reportingConfig,
      secret_name: null,
      status: 'authorizing',
      created_by: user.id,
    }).select().single()
    if (error) throw error
    connection = inserted
  }

  const { error: deleteMappingError } = await admin.from('integration_connection_departments')
    .delete().eq('connection_id', connection.id).eq('organization_id', ORGANIZATION_ID)
  if (deleteMappingError) throw deleteMappingError
  const { error: mappingError } = await admin.from('integration_connection_departments').insert(
    departmentIds.map(departmentId => ({
      connection_id: connection.id,
      organization_id: ORGANIZATION_ID,
      department_id: departmentId,
      created_by: user.id,
    })),
  )
  if (mappingError) throw mappingError

  await admin.from('integration_oauth_sessions').delete().lt('expires_at', new Date().toISOString())
  await admin.from('integration_oauth_sessions').delete().eq('connection_id', connection.id)
  const state = randomToken(32)
  const verifier = randomToken(64)
  const challenge = await pkceChallenge(verifier)
  const encryptedVerifier = await encryptSecret(verifier, config.encryptionMaterial)
  const { error: sessionError } = await admin.from('integration_oauth_sessions').insert({
    organization_id: ORGANIZATION_ID,
    connection_id: connection.id,
    provider,
    actor_id: user.id,
    state_hash: await sha256(state),
    code_verifier_ciphertext: encryptedVerifier.ciphertext,
    code_verifier_iv: encryptedVerifier.iv,
    return_path: returnPath,
  })
  if (sessionError) throw sessionError

  await admin.from('integration_events').insert({
    organization_id: ORGANIZATION_ID,
    connection_id: connection.id,
    actor_id: user.id,
    operation: 'authorization_started',
    outcome: 'succeeded',
    provider,
    metadata: { display_name: displayName, department_ids: departmentIds },
  })

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizeUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: `openid email ${PROVIDER_SCOPES[provider]}`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  return json({ authorize_url: authorizeUrl.toString(), connection_id: connection.id })
}

async function configureReporting(request: Request, body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!supabaseUrl) throw new Error('Function environment is incomplete')
  await authenticatedLeader(request, supabaseUrl)
  const admin = adminClient(supabaseUrl)
  const connectionId = text(body.connection_id, 80)
  if (!connectionId) return json({ error: 'Connection ID is required' }, 400)
  const { data: connection, error } = await admin.from('integration_connections')
    .select('id, provider, public_config').eq('id', connectionId)
    .eq('organization_id', ORGANIZATION_ID).is('archived_at', null).maybeSingle()
  if (error || !connection || !GOOGLE_PROVIDERS.has(connection.provider)) {
    return json({ error: 'Google connection not found' }, 404)
  }
  const reportingConfig = safeReportingConfig(connection.provider, body.public_config)
  const existingConfig = connection.public_config && typeof connection.public_config === 'object'
    ? connection.public_config as Record<string, unknown> : {}
  const publicConfig = { ...existingConfig, ...reportingConfig }
  const { error: updateError } = await admin.from('integration_connections')
    .update({ public_config: publicConfig }).eq('id', connection.id)
  if (updateError) throw updateError
  return json({ connection: { id: connection.id, public_config: publicConfig } })
}

async function disconnectAuthorization(request: Request, body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!supabaseUrl) throw new Error('Function environment is incomplete')
  const user = await authenticatedLeader(request, supabaseUrl)
  const config = oauthConfiguration()
  const admin = adminClient(config.supabaseUrl)
  const connectionId = text(body.connection_id, 80)
  if (!connectionId) return json({ error: 'Connection ID is required' }, 400)
  const { data: connection, error } = await admin.from('integration_connections')
    .select('id, provider, display_name, public_config')
    .eq('id', connectionId)
    .eq('organization_id', ORGANIZATION_ID)
    .is('archived_at', null)
    .single()
  if (error || !connection || !GOOGLE_PROVIDERS.has(connection.provider)) {
    return json({ error: 'Google connection not found' }, 404)
  }

  const { data: credential } = await admin.from('integration_oauth_credentials')
    .select('access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv')
    .eq('connection_id', connection.id)
    .maybeSingle()
  let revoked = false
  if (credential) {
    try {
      const token = await decryptSecret(
        credential.refresh_token_ciphertext || credential.access_token_ciphertext,
        credential.refresh_token_iv || credential.access_token_iv,
        config.encryptionMaterial,
      )
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10000),
      })
      revoked = response.ok
    } catch { /* delete the local credential even if remote revocation is unavailable */ }
  }
  const { error: deleteError } = await admin.from('integration_oauth_credentials')
    .delete().eq('connection_id', connection.id)
  if (deleteError) throw deleteError
  const publicConfig = connection.public_config && typeof connection.public_config === 'object'
    ? connection.public_config as Record<string, unknown>
    : {}
  const {
    authorized_email: _email,
    granted_scopes: _scopes,
    oauth_connected_at: _connectedAt,
    ...retainedConfig
  } = publicConfig
  const { error: updateError } = await admin.from('integration_connections').update({
    status: 'disconnected',
    last_checked_at: new Date().toISOString(),
    last_check_status: 'not_configured',
    public_config: retainedConfig,
  }).eq('id', connection.id)
  if (updateError) throw updateError
  await admin.from('integration_events').insert({
    organization_id: ORGANIZATION_ID,
    connection_id: connection.id,
    actor_id: user.id,
    operation: 'disconnected',
    outcome: 'succeeded',
    provider: connection.provider,
    metadata: { display_name: connection.display_name, remote_revoked: revoked },
  })
  return json({ success: true, remote_revoked: revoked })
}

async function oauthCallback(request: Request) {
  let config: ReturnType<typeof oauthConfiguration>
  try {
    config = oauthConfiguration()
  } catch {
    return new Response('Google OAuth is not configured on the server.', { status: 503 })
  }
  const admin = adminClient(config.supabaseUrl)
  const url = new URL(request.url)
  const state = text(url.searchParams.get('state'), 180)
  if (!state) return appRedirect(config.appUrl, '/settings', { oauth: 'error', reason: 'missing_state' })
  const { data: session, error: sessionError } = await admin.from('integration_oauth_sessions')
    .select('*, integration_connections(id, display_name, public_config, status)')
    .eq('state_hash', await sha256(state))
    .maybeSingle()
  if (
    sessionError || !session || session.consumed_at
    || new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return appRedirect(config.appUrl, '/settings', { oauth: 'error', reason: 'invalid_or_expired_state' })
  }
  const returnPath = safeReturnPath(session.return_path)
  const provider = session.provider
  const claimedAt = new Date().toISOString()
  const { data: claim, error: claimError } = await admin.from('integration_oauth_sessions')
    .update({ consumed_at: claimedAt })
    .eq('id', session.id)
    .is('consumed_at', null)
    .gt('expires_at', claimedAt)
    .select('id')
    .maybeSingle()
  if (claimError || !claim) {
    return appRedirect(config.appUrl, '/settings', { oauth: 'error', reason: 'invalid_or_expired_state' })
  }
  const googleError = text(url.searchParams.get('error'), 80)
  if (googleError) {
    await admin.from('integration_connections').update({ status: 'error', last_check_status: 'failed' }).eq('id', session.connection_id)
    await admin.from('integration_events').insert({
      organization_id: ORGANIZATION_ID,
      connection_id: session.connection_id,
      actor_id: session.actor_id,
      operation: 'authorization_failed',
      outcome: 'failed',
      provider,
      error_code: googleError,
      metadata: {},
    })
    await admin.from('integration_oauth_sessions').delete().eq('id', session.id)
    return appRedirect(config.appUrl, returnPath, { oauth: 'error', provider, reason: googleError })
  }

  const code = text(url.searchParams.get('code'), 4096)
  if (!code) {
    await admin.from('integration_connections').update({ status: 'error', last_check_status: 'failed' }).eq('id', session.connection_id)
    await admin.from('integration_events').insert({
      organization_id: ORGANIZATION_ID,
      connection_id: session.connection_id,
      actor_id: session.actor_id,
      operation: 'authorization_failed',
      outcome: 'failed',
      provider,
      error_code: 'MISSING_CODE',
      metadata: {},
    })
    await admin.from('integration_oauth_sessions').delete().eq('id', session.id)
    return appRedirect(config.appUrl, returnPath, { oauth: 'error', provider, reason: 'missing_code' })
  }

  try {
    const verifier = await decryptSecret(
      session.code_verifier_ciphertext,
      session.code_verifier_iv,
      config.encryptionMaterial,
    )
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10000),
    })
    const tokens = await tokenResponse.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
      error?: string
    }
    if (!tokenResponse.ok || !tokens.access_token) {
      throw Object.assign(new Error('Google token exchange failed'), { code: tokens.error || `HTTP_${tokenResponse.status}` })
    }
    const grantedScopes = text(tokens.scope, 4000).split(/\s+/).filter(Boolean)
    if (!grantedScopes.includes(PROVIDER_SCOPES[provider])) {
      throw Object.assign(new Error('Required Google permission was not granted'), { code: 'SCOPE_NOT_GRANTED' })
    }
    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10000),
    })
    const userInfo = await userInfoResponse.json() as { sub?: string, email?: string }
    if (!userInfoResponse.ok || !userInfo.sub) {
      throw Object.assign(new Error('Google account verification failed'), { code: `USERINFO_${userInfoResponse.status}` })
    }

    const { data: existingCredential } = await admin.from('integration_oauth_credentials')
      .select('refresh_token_ciphertext, refresh_token_iv')
      .eq('connection_id', session.connection_id)
      .maybeSingle()
    const wasReauthorization = Boolean(existingCredential)
    const encryptedAccess = await encryptSecret(tokens.access_token, config.encryptionMaterial)
    const encryptedRefresh = tokens.refresh_token
      ? await encryptSecret(tokens.refresh_token, config.encryptionMaterial)
      : existingCredential
        ? { ciphertext: existingCredential.refresh_token_ciphertext, iv: existingCredential.refresh_token_iv }
        : null
    if (!encryptedRefresh) {
      throw Object.assign(new Error('Google did not return an offline refresh token'), { code: 'REFRESH_TOKEN_MISSING' })
    }
    const expiresIn = Number(tokens.expires_in)
    const expiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString()
    const { error: credentialError } = await admin.from('integration_oauth_credentials').upsert({
      connection_id: session.connection_id,
      organization_id: ORGANIZATION_ID,
      provider,
      access_token_ciphertext: encryptedAccess.ciphertext,
      access_token_iv: encryptedAccess.iv,
      refresh_token_ciphertext: encryptedRefresh.ciphertext,
      refresh_token_iv: encryptedRefresh.iv,
      token_type: text(tokens.token_type, 40) || 'Bearer',
      granted_scopes: grantedScopes,
      access_token_expires_at: expiresAt,
      provider_subject_hash: await sha256(userInfo.sub),
    }, { onConflict: 'connection_id' })
    if (credentialError) throw credentialError

    const existingConfig = session.integration_connections?.public_config
      && typeof session.integration_connections.public_config === 'object'
      ? session.integration_connections.public_config as Record<string, unknown>
      : {}
    const connectedAt = new Date().toISOString()
    const { error: connectionError } = await admin.from('integration_connections').update({
      status: 'verified',
      last_checked_at: connectedAt,
      last_check_status: 'passed',
      public_config: {
        ...existingConfig,
        authorized_email: text(userInfo.email, 254),
        granted_scopes: grantedScopes,
        oauth_connected_at: connectedAt,
      },
    }).eq('id', session.connection_id)
    if (connectionError) throw connectionError
    await admin.from('integration_events').insert({
      organization_id: ORGANIZATION_ID,
      connection_id: session.connection_id,
      actor_id: session.actor_id,
      operation: wasReauthorization ? 'reauthorized' : 'authorized',
      outcome: 'succeeded',
      provider,
      metadata: {
        authorized_email: text(userInfo.email, 254),
        granted_scope_count: grantedScopes.length,
      },
    })
    await admin.from('integration_oauth_sessions').delete().eq('id', session.id)
    return appRedirect(config.appUrl, returnPath, { oauth: 'success', provider })
  } catch (error) {
    const codeValue = error && typeof error === 'object' && 'code' in error
      ? text(error.code, 80) || 'AUTHORIZATION_FAILED'
      : 'AUTHORIZATION_FAILED'
    await admin.from('integration_connections').update({ status: 'error', last_check_status: 'failed' })
      .eq('id', session.connection_id)
    await admin.from('integration_events').insert({
      organization_id: ORGANIZATION_ID,
      connection_id: session.connection_id,
      actor_id: session.actor_id,
      operation: 'authorization_failed',
      outcome: 'failed',
      provider,
      error_code: codeValue,
      metadata: {},
    })
    await admin.from('integration_oauth_sessions').delete().eq('id', session.id)
    return appRedirect(config.appUrl, returnPath, { oauth: 'error', provider, reason: codeValue.toLowerCase() })
  }
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method === 'GET') return oauthCallback(request)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!request.headers.get('Authorization')) return json({ error: 'Authentication required' }, 401)
  try {
    const body = await request.json() as Record<string, unknown>
    if (body.action === 'start') return startAuthorization(request, body)
    if (body.action === 'configure_reporting') return configureReporting(request, body)
    if (body.action === 'disconnect') return disconnectAuthorization(request, body)
    return json({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    const message = error instanceof Error ? error.message : 'Unexpected Google OAuth error'
    return json({ error: message }, Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
