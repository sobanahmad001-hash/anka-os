import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const PROVIDERS = new Set(['github', 'figma', 'wordpress'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const SECRET_PREFIX = {
  github: 'ANKA_GITHUB_',
  figma: 'ANKA_FIGMA_',
  wordpress: 'ANKA_WORDPRESS_',
} as const

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function text(value: unknown, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safePublicConfig(provider: string, value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (provider === 'github') {
    return { owner: text(input.owner, 100), repo: text(input.repo, 100) }
  }
  if (provider === 'figma') {
    return { file_key: text(input.file_key, 160) }
  }
  return { username: text(input.username, 160) }
}

function validateSecretName(provider: string, value: unknown) {
  const secretName = text(value, 120)
  if (!secretName) return null
  if (!/^[A-Z][A-Z0-9_]+$/.test(secretName) || !secretName.startsWith(SECRET_PREFIX[provider as keyof typeof SECRET_PREFIX])) {
    throw new Error(`Secret name must start with ${SECRET_PREFIX[provider as keyof typeof SECRET_PREFIX]}`)
  }
  return secretName
}

function safeHttpsBaseUrl(value: unknown) {
  const raw = text(value, 500)
  if (!raw) return null
  const url = new URL(raw)
  const host = url.hostname.toLowerCase()
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host.endsWith('.local') || privateIpv4.test(host)) {
    throw new Error('Only public HTTPS integration URLs are allowed')
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function testConnection(connection: Record<string, unknown>, secret: string) {
  const provider = String(connection.provider)
  const config = connection.public_config as Record<string, string>
  const startedAt = Date.now()
  let response: Response
  let summary: Record<string, unknown> = {}

  if (provider === 'github') {
    if (!config.owner || !config.repo) throw new Error('GitHub owner and repository are required')
    response = await fetch(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const data = await response.json()
      summary = { repository: data.full_name, private: Boolean(data.private), default_branch: data.default_branch }
    }
  } else if (provider === 'figma') {
    if (!config.file_key) throw new Error('Figma file key is required')
    response = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(config.file_key)}?depth=1`, {
      headers: { 'X-Figma-Token': secret },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const data = await response.json()
      summary = { file_name: data.name, last_modified: data.lastModified, version: data.version }
    }
  } else {
    const baseUrl = safeHttpsBaseUrl(connection.base_url)
    if (!baseUrl || !config.username) throw new Error('WordPress URL and username are required')
    response = await fetch(`${baseUrl}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${btoa(`${config.username}:${secret}`)}` },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const data = await response.json()
      summary = { site: new URL(baseUrl).hostname, user_name: data.name, user_id: data.id }
    }
  }

  if (!response.ok) {
    throw Object.assign(new Error(`${provider} returned HTTP ${response.status}`), { code: `HTTP_${response.status}` })
  }
  return { latency_ms: Date.now() - startedAt, summary }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication required' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
    })
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Authentication required' }, 401)

    const { data: membership, error: membershipError } = await userClient
      .from('organization_memberships')
      .select('role, status, member_kind')
      .eq('organization_id', ORGANIZATION_ID)
      .eq('user_id', user.id)
      .single()
    if (membershipError || membership?.status !== 'active' || membership?.member_kind !== 'team') {
      return json({ error: 'Active team membership required' }, 403)
    }

    const body = await req.json()
    const action = text(body.action, 40)
    const isLeader = LEADER_ROLES.has(membership.role)

    if (action === 'list') {
      const { data, error } = await userClient.from('integration_connections')
        .select('*').is('archived_at', null).order('provider').order('display_name')
      if (error) throw error
      return json({
        connections: (data || []).map((connection) => ({
          ...connection,
          secret_configured: Boolean(connection.secret_name && Deno.env.get(connection.secret_name)),
        })),
        can_manage: isLeader,
      })
    }

    if (!isLeader) return json({ error: 'Leadership access required' }, 403)

    if (action === 'save') {
      const provider = text(body.provider, 40)
      if (!PROVIDERS.has(provider)) return json({ error: 'Unsupported provider' }, 400)
      const displayName = text(body.display_name, 120)
      if (!displayName) return json({ error: 'Connection name is required' }, 400)
      const secretName = validateSecretName(provider, body.secret_name)
      const payload = {
        organization_id: ORGANIZATION_ID,
        provider,
        display_name: displayName,
        base_url: provider === 'wordpress' ? safeHttpsBaseUrl(body.base_url) : null,
        public_config: safePublicConfig(provider, body.public_config),
        secret_name: secretName,
        status: secretName && Deno.env.get(secretName) ? 'configured' : 'disconnected',
        created_by: user.id,
        archived_at: null,
      }
      const connectionId = text(body.connection_id, 80)
      const query = connectionId
        ? adminClient.from('integration_connections').update(payload).eq('id', connectionId).eq('organization_id', ORGANIZATION_ID)
        : adminClient.from('integration_connections').insert(payload)
      const { data: connection, error } = await query.select().single()
      if (error) throw error
      await adminClient.from('integration_events').insert({
        organization_id: ORGANIZATION_ID,
        connection_id: connection.id,
        actor_id: user.id,
        operation: connectionId ? 'updated' : 'created',
        outcome: 'succeeded',
        provider,
        metadata: { display_name: displayName },
      })
      return json({ connection: { ...connection, secret_configured: Boolean(secretName && Deno.env.get(secretName)) } })
    }

    const connectionId = text(body.connection_id, 80)
    if (!connectionId) return json({ error: 'Connection ID is required' }, 400)
    const { data: connection, error: connectionError } = await adminClient
      .from('integration_connections').select('*')
      .eq('id', connectionId).eq('organization_id', ORGANIZATION_ID).is('archived_at', null).single()
    if (connectionError || !connection) return json({ error: 'Connection not found' }, 404)

    if (action === 'disable') {
      const now = new Date().toISOString()
      const { error } = await adminClient.from('integration_connections')
        .update({ status: 'disabled', archived_at: now }).eq('id', connection.id)
      if (error) throw error
      await adminClient.from('integration_events').insert({
        organization_id: ORGANIZATION_ID,
        connection_id: connection.id,
        actor_id: user.id,
        operation: 'disabled',
        outcome: 'succeeded',
        provider: connection.provider,
        metadata: { display_name: connection.display_name },
      })
      return json({ success: true })
    }

    if (action === 'test') {
      const providerSecret = connection.secret_name ? Deno.env.get(connection.secret_name) : null
      if (!providerSecret) {
        await adminClient.from('integration_connections').update({
          status: 'disconnected', last_checked_at: new Date().toISOString(), last_check_status: 'not_configured',
        }).eq('id', connection.id)
        return json({ error: 'The named Edge Function secret is not configured' }, 409)
      }
      const startedAt = Date.now()
      try {
        const result = await testConnection(connection, providerSecret)
        await adminClient.from('integration_connections').update({
          status: 'verified', last_checked_at: new Date().toISOString(), last_check_status: 'passed',
        }).eq('id', connection.id)
        await adminClient.from('integration_events').insert({
          organization_id: ORGANIZATION_ID,
          connection_id: connection.id,
          actor_id: user.id,
          operation: 'tested',
          outcome: 'succeeded',
          provider: connection.provider,
          latency_ms: result.latency_ms,
          metadata: result.summary,
        })
        return json({ success: true, summary: result.summary, latency_ms: result.latency_ms })
      } catch (testError) {
        const code = testError && typeof testError === 'object' && 'code' in testError ? String(testError.code) : 'CONNECTION_FAILED'
        await adminClient.from('integration_connections').update({
          status: 'error', last_checked_at: new Date().toISOString(), last_check_status: 'failed',
        }).eq('id', connection.id)
        await adminClient.from('integration_events').insert({
          organization_id: ORGANIZATION_ID,
          connection_id: connection.id,
          actor_id: user.id,
          operation: 'tested',
          outcome: 'failed',
          provider: connection.provider,
          latency_ms: Date.now() - startedAt,
          error_code: code,
          metadata: {},
        })
        return json({ error: 'Connection test failed', code }, 502)
      }
    }

    return json({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected integration gateway error'
    return json({ error: message }, 400)
  }
})
