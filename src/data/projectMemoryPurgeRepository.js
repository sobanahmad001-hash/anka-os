import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})
const scope = (data, organizationId, projectId) => data?.organization_id === organizationId
  && data?.project_id === projectId

export function createProjectMemoryPurgeRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async history(organizationId, projectId) {
      if (!validId(organizationId) || !validId(projectId)) throw new TypeError('Valid project required')
      const { data, error } = await client.rpc('get_project_ai_memory_history', {
        p_organization_id: organizationId, p_project_id: projectId,
      })
      if (error) throw failure(error, 'Unable to load protected memory history')
      if (!scope(data, organizationId, projectId) || !Array.isArray(data.records)
        || data.records.some(row => !validId(row?.id) || !validId(row?.source_comment_id)
          || typeof row?.statement !== 'string' || typeof row?.status !== 'string')) {
        throw Object.assign(new Error('Memory history did not match the active project'), { status: 409 })
      }
      return data.records
    },
    async preview(organizationId, projectId, memoryId) {
      if (![organizationId, projectId, memoryId].every(validId)) throw new TypeError('Valid memory required')
      const { data, error } = await client.rpc('preview_project_ai_memory_purge', {
        p_organization_id: organizationId, p_project_id: projectId, p_memory_id: memoryId,
      })
      if (error) throw failure(error, 'Unable to preview memory purge')
      if (!scope(data, organizationId, projectId) || !Array.isArray(data.memory_ids)
        || !Array.isArray(data.records) || !data.memory_ids.length
        || !data.memory_ids.every(validId) || !data.memory_ids.includes(memoryId)
        || data.records.length !== data.memory_ids.length
        || data.records.some(row => !data.memory_ids.includes(row?.id))) {
        throw Object.assign(new Error('Purge preview did not match the selected project'), { status: 409 })
      }
      return data
    },
    async purge({ organizationId, projectId, memoryId, requestId, memoryIds, confirmation, reason }) {
      if (![organizationId, projectId, memoryId, requestId].every(validId)
        || !Array.isArray(memoryIds) || memoryIds.length < 1 || memoryIds.length > 100
        || !memoryIds.every(validId) || !memoryIds.includes(memoryId)
        || new Set(memoryIds).size !== memoryIds.length
        || confirmation !== 'PURGE' || typeof reason !== 'string'
        || reason.trim().length < 10 || reason.trim().length > 1000) {
        throw new TypeError('Exact approved purge preview and reason required')
      }
      const { data, error } = await client.rpc('purge_project_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_memory_id: memoryId, p_request_id: requestId,
        p_expected_memory_ids: memoryIds, p_confirmation: confirmation,
        p_reason: reason.trim(),
      })
      if (error) throw failure(error, 'Unable to purge memory history')
      if (!Array.isArray(data?.purged_memory_ids)
        || data.purged_memory_ids.length !== memoryIds.length
        || !memoryIds.every(id => data.purged_memory_ids.includes(id))) {
        throw Object.assign(new Error('Purge receipt did not match the reviewed records'), { status: 409 })
      }
      return data
    },
  }
}

export const projectMemoryPurgeRepository = createProjectMemoryPurgeRepository(supabase)
