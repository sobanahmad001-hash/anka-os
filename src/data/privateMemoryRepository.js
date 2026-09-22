import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createPrivateMemoryRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async list(organizationId, ownerId) {
      if (![organizationId, ownerId].every(validId)) throw new TypeError('Active private owner required')
      const { data, error } = await client.rpc('get_private_ai_memory', {
        p_organization_id: organizationId,
      })
      if (error) throw failure(error, 'Unable to load private memory')
      if (data?.organization_id !== organizationId || data?.owner_id !== ownerId
        || !Array.isArray(data.confirmed) || !Array.isArray(data.history)
        || [...data.confirmed, ...data.history].some(row => !validId(row?.id)
          || typeof row?.statement !== 'string'
          || !['owner_note', 'design_experiment'].includes(row?.source_kind))) {
        throw Object.assign(new Error('Private memory did not match its owner'), { status: 409 })
      }
      return data
    },
    async save({ organizationId, requestId, sourceKind, sourceNote = null, sourceJobId = null, statement, supersedesId = null }) {
      if (![organizationId, requestId].every(validId)
        || (supersedesId && !validId(supersedesId))
        || typeof statement !== 'string' || !statement.trim() || statement.trim().length > 1000
        || !['owner_note', 'design_experiment'].includes(sourceKind)
        || (sourceKind === 'owner_note' && (sourceJobId || typeof sourceNote !== 'string'
          || !sourceNote.trim() || sourceNote.trim().length > 2000))
        || (sourceKind === 'design_experiment' && (!validId(sourceJobId) || sourceNote))) {
        throw new TypeError('Exact owner-private source and lesson required')
      }
      const { data, error } = await client.rpc('save_private_ai_memory', {
        p_organization_id: organizationId, p_request_id: requestId,
        p_source_kind: sourceKind, p_source_note: sourceKind === 'owner_note' ? sourceNote.trim() : null,
        p_source_job_id: sourceKind === 'design_experiment' ? sourceJobId : null,
        p_statement: statement.trim(), p_supersedes_id: supersedesId,
      })
      if (error) throw failure(error, 'Unable to save private memory')
      if (data?.memory_id !== requestId || !['confirmed', 'superseded', 'retired'].includes(data.status)) {
        throw Object.assign(new Error('Private memory receipt did not match'), { status: 409 })
      }
      return data
    },
    async retire({ organizationId, memoryId, requestId, reason }) {
      if (![organizationId, memoryId, requestId].every(validId)
        || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) {
        throw new TypeError('Exact private retirement required')
      }
      const { data, error } = await client.rpc('retire_private_ai_memory', {
        p_organization_id: organizationId, p_memory_id: memoryId,
        p_request_id: requestId, p_reason: reason.trim(),
      })
      if (error) throw failure(error, 'Unable to retire private memory')
      if (data?.memory_id !== memoryId || data?.status !== 'retired') {
        throw Object.assign(new Error('Private retirement receipt did not match'), { status: 409 })
      }
      return data
    },
    async previewPurge(organizationId, memoryId, ownerId) {
      if (![organizationId, memoryId, ownerId].every(validId)) throw new TypeError('Exact private memory required')
      const { data, error } = await client.rpc('preview_private_ai_memory_purge', {
        p_organization_id: organizationId, p_memory_id: memoryId,
      })
      if (error) throw failure(error, 'Unable to preview private purge')
      if (data?.organization_id !== organizationId || data?.owner_id !== ownerId
        || !Array.isArray(data.memory_ids) || !Array.isArray(data.records)
        || !data.memory_ids.length || !data.memory_ids.every(validId)
        || !data.memory_ids.includes(memoryId) || data.records.length !== data.memory_ids.length
        || data.records.some(row => !data.memory_ids.includes(row?.id))) {
        throw Object.assign(new Error('Private purge preview did not match'), { status: 409 })
      }
      return data
    },
    async purge({ organizationId, memoryId, requestId, memoryIds, confirmation, reason }) {
      if (![organizationId, memoryId, requestId].every(validId)
        || !Array.isArray(memoryIds) || !memoryIds.length || memoryIds.length > 100
        || !memoryIds.every(validId) || !memoryIds.includes(memoryId)
        || new Set(memoryIds).size !== memoryIds.length
        || confirmation !== 'PURGE' || typeof reason !== 'string'
        || reason.trim().length < 10 || reason.trim().length > 1000) {
        throw new TypeError('Exact confirmed private purge required')
      }
      const { data, error } = await client.rpc('purge_private_ai_memory', {
        p_organization_id: organizationId, p_memory_id: memoryId,
        p_request_id: requestId, p_expected_memory_ids: memoryIds,
        p_confirmation: confirmation, p_reason: reason.trim(),
      })
      if (error) throw failure(error, 'Unable to purge private memory')
      if (!Array.isArray(data?.purged_memory_ids)
        || data.purged_memory_ids.length !== memoryIds.length
        || !memoryIds.every(id => data.purged_memory_ids.includes(id))) {
        throw Object.assign(new Error('Private purge receipt did not match'), { status: 409 })
      }
      return data
    },
  }
}

export const privateMemoryRepository = createPrivateMemoryRepository(supabase)
