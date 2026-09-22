import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const kinds = ['department', 'client_brand']
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createPromotedMemoryRetentionRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async list(organizationId) {
      if (!validId(organizationId)) throw new TypeError('Exact organization required')
      const { data, error } = await client.rpc('get_promoted_ai_memory_history', {
        p_organization_id: organizationId,
      })
      if (error) throw failure(error, 'Unable to load promoted memory history')
      if (data?.organization_id !== organizationId
        || !Array.isArray(data.department) || !Array.isArray(data.client_brand)
        || data.department.some(row => !validId(row?.id)
          || !validId(row?.source_project_memory_id)
          || typeof row?.generalized_statement !== 'string')
        || data.client_brand.some(row => !validId(row?.id)
          || !validId(row?.source_project_memory_id)
          || !validId(row?.client_id)
          || (row.brand_id !== null && !validId(row.brand_id)))) {
        throw Object.assign(new Error('Promotion history did not match the organization'), { status: 409 })
      }
      return data
    },
    async preview(organizationId, memoryKind, memoryId) {
      if (!validId(organizationId) || !validId(memoryId) || !kinds.includes(memoryKind)) {
        throw new TypeError('Exact promoted memory required')
      }
      const { data, error } = await client.rpc('preview_promoted_ai_memory_purge', {
        p_organization_id: organizationId, p_memory_kind: memoryKind, p_memory_id: memoryId,
      })
      if (error) throw failure(error, 'Unable to preview promotion purge')
      if (data?.organization_id !== organizationId
        || data?.memory_kind !== memoryKind || data?.memory_id !== memoryId
        || !validId(data?.source_project_memory_id)
        || !/^[0-9a-f]{64}$/.test(data?.fingerprint || '')) {
        throw Object.assign(new Error('Promotion purge preview did not match'), { status: 409 })
      }
      return data
    },
    async purge({ organizationId, memoryKind, memoryId, requestId, fingerprint, confirmation, reason }) {
      if (![organizationId, memoryId, requestId].every(validId)
        || !kinds.includes(memoryKind) || !/^[0-9a-f]{64}$/.test(fingerprint || '')
        || confirmation !== 'PURGE' || typeof reason !== 'string'
        || reason.trim().length < 10 || reason.trim().length > 1000) {
        throw new TypeError('Exact promoted memory purge required')
      }
      const { data, error } = await client.rpc('purge_promoted_ai_memory', {
        p_organization_id: organizationId, p_memory_kind: memoryKind,
        p_memory_id: memoryId, p_request_id: requestId,
        p_expected_fingerprint: fingerprint, p_confirmation: confirmation,
        p_reason: reason.trim(),
      })
      if (error) throw failure(error, 'Unable to purge promoted memory')
      if (data?.purged_memory_id !== memoryId || data?.memory_kind !== memoryKind) {
        throw Object.assign(new Error('Promoted memory purge receipt did not match'), { status: 409 })
      }
      return data
    },
  }
}

export const promotedMemoryRetentionRepository = createPromotedMemoryRetentionRepository(supabase)
