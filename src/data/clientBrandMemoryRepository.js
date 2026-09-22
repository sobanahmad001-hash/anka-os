import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createClientBrandMemoryRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async list(organizationId, projectId) {
      if (![organizationId, projectId].every(validId)) throw new TypeError('Exact project required')
      const { data, error } = await client.rpc('get_client_brand_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
      })
      if (error) throw failure(error, 'Unable to load client and brand memory')
      if (data?.organization_id !== organizationId || data?.project_id !== projectId
        || !validId(data.client_id) || !validId(data.brand_id)
        || !Array.isArray(data.confirmed) || !Array.isArray(data.candidates)
        || [...data.confirmed, ...data.candidates].some(row =>
          !validId(row?.id) || !validId(row?.source_project_memory_id)
          || !validId(row?.source_comment_id) || !validId(row?.project_id)
          || !['client', 'brand'].includes(row?.scope_kind)
          || typeof row?.statement !== 'string'
          || row.client_id !== data.client_id
          || (row.scope_kind === 'brand' && row.brand_id !== data.brand_id)
          || (row.scope_kind === 'client' && row.brand_id !== null))) {
        throw Object.assign(new Error('Memory did not match the active client and brand'), { status: 409 })
      }
      return data
    },
    async propose({ organizationId, projectId, requestId, sourceMemoryId, scopeKind }) {
      if (![organizationId, projectId, requestId, sourceMemoryId].every(validId)
        || !['client', 'brand'].includes(scopeKind)) throw new TypeError('Exact promotion required')
      const { data, error } = await client.rpc('propose_client_brand_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_request_id: requestId, p_source_project_memory_id: sourceMemoryId,
        p_scope_kind: scopeKind,
      })
      if (error) throw failure(error, 'Unable to propose scoped memory')
      if (data?.memory_id !== requestId || !['candidate', 'confirmed', 'rejected', 'retired'].includes(data.status)) {
        throw Object.assign(new Error('Promotion receipt did not match'), { status: 409 })
      }
      return data
    },
    async review({ organizationId, projectId, memoryId, requestId, decision, evidence }) {
      if (![organizationId, projectId, memoryId, requestId].every(validId)
        || !['confirm', 'reject', 'retire'].includes(decision)
        || typeof evidence !== 'string' || !evidence.trim() || evidence.trim().length > 1000) {
        throw new TypeError('Exact review required')
      }
      const { data, error } = await client.rpc('review_client_brand_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_memory_id: memoryId, p_request_id: requestId,
        p_decision: decision, p_evidence: evidence.trim(),
      })
      if (error) throw failure(error, 'Unable to review scoped memory')
      if (data?.memory_id !== memoryId
        || data.status !== ({ confirm: 'confirmed', reject: 'rejected', retire: 'retired' })[decision]) {
        throw Object.assign(new Error('Review receipt did not match'), { status: 409 })
      }
      return data
    },
  }
}

export const clientBrandMemoryRepository = createClientBrandMemoryRepository(supabase)
