import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const PROVIDERS = new Set(['github', 'figma', 'wordpress', 'openai'])
const DEPARTMENTS = new Set(['content', 'design', 'development', 'marketing'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const SECRET_PREFIX = {
  github: 'ANKA_GITHUB_',
  figma: 'ANKA_FIGMA_',
  wordpress: 'ANKA_WORDPRESS_',
  openai: 'ANKA_OPENAI_',
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

const SAFE_CONNECTION_ERROR_CODES = new Set([
  'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_415', 'HTTP_422', 'HTTP_429',
  'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504', 'CONNECTION_FAILED', 'TIMEOUT',
])

export function safeConnectionHealthObservations(connectionIds: string[], events: Array<Record<string, unknown>>) {
  const visible = new Set(connectionIds)
  const latest = new Map<string, Record<string, unknown>>()
  for (const event of [...events].sort((left, right) =>
    Date.parse(String(right.occurred_at || '')) - Date.parse(String(left.occurred_at || '')))) {
    const connectionId = text(event.connection_id, 80)
    if (!visible.has(connectionId) || latest.has(connectionId)) continue
    const outcome = event.outcome === 'succeeded' ? 'succeeded' : event.outcome === 'failed' ? 'failed' : 'unknown'
    const rawCode = text(event.error_code, 80)
    latest.set(connectionId, {
      outcome,
      error_code: outcome === 'failed' ? (SAFE_CONNECTION_ERROR_CODES.has(rawCode) ? rawCode : 'UNKNOWN') : null,
      observed_at: text(event.occurred_at, 80) || null,
    })
  }
  return latest
}

export function currentConnectionHealthObservation(connection: Record<string, unknown>, observation?: Record<string, unknown>) {
  if (!observation?.observed_at) return null
  const observedAt = Date.parse(String(observation.observed_at))
  const changedAt = Date.parse(String(connection.updated_at || ''))
  if (!Number.isFinite(observedAt) || (Number.isFinite(changedAt) && observedAt < changedAt)) return null
  return observation
}

function safePublicConfig(provider: string, value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (provider === 'github') {
    return { owner: text(input.owner, 100), repo: text(input.repo, 100) }
  }
  if (provider === 'figma') {
    return { file_key: text(input.file_key, 160) }
  }
  if (provider === 'openai') {
    return { model_id: text(input.model_id, 120) || 'gpt-5.6-terra' }
  }
  return { username: text(input.username, 160) }
}

function safeDepartmentIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Select at least one department')
  const departmentIds = [...new Set(value.map((item) => text(item, 40)).filter(Boolean))]
  if (!departmentIds.length || departmentIds.some((departmentId) => !DEPARTMENTS.has(departmentId))) {
    throw new Error('Select valid department access')
  }
  return departmentIds
}

function verifiedModelIds(connection: Record<string, unknown>) {
  const config = connection.public_config && typeof connection.public_config === 'object'
    ? connection.public_config as Record<string, unknown> : {}
  return [...new Set([
    text(config.model_id, 120),
    ...(Array.isArray(config.verified_model_ids)
      ? config.verified_model_ids.map(model => text(model, 120)) : []),
  ].filter(Boolean))]
}

export async function syncInitialDepartmentChatModel(
  adminClient: ReturnType<typeof createClient<any>>,
  connection: Record<string, unknown>,
  actorId: string,
  organizationId = ORGANIZATION_ID,
) {
  if (connection.provider !== 'openai') return
  const modelId = verifiedModelIds(connection)[0]
  if (!modelId) return
  const [{ data: mappings, error: mappingError }, { data: history, error: historyError }] = await Promise.all([
    adminClient.from('integration_connection_departments').select('department_id')
      .eq('connection_id', connection.id).eq('organization_id', organizationId),
    adminClient.from('department_chat_model_configurations').select('model_id, revoked_at')
      .eq('connector_connection_id', connection.id).eq('organization_id', organizationId),
  ])
  if (mappingError) throw mappingError
  if (historyError) throw historyError
  const active = (history || []).filter(configuration => !configuration.revoked_at)
  const shouldInitialize = !(history || []).length
  const verifiedModelChanged = active.some(configuration => configuration.model_id !== modelId)
  if (!shouldInitialize && !verifiedModelChanged) return
  const departmentModelIds = Object.fromEntries((mappings || [])
    .map(mapping => mapping.department_id)
    .filter(departmentId => ['content', 'design', 'marketing'].includes(departmentId))
    .map(departmentId => [departmentId, [modelId]]))
  const { error } = await adminClient.rpc('configure_department_chat_model_allowlist', {
    p_organization_id: organizationId,
    p_connector_connection_id: connection.id,
    p_actor_id: actorId,
    p_department_model_ids: departmentModelIds,
  })
  if (error) throw error
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

async function testConnection(connection: Record<string, unknown>, secret: string, fetcher: typeof fetch = fetch) {
  const provider = String(connection.provider)
  const config = connection.public_config as Record<string, string>
  const startedAt = Date.now()
  let response: Response
  let summary: Record<string, unknown> = {}

  if (provider === 'github') {
    if (!config.owner || !config.repo) throw new Error('GitHub owner and repository are required')
    response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, {
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
    response = await fetcher(`https://api.figma.com/v1/files/${encodeURIComponent(config.file_key)}?depth=1`, {
      headers: { 'X-Figma-Token': secret },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const data = await response.json()
      summary = { file_name: data.name, last_modified: data.lastModified, version: data.version }
    }
  } else if (provider === 'wordpress') {
    const baseUrl = safeHttpsBaseUrl(connection.base_url)
    if (!baseUrl || !config.username) throw new Error('WordPress URL and username are required')
    response = await fetcher(`${baseUrl}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${btoa(`${config.username}:${secret}`)}` },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const data = await response.json()
      summary = { site: new URL(baseUrl).hostname, user_name: data.name, user_id: data.id }
    }
  } else {
    if (!config.model_id) throw new Error('OpenAI model ID is required')
    response = await fetcher(`https://api.openai.com/v1/models/${encodeURIComponent(config.model_id)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const data = await response.json()
      summary = { model_id: data.id, owned_by: data.owned_by }
    }
  }

  if (!response.ok) {
    throw Object.assign(new Error(`${provider} returned HTTP ${response.status}`), { code: `HTTP_${response.status}` })
  }
  return { latency_ms: Date.now() - startedAt, summary }
}

export async function handleRequest(req: Request, dependencies: {
  clients?: { userClient: any; adminClient: any }
  env?: (name: string) => string | undefined
  fetcher?: typeof fetch
} = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication required' }, 401)

    const environment = dependencies.env || ((name: string) => Deno.env.get(name))
    let userClient = dependencies.clients?.userClient
    let adminClient = dependencies.clients?.adminClient
    if (!userClient || !adminClient) {
      const supabaseUrl = environment('SUPABASE_URL') ?? ''
      const publishableKey = environment('SUPABASE_ANON_KEY') ?? ''
      const secretKey = environment('SUPABASE_SERVICE_ROLE_KEY') ?? environment('SERVICE_ROLE_KEY') ?? ''
      if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
      userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authorization } },
      })
      adminClient = createClient(supabaseUrl, secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    }
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Authentication required' }, 401)

    const body = await req.json()
    const action = text(body.action, 40)
    const modelScopedAction = action === 'list_model_allowlist' || action === 'configure_model_allowlist'
    const selectedOrganizationId = modelScopedAction ? text(body.organization_id, 80) : ORGANIZATION_ID
    if (modelScopedAction && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedOrganizationId)) {
      return json({ error: 'Selected organization is required' }, 400)
    }
    const { data: membership, error: membershipError } = await userClient
      .from('organization_memberships')
      .select('role, status, member_kind')
      .eq('organization_id', selectedOrganizationId)
      .eq('user_id', user.id)
      .single()
    if (membershipError || membership?.status !== 'active' || membership?.member_kind !== 'team') {
      return json({ error: 'Active team membership required' }, 403)
    }

    const isLeader = LEADER_ROLES.has(membership.role)

    if (action === 'list_model_allowlist') {
      const { data, error } = await userClient.from('integration_connections')
        .select('*, integration_connection_departments(department_id)')
        .eq('organization_id', selectedOrganizationId)
        .eq('provider', 'openai')
        .is('archived_at', null).order('display_name')
      if (error) throw error
      const { data: modelConfigurations, error: modelConfigurationError } = await userClient
        .from('department_chat_model_configurations')
        .select('id, department_id, connector_connection_id, model_id, display_name, is_default, revoked_at, verified_at')
        .eq('organization_id', selectedOrganizationId)
        .order('created_at', { ascending: true })
      if (modelConfigurationError) throw modelConfigurationError
      const connections = (data || []).map((connection: Record<string, any>) => {
        const mappings = Array.isArray(connection.integration_connection_departments)
          ? connection.integration_connection_departments as Array<{ department_id: string }>
          : []
        const { integration_connection_departments: _mappings, ...publicConnection } = connection
        return {
          ...publicConnection,
          department_ids: mappings.map(mapping => mapping.department_id),
          verified_model_ids: connection.status === 'verified' ? verifiedModelIds(connection) : [],
          model_configurations: (modelConfigurations || []).filter((configuration: Record<string, unknown>) =>
            configuration.connector_connection_id === connection.id && !configuration.revoked_at),
        }
      })
      return json({ organization_id: selectedOrganizationId, connections, can_manage: isLeader })
    }

    if (action === 'list') {
      const departmentId = text(body.department_id, 40)
      if (departmentId && !DEPARTMENTS.has(departmentId)) return json({ error: 'Unknown department' }, 400)
      const { data, error } = await userClient.from('integration_connections')
        .select('*, integration_connection_departments(department_id)')
        .is('archived_at', null).order('provider').order('display_name')
      if (error) throw error
      const visibleConnections = (data || []).map((connection: Record<string, any>) => {
        const mappings = Array.isArray(connection.integration_connection_departments)
          ? connection.integration_connection_departments as Array<{ department_id: string }>
          : []
        const { integration_connection_departments: _mappings, ...publicConnection } = connection
        return {
          ...publicConnection,
          department_ids: mappings.map((mapping) => mapping.department_id),
          secret_configured: Boolean(connection.secret_name && Deno.env.get(connection.secret_name)),
        }
      }).filter((connection: Record<string, any>) => !departmentId || connection.department_ids.includes(departmentId))
      const connectionIds = visibleConnections.map((connection: Record<string, any>) => String(connection.id))
      let observations = new Map<string, Record<string, unknown>>()
      if (connectionIds.length) {
        const { data: events, error: eventsError } = await adminClient.from('integration_events')
          .select('connection_id, outcome, error_code, occurred_at')
          .eq('organization_id', selectedOrganizationId).eq('operation', 'tested')
          .in('connection_id', connectionIds)
        if (!eventsError) observations = safeConnectionHealthObservations(connectionIds, events || [])
      }
      return json({
        connections: visibleConnections.map((connection: Record<string, any>) => ({
          ...connection,
          health_observation: currentConnectionHealthObservation(connection, observations.get(String(connection.id))),
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
      const departmentIds = safeDepartmentIds(body.department_ids)
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
      const { error: deleteMappingError } = await adminClient.from('integration_connection_departments')
        .delete().eq('connection_id', connection.id).eq('organization_id', ORGANIZATION_ID)
      if (deleteMappingError) throw deleteMappingError
      const { error: insertMappingError } = await adminClient.from('integration_connection_departments').insert(
        departmentIds.map((departmentId) => ({
          connection_id: connection.id,
          organization_id: ORGANIZATION_ID,
          department_id: departmentId,
          created_by: user.id,
        })),
      )
      if (insertMappingError) throw insertMappingError
      await adminClient.from('integration_events').insert({
        organization_id: ORGANIZATION_ID,
        connection_id: connection.id,
        actor_id: user.id,
        operation: connectionId ? 'updated' : 'created',
        outcome: 'succeeded',
        provider,
        metadata: { display_name: displayName, department_ids: departmentIds },
      })
      return json({ connection: { ...connection, department_ids: departmentIds, secret_configured: Boolean(secretName && Deno.env.get(secretName)) } })
    }

    const connectionId = text(body.connection_id, 80)
    if (!connectionId) return json({ error: 'Connection ID is required' }, 400)
    const connectionOrganizationId = action === 'configure_model_allowlist'
      ? selectedOrganizationId
      : ORGANIZATION_ID
    const { data: connection, error: connectionError } = await adminClient
      .from('integration_connections').select('*')
      .eq('id', connectionId).eq('organization_id', connectionOrganizationId).is('archived_at', null).single()
    if (connectionError || !connection) return json({ error: 'Connection not found' }, 404)
    if (!PROVIDERS.has(String(connection.provider))) {
      return json({ error: 'Use the Google authorization service for this connector' }, 400)
    }

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

    if (action === 'configure_model_allowlist') {
      if (connection.provider !== 'openai' || connection.status !== 'verified') {
        return json({ error: 'A verified OpenAI connector is required' }, 409)
      }
      const requested = body.department_model_ids && typeof body.department_model_ids === 'object'
        ? body.department_model_ids as Record<string, unknown> : {}
      const { data: mappings, error: mappingError } = await adminClient
        .from('integration_connection_departments').select('department_id')
        .eq('connection_id', connection.id).eq('organization_id', selectedOrganizationId)
      if (mappingError) throw mappingError
      const mappedDepartments = new Set<string>((mappings || []).map((mapping: { department_id: string }) => mapping.department_id)
        .filter((departmentId: string) => ['content', 'design', 'marketing'].includes(departmentId)))
      const verified = new Set(verifiedModelIds(connection))
      const selected: Array<{ department_id: string; model_id: string }> = []
      for (const [departmentId, values] of Object.entries(requested)) {
        if (!mappedDepartments.has(departmentId) || !Array.isArray(values)) {
          return json({ error: 'Model allowlist contains an unmapped department' }, 400)
        }
        for (const value of values) {
          const modelId = text(value, 120)
          if (!modelId || !verified.has(modelId)) {
            return json({ error: 'Model allowlist contains an unverified model' }, 400)
          }
          selected.push({ department_id: departmentId, model_id: modelId })
        }
      }
      const departmentModelIds = Object.fromEntries([...mappedDepartments].map(departmentId => [
        departmentId,
        selected.filter(entry => entry.department_id === departmentId).map(entry => entry.model_id),
      ]))
      const { error: configureError } = await adminClient.rpc('configure_department_chat_model_allowlist', {
        p_organization_id: selectedOrganizationId,
        p_connector_connection_id: connection.id,
        p_actor_id: user.id,
        p_department_model_ids: departmentModelIds,
      })
      if (configureError) throw configureError
      await adminClient.from('integration_events').insert({
        organization_id: selectedOrganizationId, connection_id: connection.id, actor_id: user.id,
        operation: 'updated', outcome: 'succeeded', provider: 'openai',
        metadata: { change: 'department_chat_model_allowlist', departments: [...mappedDepartments] },
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
        const result = await testConnection(connection, providerSecret, dependencies.fetcher)
        await adminClient.from('integration_connections').update({
          status: 'verified', last_checked_at: new Date().toISOString(), last_check_status: 'passed',
        }).eq('id', connection.id)
        await syncInitialDepartmentChatModel(adminClient, connection, user.id)
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
}

if (import.meta.main) serve(req => handleRequest(req))
